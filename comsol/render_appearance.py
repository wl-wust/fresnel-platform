"""用与 COMSOL 外观几何一致的尺寸渲染实验装置示意图。"""

from pathlib import Path
import math

import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import numpy as np


BASE = Path(__file__).resolve().parent
OUTPUT = BASE / "FresnelBiprism_Apparatus_Appearance.png"
VS = 0.45

COLORS = {
    "rail_dark": "#333c47",
    "rail_mid": "#6e7b88",
    "steel_blue": "#5a80a8",
    "steel_light": "#94a8bd",
    "source_orange": "#ef7a29",
    "source_dark": "#3d332d",
    "glass_cyan": "#63c7e0",
    "screen_white": "#f7fafc",
    "frame_dark": "#2b333c",
    "knob_gold": "#e0ad33",
}


def add_box(ax, origin, size, color, alpha=1.0, edge="#344454", linewidth=0.45):
    """添加长方体。"""
    x, y, z = origin
    x *= VS
    dx, dy, dz = size
    dx *= VS
    vertices = np.array(
        [
            [x, y, z],
            [x + dx, y, z],
            [x + dx, y + dy, z],
            [x, y + dy, z],
            [x, y, z + dz],
            [x + dx, y, z + dz],
            [x + dx, y + dy, z + dz],
            [x, y + dy, z + dz],
        ]
    )
    faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ]
    collection = Poly3DCollection(
        [vertices[index] for index in faces],
        facecolor=color,
        edgecolor=edge,
        linewidth=linewidth,
        alpha=alpha,
    )
    ax.add_collection3d(collection)


def add_cylinder(
    ax,
    base,
    radius,
    length,
    axis,
    color,
    alpha=1.0,
    segments=36,
    edge="#344454",
):
    """添加沿任意坐标轴放置的圆柱。"""
    base = np.asarray(base, dtype=float)
    base[0] *= VS
    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)
    visual_length = length * VS if abs(axis[0]) > 0.9 else length
    if abs(axis[2]) < 0.9:
        u = np.cross(axis, [0, 0, 1])
    else:
        u = np.cross(axis, [1, 0, 0])
    u = u / np.linalg.norm(u)
    v = np.cross(axis, u)
    theta = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    ring = radius * (
        np.cos(theta)[:, None] * u[None, :]
        + np.sin(theta)[:, None] * v[None, :]
    )
    lower = base + ring
    upper = base + axis * visual_length + ring
    faces = []
    for index in range(segments):
        j = (index + 1) % segments
        faces.append([lower[index], lower[j], upper[j], upper[index]])
    faces.append(list(lower[::-1]))
    faces.append(list(upper))
    ax.add_collection3d(
        Poly3DCollection(
            faces,
            facecolor=color,
            edgecolor=edge,
            linewidth=0.2,
            alpha=alpha,
        )
    )


def add_triangular_prism(ax):
    """添加与光学模型一致的双棱镜玻璃外观。"""
    front = np.array(
        [
            [-0.2618, 0.03, 0],
            [0, 15, 0],
            [0, -15, 0],
            [-0.2618, -0.03, 0],
        ]
    )
    front[:, 0] *= VS
    back = front + np.array([0, 0, 2])
    faces = [list(front), list(back[::-1])]
    for index in range(4):
        j = (index + 1) % 4
        faces.append([front[index], front[j], back[j], back[index]])
    ax.add_collection3d(
        Poly3DCollection(
            faces,
            facecolor=COLORS["glass_cyan"],
            edgecolor="#19768e",
            linewidth=0.8,
            alpha=0.62,
        )
    )


def add_apparatus(ax, compact=False):
    """添加教学示意版机械装置。"""
    # 支脚与导轨。
    add_box(ax, (-80, -60, -50), (80, 120, 30), COLORS["rail_dark"])
    add_box(ax, (1000, -60, -50), (80, 120, 30), COLORS["rail_dark"])
    add_box(ax, (-80, -30, -20), (1160, 60, 10), COLORS["rail_dark"])
    add_box(ax, (-80, -24, -10), (1160, 4, 6), COLORS["rail_mid"])
    add_box(ax, (-80, 20, -10), (1160, 4, 6), COLORS["rail_mid"])
    add_box(ax, (-90, -35, -20), (20, 70, 16), COLORS["rail_mid"])
    add_box(ax, (1070, -35, -20), (20, 70, 16), COLORS["rail_mid"])

    # 滑块、顶板和锁紧旋钮。
    for x in (-50, 0, 1000):
        add_box(ax, (x - 30, -45, -4), (60, 90, 4), COLORS["steel_blue"])
        add_box(ax, (x - 26, -36, 0), (52, 72, 2), COLORS["steel_light"])
        add_cylinder(
            ax,
            (x, -49, -2),
            3.2,
            8,
            (0, 1, 0),
            COLORS["knob_gold"],
        )

    # 光源。
    add_cylinder(
        ax,
        (-72, 0, 1),
        14,
        20,
        (1, 0, 0),
        COLORS["source_orange"],
    )
    add_cylinder(
        ax,
        (-53, 0, 1),
        10,
        4,
        (1, 0, 0),
        COLORS["source_dark"],
    )
    add_box(ax, (-51, -12, -14), (2, 24, 30), COLORS["frame_dark"])
    add_cylinder(
        ax,
        (-50, 0, 2),
        4,
        45,
        (0, 0, 1),
        COLORS["steel_blue"],
    )

    # 双棱镜支架。
    add_cylinder(
        ax,
        (0, -22, 2),
        3,
        48,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_cylinder(
        ax,
        (0, 22, 2),
        3,
        48,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_box(ax, (-12, -27, 45), (24, 54, 5), COLORS["steel_light"])
    for sign in (-1, 1):
        jaw_yz = np.array(
            [
                [14, 1],
                [22, 1],
                [22, 8],
                [18, 24],
                [14, 24],
                [18, 8],
            ]
        )
        front = np.column_stack(
            [
                np.full(len(jaw_yz), -10 * VS),
                sign * jaw_yz[:, 0],
                jaw_yz[:, 1],
            ]
        )
        back = front + np.array([20 * VS, 0, 0])
        faces = [list(front), list(back[::-1])]
        for index in range(len(front)):
            j = (index + 1) % len(front)
            faces.append([front[index], front[j], back[j], back[index]])
        ax.add_collection3d(
            Poly3DCollection(
                faces,
                facecolor=COLORS["steel_light"],
                edgecolor="#344454",
                linewidth=0.45,
                alpha=1.0,
            )
        )
    add_triangular_prism(ax)

    # 光屏。
    add_cylinder(
        ax,
        (1000, -100, 2),
        4,
        132,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_cylinder(
        ax,
        (1000, 100, 2),
        4,
        132,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_box(ax, (1000, -110, -50), (3, 220, 180), COLORS["screen_white"])
    add_box(ax, (1000, -115, 130), (5, 230, 8), COLORS["frame_dark"])
    add_box(ax, (1000, -115, -58), (5, 230, 8), COLORS["frame_dark"])
    add_box(ax, (1000, -115, -54), (5, 8, 188), COLORS["frame_dark"])
    add_box(ax, (1000, 107, -54), (5, 8, 188), COLORS["frame_dark"])

    if not compact:
        ax.text(
            -45 * VS,
            -40,
            26,
            "Source",
            color="#9a3b10",
            fontsize=10,
            weight="bold",
        )
        ax.text(0, 30, 55, "Biprism holder", color="#315b86", fontsize=10, weight="bold")
        ax.text(1000 * VS, 120, 145, "Screen", color="#202a35", fontsize=10, weight="bold")
        ax.text(
            500 * VS,
            -70,
            -34,
            "Optical rail",
            color="#202a35",
            fontsize=10,
            weight="bold",
        )


def add_prism_detail(ax):
    """在放大视图中只绘制双棱镜夹持机构。"""
    add_box(ax, (-30, -45, -4), (60, 90, 4), COLORS["steel_blue"])
    add_box(ax, (-26, -36, 0), (52, 72, 2), COLORS["steel_light"])
    add_cylinder(
        ax,
        (0, -22, 2),
        3,
        48,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_cylinder(
        ax,
        (0, 22, 2),
        3,
        48,
        (0, 0, 1),
        COLORS["steel_blue"],
    )
    add_box(ax, (-12, -27, 45), (24, 54, 5), COLORS["steel_light"])
    for sign in (-1, 1):
        jaw_yz = np.array(
            [
                [14, 1],
                [22, 1],
                [22, 8],
                [18, 24],
                [14, 24],
                [18, 8],
            ]
        )
        front = np.column_stack(
            [
                np.full(len(jaw_yz), -10),
                sign * jaw_yz[:, 0],
                jaw_yz[:, 1],
            ]
        )
        back = front + np.array([20, 0, 0])
        faces = [list(front), list(back[::-1])]
        for index in range(len(front)):
            j = (index + 1) % len(front)
            faces.append([front[index], front[j], back[j], back[index]])
        ax.add_collection3d(
            Poly3DCollection(
                faces,
                facecolor=COLORS["steel_light"],
                edgecolor="#344454",
                linewidth=0.55,
                alpha=1.0,
            )
        )
    # 放大图中按真实 x 比例显示玻璃棱镜。
    front = np.array(
        [
            [-0.2618, 0.03, 0],
            [0, 15, 0],
            [0, -15, 0],
            [-0.2618, -0.03, 0],
        ]
    )
    back = front + np.array([0, 0, 2])
    faces = [list(front), list(back[::-1])]
    for index in range(4):
        j = (index + 1) % 4
        faces.append([front[index], front[j], back[j], back[index]])
    ax.add_collection3d(
        Poly3DCollection(
            faces,
            facecolor=COLORS["glass_cyan"],
            edgecolor="#19768e",
            linewidth=1.0,
            alpha=0.72,
        )
    )


def visual_x(value):
    """把真实 x 坐标转换为显示坐标。"""
    return value * VS


def style_main_axis(ax):
    ax.set_xlim(-50, 510)
    ax.set_ylim(-130, 130)
    ax.set_zlim(-70, 160)
    ax.set_box_aspect((560, 260, 240), zoom=1.18)
    ax.view_init(elev=24, azim=-67)
    ax.set_proj_type("ortho")
    ax.grid(False)
    ax.set_axis_off()
    ax.set_facecolor("white")


def main():
    plt.rcParams.update({"font.family": "DejaVu Sans"})
    fig = plt.figure(figsize=(15, 8.6), dpi=180)
    ax = fig.add_subplot(111, projection="3d")
    ax.set_position([0.02, 0.16, 0.72, 0.77])
    add_apparatus(ax, compact=False)
    style_main_axis(ax)

    ax.set_title(
        "Fresnel biprism teaching apparatus - display geometry",
        fontsize=17,
        color="#172033",
        pad=8,
    )

    # 棱镜夹持处放大视图。
    inset = fig.add_axes([0.71, 0.53, 0.26, 0.32], projection="3d")
    add_prism_detail(inset)
    inset.set_xlim(-34, 34)
    inset.set_ylim(-35, 35)
    inset.set_zlim(-8, 52)
    inset.set_box_aspect((68, 70, 60), zoom=1.12)
    inset.view_init(elev=22, azim=-55)
    inset.set_axis_off()
    inset.set_facecolor("#f8fafc")
    inset.set_title("Biprism V-block detail", fontsize=9, color="#475569")

    legend = [
        Patch(facecolor=COLORS["rail_dark"], label="Rail and feet"),
        Patch(facecolor=COLORS["steel_blue"], label="Sliders and posts"),
        Patch(facecolor=COLORS["source_orange"], label="Light source"),
        Patch(facecolor=COLORS["glass_cyan"], label="Biprism glass"),
        Patch(facecolor=COLORS["screen_white"], edgecolor="#64748b", label="Screen"),
    ]
    fig.legend(
        handles=legend,
        loc="lower left",
        bbox_to_anchor=(0.06, 0.045),
        ncol=5,
        frameon=False,
        fontsize=8.5,
    )
    fig.text(
        0.5,
        0.018,
        "Display-only geometry in COMSOL sequence 'mech'; optical solving remains in 'geom1'.",
        ha="center",
        fontsize=9,
        color="#64748b",
    )
    fig.text(
        0.06,
        0.095,
        "Longitudinal x-axis is compressed for the appearance drawing.",
        fontsize=8,
        color="#94a3b8",
    )
    fig.savefig(OUTPUT, facecolor="white", bbox_inches="tight")
    print(OUTPUT)


if __name__ == "__main__":
    main()
