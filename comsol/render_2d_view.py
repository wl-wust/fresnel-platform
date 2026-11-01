"""绘制完整仪器、光路和干涉区的二维总览图。"""

from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.patches import Patch, Polygon, Rectangle
import numpy as np

from build_2d_view import (
    DX_MM,
    LOWER,
    UPPER,
    extract_rays,
    load_rays,
    overlap_curves,
)


BASE = Path(__file__).resolve().parent
OUTPUT = BASE / "FresnelBiprism_2D_View.png"


def read_sectionwise(path):
    polylines = []
    coordinates = []
    segments = []
    section = None
    for line in path.read_text(encoding="ascii").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("%"):
            section = "coordinates" if coordinates == [] else "segments"
            continue
        values = line.replace(",", " ").split()
        if section == "coordinates":
            coordinates.append((float(values[0]), float(values[1])))
        elif section == "segments":
            segments.append((int(values[0]), int(values[1])))
    adjacency = {}
    for first, second in segments:
        adjacency.setdefault(first, []).append(second)
        adjacency.setdefault(second, []).append(first)
    visited = set()
    for start in adjacency:
        if start in visited:
            continue
        stack = [start]
        component = []
        while stack:
            node = stack.pop()
            if node in visited:
                continue
            visited.add(node)
            component.append(node)
            stack.extend(adjacency.get(node, []))
        endpoints = [node for node in component if len(adjacency[node]) == 1]
        ordered = []
        if endpoints:
            current = endpoints[0]
            previous = None
            while current is not None:
                ordered.append(coordinates[current - 1])
                candidates = [item for item in adjacency[current] if item != previous]
                previous, current = current, (candidates[0] if candidates else None)
        else:
            ordered = [coordinates[node - 1] for node in component]
        if len(ordered) >= 2:
            polylines.append(np.asarray(ordered))
    return polylines


def draw_apparatus(ax, compact=False):
    rail_color = "#38434f"
    steel = "#6385a8"
    steel_light = "#94a9bd"
    frame = "#26313c"
    screen = "#f8fafc"

    ax.add_patch(Rectangle((-80, -35), 1160, 20, facecolor=rail_color, edgecolor="#25303a"))
    ax.add_patch(Rectangle((-80, -15), 1160, 4, facecolor=steel_light, edgecolor="#25303a", lw=0.4))
    ax.add_patch(Rectangle((-80, -11), 1160, 4, facecolor=steel_light, edgecolor="#25303a", lw=0.4))
    ax.add_patch(Rectangle((-80, -53), 80, 18, facecolor=rail_color, edgecolor="#25303a"))
    ax.add_patch(Rectangle((1000, -53), 80, 18, facecolor=rail_color, edgecolor="#25303a"))

    for x in (-50, 0, 1000):
        ax.add_patch(Rectangle((x - 30, -7), 60, 8, facecolor=steel, edgecolor="#25303a"))
        ax.add_patch(Rectangle((x - 26, -4), 52, 3, facecolor=steel_light, edgecolor="#25303a", lw=0.4))

    ax.add_patch(Rectangle((-78, -12), 30, 24, facecolor="#ef7a29", edgecolor="#7a3c18"))
    ax.add_patch(Rectangle((-51, -15), 2, 30, facecolor=frame, edgecolor=frame))
    ax.add_patch(Rectangle((-52.5, -37), 5, 38, facecolor=steel, edgecolor="#25303a"))

    ax.add_patch(Rectangle((-20, -26), 4, 42, facecolor=steel, edgecolor="#25303a"))
    ax.add_patch(Rectangle((16, -26), 4, 42, facecolor=steel, edgecolor="#25303a"))
    ax.add_patch(Rectangle((-20, 16), 40, 5, facecolor=steel_light, edgecolor="#25303a"))
    ax.add_patch(
        Polygon(
            [(-35, -18), (-15, -18), (-15, -10), (-22, 8), (-30, 8), (-24, -10)],
            closed=True,
            facecolor=steel_light,
            edgecolor="#344454",
        )
    )
    ax.add_patch(
        Polygon(
            [(35, -18), (15, -18), (15, -10), (22, 8), (30, 8), (24, -10)],
            closed=True,
            facecolor=steel_light,
            edgecolor="#344454",
        )
    )
    ax.add_patch(
        Polygon(
            [(-0.2618, 0.03), (0, 15), (0, -15), (-0.2618, -0.03)],
            closed=True,
            facecolor="#63c7e0",
            edgecolor="#147992",
            alpha=0.9,
        )
    )

    ax.add_patch(Rectangle((1000, -115), 5, 230, facecolor=frame, edgecolor=frame))
    ax.add_patch(Rectangle((1001, -110), 3, 220, facecolor=screen, edgecolor="#5d6872", lw=0.7))
    for k in range(-4, 5):
        y = k * DX_MM
        ax.plot([1004, 1010], [y, y], color="#d97706", lw=1.2)

    if not compact:
        ax.annotate("Source / slit", (-50, 0), xytext=(-120, 45), arrowprops={"arrowstyle": "->"})
        ax.annotate("Biprism holder", (0, 18), xytext=(65, 58), arrowprops={"arrowstyle": "->"})
        ax.annotate("Screen", (1002, 100), xytext=(900, 105), arrowprops={"arrowstyle": "->"})
        ax.text(470, -29, "Optical rail", fontsize=9, color="#d8e0e7", ha="center")


def style_axis(ax):
    ax.set_facecolor("#fbfcfd")
    ax.grid(True, color="#d9e1e8", linewidth=0.6, alpha=0.8)
    for spine in ax.spines.values():
        spine.set_color("#9aa7b5")
    ax.tick_params(colors="#334155", labelsize=8)


def main():
    groups = load_rays()
    incoming, upper, lower, outgoing_lines = extract_rays(groups)
    upper_envelope, lower_envelope = overlap_curves(outgoing_lines)
    if not len(upper_envelope):
        raise RuntimeError("没有可显示的干涉交叠区")

    incoming_curves = read_sectionwise(BASE / "rays_incoming.txt")
    upper_curves = read_sectionwise(UPPER)
    lower_curves = read_sectionwise(LOWER)

    fig = plt.figure(figsize=(16, 9), dpi=180)
    grid = fig.add_gridspec(
        2,
        2,
        height_ratios=(1.2, 1.0),
        width_ratios=(1.05, 1.45),
        hspace=0.26,
        wspace=0.18,
    )
    ax_full = fig.add_subplot(grid[0, :])
    ax_prism = fig.add_subplot(grid[1, 0])
    ax_overlap = fig.add_subplot(grid[1, 1])

    draw_apparatus(ax_full)
    for curve in incoming_curves:
        ax_full.plot(curve[:, 0], curve[:, 1], color="#e8ba32", lw=0.48, alpha=0.45)
    for curve in upper_curves:
        ax_full.plot(curve[:, 0], curve[:, 1], color="#df5637", lw=0.58, alpha=0.50)
    for curve in lower_curves:
        ax_full.plot(curve[:, 0], curve[:, 1], color="#3378cc", lw=0.58, alpha=0.50)
    ax_full.fill_between(
        upper_envelope[:, 0],
        lower_envelope[:, 1],
        upper_envelope[:, 1],
        color="#66bb6a",
        alpha=0.55,
        label="Interference overlap",
    )
    ax_full.set_xlim(-90, 1085)
    ax_full.set_ylim(-125, 125)
    ax_full.set_xlabel("Optical axis x (mm)")
    ax_full.set_ylabel("Transverse position y (mm)")
    ax_full.set_title("(a) Full 2D apparatus with ray paths", fontsize=13, color="#172033")
    style_axis(ax_full)

    draw_apparatus(ax_prism, compact=True)
    for curve in incoming_curves:
        ax_prism.plot(curve[:, 0], curve[:, 1], color="#e8ba32", lw=0.65, alpha=0.45)
    for curve in upper_curves:
        ax_prism.plot(curve[:, 0], curve[:, 1], color="#df5637", lw=0.75, alpha=0.55)
    for curve in lower_curves:
        ax_prism.plot(curve[:, 0], curve[:, 1], color="#3378cc", lw=0.75, alpha=0.55)
    ax_prism.set_xlim(-62, 40)
    ax_prism.set_ylim(-55, 55)
    ax_prism.set_xlabel("x (mm)")
    ax_prism.set_ylabel("y (mm)")
    ax_prism.set_title("(b) Source and biprism close-up", fontsize=11)
    style_axis(ax_prism)

    ax_overlap.fill_between(
        upper_envelope[:, 0],
        lower_envelope[:, 1],
        upper_envelope[:, 1],
        color="#66bb6a",
        alpha=0.65,
    )
    for curve in upper_curves:
        mask = curve[:, 0] >= 150
        ax_overlap.plot(curve[mask, 0], curve[mask, 1], color="#df5637", lw=0.45, alpha=0.18)
    for curve in lower_curves:
        mask = curve[:, 0] >= 150
        ax_overlap.plot(curve[mask, 0], curve[mask, 1], color="#3378cc", lw=0.45, alpha=0.18)
    ax_overlap.axvline(1000, color="#26313c", lw=2)
    for k in range(-4, 5):
        y = k * DX_MM
        ax_overlap.plot([1000, 1007], [y, y], color="#d97706", lw=1.2)
    ax_overlap.set_xlim(150, 1018)
    ax_overlap.set_ylim(-6, 6)
    ax_overlap.set_xlabel("x (mm)")
    ax_overlap.set_ylabel("y (mm)")
    ax_overlap.set_title("(c) Magnified interference region", fontsize=11)
    style_axis(ax_overlap)

    screen_low = float(lower_envelope[-1, 1])
    screen_high = float(upper_envelope[-1, 1])
    ax_overlap.text(
        425,
        -5.2,
        "overlap width at screen = %.3f mm\nfringe spacing = %.6f mm"
        % (screen_high - screen_low, DX_MM),
        fontsize=8.5,
        color="#2f5d3a",
        bbox={"facecolor": "white", "edgecolor": "#a6c9ad", "alpha": 0.92},
    )
    ax_full.text(
        240,
        34,
        "interference region\nx = %.1f to 1000 mm" % upper_envelope[0, 0],
        fontsize=8.5,
        color="#2f6c3d",
        bbox={"facecolor": "white", "edgecolor": "#9ac7a0", "alpha": 0.92},
    )

    legend = [
        Patch(facecolor="#ef7a29", label="Light source"),
        Patch(facecolor="#63c7e0", label="Biprism glass"),
        Patch(facecolor="#66bb6a", alpha=0.55, label="Interference overlap"),
        Patch(facecolor="#f8fafc", edgecolor="#4b5563", label="Screen"),
    ]
    ax_full.legend(handles=legend, loc="upper right", frameon=True, fontsize=8)

    fig.suptitle(
        "Fresnel Biprism - full apparatus, 2D optical path and interference region",
        fontsize=16,
        color="#172033",
    )
    fig.text(
        0.5,
        0.018,
        "Display geometry in COMSOL; ray paths are projected from the validated 3D thin-slab Ray Optics solution.",
        ha="center",
        fontsize=9,
        color="#64748b",
    )
    fig.subplots_adjust(left=0.065, right=0.985, bottom=0.08, top=0.90, hspace=0.30, wspace=0.18)
    fig.savefig(OUTPUT, facecolor="white", bbox_inches="tight")
    print("图像:", OUTPUT)
    print("入射/上/下光线数:", len(incoming), len(upper), len(lower))
    print(
        "干涉区 x 范围: %.3f ~ %.3f mm"
        % (upper_envelope[0, 0], upper_envelope[-1, 0])
    )
    print("屏面交叠宽度: %.6f mm" % (screen_high - screen_low))


if __name__ == "__main__":
    main()
