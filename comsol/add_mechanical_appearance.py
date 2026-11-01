"""为菲涅耳双棱镜光学模型添加仅用于显示的机械装置几何。"""

from pathlib import Path

import mph


BASE = Path(__file__).resolve().parent
SOURCE = BASE / "FresnelBiprism_RayOptics.mph"
TARGET = BASE / "FresnelBiprism_RayOptics_with_appearance.mph"

COLORS = {
    "rail_dark": ("0.20", "0.24", "0.29"),
    "rail_mid": ("0.43", "0.48", "0.54"),
    "steel_blue": ("0.35", "0.50", "0.66"),
    "steel_light": ("0.58", "0.65", "0.73"),
    "source_orange": ("0.94", "0.48", "0.16"),
    "source_dark": ("0.24", "0.20", "0.18"),
    "glass_cyan": ("0.35", "0.78", "0.88"),
    "screen_white": ("0.97", "0.98", "0.99"),
    "frame_dark": ("0.17", "0.20", "0.24"),
    "knob_gold": ("0.88", "0.68", "0.20"),
}


def colorize(feature, name):
    """给显示几何设置自定义颜色。"""
    feature.set("color", "custom")
    for index, value in enumerate(COLORS[name]):
        feature.setIndex("customcolor", value, index)


def block(geom, tag, size, pos, color, label=None):
    feature = geom.create(tag, "Block")
    feature.set("size", [str(value) for value in size])
    feature.set("pos", [str(value) for value in pos])
    if label:
        feature.label(label)
    colorize(feature, color)
    return feature


def cylinder(geom, tag, radius, height, pos, color, axis=None, label=None):
    feature = geom.create(tag, "Cylinder")
    feature.set("r", str(radius))
    feature.set("h", str(height))
    feature.set("pos", [str(value) for value in pos])
    if axis:
        feature.set("axis", [str(value) for value in axis])
    if label:
        feature.label(label)
    colorize(feature, color)
    return feature


def workplane_polygons(geom, tag, plane, offset, polygons, extrude, color, label):
    """在坐标平面创建多个封闭多边形，并沿法向拉伸成显示实体。"""
    wp = geom.create(tag, "WorkPlane")
    wp.set("quickplane", plane)
    offset_name = {"xy": "quickz", "yz": "quickx", "xz": "quicky"}[plane]
    wp.set(offset_name, str(offset))
    for index, points in enumerate(polygons):
        polygon = wp.geom().create(f"pol_{tag}_{index}", "Polygon")
        polygon.set("source", "table")
        for row, (u, v) in enumerate(points):
            polygon.setIndex("table", str(u), row, 0)
            polygon.setIndex("table", str(v), row, 1)
    wp.geom().run()
    extrusion = geom.create(f"ext_{tag}", "Extrude")
    extrusion.set("workplane", tag)
    extrusion.selection("input").set(tag)
    extrusion.set("distance", str(extrude))
    extrusion.label(label)
    colorize(extrusion, color)
    return extrusion


def build_mechanical_geometry(geom):
    """创建导轨、支脚、滑块、光源、棱镜架和光屏。"""
    # 导轨和支脚全部位于光学平面 z=0 以下。
    block(geom, "foot_left", (80, 120, 30), (-80, -60, -50), "rail_dark", "左支脚")
    block(geom, "foot_right", (80, 120, 30), (1000, -60, -50), "rail_dark", "右支脚")
    block(geom, "rail_main", (1160, 60, 10), (-80, -30, -20), "rail_dark", "光学导轨")
    block(geom, "rail_strip_a", (1160, 4, 6), (-80, -24, -10), "rail_mid", "导轨凸轨 A")
    block(geom, "rail_strip_b", (1160, 4, 6), (-80, 20, -10), "rail_mid", "导轨凸轨 B")
    block(geom, "rail_end_a", (20, 70, 16), (-90, -35, -20), "rail_mid", "左端盖")
    block(geom, "rail_end_b", (20, 70, 16), (1070, -35, -20), "rail_mid", "右端盖")

    # 三个滑块和锁紧旋钮。
    for tag, x, label in (
        ("slider_source", -50, "光源滑块"),
        ("slider_prism", 0, "棱镜滑块"),
        ("slider_screen", 1000, "光屏滑块"),
    ):
        block(geom, tag, (60, 90, 4), (x - 30, -45, -4), "steel_blue", label)
        block(geom, f"{tag}_top", (52, 72, 2), (x - 26, -36, 0), "steel_light", f"{label}顶板")
        cylinder(
            geom,
            f"{tag}_knob",
            3.2,
            8,
            (x, -49, -2),
            "knob_gold",
            axis=(0, 1, 0),
            label=f"{label}旋钮",
        )

    # 光源：短镜筒、竖直狭缝片和支撑柱。
    cylinder(
        geom,
        "source_shell",
        14,
        20,
        (-72, 0, 1),
        "source_orange",
        axis=(1, 0, 0),
        label="圆形光源壳",
    )
    cylinder(
        geom,
        "source_lens",
        10,
        4,
        (-53, 0, 1),
        "source_dark",
        axis=(1, 0, 0),
        label="光源镜筒",
    )
    block(geom, "source_slit", (2, 24, 30), (-51, -12, -14), "frame_dark", "狭缝片")
    cylinder(
        geom,
        "source_post",
        4,
        45,
        (-50, 0, 2),
        "steel_blue",
        label="光源支柱",
    )

    # 双棱镜夹持架：两根立柱、横梁和左右 V 形夹爪。
    cylinder(
        geom,
        "prism_post_left",
        3,
        48,
        (0, -22, 2),
        "steel_blue",
        label="棱镜左立柱",
    )
    cylinder(
        geom,
        "prism_post_right",
        3,
        48,
        (0, 22, 2),
        "steel_blue",
        label="棱镜右立柱",
    )
    block(geom, "prism_crossbar", (24, 54, 5), (-12, -27, 45), "steel_light", "棱镜横梁")
    workplane_polygons(
        geom,
        "wp_prism_jaws",
        "yz",
        -10,
        [
            [(14, 1), (22, 1), (22, 8), (18, 24), (14, 24), (18, 8)],
            [(-14, 1), (-22, 1), (-22, 8), (-18, 24), (-14, 24), (-18, 8)],
        ],
        20,
        "steel_light",
        "双棱镜 V 形夹爪",
    )

    # 光屏：白色屏面、深色边框和双立柱。
    cylinder(
        geom,
        "screen_post_left",
        4,
        132,
        (1000, -100, 2),
        "steel_blue",
        label="光屏左立柱",
    )
    cylinder(
        geom,
        "screen_post_right",
        4,
        132,
        (1000, 100, 2),
        "steel_blue",
        label="光屏右立柱",
    )
    block(geom, "screen_face", (3, 220, 180), (1000, -110, -50), "screen_white", "白色光屏")
    block(geom, "screen_frame_top", (5, 230, 8), (1000, -115, 130), "frame_dark", "光屏上框")
    block(geom, "screen_frame_bottom", (5, 230, 8), (1000, -115, -58), "frame_dark", "光屏下框")
    block(geom, "screen_frame_left", (5, 8, 188), (1000, -115, -54), "frame_dark", "光屏左框")
    block(geom, "screen_frame_right", (5, 8, 188), (1000, 107, -54), "frame_dark", "光屏右框")

    # 外观版双棱镜玻璃，坐标与光学几何完全一致；仅用于显示。
    workplane_polygons(
        geom,
        "wp_glass",
        "xy",
        0,
        [
            [
                (-0.2618, 0.03),
                (0, 15),
                (0, -15),
                (-0.2618, -0.03),
                (-0.2618, 0.03),
            ]
        ],
        2,
        "glass_cyan",
        "双棱镜玻璃外观",
    )


def main():
    client = mph.Client(cores=1)
    model = client.load(SOURCE)
    comp = model.java.component("comp1")

    if "mech" in comp.geom().tags():
        comp.geom().remove("mech")

    mech = comp.geom().create("mech", 3)
    mech.lengthUnit("mm")
    build_mechanical_geometry(mech)
    mech.run()

    model.save(TARGET)
    print("外观模型:", TARGET)
    print("几何序列:", model.geometries())
    print("外观包围盒:", mech.getBoundingBox())
    print("原光学解:", model.solutions())
    print("原轨迹绘图:", model.plots())
    client.remove(model)


if __name__ == "__main__":
    main()
