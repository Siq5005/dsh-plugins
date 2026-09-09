"""Pure animation state model for the BigFish native helper (macOS replica).

The model has no Qt dependency. It maps companion states to animation clips
from the pet manifest, advances frames, and lets short overlay clips (blink,
glance) return to the durable state clip. Design follows the concept of
QCYTSN/dsh-dafeiyu's animation_model (MIT), simplified for this replica.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

STATES = {"IDLE", "THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR", "DISCONNECTED"}


@dataclass(frozen=True)
class Clip:
    name: str
    frames: tuple[str, ...]
    frame_ms: int
    loop: bool
    motion: str | None = None
    scale: float = 1.0


class AnimationModel:
    def __init__(self, manifest: dict[str, Any]) -> None:
        self.clips = {
            name: Clip(
                name=name,
                frames=tuple(value["frames"]),
                frame_ms=int(value["frameMs"]),
                loop=bool(value["loop"]),
                motion=value.get("motion"),
                scale=float(value.get("scale", 1.0)),
            )
            for name, value in manifest["clips"].items()
        }
        self.state_map = dict(manifest["stateMap"])
        self.working_activity_map = dict(manifest.get("workingActivityMap", {}))
        self.idle_micro_clips = tuple(manifest.get("idleMicroClips", ()))
        self.photo_wall = list(manifest.get("photoWall", []))
        self.base_state = "IDLE"
        self.base_activity: str | None = None
        self.base_clip_name = self.state_map["IDLE"]
        self.overlay_clip_name: str | None = None
        self.active_clip_name = self.base_clip_name
        self.frame_index = 0
        self.frame_elapsed_ms = 0
        self.sequence: list[str] = []
        self.seq_index = 0
        # D-020 A3：连续拖拽计数（本段内已完成释放的次数），回落基础状态时清零。
        self._drag_streak = 0

    def apply_state(self, state: str, activity: str | None = None) -> None:
        if state not in STATES:
            return
        self.base_state = state
        self.base_activity = activity
        self.base_clip_name = self._clip_for(state, activity)
        self.overlay_clip_name = None
        self.sequence = []
        self._drag_streak = 0
        self._activate(self.base_clip_name)

    def play_overlay(self, clip_name: str) -> None:
        if clip_name in self.clips:
            self.overlay_clip_name = clip_name
            self._activate(clip_name)

    def clear_overlay(self) -> None:
        if self.overlay_clip_name is not None:
            self.overlay_clip_name = None
            self._activate(self.base_clip_name)

    def play_sequence(self, clip_names: list[str]) -> None:
        """按顺序播放一组 clip（photoWall 场景），播完回落到基础状态。"""
        if not clip_names or clip_names[0] not in self.clips:
            return
        self.sequence = list(clip_names)
        self.seq_index = 0
        self.overlay_clip_name = None
        self._activate(self.sequence[0])

    def tick(self, delta_ms: int) -> None:
        clip = self.clips[self.active_clip_name]
        self.frame_elapsed_ms += delta_ms
        while self.frame_elapsed_ms >= clip.frame_ms:
            self.frame_elapsed_ms -= clip.frame_ms
            if self.frame_index + 1 < len(clip.frames):
                self.frame_index += 1
            elif clip.loop:
                self.frame_index = 0
            elif self.overlay_clip_name is not None:
                # 单次 overlay 播完回落到当前基础状态。
                self.clear_overlay()
                self._drag_streak = 0
            elif self.sequence:
                if self.seq_index + 1 < len(self.sequence):
                    self.seq_index += 1
                    self._activate(self.sequence[self.seq_index])
                else:
                    # 序列播完：回落基础状态。
                    self.sequence = []
                    self._activate(self.base_clip_name)
                    self._drag_streak = 0
            else:
                self.frame_elapsed_ms = 0
                break

    # ---- 拖拽反应（D-020 A3，对照上游 0.1.6 #45→#52/#55）----------------
    def drag_grab(self) -> None:
        """拖拽抓取：播放抓取姿势，并打断进行中的反应/序列。

        素材缺失时保持当前基础状态不动画（仅计数与打断逻辑生效）。
        """
        self.overlay_clip_name = None
        self.sequence = []
        if "dragging_hold" in self.clips:
            self.play_overlay("dragging_hold")
        else:
            self._activate(self.base_clip_name)

    def drag_release(self, reduced_motion: bool = False) -> str | None:
        """松手：本段已完成过一次拖拽时触发闹腾反应（error_dizzy，
        缺素材则用 dragging_cry），否则普通松手（dragging_release）。
        reduced_motion 时跳过反应、只做普通松手。返回实际播放的 clip 名。
        """
        if not reduced_motion and self._drag_streak >= 1:
            reaction = self._first_existing(("error_dizzy", "dragging_cry"))
            if reaction is not None:
                self._drag_streak = 0
                self.play_overlay(reaction)
                return reaction
        self._drag_streak += 1
        release = "dragging_release" if "dragging_release" in self.clips else None
        if release is not None:
            self.play_overlay(release)
        return release

    def _first_existing(self, names: tuple[str, ...]) -> str | None:
        for name in names:
            if name in self.clips:
                return name
        return None

    @property
    def drag_streak(self) -> int:
        return self._drag_streak

    def _clip_for(self, state: str, activity: str | None) -> str:
        if state == "WORKING" and activity:
            return self.working_activity_map.get(activity, self.state_map["WORKING"])
        return self.state_map.get(state, self.state_map["IDLE"])

    def _activate(self, clip_name: str) -> None:
        self.active_clip_name = clip_name
        self.frame_index = 0
        self.frame_elapsed_ms = 0

    @property
    def frame(self) -> str:
        return self.clips[self.active_clip_name].frames[self.frame_index]

    @property
    def motion(self) -> str | None:
        return self.clips[self.active_clip_name].motion
