"""D-020 A3 接线验证：真实 PetWindow + 真实 manifest 的拖拽反应。

用离屏 Qt（QT_QPA_PLATFORM=offscreen）驱动 helper.py 的鼠标处理函数，
不弹出窗口、不干扰桌面；验证"事件 → 模型 → clip"整条链路，而不只是纯模型。

运行（需装 PySide6 的环境，如桌宠 venv）：
    ~/.dsh-dafeiyu-venv/bin/python -m unittest discover -s runtime -p 'test_*.py' -v
未装 PySide6 时本文件自动跳过，系统 python3 也能安全跑全套。
"""

import json
import os
import queue
import tempfile
import unittest
from pathlib import Path

# 必须在导入 PySide6 之前设置：离屏渲染 + 布局文件写到临时目录（不动用户真实布局）。
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault(
    "DSH_DAFEIYU_LAYOUT_PATH",
    str(Path(tempfile.mkdtemp(prefix="dsh-pet-layout-")) / "layout.json"),
)

try:
    from PySide6.QtCore import QPointF, Qt
    from PySide6.QtWidgets import QApplication

    HAVE_QT = True
except Exception:  # pragma: no cover - 环境无 PySide6
    HAVE_QT = False

import helper  # noqa: E402  bundle 内模块；headless 导入不依赖 Qt


class FakeMouseEvent:
    """只实现 mousePress/Release 处理函数真正读取的接口。"""

    def __init__(self, x: int = 10, y: int = 10) -> None:
        self._point = QPointF(float(x), float(y))

    def button(self):
        return Qt.MouseButton.LeftButton

    def globalPosition(self):
        return self._point

    def globalPos(self):
        return self._point.toPoint()


@unittest.skipUnless(HAVE_QT, "PySide6 not installed")
class DragWiringTest(unittest.TestCase):
    app = None
    manifest = None
    asset_root = None

    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        root = helper.bundle_root()
        cls.manifest = json.loads((root / "assets" / "pet-manifest.json").read_text(encoding="utf-8"))
        cls.asset_root = root / "assets" / "pet"

    def make_window(self, reduced_motion: bool = False):
        from animation_model import AnimationModel

        model = AnimationModel(self.manifest)
        config = {
            "scale": 1.0,
            "bubble_scale": 1.0,
            "activity_level": "normal",
            "reduced_motion": reduced_motion,
            "locked": False,
        }
        window = helper.PetWindow(model, self.asset_root, queue.Queue(), config)
        self.addCleanup(window.deleteLater)
        return window

    def test_double_drag_plays_dizzy_reaction_and_grab_interrupts_it(self):
        window = self.make_window()
        model = window.model

        # 第一次完整拖拽：抓取姿势 → 普通放下。
        window.mousePressEvent(FakeMouseEvent())
        self.assertEqual(model.active_clip_name, "dragging_hold")
        window.mouseReleaseEvent(FakeMouseEvent())
        self.assertEqual(model.active_clip_name, "dragging_release")

        # 第二次拖拽（尚未回落）：闹腾反应。
        window.mousePressEvent(FakeMouseEvent())
        self.assertEqual(model.active_clip_name, "dragging_hold")
        window.mouseReleaseEvent(FakeMouseEvent())
        self.assertEqual(model.active_clip_name, "error_dizzy")

        # 反应播放中再抓住：立即打断，回到抓取姿势。
        window.mousePressEvent(FakeMouseEvent())
        self.assertEqual(model.active_clip_name, "dragging_hold")

    def test_reduced_motion_never_reacts(self):
        window = self.make_window(reduced_motion=True)
        model = window.model
        for _ in range(3):
            window.mousePressEvent(FakeMouseEvent())
            window.mouseReleaseEvent(FakeMouseEvent())
            self.assertEqual(model.active_clip_name, "dragging_release")

    def test_locked_window_ignores_drag(self):
        window = self.make_window()
        window.config["locked"] = True
        model = window.model
        window.mousePressEvent(FakeMouseEvent())
        self.assertNotEqual(model.active_clip_name, "dragging_hold")


if __name__ == "__main__":
    unittest.main()
