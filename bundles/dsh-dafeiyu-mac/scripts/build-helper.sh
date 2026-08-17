#!/usr/bin/env bash
# 打包桌宠 helper 为单文件可执行（macOS / Linux），输出到
#   runtime/bin/<platform>-<arch>/dsh-dafeiyu-mac-helper
# 用法：
#   bash scripts/build-helper.sh [python-binary]
#   （python-binary 默认 python3；建议传 venv 的 python，如
#     ~/.dsh-dafeiyu-venv/bin/python，需已装 pyinstaller 与 PySide6）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${1:-python3}"

PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) DEST_ARCH="x64" ;;
  arm64)  DEST_ARCH="arm64" ;;
  *)      DEST_ARCH="$ARCH" ;;
esac
OUT_DIR="$ROOT/runtime/bin/${PLATFORM}-${DEST_ARCH}"
DIST_DIR="$ROOT/dist-helper"
WORK_DIR="$ROOT/build-helper"

if ! "$PYTHON" -m PyInstaller --version >/dev/null 2>&1; then
  echo "error: pyinstaller 未安装（$PYTHON -m pip install pyinstaller）" >&2
  exit 1
fi

rm -rf "$DIST_DIR" "$WORK_DIR"
mkdir -p "$OUT_DIR"

echo "==> 构建 ${PLATFORM}-${DEST_ARCH}（PyInstaller onefile）..."
"$PYTHON" -m PyInstaller \
  --onefile \
  --clean \
  --noconfirm \
  --name dsh-dafeiyu-mac-helper \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --add-data "$ROOT/assets:assets" \
  --exclude-module PySide6.Qt3DAnimation \
  --exclude-module PySide6.Qt3DCore \
  --exclude-module PySide6.Qt3DExtras \
  --exclude-module PySide6.Qt3DInput \
  --exclude-module PySide6.Qt3DLogic \
  --exclude-module PySide6.Qt3DRender \
  --exclude-module PySide6.QtBluetooth \
  --exclude-module PySide6.QtCharts \
  --exclude-module PySide6.QtConcurrent \
  --exclude-module PySide6.QtDataVisualization \
  --exclude-module PySide6.QtDesigner \
  --exclude-module PySide6.QtHelp \
  --exclude-module PySide6.QtLocation \
  --exclude-module PySide6.QtMultimedia \
  --exclude-module PySide6.QtMultimediaWidgets \
  --exclude-module PySide6.QtNetwork \
  --exclude-module PySide6.QtNetworkAuth \
  --exclude-module PySide6.QtNfc \
  --exclude-module PySide6.QtOpenGL \
  --exclude-module PySide6.QtOpenGLWidgets \
  --exclude-module PySide6.QtPdf \
  --exclude-module PySide6.QtPdfWidgets \
  --exclude-module PySide6.QtPositioning \
  --exclude-module PySide6.QtQml \
  --exclude-module PySide6.QtQuick \
  --exclude-module PySide6.QtQuick3D \
  --exclude-module PySide6.QtQuickWidgets \
  --exclude-module PySide6.QtRemoteObjects \
  --exclude-module PySide6.QtSensors \
  --exclude-module PySide6.QtSerialPort \
  --exclude-module PySide6.QtSql \
  --exclude-module PySide6.QtStateMachine \
  --exclude-module PySide6.QtSvg \
  --exclude-module PySide6.QtSvgWidgets \
  --exclude-module PySide6.QtTest \
  --exclude-module PySide6.QtTextToSpeech \
  --exclude-module PySide6.QtUiTools \
  --exclude-module PySide6.QtWebChannel \
  --exclude-module PySide6.QtWebEngineCore \
  --exclude-module PySide6.QtWebEngineWidgets \
  --exclude-module PySide6.QtWebSockets \
  "$ROOT/runtime/helper.py"

cp "$DIST_DIR/dsh-dafeiyu-mac-helper" "$OUT_DIR/"
chmod +x "$OUT_DIR/dsh-dafeiyu-mac-helper"
rm -rf "$DIST_DIR" "$WORK_DIR"

SIZE="$(du -h "$OUT_DIR/dsh-dafeiyu-mac-helper" | cut -f1)"
echo "==> 完成：$OUT_DIR/dsh-dafeiyu-mac-helper（$SIZE）"
