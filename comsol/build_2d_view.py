"""构建菲涅耳双棱镜二维仪器、光路和干涉区展示模型。"""

from collections import defaultdict
import math
from pathlib import Path

import mph
import numpy as np


BASE = Path(__file__).resolve().parent
SOURCE = BASE / "FresnelBiprism_RayOptics.txt"
MODEL = BASE / "FresnelBiprism_2D_View.mph"
INCOMING = BASE / "rays_incoming.txt"
UPPER = BASE / "rays_upper.txt"
LOWER = BASE / "rays_lower.txt"

LAMBDA_MM = 589.3e-6
A_MM = 50.0
SCREEN_X = 1000.0
N_GLASS = 1.5168
DX_MM = LAMBDA_MM * (A_MM + 950.0) / (
    2 * A_MM * (N_GLASS - 1) * math.radians(1.0)
)

COLORS = {
    "rail": ("0.21", "0.25", "0.30"),
    "steel": ("0.38", "0.54", "0.70"),
    "steel_light": ("0.58", "0.68", "0.78"),
    "source": ("0.95", "0.50", "0.18"),
    "screen": ("0.97", "0.98", "1.0"),
    "frame": ("0.17", "0.21", "0.25"),
    "glass": ("0.35", "0.78", "0.88"),
    "interference": ("0.35", "0.76", "0.42"),
    "incoming": ("0.95", "0.73", "0.20"),
    "upper": ("0.91", "0.30", "0.13"),
    "lower": ("0.15", "0.43", "0.82"),
}


def load_rays():
    groups = defaultdict(list)
    for line in SOURCE.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.startswith("%"):
            continue
        parts = line.split()
        if len(parts) < 8:
            continue
        try:
            x, y, z = map(float, parts[:3])
            ray = int(float(parts[3]))
            vx, vy, vz = map(float, parts[5:8])
        except ValueError:
            continue
        if np.isfinite([x, y, z, vx, vy, vz]).all():
            groups[ray].append((x, y, z, vx, vy, vz))
    return groups


def interpolate_y(points, x_target):
    for p1, p2 in zip(points, points[1:]):
        if (p1[0] - x_target) * (p2[0] - x_target) <= 0 and p1[0] != p2[0]:
            t = (x_target - p1[0]) / (p2[0] - p1[0])
            return p1[1] + t * (p2[1] - p1[1])
    return None


def extract_rays(groups):
    incoming = []
    upper = []
    lower = []
    outgoing_lines = []
    for ray, points in groups.items():
        points = sorted(points, key=lambda item: item[0])
        if len(points) < 2:
            continue
        first = points[0]
        last = points[-1]
        if first[3] == 0 or last[3] == 0:
            continue
        slope_in = first[4] / first[3]
        slope_out = last[4] / last[3]
        if abs(slope_out - slope_in) <= 1e-5:
            continue
        y0 = interpolate_y(points, 0.0)
        if y0 is None or abs(y0) > 15:
            continue
        intercept = last[1] - slope_out * last[0]
        y_screen = slope_out * SCREEN_X + intercept
        # 只显示实际落到 ±110 mm 光屏内的光线。
        if abs(y_screen) > 110.0:
            continue
        incoming.append([(-A_MM, 0.0), (0.0, y0)])
        outgoing = [(0.0, y0), (SCREEN_X, y_screen)]
        if y0 > 0:
            upper.append(outgoing)
        else:
            lower.append(outgoing)
        outgoing_lines.append((slope_out, intercept, y0))
    return incoming, upper, lower, outgoing_lines


def write_sectionwise(path, polylines):
    coordinates = []
    segments = []
    offset = 1
    for polyline in polylines:
        coordinates.extend(polyline)
        segments.extend(
            (offset + index, offset + index + 1)
            for index in range(len(polyline) - 1)
        )
        offset += len(polyline)
    lines = ["% Coordinates"]
    lines.extend(f"{x:.9f}\t{y:.9f}" for x, y in coordinates)
    lines.append("% Elements (segments)")
    lines.extend(f"{first}\t{second}" for first, second in segments)
    path.write_text("\r\n".join(lines) + "\r\n", encoding="ascii")


def overlap_curves(outgoing_lines):
    xs = np.linspace(0.0, SCREEN_X, 1001)
    upper_values = []
    lower_values = []
    for x in xs:
        upper = [slope * x + intercept for slope, intercept, y0 in outgoing_lines if y0 > 0]
        lower = [slope * x + intercept for slope, intercept, y0 in outgoing_lines if y0 < 0]
        low = max(min(upper), min(lower))
        high = min(max(upper), max(lower))
        if high > low:
            upper_values.append((x, high))
            lower_values.append((x, low))
    if not upper_values:
        return np.empty((0, 2)), np.empty((0, 2))
    return np.asarray(upper_values), np.asarray(lower_values)


def overlap_polygon(outgoing_lines):
    upper_values, lower_values = overlap_curves(outgoing_lines)
    if not len(upper_values):
        return []
    upper_values = upper_values[::10]
    lower_values = lower_values[::10]
    return [tuple(row) for row in upper_values] + [
        tuple(row) for row in reversed(lower_values)
    ]


def colorize(feature, name):
    feature.set("color", "custom")
    for index, value in enumerate(COLORS[name]):
        feature.setIndex("customcolor", value, index)


def add_rect(geom, tag, size, pos, color, label):
    feature = geom.create(tag, "Rectangle")
    feature.set("size", [str(value) for value in size])
    feature.set("pos", [str(value) for value in pos])
    feature.label(label)
    colorize(feature, color)
    return feature


def add_polygon(geom, tag, points, color, label, closed=True):
    feature = geom.create(tag, "Polygon")
    feature.set("source", "table")
    feature.set("type", "solid" if closed else "open")
    for row, (x, y) in enumerate(points):
        feature.setIndex("table", f"{x:.9f}", row, 0)
        feature.setIndex("table", f"{y:.9f}", row, 1)
    feature.label(label)
    colorize(feature, color)
    return feature


def add_curve(geom, tag, filename, color, label):
    feature = geom.create(tag, "InterpolationCurve")
    feature.set("source", "file")
    feature.set("struct", "sectionwise")
    feature.set("filename", str(filename))
    feature.set("type", "open")
    feature.label(label)
    colorize(feature, color)
    return feature


def build_model(incoming, upper, lower, overlap):
    client = mph.Client(cores=1)
    model = client.create("FresnelBiprism_2D_View")
    model.java.label("Fresnel Biprism 2D View")
    comp = model.java.component().create("comp1", "Component")
    geom = comp.geom().create("view2d", 2)
    geom.lengthUnit("mm")

    # 完整仪器的二维侧视轮廓。
    add_rect(geom, "rail_main", (1160, 20), (-80, -35), "rail", "光学导轨")
    add_rect(geom, "rail_top_a", (1160, 4), (-80, -15), "steel_light", "导轨顶面 A")
    add_rect(geom, "rail_top_b", (1160, 4), (-80, -11), "steel_light", "导轨顶面 B")
    add_rect(geom, "foot_left", (80, 18), (-80, -53), "rail", "左支脚")
    add_rect(geom, "foot_right", (80, 18), (1000, -53), "rail", "右支脚")

    # 三个滑块。
    for tag, x, label in (
        ("slider_source", -50, "光源滑块"),
        ("slider_prism", 0, "棱镜滑块"),
        ("slider_screen", 1000, "光屏滑块"),
    ):
        add_rect(geom, tag, (60, 8), (x - 30, -7), "steel", label)
        add_rect(geom, f"{tag}_cap", (52, 3), (x - 26, -4), "steel_light", f"{label}顶面")

    # 光源、狭缝片和棱镜夹持架。
    add_rect(geom, "source_body", (30, 24), (-78, -12), "source", "光源壳体")
    add_rect(geom, "source_slit", (2, 30), (-51, -15), "frame", "竖直狭缝片")
    add_rect(geom, "source_post", (5, 38), (-52.5, -37), "steel", "光源支柱")
    add_rect(geom, "prism_post_left", (4, 42), (-20, -26), "steel", "棱镜左立柱")
    add_rect(geom, "prism_post_right", (4, 42), (16, -26), "steel", "棱镜右立柱")
    add_rect(geom, "prism_crossbar", (40, 5), (-20, 16), "steel_light", "棱镜横梁")
    add_polygon(
        geom,
        "prism_jaw_left",
        [(-35, -18), (-15, -18), (-15, -10), (-22, 8), (-30, 8), (-24, -10)],
        "steel_light",
        "左侧 V 形夹爪",
    )
    add_polygon(
        geom,
        "prism_jaw_right",
        [(35, -18), (15, -18), (15, -10), (22, 8), (30, 8), (24, -10)],
        "steel_light",
        "右侧 V 形夹爪",
    )

    # 光学双棱镜截面。
    add_polygon(
        geom,
        "glass2d",
        [(-0.2618, 0.03), (0, 15), (0, -15), (-0.2618, -0.03)],
        "glass",
        "双棱镜玻璃",
    )

    # 光屏与屏幕边框。
    add_rect(geom, "screen_frame", (5, 230), (1000, -115), "frame", "光屏边框")
    add_rect(geom, "screen_face", (3, 220), (1001, -110), "screen", "白色光屏")

    # 光屏上的平台条纹位置。
    for index, k in enumerate(range(-4, 5)):
        y = k * DX_MM
        add_polygon(
            geom,
            f"fringe_tick_{index}",
            [(1003, y), (1009, y)],
            "source",
            f"条纹刻度 {index + 1}",
            closed=False,
        )

    # 干涉交叠区。
    add_polygon(
        geom,
        "interference_zone",
        overlap,
        "interference",
        "干涉交叠区",
    )

    # 三组光线。
    add_curve(geom, "rays_incoming", INCOMING, "incoming", "入射光线")
    add_curve(geom, "rays_upper", UPPER, "upper", "上折射束")
    add_curve(geom, "rays_lower", LOWER, "lower", "下折射束")

    geom.run()
    # Assembly 保留所有显示对象，避免重叠对象被合并而丢失颜色。
    geom.feature("fin").set("action", "assembly")
    geom.run()

    model.save(MODEL)
    print("模型:", MODEL)
    print("几何序列:", model.geometries())
    print("包围盒:", geom.getBoundingBox())
    print("边数:", geom.getNEdges())
    print("条纹间距:", f"{DX_MM:.6f} mm")
    client.remove(model)


def main():
    groups = load_rays()
    incoming, upper, lower, outgoing_lines = extract_rays(groups)
    if not lower or not upper:
        raise RuntimeError("未识别到上下两组折射光线")
    write_sectionwise(INCOMING, incoming)
    write_sectionwise(UPPER, upper)
    write_sectionwise(LOWER, lower)
    overlap = overlap_polygon(outgoing_lines)
    print("光线数量: incoming", len(incoming), "upper", len(upper), "lower", len(lower))
    build_model(incoming, upper, lower, overlap)


if __name__ == "__main__":
    main()
