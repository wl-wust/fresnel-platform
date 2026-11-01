"""为已求解的光线追踪模型添加轨迹图、图片和文本数据导出。"""

from pathlib import Path

import mph


BASE = Path(__file__).resolve().parent
MPH = BASE / "FresnelBiprism_RayOptics.mph"
IMAGE = BASE / "FresnelBiprism_RayOptics.png"
DATA = BASE / "FresnelBiprism_RayOptics.txt"


def main():
    client = mph.Client(cores=1)
    model = client.load(MPH)
    result = model.java.result()

    # 将射线解包装成可绘图的 Ray 数据集。
    dataset = result.dataset().create("ray1", "Ray")
    dataset.set("solution", "sol1")
    dataset.set(
        "posdof",
        ["comp1.qx", "comp1.qy", "comp1.qz"],
    )
    dataset.set("geom", "geom1")
    dataset.set("rgeom", "pgeom_gop")
    dataset.set("rgeomspec", "fromphysics")
    dataset.set("physicsinterface", "gop")

    # 光线轨迹图，以光程长度着色，便于区分两个折射光束。
    plot = result.create("pg1", "PlotGroup3D")
    plot.label("Fresnel Biprism Ray Trajectories")
    plot.set("data", "ray1")
    plot.set("titletype", "manual")
    plot.set("title", "Fresnel biprism: two refracted ray bundles")
    rays = plot.create("rtrj1", "RayTrajectories")
    rays.set("linetype", "line")
    color = rays.create("col1", "Color")
    color.set("expr", "gop.L")
    color.set("descr", "Optical path length")
    color.set("colortable", "ThermalDark")

    # 额外导出射线编号、光程和强度。
    export_expr = rays.create("exp1", "Export")
    export_expr.set("expr", ["gop.pidx", "gop.L", "gop.I"])
    export_expr.set(
        "descr",
        ["Ray index", "Optical path length", "Ray intensity"],
    )

    plot.run()

    image = result.export().create("img1", "pg1", "Image")
    image.set("imagetype", "png")
    image.set("pngfilename", str(IMAGE))
    image.set("width", "1800")
    image.set("height", "1000")
    image.set("fontsize", "12")
    image.set("background", "color")
    for index, value in enumerate(("1", "1", "1")):
        image.setIndex("customcolor", value, index)
    image.set("options3d", "on")
    image.set("legend3d", "on")
    image.set("axisorientation", "on")
    image.set("grid", "off")
    image.set("lockratio", "off")
    image.run()

    data = result.export().create("data1", "pg1", "rtrj1", "Plot")
    data.set("exporttype", "text")
    data.set("filename", str(DATA))
    data.set("ifexists", "overwrite")
    data.run()

    model.save(MPH)
    print("图像:", IMAGE, IMAGE.stat().st_size if IMAGE.exists() else "缺失")
    print("数据:", DATA, DATA.stat().st_size if DATA.exists() else "缺失")
    print("绘图组:", model.plots())
    print("导出:", model.exports())
    print("问题:", model.problems())


if __name__ == "__main__":
    main()
