"""把 COMSOL 光线数据整理成光路与干涉区对比图。"""

from collections import defaultdict
from pathlib import Path
import json
import math

import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Rectangle
import numpy as np


BASE = Path(__file__).resolve().parent
DATA = BASE / "FresnelBiprism_RayOptics.txt"
FIGURE = BASE / "FresnelBiprism_OpticalPath_Interference.png"
METRICS = BASE / "FresnelBiprism_metrics.json"

LAMBDA_MM = 589.3e-6
N_GLASS = 1.5168
A_MM = 50.0
Z2_MM = 950.0
D_PLATFORM = 2 * A_MM * (N_GLASS - 1) * math.radians(1.0)
DX_PLATFORM = LAMBDA_MM * (A_MM + Z2_MM) / D_PLATFORM


def load_groups():
    groups = defaultdict(list)
    for line in DATA.read_text(encoding="utf-8", errors="ignore").splitlines():
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


def interpolate_x(points, x_target):
    for point1, point2 in zip(points, points[1:]):
        x1, y1 = point1[:2]
        x2, y2 = point2[:2]
        if (x1 - x_target) * (x2 - x_target) <= 0 and x1 != x2:
            t = (x_target - x1) / (x2 - x1)
            return y1 + t * (y2 - y1)
    return None


def classify(groups):
    rays = {}
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
        y0 = interpolate_x(points, 0.0)
        if y0 is None or abs(y0) > 15:
            continue
        refracted = abs(slope_out - slope_in) > 1e-5
        if not refracted:
            continue
        intercept = last[1] - slope_out * last[0]
        rays[ray] = {
            "points": points,
            "y0": y0,
            "slope_in": slope_in,
            "slope_out": slope_out,
            "intercept": intercept,
            "side": 1 if y0 > 0 else -1,
        }
    return rays


def fit_virtual_sources(rays, aperture):
    sources = {}
    for side in (-1, 1):
        lines = [
            row
            for row in rays.values()
            if row["side"] == side and 0.2 < abs(row["y0"]) <= aperture
        ]
        slope = np.asarray([row["slope_out"] for row in lines])
        intercept = np.asarray([row["intercept"] for row in lines])
        design = np.column_stack([slope, -np.ones_like(slope)])
        xv, yv = np.linalg.lstsq(design, -intercept, rcond=None)[0]
        sources[side] = (float(xv), float(yv))
    return sources


def overlap_region(rays):
    x_grid = np.linspace(0.0, 1000.0, 1001)
    low_values = []
    high_values = []
    for x in x_grid:
        upper = [
            row["slope_out"] * x + row["intercept"]
            for row in rays.values()
            if row["side"] == 1
        ]
        lower = [
            row["slope_out"] * x + row["intercept"]
            for row in rays.values()
            if row["side"] == -1
        ]
        low = max(min(upper), min(lower))
        high = min(max(upper), max(lower))
        if high > low:
            low_values.append((x, low))
            high_values.append((x, high))
    return np.asarray(low_values), np.asarray(high_values)


def style_axis(ax):
    ax.grid(True, color="#d7dde5", linewidth=0.6, alpha=0.75)
    ax.set_facecolor("#fbfcfd")
    for spine in ax.spines.values():
        spine.set_color("#9aa7b5")
    ax.tick_params(colors="#334155")


def main():
    groups = load_groups()
    rays = classify(groups)
    paraxial_sources = fit_virtual_sources(rays, aperture=3.0)
    full_sources = fit_virtual_sources(rays, aperture=14.5)
    d_paraxial = abs(paraxial_sources[1][1] - paraxial_sources[-1][1])
    d_full = abs(full_sources[1][1] - full_sources[-1][1])
    lower, upper = overlap_region(rays)

    metrics = {
        "platform": {
            "d_mm": D_PLATFORM,
            "delta_x_mm": DX_PLATFORM,
            "lambda_nm": LAMBDA_MM * 1e6,
            "a_mm": A_MM,
            "z2_mm": Z2_MM,
        },
        "comsol": {
            "d_paraxial_mm": d_paraxial,
            "d_full_aperture_mm": d_full,
            "virtual_source_paraxial": {
                "upper": paraxial_sources[1],
                "lower": paraxial_sources[-1],
            },
            "virtual_source_full": {
                "upper": full_sources[1],
                "lower": full_sources[-1],
            },
            "interference_region_x_mm": [
                float(lower[0, 0]),
                float(lower[-1, 0]),
            ],
            "screen_overlap_mm": [
                float(lower[-1, 1]),
                float(upper[-1, 1]),
            ],
            "refracted_ray_count": len(rays),
        },
        "relative_error_percent": {
            "paraxial_d": (d_paraxial - D_PLATFORM) / D_PLATFORM * 100.0,
            "full_aperture_d": (d_full - D_PLATFORM) / D_PLATFORM * 100.0,
        },
    }
    METRICS.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "axes.titlesize": 12,
            "axes.labelsize": 10,
            "legend.fontsize": 8.5,
        }
    )
    fig = plt.figure(figsize=(14, 8.4), dpi=180)
    grid = fig.add_gridspec(2, 2, width_ratios=[1.9, 1.0], height_ratios=[1.0, 1.0])

    ax_full = fig.add_subplot(grid[:, 0])
    ax_prism = fig.add_subplot(grid[0, 1])
    ax_overlap = fig.add_subplot(grid[1, 1])

    colors = {1: "#e76f51", -1: "#2a6fbb"}
    for row in rays.values():
        points = np.asarray([(point[0], point[1]) for point in row["points"]])
        ax_full.plot(
            points[:, 0],
            points[:, 1],
            color=colors[row["side"]],
            alpha=0.18,
            linewidth=0.7,
        )

    ax_full.fill_between(
        lower[:, 0],
        lower[:, 1],
        upper[:, 1],
        color="#69b36f",
        alpha=0.38,
        label="Interference overlap",
    )
    ax_full.axvline(0, color="#8a6d3b", linewidth=1.4)
    ax_full.add_patch(
        Rectangle(
            (-0.5, -15),
            1.0,
            30,
            facecolor="#f5d58b",
            edgecolor="#a4761a",
            linewidth=1.0,
            alpha=0.95,
            zorder=5,
        )
    )
    ax_full.axvline(1000, color="#243447", linewidth=2.0)
    ax_full.plot(-A_MM, 0, marker="*", markersize=12, color="#d62828", zorder=6)
    ax_full.annotate(
        "point source\n(slit)",
        (-A_MM, 0),
        xytext=(-46, 38),
        textcoords="data",
        arrowprops={"arrowstyle": "->", "color": "#6b7280"},
        fontsize=8.5,
    )
    ax_full.annotate(
        "biprism",
        (0, 15),
        xytext=(45, 62),
        textcoords="data",
        arrowprops={"arrowstyle": "->", "color": "#6b7280"},
        fontsize=8.5,
    )
    ax_full.annotate(
        "screen",
        (1000, 65),
        xytext=(925, 92),
        textcoords="data",
        arrowprops={"arrowstyle": "->", "color": "#6b7280"},
        fontsize=8.5,
    )
    ax_full.text(
        225,
        22,
        "interference region\nx = %.1f to 1000 mm" % lower[0, 0],
        color="#2f6c3d",
        fontsize=8.5,
        bbox={"facecolor": "white", "edgecolor": "#9ac7a0", "alpha": 0.9},
    )
    ax_full.set(
        xlim=(-65, 1025),
        ylim=(-115, 115),
        xlabel="Optical axis x (mm)",
        ylabel="Transverse position y (mm)",
        title="(a) COMSOL ray-optics layout: two refracted bundles",
    )
    style_axis(ax_full)
    ax_full.legend(loc="upper left", frameon=True)

    prism_vertices = np.asarray(
        [
            [-15 * math.tan(math.radians(1.0)), 0],
            [0, -15],
            [0, 15],
        ]
    )
    ax_prism.add_patch(
        Polygon(
            prism_vertices,
            closed=True,
            facecolor="#f5d58b",
            edgecolor="#a4761a",
            linewidth=1.2,
            alpha=0.9,
        )
    )
    for row in rays.values():
        points = np.asarray([(point[0], point[1]) for point in row["points"]])
        mask = (points[:, 0] >= -2.0) & (points[:, 0] <= 5.0)
        if np.count_nonzero(mask) >= 2:
            ax_prism.plot(
                points[mask, 0],
                points[mask, 1],
                color=colors[row["side"]],
                alpha=0.32,
                linewidth=0.8,
            )
    ax_prism.set(
        xlim=(-2.0, 5.0),
        ylim=(-16, 16),
        xlabel="x (mm)",
        ylabel="y (mm)",
        title="(b) 1 degree half-prism close-up",
    )
    style_axis(ax_prism)

    x_dense = np.linspace(180.0, 1000.0, 400)
    for row in rays.values():
        ax_overlap.plot(
            x_dense,
            row["slope_out"] * x_dense + row["intercept"],
            color=colors[row["side"]],
            alpha=0.10,
            linewidth=0.55,
        )
    mask = lower[:, 0] >= 180
    ax_overlap.fill_between(
        lower[mask, 0],
        lower[mask, 1],
        upper[mask, 1],
        color="#69b36f",
        alpha=0.45,
    )
    ax_overlap.axvline(1000, color="#243447", linewidth=2.0)
    for k in range(-4, 5):
        y = k * DX_PLATFORM
        ax_overlap.plot([1000, 1005], [y, y], color="#d97706", linewidth=1.3)
    ax_overlap.set(
        xlim=(180, 1025),
        ylim=(-12, 12),
        xlabel="x (mm)",
        ylabel="y (mm)",
        title="(c) Overlap region and platform fringe positions",
    )
    style_axis(ax_overlap)
    ax_overlap.text(
        610,
        -10.4,
        "screen overlap: %.2f mm\nplatform spacing: %.4f mm" %
        (upper[-1, 1] - lower[-1, 1], DX_PLATFORM),
        fontsize=8.3,
        bbox={"facecolor": "white", "edgecolor": "#b8c6d1", "alpha": 0.92},
    )

    fig.suptitle(
        "Fresnel Biprism: COMSOL optical-path and interference-region model",
        fontsize=15,
        color="#16213e",
    )
    fig.text(
        0.5,
        0.012,
        "COMSOL Ray Optics validates geometry and overlap; fringe intensity remains in the MATLAB/front-end solver.",
        ha="center",
        color="#475569",
        fontsize=9,
    )
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    fig.savefig(FIGURE, facecolor="white")
    print("图像:", FIGURE)
    print("指标:", METRICS)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
