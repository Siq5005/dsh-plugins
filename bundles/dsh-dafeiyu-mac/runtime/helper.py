"""Native BigFish helper for macOS (replica of dsh-dafeiyu, Phase-1 core).

The DSH plugin owns this process and sends newline-delimited JSON over stdin.
Closing stdin is a lifecycle signal: the helper exits instead of becoming an
independent desktop application.

Visual mode renders a frameless, always-on-top, transparent pet window with a
state bubble; headless mode only exercises the JSONL protocol (no Qt needed).

Locked mode (config["locked"]) makes the window click-through
(Qt.WindowTransparentForInput) so the pet never blocks desktop interaction,
like a locked floating lyrics window.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import queue
import random
import sys
import threading
import time
from pathlib import Path
from typing import Any, TextIO

try:
    from .animation_model import AnimationModel
    from .layout_store import default_layout_path, load_layout, save_layout
except ImportError:
    from animation_model import AnimationModel
    from layout_store import default_layout_path, load_layout, save_layout

try:
    # PetWindow 的基类。headless 模式没有 PySide6 时退化为 object，
    # PetWindow 只在 visual 模式（run_visual）里实例化。
    from PySide6.QtWidgets import QWidget
except ImportError:
    QWidget = object  # type: ignore[misc,assignment]

PROTOCOL_VERSION = 1
STATES = {"IDLE", "THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR", "DISCONNECTED"}

# 气泡底部与角色顶部的间距（px）。
BUBBLE_GAP = 8


def bundle_root() -> Path:
    """Locate packaged assets both from source and a frozen build."""
    frozen_root = getattr(sys, "_MEIPASS", None)
    if frozen_root is not None:
        return Path(frozen_root)
    return Path(__file__).resolve().parent.parent


def configure_stdio() -> None:
    """Make the JSONL pipe UTF-8 regardless of locale."""
    for stream, errors in ((sys.stdin, "strict"), (sys.stdout, "backslashreplace"), (sys.stderr, "backslashreplace")):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors=errors)


def parse_message(line: str) -> dict[str, Any]:
    message = json.loads(line)
    if not isinstance(message, dict):
        raise ValueError("message must be an object")
    if message.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    kind = message.get("kind")
    if kind in {"state", "pulse"} and message.get("state") not in STATES:
        raise ValueError("unsupported companion state")
    return message


def emit_reply(kind: str, **payload: Any) -> None:
    print(
        json.dumps(
            {"protocolVersion": PROTOCOL_VERSION, "kind": kind, "timestamp": int(time.time() * 1000), **payload},
            ensure_ascii=False,
        ),
        flush=True,
    )


def esc(text: Any) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class EventRecorder:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._stream: TextIO | None = None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._stream = path.open("a", encoding="utf-8")

    def record(self, message: dict[str, Any]) -> None:
        if self._stream is None:
            return
        self._stream.write(json.dumps(message, ensure_ascii=False) + "\n")
        self._stream.flush()

    def close(self) -> None:
        if self._stream is not None:
            self._stream.close()


def run_headless(recorder: EventRecorder) -> int:
    try:
        emit_reply("ready")
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = parse_message(line)
            except (ValueError, json.JSONDecodeError) as error:
                print(json.dumps({"kind": "error", "message": str(error)}), flush=True)
                continue
            recorder.record(message)
            if message.get("kind") == "ping":
                emit_reply("pong")
                continue
            if message.get("kind") == "shutdown":
                break
    finally:
        recorder.close()
    return 0


class PetWindow(QWidget):
    """Frameless always-on-top pet window: character frame + state bubble.

    `config` is a shared mutable dict (scale / bubble_scale / activity_level /
    reduced_motion / locked), updated by CONFIG messages from the DSH host.
    """

    BASE_W, BASE_H = 300, 330
    PET_W, PET_H = 238, 238

    def __init__(self, model: AnimationModel, asset_root: Path, inbox: "queue.Queue[dict[str, Any]]", config: dict[str, Any]) -> None:
        super().__init__()
        # PetWindow 只在 visual 模式使用；导入放在这里，保持 headless
        # 模式不依赖 PySide6。
        from PySide6.QtCore import QPoint, Qt, QTimer
        from PySide6.QtGui import QAction, QPixmap
        from PySide6.QtWidgets import QApplication, QLabel, QMenu

        self.Qt = Qt
        self.QTimer = QTimer
        self.QPixmap = QPixmap
        self.QApplication = QApplication
        self.QMenu = QMenu
        self.QAction = QAction
        self.QPoint = QPoint

        self.model = model
        self.asset_root = asset_root
        self.inbox = inbox
        self.config = config
        self._pixmaps: dict[str, Any] = {}
        self._drag_offset: Any = None
        self._clock_ms = 0
        self._micro_timer: Any = None
        self._pulse_until_ms = 0
        self._pulse_resume: tuple[str, str | None] | None = None
        self._pet_rect: tuple[int, int, int, int] | None = None
        # 动画扩展：走动 / 入场 / 提问表情。
        self._walk: dict[str, Any] | None = None
        self._anim_started = False
        self._question_phase = "none"

        self.setWindowFlags(self._flags_for(config["locked"]))
        self.setAttribute(self.Qt.WA_TranslucentBackground)
        self.setFixedSize(self.BASE_W, self.BASE_H)

        # 位置持久化：重启 DSH 后恢复到上次拖拽的位置。
        self.layout_path = default_layout_path()
        self._restore_position()

        self.pet = QLabel(self)
        self.bubble = QLabel(self)
        self.bubble.setWordWrap(True)
        self.bubble.setAlignment(self.Qt.AlignCenter)
        self.bubble.setStyleSheet(
            "QLabel { background: rgba(20, 20, 30, 210); color: white;"
            " border-radius: 12px; padding: 8px 10px; }"
        )
        self.bubble.hide()

        # 余额合并进状态气泡的最下面一行；收到 balance 消息后更新。
        self._bubble_message: dict[str, Any] | None = None
        self._balance_text = ""
        self._balance_detail = ""

        self.lock_badge = QLabel("🔒", self)
        self.lock_badge.setStyleSheet(
            "background: rgba(20, 20, 30, 180); color: white; border-radius: 8px;"
            " padding: 2px 6px; font-size: 11px;"
        )
        self.lock_badge.adjustSize()
        self.lock_badge.move(self.width() - self.lock_badge.width() - 6, 6)
        self.lock_badge.setVisible(config["locked"])

        self.anim_timer = QTimer(self)
        self.anim_timer.timeout.connect(self._on_anim_tick)
        self.anim_timer.start(33)
        self.poll_timer = QTimer(self)
        self.poll_timer.timeout.connect(self._poll_inbox)
        self.poll_timer.start(16)
        self._schedule_idle_micro()

    def _flags_for(self, locked: bool) -> Any:
        flags = self.Qt.FramelessWindowHint | self.Qt.WindowStaysOnTopHint
        if locked:
            # 点击穿透：锁定后窗口不拦截任何鼠标事件（类似锁定的悬浮歌词）。
            flags |= self.Qt.WindowTransparentForInput
        return flags

    # ---- 位置持久化 / 全桌面 ------------------------------------------
    def _restore_position(self) -> None:
        layout = load_layout(self.layout_path)
        if layout["x"] is None or layout["y"] is None:
            # 首次运行：屏幕底部中央。
            screen = self.QApplication.primaryScreen()
            if screen is not None:
                geo = screen.availableGeometry()
                self.move(
                    geo.x() + (geo.width() - self.BASE_W) // 2,
                    geo.bottom() - self.BASE_H - 40,
                )
            return
        self.move(layout["x"], layout["y"])
        self._clamp_to_screen()

    def _clamp_to_screen(self) -> None:
        """窗口至少保留一角可见（分辨率/多屏变化后不丢失窗口）。"""
        center = self.pos() + self.QPoint(self.BASE_W // 2, self.BASE_H // 2)
        screen = self.QApplication.screenAt(center) or self.QApplication.primaryScreen()
        if screen is None:
            return
        geo = screen.availableGeometry()
        x = min(max(self.x(), geo.x() - self.BASE_W + 80), geo.right() - 80)
        y = min(max(self.y(), geo.y()), geo.bottom() - 40)
        self.move(x, y)

    def _persist_position(self) -> None:
        try:
            save_layout(self.layout_path, self.x(), self.y())
        except OSError:
            pass

    def _enable_all_spaces(self) -> None:
        """macOS：让窗口在所有桌面（Spaces）显示，切换桌面也保持可见。

        通过 pyobjc 设置 NSWindow collectionBehavior 的 CanJoinAllSpaces；
        pyobjc 缺失或非 macOS 时静默降级（仅当前桌面显示）。
        """
        try:
            import objc
            from AppKit import NSWindowCollectionBehaviorCanJoinAllSpaces
            nsview = objc.objc_object(c_void_p=self.winId())
            nswindow = nsview.window()
            nswindow.setCollectionBehavior_(
                nswindow.collectionBehavior() | NSWindowCollectionBehaviorCanJoinAllSpaces
            )
        except Exception:
            pass

    # ---- 消息处理 -------------------------------------------------
    def _poll_inbox(self) -> None:
        while True:
            try:
                message = self.inbox.get_nowait()
            except queue.Empty:
                break
            self._handle(message)

    def _handle(self, message: dict[str, Any]) -> None:
        kind = message.get("kind")
        if kind == "state":
            state = message.get("state", "IDLE")
            self.model.apply_state(state, message.get("activity"))
            self._pulse_until_ms = 0
            self._question_phase = "none"
            self._set_bubble(message)
            self._maybe_play_sequence(state, message.get("activity"))
        elif kind == "pulse":
            self.model.apply_state(message.get("state", "IDLE"), message.get("resumeActivity"))
            self._pulse_until_ms = time.monotonic() * 1000 + int(message.get("ttlMs", 1500))
            self._pulse_resume = (
                message.get("resumeState", "IDLE"),
                message.get("resumeActivity"),
                message.get("resumeMessage"),
                message.get("resumeDetail"),
            )
            self._set_bubble(message)
        elif kind == "task":
            self._set_bubble(message)
        elif kind == "balance":
            self._set_balance(message)
        elif kind == "question":
            self._apply_question(message)
        elif kind == "config":
            self.config["scale"] = float(message.get("scale", self.config["scale"]))
            self.config["bubble_scale"] = float(message.get("bubbleScale", self.config["bubble_scale"]))
            self.config["activity_level"] = str(message.get("activityLevel", self.config["activity_level"]))
            self.config["reduced_motion"] = bool(message.get("reducedMotion", self.config["reduced_motion"]))
            locked = bool(message.get("locked", self.config["locked"]))
            if locked != self.config["locked"]:
                self.config["locked"] = locked
                self._apply_lock()
            self._schedule_idle_micro()
        elif kind == "ping":
            emit_reply("pong")
        elif kind == "shutdown":
            self.QApplication.quit()

    def _set_bubble(self, message: dict[str, Any]) -> None:
        self._bubble_message = message
        self._render_bubble()

    def _set_balance(self, message: dict[str, Any]) -> None:
        self._balance_text = message.get("message") or ""
        self._balance_detail = message.get("detail") or ""
        self._render_bubble()

    def _render_bubble(self) -> None:
        base = self._bubble_message or {}
        text = base.get("message") or ""
        detail = base.get("detail") or ""
        balance_text = self._balance_text
        balance_detail = self._balance_detail
        if not text and not detail and not balance_text and not balance_detail:
            self.bubble.hide()
            return
        size = int(13 * self.config["bubble_scale"])
        parts: list[str] = []
        if text:
            parts.append(f'<div style="font-size:{size + 2}px; font-weight:600;">{esc(text)}</div>')
        if detail:
            parts.append(f'<div style="font-size:{size - 1}px; opacity:0.8; margin-top:3px;">{esc(detail)}</div>')
        if balance_text or balance_detail:
            if parts:
                parts.append('<div style="font-size:10px; opacity:0.45; margin-top:3px;">—</div>')
            if balance_text:
                parts.append(
                    f'<div style="font-size:{size}px; font-weight:600; margin-top:3px;">{esc(balance_text)}</div>'
                )
            if balance_detail:
                parts.append(
                    f'<div style="font-size:{max(10, size - 2)}px; opacity:0.8; margin-top:2px;">{esc(balance_detail)}</div>'
                )
        self.bubble.setText("".join(parts))
        self.bubble.adjustSize()
        self.bubble.setMaximumWidth(self.width() - 24)
        self._layout_bubble()

    def _layout_bubble(self) -> None:
        bw = self.bubble.width()
        bh = self.bubble.height()
        rect = self._pet_rect
        if rect is None:
            # 角色还没渲染出来时退化为窗口顶部。
            self.bubble.move((self.width() - bw) // 2, 8)
        else:
            px, py, sw, _sh = rect
            cx = px + sw // 2
            x = max(4, min(cx - bw // 2, self.width() - bw - 4))
            y = max(2, py - bh - BUBBLE_GAP)
            self.bubble.move(x, y)
        self.bubble.show()

    # ---- 动画扩展：场景序列 / 提问 / 走动 / 入场 ----------------------
    def _wall_clips(self, wall_id: str) -> list[str]:
        for group in self.model.photo_wall:
            if group.get("id") == wall_id:
                return list(group.get("clips", []))
        return []

    def _maybe_play_sequence(self, state: str, activity: str | None = None) -> None:
        """状态进入时按 photoWall 场景播放一组 clip（搜索/工作/提问）。"""
        if state == "WORKING":
            key = "searching" if activity == "searching" else "working"
        elif state == "WAITING":
            key = "question"
        else:
            return
        clips = self._wall_clips(key)
        if clips:
            self.model.play_sequence(clips)

    def _apply_question(self, message: dict[str, Any]) -> None:
        """收到 QUESTION：播放 question 表情并把问题文本放进气泡。"""
        question = message.get("question") or ""
        self._question_phase = "asked"
        self._question_phase_ms = time.monotonic() * 1000
        self.model.play_overlay("question")
        if question:
            self._set_bubble({"message": question, "detail": "等你回答"})

    def _maybe_enter(self) -> None:
        if self._anim_started:
            return
        self._anim_started = True
        # 已有真实状态时跳过入场动画（避免入场覆盖状态序列）。
        if self.model.base_state != "IDLE":
            return
        clips = self._wall_clips("enter")
        if clips:
            self.model.play_sequence(clips)

    def _start_walk(self) -> None:
        """空闲巡逻。

        解锁：窗口随鱼平移（不持久化位置）；
        锁定：窗口不动，鱼在窗口内横向走动（纯动画位移）。
        """
        if self._walk is not None or self.config["reduced_motion"]:
            return
        if self.model.base_state != "IDLE" or self.model.overlay_clip_name is not None:
            return
        direction = random.choice([-1, 1])
        distance = random.randint(60, 140)
        side = "left" if direction < 0 else "right"
        self._walk = {"dir": direction, "remaining": float(distance), "offset": 0.0}
        self.model.play_sequence([f"walk_start_{side}", f"walk_side_{side}"])

    def _tick_walk(self, delta_ms: int) -> None:
        walk = self._walk
        if walk is None:
            return
        speed = 0.16  # px/ms
        if self.config["locked"]:
            # 锁定：窗口不动，位移作用于窗口内的鱼（pet），走到边缘停步回中。
            walk["offset"] += walk["dir"] * speed * delta_ms
            limit = max(10, (self.width() - self.pet.width()) / 2 - 12)
            if abs(walk["offset"]) >= limit:
                walk["offset"] = 0.0
                self._finish_walk()
            return
        step = walk["dir"] * speed * delta_ms
        screen = self.QApplication.primaryScreen()
        if screen is not None:
            geo = screen.availableGeometry()
            new_x = min(max(self.x() + step, geo.x()), geo.right() - self.BASE_W + 1)
            step = new_x - self.x()
            if abs(step) < 0.5:
                # 贴屏幕边缘：掉头继续走（自然转身），而不是终止——
                # 否则靠近边缘时该方向的走动会瞬间结束，观感上偏向另一方向。
                walk["dir"] *= -1
                side = "left" if walk["dir"] < 0 else "right"
                self.model.play_sequence([f"walk_start_{side}", f"walk_side_{side}"])
                walk["remaining"] = max(walk["remaining"], 40.0)
                return
        else:
            new_x = self.x() + step
        self.move(int(new_x), self.y())
        walk["remaining"] -= abs(step)
        if walk["remaining"] <= 0:
            self._finish_walk()

    def _finish_walk(self) -> None:
        walk = self._walk
        self._walk = None
        if walk is None:
            return
        side = "left" if walk["dir"] < 0 else "right"
        # 停步动画作为 overlay 播放，播完回落待机。
        self.model.play_overlay(f"walk_stop_{side}")
        self._schedule_idle_micro()

    # ---- 动画 -----------------------------------------------------
    def _on_anim_tick(self) -> None:
        now = time.monotonic() * 1000
        delta = now - self._clock_ms
        self._clock_ms = now
        delta = max(1, min(int(delta), 200))
        # PULSE（成功/失败）是带 TTL 的瞬态状态：过期后回落到 resume 状态，
        # 避免"完成/出错"动画无限循环。
        if self._pulse_until_ms and now >= self._pulse_until_ms:
            self._expire_pulse()
        self._maybe_enter()
        self._tick_walk(delta)
        self.model.tick(delta)
        self._render_pet()
        # 动画位移会让角色移动，气泡保持贴在其上方。
        if self.bubble.isVisible():
            self._layout_bubble()

    def _expire_pulse(self) -> None:
        self._pulse_until_ms = 0
        if self._pulse_resume is None:
            return
        state, activity, message, detail = self._pulse_resume
        self._pulse_resume = None
        self.model.apply_state(state, activity)
        self._set_bubble({"message": message, "detail": detail})

    def _render_pet(self) -> None:
        frame_path = self.model.frame
        pixmap = self._pixmaps.get(frame_path)
        if pixmap is None:
            pixmap = self.QPixmap(str(self.asset_root / frame_path))
            self._pixmaps[frame_path] = pixmap
        if pixmap.isNull():
            return

        motion = self.model.motion
        # clip 自带缩放（如坐姿 1.08）叠加上用户 scale。
        scale = self.config["scale"] * self.model.clips[self.model.active_clip_name].scale
        if self.config["reduced_motion"]:
            motion = None
        phase = (self._clock_ms % 1000) / 1000.0
        phase_sec = self._clock_ms / 1000.0
        dx = dy = 0.0
        if motion == "bounce":
            dy = -14 * abs(math.sin(phase * math.tau))
        elif motion == "shake":
            dx = 5 * math.sin(phase * math.tau * 2)
        elif motion == "dizzy":
            dx = 3 * math.sin(phase * math.tau * 3)
        elif motion == "think":
            dy = 3 * math.sin(phase_sec * 2.8)
        elif motion == "work":
            dx = 3 * math.sin(phase_sec * 5.4)
        elif motion == "wait":
            dy = 1 * math.sin(phase_sec * 1.8)
        elif motion == "float":
            dy = 4 * math.sin(phase_sec * 3.0)

        w = max(1, int(self.PET_W * scale))
        h = max(1, int(self.PET_H * scale))
        scaled = pixmap.scaled(w, h, self.Qt.KeepAspectRatio, self.Qt.SmoothTransformation)
        # setPixmap 只更新 sizeHint，QLabel 不会自动调整自身尺寸；
        # 不 adjustSize 会把角色裁在默认 100x30 的框里。
        self.pet.setPixmap(scaled)
        self.pet.adjustSize()
        sw, sh = scaled.width(), scaled.height()

        # 窗口高度动态适配：足够容纳鱼 + 气泡，避免放大时气泡被挤出窗口。
        need = sh + 12
        if self.bubble.isVisible():
            need += self.bubble.height() + BUBBLE_GAP + 6
        target = max(self.BASE_H, int(need))
        if target != self.height():
            self.setFixedSize(self.BASE_W, target)

        px = int((self.width() - sw) / 2 + dx)
        if self._walk is not None and self.config["locked"]:
            # 锁定时走动：鱼在窗口内横向移动（窗口本身不动）。
            px += int(self._walk.get("offset", 0.0))
        py = int(self.height() - sh - 12 + dy)
        self.pet.move(px, py)
        self._pet_rect = (px, py, sw, sh)

    # ---- 空闲微动画 ------------------------------------------------
    def _schedule_idle_micro(self) -> None:
        if self._micro_timer is not None:
            self._micro_timer.stop()
        if self.config["reduced_motion"] or not self.model.idle_micro_clips:
            return
        interval = {"quiet": 9000, "normal": 5200, "lively": 2800}[self.config["activity_level"]]
        self._micro_timer = self.QTimer(self)
        self._micro_timer.setSingleShot(True)
        self._micro_timer.timeout.connect(self._play_idle_micro)
        self._micro_timer.start(interval + random.randint(0, 2500))

    def _play_idle_micro(self) -> None:
        if self.model.base_state == "IDLE" and not self.model.overlay_clip_name:
            if random.random() < 0.25:
                # 约 1/4 概率触发走动巡逻。
                self._start_walk()
            else:
                self.model.play_overlay(random.choice(self.model.idle_micro_clips))
        self._schedule_idle_micro()

    # ---- 锁定 / 拖拽 / 右键 ------------------------------------------
    def _apply_lock(self) -> None:
        self.setWindowFlags(self._flags_for(self.config["locked"]))
        self.setAttribute(self.Qt.WA_TranslucentBackground)
        self.show()
        self.lock_badge.setVisible(self.config["locked"])

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if self.config["locked"]:
            return
        if event.button() == self.Qt.LeftButton:
            # 拖拽开始：终止进行中的走动，避免两个 move 互相覆盖。
            self._walk = None
            self._drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
            # 拖拽细节：抓取姿势（如有素材）。
            if "dragging_hold" in self.model.clips:
                self.model.play_overlay("dragging_hold")

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self.config["locked"] or self._drag_offset is None:
            return
        self.move(event.globalPosition().toPoint() - self._drag_offset)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        dragging = self._drag_offset is not None
        self._drag_offset = None
        self._persist_position()
        if dragging and "dragging_release" in self.model.clips:
            # 松手：播放放下动画（单次，播完回落）。
            self.model.play_overlay("dragging_release")

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        # 双击戳一戳。
        if self.config["locked"]:
            return
        if "poke" in self.model.clips:
            self.model.play_overlay("poke")

    def contextMenuEvent(self, event) -> None:  # noqa: N802
        if self.config["locked"]:
            return
        menu = self.QMenu(self)
        pet_action = self.QAction("摸摸头", self)
        pet_action.triggered.connect(lambda: self.model.play_overlay("head_pat"))
        poke_action = self.QAction("戳一戳", self)
        poke_action.triggered.connect(lambda: self.model.play_overlay("poke"))
        quit_action = self.QAction("退出大肥鱼", self)
        quit_action.triggered.connect(self._quit)
        menu.addAction(pet_action)
        menu.addAction(poke_action)
        menu.addSeparator()
        menu.addAction(quit_action)
        menu.exec(event.globalPos())

    def _quit(self) -> None:
        emit_reply("closed")
        self.QApplication.quit()

    def closeEvent(self, event) -> None:  # noqa: N802
        self.QApplication.quit()


def hide_dock_icon() -> None:
    """macOS：以 accessory 激活策略运行，隐藏 Dock 图标与菜单栏。

    桌宠窗口仍正常显示与交互；非 macOS 或 pyobjc 缺失时静默降级。
    DSH_DAFEIYU_VERBOSE=1 时把生效的策略值打印到 stderr（诊断用）。
    """
    try:
        from AppKit import NSApplication, NSApplicationActivationPolicyAccessory
        NSApplication.sharedApplication().setActivationPolicy_(NSApplicationActivationPolicyAccessory)
        if os.environ.get("DSH_DAFEIYU_VERBOSE") == "1":
            print(f"activationPolicy={NSApplication.sharedApplication().activationPolicy()}", file=sys.stderr, flush=True)
    except Exception:
        pass


def run_visual(recorder: EventRecorder) -> int:
    try:
        from PySide6.QtCore import Qt  # noqa: F401  (window flags inside PetWindow)
        from PySide6.QtWidgets import QApplication
    except ImportError:
        print("PySide6 is required for visual mode. Run with --headless for protocol tests.", file=sys.stderr)
        return 2

    manifest = json.loads((bundle_root() / "assets" / "pet-manifest.json").read_text(encoding="utf-8"))
    asset_root = bundle_root() / "assets" / "pet"
    model = AnimationModel(manifest)
    inbox: "queue.Queue[dict[str, Any]]" = queue.Queue()

    def env_float(name: str, default: float) -> float:
        try:
            return float(os.environ.get(name, ""))
        except ValueError:
            return default

    config = {
        "scale": env_float("DSH_DAFEIYU_SCALE", 1.0),
        "bubble_scale": env_float("DSH_DAFEIYU_BUBBLE_SCALE", 1.0),
        "activity_level": os.environ.get("DSH_DAFEIYU_ACTIVITY_LEVEL", "normal"),
        "reduced_motion": os.environ.get("DSH_DAFEIYU_REDUCED_MOTION", "0") == "1",
        "locked": os.environ.get("DSH_DAFEIYU_LOCKED", "0") == "1",
    }

    app = QApplication(sys.argv)
    # 隐藏 Dock 图标（在窗口显示前设置，避免图标闪现）。
    hide_dock_icon()
    window = PetWindow(model, asset_root, inbox, config)
    window.show()
    window._enable_all_spaces()

    def reader() -> None:
        try:
            for line in sys.stdin:
                if not line.strip():
                    continue
                try:
                    inbox.put(parse_message(line))
                except (ValueError, json.JSONDecodeError) as error:
                    print(json.dumps({"kind": "error", "message": str(error)}), flush=True)
        finally:
            recorder.close()
            QApplication.quit()

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    emit_reply("ready")
    return app.exec()


def main() -> int:
    parser = argparse.ArgumentParser(description="DSH BigFish native helper (macOS replica)")
    parser.add_argument("--headless", action="store_true", help="protocol-only mode, no Qt window")
    parser.add_argument("--event-log", type=Path, default=None, help="append received messages to a JSONL file")
    args = parser.parse_args()
    configure_stdio()
    recorder = EventRecorder(args.event_log)
    if args.headless:
        return run_headless(recorder)
    return run_visual(recorder)


if __name__ == "__main__":
    sys.exit(main())
