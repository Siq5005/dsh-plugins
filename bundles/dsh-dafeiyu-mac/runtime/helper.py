"""Native BigFish helper for macOS (replica of dsh-dafeiyu, Phase-1 core).

The DSH plugin owns this process and sends newline-delimited JSON over stdin.
Closing stdin is a lifecycle signal: the helper exits instead of becoming an
independent desktop application.

Visual mode renders a frameless, always-on-top, transparent pet window with a
state bubble; headless mode only exercises the JSONL protocol (no Qt needed).
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

PROTOCOL_VERSION = 1
STATES = {"IDLE", "THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR", "DISCONNECTED"}


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


def run_visual(recorder: EventRecorder) -> int:
    try:
        from PySide6.QtCore import QPoint, Qt, QTimer
        from PySide6.QtGui import QAction, QColor, QFont, QPainter, QPixmap
        from PySide6.QtWidgets import QApplication, QLabel, QMenu, QVBoxLayout, QWidget
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
    }

    class PetWindow(QWidget):
        BASE_W, BASE_H = 300, 330
        PET_W, PET_H = 238, 238

        def __init__(self) -> None:
            super().__init__()
            self._pixmaps: dict[str, QPixmap] = {}
            self._drag_offset: QPoint | None = None
            self._clock_ms = 0
            self._micro_timer: QTimer | None = None
            self._pulse_until_ms = 0
            self._pulse_resume: tuple[str, str | None] | None = None

            self.setWindowFlags(
                # 与上游一致：不加 WindowDoesNotAcceptFocus，避免 macOS 上
                # 无焦点窗口收不到鼠标事件导致无法拖动。
                Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
            )
            self.setAttribute(Qt.WA_TranslucentBackground)
            self.setFixedSize(self.BASE_W, self.BASE_H)

            self.pet = QLabel(self)
            self.bubble = QLabel(self)
            self.bubble.setWordWrap(True)
            self.bubble.setAlignment(Qt.AlignCenter)
            self.bubble.setStyleSheet(
                "QLabel { background: rgba(20, 20, 30, 210); color: white;"
                " border-radius: 12px; padding: 8px 10px; }"
            )
            self.bubble.hide()

            self.anim_timer = QTimer(self)
            self.anim_timer.timeout.connect(self._on_anim_tick)
            self.anim_timer.start(33)
            self.poll_timer = QTimer(self)
            self.poll_timer.timeout.connect(self._poll_inbox)
            self.poll_timer.start(16)
            self._schedule_idle_micro()

        # ---- 消息处理 -------------------------------------------------
        def _poll_inbox(self) -> None:
            while True:
                try:
                    message = inbox.get_nowait()
                except queue.Empty:
                    break
                self._handle(message)

        def _handle(self, message: dict[str, Any]) -> None:
            kind = message.get("kind")
            if kind == "state":
                model.apply_state(message.get("state", "IDLE"), message.get("activity"))
                self._pulse_until_ms = 0
                self._set_bubble(message)
            elif kind == "pulse":
                model.apply_state(message.get("state", "IDLE"), message.get("resumeActivity"))
                self._pulse_until_ms = time.monotonic() * 1000 + int(message.get("ttlMs", 1500))
                self._pulse_resume = (message.get("resumeState", "IDLE"), message.get("resumeActivity"))
                self._set_bubble(message)
            elif kind == "task":
                self._set_bubble(message)
            elif kind == "config":
                config["scale"] = float(message.get("scale", config["scale"]))
                config["bubble_scale"] = float(message.get("bubbleScale", config["bubble_scale"]))
                config["activity_level"] = str(message.get("activityLevel", config["activity_level"]))
                config["reduced_motion"] = bool(message.get("reducedMotion", config["reduced_motion"]))
                self._schedule_idle_micro()
            elif kind == "ping":
                emit_reply("pong")
            elif kind == "shutdown":
                QApplication.quit()

        def _set_bubble(self, message: dict[str, Any]) -> None:
            text = message.get("message") or ""
            detail = message.get("detail") or ""
            if not text and not detail:
                self.bubble.hide()
                return
            size = int(13 * config["bubble_scale"])
            parts = [f'<div style="font-size:{size + 2}px; font-weight:600;">{_esc(text)}</div>']
            if detail:
                parts.append(f'<div style="font-size:{size - 1}px; opacity:0.8; margin-top:3px;">{_esc(detail)}</div>')
            self.bubble.setText("".join(parts))
            self.bubble.adjustSize()
            self.bubble.setMaximumWidth(self.width() - 24)
            self._layout_bubble()

        def _layout_bubble(self) -> None:
            bw = self.bubble.width()
            bh = self.bubble.height()
            self.bubble.move((self.width() - bw) // 2, 8)
            self.bubble.show()

        # ---- 动画 -----------------------------------------------------
        def _on_anim_tick(self) -> None:
            now = time.monotonic() * 1000
            delta = now - self._clock_ms
            self._clock_ms = now
            model.tick(max(1, min(int(delta), 200)))
            self._render_pet()

        def _render_pet(self) -> None:
            frame_path = model.frame
            pixmap = self._pixmaps.get(frame_path)
            if pixmap is None:
                pixmap = QPixmap(str(asset_root / frame_path))
                self._pixmaps[frame_path] = pixmap
            if pixmap.isNull():
                return

            motion = model.motion
            scale = config["scale"]
            if config["reduced_motion"]:
                motion = None
            phase = (self._clock_ms % 1000) / 1000.0
            dx = dy = 0.0
            if motion == "breathe":
                scale *= 1.0 + 0.02 * math.sin(phase * math.tau)
            elif motion == "bounce":
                dy = -14 * abs(math.sin(phase * math.tau))
            elif motion == "shake":
                dx = 5 * math.sin(phase * math.tau * 2)
            elif motion == "dizzy":
                dx = 3 * math.sin(phase * math.tau * 3)

            w = max(1, int(self.PET_W * scale))
            h = max(1, int(self.PET_H * scale))
            scaled = pixmap.scaled(w, h, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            # setPixmap 只更新 sizeHint，QLabel 不会自动调整自身尺寸；
            # 不 adjustSize 会把角色裁在默认 100x30 的框里。
            self.pet.setPixmap(scaled)
            self.pet.adjustSize()
            sw, sh = scaled.width(), scaled.height()
            self.pet.move(int((self.width() - sw) / 2 + dx), int(self.height() - sh - 12 + dy))

        # ---- 空闲微动画 ------------------------------------------------
        def _schedule_idle_micro(self) -> None:
            if self._micro_timer is not None:
                self._micro_timer.stop()
            if config["reduced_motion"] or not model.idle_micro_clips:
                return
            interval = {"quiet": 9000, "normal": 5200, "lively": 2800}[config["activity_level"]]
            self._micro_timer = QTimer(self)
            self._micro_timer.setSingleShot(True)
            self._micro_timer.timeout.connect(self._play_idle_micro)
            self._micro_timer.start(interval + random.randint(0, 2500))

        def _play_idle_micro(self) -> None:
            if model.base_state == "IDLE" and not model.overlay_clip_name:
                model.play_overlay(random.choice(model.idle_micro_clips))
            self._schedule_idle_micro()

        # ---- 拖拽 / 右键 ------------------------------------------------
        def mousePressEvent(self, event) -> None:  # noqa: N802
            if event.button() == Qt.LeftButton:
                self._drag_offset = event.globalPosition().toPoint() - self.frameGeometry().topLeft()

        def mouseMoveEvent(self, event) -> None:  # noqa: N802
            if self._drag_offset is not None:
                self.move(event.globalPosition().toPoint() - self._drag_offset)

        def mouseReleaseEvent(self, event) -> None:  # noqa: N802
            self._drag_offset = None

        def contextMenuEvent(self, event) -> None:  # noqa: N802
            menu = QMenu(self)
            quit_action = QAction("退出大肥鱼", self)
            quit_action.triggered.connect(self._quit)
            menu.addAction(quit_action)
            menu.exec(event.globalPos())

        def _quit(self) -> None:
            emit_reply("closed")
            QApplication.quit()

        def closeEvent(self, event) -> None:  # noqa: N802
            QApplication.quit()

    def _esc(text: Any) -> str:
        return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    app = QApplication(sys.argv)
    window = PetWindow()
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
