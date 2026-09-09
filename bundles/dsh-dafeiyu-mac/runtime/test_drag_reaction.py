"""D-020 A3：拖拽反应序列（纯模型单测，无 Qt 依赖）。

语义（对照上游 0.1.6 #45→#52/#55，适配本地 manifest）：
- drag_grab()：播放抓取姿势并打断进行中的反应；计入"本段"拖拽计数。
- drag_release()：本段已有一次完整拖拽时触发闹腾反应（error_dizzy，缺则
  dragging_cry），否则普通松手（dragging_release）；reduced_motion 时跳过反应。
- 回落到基础状态（overlay 播完或状态切换）时拖拽计数清零。
"""

import unittest

from animation_model import AnimationModel


def make_model() -> AnimationModel:
    manifest = {
        "stateMap": {"IDLE": "idle"},
        "clips": {
            "idle": {"frames": ["idle_0"], "frameMs": 1000, "loop": True},
            "dragging_hold": {"frames": ["hold_0"], "frameMs": 120, "loop": True},
            "dragging_release": {"frames": ["rel_0"], "frameMs": 150, "loop": False},
            "error_dizzy": {"frames": ["dz_0"], "frameMs": 200, "loop": False},
            "dragging_cry": {"frames": ["cry_0"], "frameMs": 200, "loop": False},
        },
        "idleMicroClips": [],
        "photoWall": [],
    }
    return AnimationModel(manifest)


class DragReactionTest(unittest.TestCase):
    def test_single_drag_grabs_then_releases_normally(self) -> None:
        model = make_model()
        model.drag_grab()
        self.assertEqual(model.active_clip_name, "dragging_hold")
        clip = model.drag_release(reduced_motion=False)
        self.assertEqual(clip, "dragging_release")
        self.assertEqual(model.active_clip_name, "dragging_release")

    def test_quick_second_drag_triggers_dizzy_reaction(self) -> None:
        model = make_model()
        # 第一次完整拖拽：普通松手。
        model.drag_grab()
        model.drag_release(reduced_motion=False)
        self.assertEqual(model.active_clip_name, "dragging_release")
        # 快速第二次抓取：打断松手动画，回到抓取姿势。
        model.drag_grab()
        self.assertEqual(model.active_clip_name, "dragging_hold")
        # 第二次释放：连续拖拽 → 闹腾反应。
        clip = model.drag_release(reduced_motion=False)
        self.assertEqual(clip, "error_dizzy")
        self.assertEqual(model.active_clip_name, "error_dizzy")

    def test_reaction_finishes_then_falls_back_and_resets_streak(self) -> None:
        model = make_model()
        model.drag_grab()
        model.drag_release(reduced_motion=False)
        model.drag_grab()
        model.drag_release(reduced_motion=False)  # error_dizzy 已激活
        self.assertEqual(model.active_clip_name, "error_dizzy")
        # 单帧 reaction 播完：回落基础状态并清零计数。
        model.tick(200)
        self.assertEqual(model.active_clip_name, "idle")
        self.assertEqual(model.drag_streak, 0)
        # 清零后下一次拖拽又是普通松手，不再闹腾。
        model.drag_grab()
        clip = model.drag_release(reduced_motion=False)
        self.assertEqual(clip, "dragging_release")

    def test_reduced_motion_skips_reaction_but_keeps_short_release(self) -> None:
        model = make_model()
        model.drag_grab()
        clip1 = model.drag_release(reduced_motion=True)
        self.assertEqual(clip1, "dragging_release")
        model.drag_grab()
        clip2 = model.drag_release(reduced_motion=True)
        self.assertEqual(clip2, "dragging_release")
        self.assertNotEqual(model.active_clip_name, "error_dizzy")

    def test_grabbing_during_reaction_interrupts_it(self) -> None:
        model = make_model()
        model.drag_grab()
        model.drag_release(reduced_motion=False)
        model.drag_grab()
        model.drag_release(reduced_motion=False)  # error_dizzy 播放中
        self.assertEqual(model.active_clip_name, "error_dizzy")
        model.drag_grab()  # 再被抓取：中断反应，回到抓取姿势
        self.assertEqual(model.active_clip_name, "dragging_hold")

    def test_state_change_resets_drag_streak(self) -> None:
        model = make_model()
        model.drag_grab()
        model.drag_release(reduced_motion=False)  # streak == 1
        self.assertEqual(model.drag_streak, 1)
        model.apply_state("IDLE")  # 宿主状态更新相当于回落
        self.assertEqual(model.drag_streak, 0)


if __name__ == "__main__":
    unittest.main()
