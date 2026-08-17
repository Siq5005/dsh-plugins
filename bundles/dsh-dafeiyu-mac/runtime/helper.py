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
except ImportError:
    from animation_model import AnimationModel

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

# 空闲呼吸参数：幅度（比例，±1%）与周期（秒，约 3.5s 一次）。
BREATHE_AMPLITUDE = 0.01
BREATHE_PERIOD_SEC = 3.5


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
        from PySide6.QtCore import Qt, QTimer
        from PySide6.QtGui import QAction, QPixmap
        from PySide6.QtWidgets import QApplication, QLabel, QMenu

        self.Qt = Qt
        self.QTimer = QTimer
        self.QPixmap = QPixmap
        self.QApplication = QApplication
        self.QMenu = QMenu
        self.QAction = QAction

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

        self.setWindowFlags(self._flags_for(config["locked"]))
        self.setAttribute(self.Qt.WA_TranslucentBackground)
        self.setFixedSize(self.BASE_W, self.BASE_H)

        self.pet = QLabel(self)
        self.bubble = QLabel(self)
        self.bubble.setWordWrap(True)
        self.bubble.setAlignment(self.Qt.AlignCenter)
        self.bubble.setStyleSheet(
            "QLabel { background: rgba(20, 20, 30, 210); color: white;"
            " border-radius: 12px; padding: 8px 10px; }"
        )
        self.bubble.hide()

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
            self.model.apply_state(message.get("state", "IDLE"), message.get("activity"))
            self._pulse_until_ms = 0
            self._set_bubble(message)
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
        text = message.get("message") or ""
        detail = message.get("detail") or ""
        if not text and not detail:
            self.bubble.hide()
            return
        size = int(13 * self.config["bubble_scale"])
        parts = [f'<div style="font-size:{size + 2}px; font-weight:600;">{esc(text)}</div>']
        if detail:
            parts.append(f'<div style="font-size:{size - 1}px; opacity:0.8; margin-top:3px;">{esc(detail)}</div>')
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

    # ---- 动画 -----------------------------------------------------
    def _on_anim_tick(self) -> None:
        now = time.monotonic() * 1000
        delta = now - self._clock_ms
        self._clock_ms = now
        # PULSE（成功/失败）是带 TTL 的瞬态状态：过期后回落到 resume 状态，
        # 避免"完成/出错"动画无限循环。
        if self._pulse_until_ms and now >= self._pulse_until_ms:
            self._expire_pulse()
        self.model.tick(max(1, min(int(delta), 200)))
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
        scale = self.config["scale"]
        if self.config["reduced_motion"]:
            motion = None
        phase = (self._clock_ms % 1000) / 1000.0
        phase_sec = self._clock_ms / 1000.0
        dx = dy = 0.0
        if motion == "breathe":
            # 缓慢呼吸：±1% 缩放，约 3.5s 一个周期（原实现 1s 太快、2% 太明显）。
            scale *= 1.0 + BREATHE_AMPLITUDE * math.sin(phase_sec * (math.tau / BREATHE_PERIOD_SEC))
        elif motion == "bounce":
            dy = -14 * abs(math.sin(phase * math.tau))
        elif motion == "shake":
            dx = 5 * math.sin(phase * math.tau * 2)
        elif motion == "dizzy":
            dx = 3 * math.sin(phase * math.tau * 3)

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
            self._drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self.config["locked"] or self._drag_offset is None:
            return
        self.move(event.globalPosition().toPoint() - self._drag_offset)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        self._drag_offset = None

    def contextMenuEvent(self, event) -> None:  # noqa: N802
        if self.config["locked"]:
            return
        menu = self.QMenu(self)
        quit_action = self.QAction("退出大肥鱼", self)
        quit_action.triggered.connect(self._quit)
        menu.addAction(quit_action)
        menu.exec(event.globalPos())

    def _quit(self) -> None:
        emit_reply("closed")
        self.QApplication.quit()

    def closeEvent(self, event) -> None:  # noqa: N802
        self.QApplication.quit()


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
    window = PetWindow(model, asset_root, inbox, config)
    window.show()

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
