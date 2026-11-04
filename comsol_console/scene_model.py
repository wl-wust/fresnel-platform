"""COMSOL 参数台的纯数据模型。

这一层不导入 mph，也不启动 COMSOL，便于界面预览和自动化测试。
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any, Mapping


SCHEMA = "bp.comsol-scene/1"
PIXEL_SCALE_MM = 0.004


@dataclass(frozen=True)
class ParameterSpec:
    key: str
    label: str
    unit: str
    minimum: float
    maximum: float
    step: float
    default: float
    precision: int
    group: str


PARAMETER_SPECS: tuple[ParameterSpec, ...] = (
    ParameterSpec("lambda_nm", "波长", "nm", 450.0, 700.0, 0.1, 589.3, 1, "光学"),
    ParameterSpec("n_glass", "玻璃折射率", "", 1.35, 1.80, 0.0001, 1.5168, 4, "光学"),
    ParameterSpec("beta_deg", "单侧棱镜角", "deg", 0.2, 2.0, 0.01, 1.0, 2, "光学"),
    ParameterSpec("a_mm", "光源/单缝到棱镜", "mm", 5.0, 300.0, 1.0, 50.0, 1, "几何"),
    ParameterSpec("z2_mm", "棱镜到光屏", "mm", 100.0, 1500.0, 5.0, 950.0, 1, "几何"),
    ParameterSpec("slit_b_mm", "单缝宽度", "mm", 0.02, 0.30, 0.01, 0.08, 2, "几何"),
    ParameterSpec("prism_half_height_mm", "棱镜半高 H", "mm", 8.0, 25.0, 0.5, 15.0, 1, "模型边界"),
    ParameterSpec("prism_thickness_mm", "棱镜厚度", "mm", 1.0, 5.0, 0.1, 2.0, 1, "模型边界"),
    ParameterSpec("tip_half_mm", "钝顶半宽", "mm", 0.01, 0.10, 0.005, 0.03, 3, "模型边界"),
)

SPECS_BY_KEY = {spec.key: spec for spec in PARAMETER_SPECS}
STANDARD_PARAMETERS = {spec.key: spec.default for spec in PARAMETER_SPECS}

COMSOL_PARAMETER_NAMES = {
    "lambda_nm": "lambda0",
    "n_glass": "n_glass",
    "beta_deg": "beta",
    "a_mm": "a",
    "z2_mm": "z2",
    "slit_b_mm": "slit_b",
    "prism_half_height_mm": "H",
    "prism_thickness_mm": "thickness",
    "tip_half_mm": "tip_half",
}


def _number(value: Any,key: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"参数 {key} 不是有效数字") from exc
    if not math.isfinite(parsed):
        raise ValueError(f"参数 {key} 必须是有限数值")
    return parsed


def clamp_parameter(key: str, value: Any) -> float:
    """将界面输入限制在安全范围内。"""
    if key not in SPECS_BY_KEY:
        raise KeyError(f"未知参数: {key}")
    spec = SPECS_BY_KEY[key]
    parsed = _number(value, key)
    return max(spec.minimum, min(spec.maximum, parsed))


def validate_parameters(values: Mapping[str, Any] | None = None) -> dict[str, float]:
    """严格校验配置；缺项、未知项或越界值都直接报错。"""
    source = STANDARD_PARAMETERS if values is None else values
    if not isinstance(source, Mapping):
        raise ValueError("parameters 必须是对象")

    missing = [spec.key for spec in PARAMETER_SPECS if spec.key not in source]
    if missing:
        raise ValueError("缺少参数: " + ", ".join(missing))

    unknown = sorted(set(source) - set(SPECS_BY_KEY))
    if unknown:
        raise ValueError("存在未知参数: " + ", ".join(unknown))

    normalized: dict[str, float] = {}
    for spec in PARAMETER_SPECS:
        value = _number(source[spec.key], spec.key)
        if not spec.minimum <= value <= spec.maximum:
            raise ValueError(
                f"{spec.label} 必须在 {spec.minimum:g}–{spec.maximum:g} {spec.unit} 内"
            )
        normalized[spec.key] = value
    return normalized


def build_scene(values: Mapping[str, Any] | None = None) -> dict[str, Any]:
    parameters = validate_parameters(values)
    a_mm = parameters["a_mm"]
    z2_mm = parameters["z2_mm"]
    beta_rad = math.radians(parameters["beta_deg"])
    total_distance_mm = a_mm + z2_mm
    # 报告表 5.1 采用小顶角傍轴口径 d = 2a(n-1)β（β 用弧度）。
    d_mm = 2.0 * a_mm * (parameters["n_glass"] - 1.0) * beta_rad
    if d_mm <= 0:
        raise ValueError("虚光源间距必须大于 0")
    delta_x_mm = parameters["lambda_nm"] * 1e-6 * total_distance_mm / d_mm

    return {
        "schema": SCHEMA,
        "parameters": parameters,
        "derived": {
            "source_x_mm": -a_mm,
            "prism_x_mm": 0.0,
            "screen_x_mm": total_distance_mm,
            "total_distance_mm": total_distance_mm,
            "d_paraxial_mm": d_mm,
            "delta_x_mm": delta_x_mm,
            "delta_x_px": delta_x_mm / PIXEL_SCALE_MM,
            "pixel_scale_mm": PIXEL_SCALE_MM,
            "fringe_count_6mm": 6.0 / delta_x_mm,
        },
        "mapping": {
            "solver": "comsol/FresnelBiprism_RayOptics.mph",
            "mapped": [
                "点光源/单缝位置",
                "双棱镜角度、折射率与几何",
                "光屏距离",
                "波长",
            ],
            "not_mapped": [
                "滤光片与衰减片",
                "45° 半透半反镜",
                "可插拔凸透镜 L′",
                "圆孔光阑、测微目镜与手机",
                "完整机械支架与导轨",
            ],
            "scope_note": "当前求解模型是光路验证模型，不是整台实验装置的完整机械仿真。",
        },
    }


def save_scene(path: Path | str, scene: Mapping[str, Any]) -> Path:
    target = Path(path)
    parameters = scene.get("parameters", scene)
    payload = {
        "schema": SCHEMA,
        "parameters": validate_parameters(parameters),
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return target


def load_scene(path: Path | str) -> dict[str, Any]:
    source = Path(path)
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"配置文件不是有效 JSON: {source}") from exc
    if not isinstance(payload, Mapping) or payload.get("schema") != SCHEMA:
        raise ValueError(f"配置文件 schema 必须是 {SCHEMA}")
    if "parameters" not in payload:
        raise ValueError("配置文件缺少 parameters")
    return build_scene(payload.get("parameters"))


def scene_parameter_expressions(scene: Mapping[str, Any]) -> dict[str, str]:
    parameters = validate_parameters(scene.get("parameters", scene))
    units = {
        "lambda_nm": "nm",
        "beta_deg": "deg",
        "a_mm": "mm",
        "z2_mm": "mm",
        "slit_b_mm": "mm",
        "prism_half_height_mm": "mm",
        "prism_thickness_mm": "mm",
        "tip_half_mm": "mm",
    }
    expressions: dict[str, str] = {}
    for key, comsol_name in COMSOL_PARAMETER_NAMES.items():
        value = parameters[key]
        unit = units.get(key)
        text = f"{value:.12g}"
        expressions[comsol_name] = f"{text}[{unit}]" if unit else text
    return expressions


def standard_scene_path() -> Path:
    return Path(__file__).resolve().parent / "scenes" / "standard.json"
