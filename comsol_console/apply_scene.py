"""COMSOL 参数台子进程入口。

preview 模式只做本地计算；update/solve 模式才会延迟导入 mph。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from scene_model import build_scene, load_scene, save_scene  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="菲涅耳双棱镜 COMSOL 参数台")
    parser.add_argument("--mode", choices=("preview", "update", "solve"), default="preview")
    parser.add_argument("--config", type=Path, default=BASE / "scenes" / "standard.json")
    parser.add_argument("--output-dir", type=Path, default=BASE / "outputs")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scene = load_scene(args.config)

    if args.mode == "preview":
        print(
            json.dumps(
                {"mode": "preview", "scene": build_scene(scene["parameters"])},
                ensure_ascii=False,
            )
        )
        return 0

    # 只有明确要求更新或求解时才导入后端，避免轻量预览启动 COMSOL。
    from comsol_backend import apply_scene_to_comsol

    result = apply_scene_to_comsol(
        scene=scene,
        output_dir=args.output_dir,
        solve=args.mode == "solve",
        export=args.mode == "solve",
    )
    print(json.dumps({"mode": args.mode, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
