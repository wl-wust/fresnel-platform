"""分析 COMSOL 导出的射线轨迹，确认是否发生双棱镜折射。"""

from pathlib import Path
from collections import defaultdict

import numpy as np


DATA = Path(__file__).resolve().parent / "FresnelBiprism_RayOptics.txt"


def load_groups():
    groups = defaultdict(list)
    for line in DATA.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.startswith("%"):
            continue
        parts = line.split()
        if len(parts) < 9:
            continue
        try:
            x, y, z = map(float, parts[:3])
            ray = int(float(parts[3]))
            vx, vy, vz = map(float, parts[5:8])
        except ValueError:
            continue
        groups[ray].append((x, y, z, vx, vy, vz))
    return groups


def interpolate_x(points, x_target):
    for point1, point2 in zip(points, points[1:]):
        x1, y1, z1 = point1[:3]
        x2, y2, z2 = point2[:3]
        if (x1 - x_target) * (x2 - x_target) <= 0 and x1 != x2:
            t = (x_target - x1) / (x2 - x1)
            return y1 + t * (y2 - y1), z1 + t * (z2 - z1)
    return None


def main():
    groups = load_groups()
    print("射线数:", len(groups))
    hit = []
    refracted = []
    outgoing = []
    for ray, points in groups.items():
        points = sorted(points, key=lambda item: item[0])
        points = [point for point in points if np.isfinite(point[:3]).all()]
        if not points:
            continue
        yz0 = interpolate_x(points, 0.0)
        if yz0 is None:
            continue
        y0, z0 = yz0
        if abs(y0) <= 15.0 and -0.1 <= z0 <= 2.1:
            hit.append((ray, y0, z0))

        first = points[0]
        last = points[-1]
        slope_before = first[4] / first[3] if first[3] else np.nan
        slope_after = last[4] / last[3] if last[3] else np.nan
        if (
            np.isfinite(slope_before)
            and np.isfinite(slope_after)
            and abs(slope_after - slope_before) > 1e-5
        ):
            refracted.append((ray, y0, slope_before, slope_after))

        screen_yz = interpolate_x(points, 1000.0)
        if screen_yz is not None and np.isfinite(slope_after):
            outgoing.append((ray, y0, screen_yz[0], slope_after))

    print("命中棱镜平面 x=0 的光线:", len(hit))
    print("其中观察到斜率变化的光线:", len(refracted))
    print("前 20 条折射光线（ray, y0, slope_before, slope_after）:")
    for row in refracted[:20]:
        print(row)

    slopes = [row[3] for row in refracted]
    if slopes:
        print("折射后斜率范围:", min(slopes), max(slopes))
        print("折射后斜率均值:", float(np.mean(slopes)))

    # 对出射直线外推到物平面 x=-a，估计两个虚光源的纵坐标。
    intercepts = []
    for ray, y0, screen_y, slope in outgoing:
        if y0 is None:
            continue
        intercept = screen_y - slope * (1000.0 + 50.0)
        intercepts.append(intercept)
    if intercepts:
        print("虚拟像点纵坐标范围:", min(intercepts), max(intercepts))
        print("虚拟像点纵坐标均值:", float(np.mean(intercepts)))

    # 取屏幕 |y|<=100 mm 内的折射线，用中线两侧的间隙表征干涉重叠区。
    screen_points = sorted(
        [row[2] for row in outgoing if abs(row[2]) <= 100 and np.isfinite(row[2])]
    )
    if screen_points:
        print("屏面 y 最小值/最大值:", screen_points[0], screen_points[-1])

    # 对上下半棱镜的出射直线分别做最小二乘交点，近似两个虚光源位置。
    for aperture in (3.0, 5.0, 10.0, 14.5):
        virtual_sources = {}
        lines = {1: [], -1: []}
        for ray, y0, slope_before, slope_after in refracted:
            if y0 is None or abs(y0) < 0.2 or abs(y0) > aperture:
                continue
            points = sorted(
                [p for p in groups[ray] if np.isfinite(p[:3]).all()],
                key=lambda item: item[0],
            )
            if not points:
                continue
            last = points[-1]
            intercept = last[1] - slope_after * last[0]
            lines[1 if y0 > 0 else -1].append((slope_after, intercept))

        for side, side_lines in lines.items():
            if len(side_lines) < 2:
                continue
            m = np.asarray([item[0] for item in side_lines])
            b = np.asarray([item[1] for item in side_lines])
            design = np.column_stack([m, -np.ones_like(m)])
            target = -b
            xv, yv = np.linalg.lstsq(design, target, rcond=None)[0]
            virtual_sources[side] = (xv, yv)

        if len(virtual_sources) == 2:
            upper = np.array(virtual_sources[1])
            lower = np.array(virtual_sources[-1])
            d_value = float(np.linalg.norm(upper - lower))
            print(
                f"孔径 |y0|<={aperture:g} mm: "
                f"上像 y={upper[1]:.6f}, 下像 y={lower[1]:.6f}, d={d_value:.6f} mm"
            )

    # 用出射直线近似上下两束光的包络，求干涉重叠区。
    beam_lines = {1: [], -1: []}
    for ray, y0, slope_before, slope_after in refracted:
        if y0 is None or abs(y0) < 0.2 or abs(y0) > 14.5:
            continue
        points = sorted(
            [p for p in groups[ray] if np.isfinite(p[:3]).all()],
            key=lambda item: item[0],
        )
        if not points:
            continue
        last = points[-1]
        intercept = last[1] - slope_after * last[0]
        beam_lines[1 if y0 > 0 else -1].append((slope_after, intercept))

    if beam_lines[1] and beam_lines[-1]:
        overlap_rows = []
        for x in np.linspace(0.0, 1000.0, 1001):
            upper_values = [m * x + b for m, b in beam_lines[1]]
            lower_values = [m * x + b for m, b in beam_lines[-1]]
            low = max(min(upper_values), min(lower_values))
            high = min(max(upper_values), max(lower_values))
            if high > low:
                overlap_rows.append((x, low, high, high - low))
        if overlap_rows:
            widest = max(overlap_rows, key=lambda row: row[3])
            at_screen = min(overlap_rows, key=lambda row: abs(row[0] - 1000.0))
            print(
                "干涉重叠区 x 范围:",
                f"{overlap_rows[0][0]:.3f} ~ {overlap_rows[-1][0]:.3f} mm",
            )
            print(
                "最宽重叠:",
                f"x={widest[0]:.3f} mm, 宽={widest[3]:.3f} mm",
            )
            print(
                "屏面重叠:",
                f"x={at_screen[0]:.3f} mm, y={at_screen[1]:.3f}~{at_screen[2]:.3f} mm, "
                f"宽={at_screen[3]:.3f} mm",
            )


if __name__ == "__main__":
    main()
