"""通过 mph 更新现有 COMSOL 模型并可选求解、导出。"""

from __future__ import annotations

from datetime import datetime
import importlib
from pathlib import Path
from typing import Any, Mapping

from scene_model import build_scene, save_scene, scene_parameter_expressions


BASE = Path(__file__).resolve().parent
PROJECT = BASE.parent
MODEL_PATH = PROJECT / "comsol" / "FresnelBiprism_RayOptics.mph"


def runtime_status() -> dict[str, Any]:
    try:
        module = importlib.import_module("mph")
        version = getattr(module, "__version__", "installed")
        return {
            "available": True,
            "mph_version": str(version),
            "model_exists": MODEL_PATH.exists(),
            "model_path": str(MODEL_PATH),
        }
    except Exception as exc:
        return {
            "available": False,
            "error": str(exc),
            "model_exists": MODEL_PATH.exists(),
            "model_path": str(MODEL_PATH),
        }


def apply_scene_to_comsol(
    scene: Mapping[str, Any],
    output_dir: Path | str,
    *,
    solve: bool,
    export: bool,
) -> dict[str, Any]:
    """加载基准模型，写入参数、重建几何；求解与导出由调用者显式选择。"""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"找不到 COMSOL 基准模型: {MODEL_PATH}")

    import mph  # 延迟导入，preview 模式不触发 COMSOL

    # COMSOL 会按模型目录解析相对路径，这里必须固定为调用方指定的绝对目录。
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    scene_json = output / "latest_scene.json"
    model_copy = output / f"fresnel_scene_{stamp}.mph"
    ray_data = output / "latest_ray_trajectories.txt"

    save_scene(scene_json, scene)
    client = mph.Client(cores=1)
    warnings: list[str] = []
    try:
        model = client.load(MODEL_PATH)
        for name, expression in scene_parameter_expressions(scene).items():
            model.parameter(name, expression)

        # mph 对模型树标签和 Java 标签的解析不完全一致；这里直接走已验证的 Java 树。
        component = model.java.component("comp1")
        component.geom("geom1").run()
        component.mesh("mesh1").run()

        if solve:
            model.java.study("std1").run()
            if export:
                try:
                    export_node = model.java.result().export("data1")
                    export_node.set("filename", str(ray_data))
                    export_node.set("ifexists", "overwrite")
                    export_node.run()
                except Exception as exc:
                    warnings.append(f"射线文本导出失败: {exc}")

        model.save(model_copy)
    finally:
        try:
            client.clear()
        except Exception:
            pass

    return {
        "scene": build_scene(scene["parameters"]),
        "model": str(model_copy),
        "config": str(scene_json),
        "ray_data": str(ray_data) if ray_data.exists() else None,
        "solved": bool(solve),
        "warnings": warnings,
    }
