"""Small persistence layer for the companion window position.

Simplified from the concept of QCYTSN/dsh-dafeiyu's layout_store (MIT):
the pet's window position survives DSH restarts.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

DEFAULT_LAYOUT: dict[str, Any] = {"version": 1, "x": None, "y": None}


def default_layout_path() -> Path:
    override = os.environ.get("DSH_DAFEIYU_LAYOUT_PATH")
    if override:
        return Path(override)
    dsh_home = os.environ.get("DSH_HOME")
    if dsh_home:
        return Path(dsh_home) / "dsh-dafeiyu-mac" / "layout.json"
    return Path.home() / ".dsh" / "dsh-dafeiyu-mac" / "layout.json"


def load_layout(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return dict(DEFAULT_LAYOUT)
        layout = dict(DEFAULT_LAYOUT)
        for key in ("x", "y"):
            coordinate = value.get(key)
            if isinstance(coordinate, int) and not isinstance(coordinate, bool):
                layout[key] = coordinate
        return layout
    except (OSError, ValueError):
        return dict(DEFAULT_LAYOUT)


def save_layout(path: Path, x: int, y: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump({"version": 1, "x": x, "y": y}, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            Path(temporary_name).unlink()
        except FileNotFoundError:
            pass
