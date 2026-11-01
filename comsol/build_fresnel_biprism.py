"""建立并运行菲涅耳双棱镜 Ray Optics 模型。

模型只计算几何光学光路和光束交叠区域，条纹强度仍由网页平台/MATLAB 计算。
"""

from pathlib import Path

import mph


BASE = Path(__file__).resolve().parent
OUT = BASE / "FresnelBiprism_RayOptics.mph"


def set_index_vector(feature, name, values):
    """按 COMSOL 的 setIndex 接口写入一维字符串数组。"""
    for index, value in enumerate(values):
        feature.setIndex(name, str(value), index)


def main():
    client = mph.Client(cores=1)
    model = client.create("FresnelBiprism_RayOptics")
    java = model.java

    # 与网页平台一致的实验参数。
    parameters = {
        "lambda0": "589.3[nm]",
        "n_air": "1",
        "n_glass": "1.5168",
        "a": "50[mm]",
        "z2": "950[mm]",
        "beta": "1[deg]",
        "slit_b": "0.08[mm]",
        "H": "15[mm]",
        "thickness": "2[mm]",
        "tip_half": "0.03[mm]",
        "x_apex": "-H*tan(beta)",
        "screen_x": "a+z2",
        "fan_angle": "atan(1.25*H/a)",
    }
    for name, expression in parameters.items():
        model.parameter(name, expression)

    comp = java.component().create("comp1", "Component")
    comp.label("Fresnel Biprism")

    # 3D 薄片：截面在 xy 平面，沿 z 方向拉伸 2 mm。
    geom = comp.geom().create("geom1", 3)
    geom.lengthUnit("mm")
    wp = geom.create("wp1", "WorkPlane")
    wp.set("quickplane", "xy")
    wp.set("quickz", "0")

    poly = wp.geom().create("pol1", "Polygon")
    poly.set("source", "table")
    points = [
        ("x_apex", "tip_half"),
        ("0", "H"),
        ("0", "-H"),
        ("x_apex", "-tip_half"),
        ("x_apex", "tip_half"),
    ]
    for row, (x_value, y_value) in enumerate(points):
        poly.setIndex("table", x_value, row, 0)
        poly.setIndex("table", y_value, row, 1)
    wp.geom().run("pol1")
    geom.run("wp1")

    extrude = geom.create("ext1", "Extrude")
    extrude.set("workplane", "wp1")
    extrude.selection("input").set("wp1")
    extrude.set("distance", "thickness")
    geom.run()

    # 玻璃材料：仅棱镜域，外部 void 的折射率由 gop 属性指定。
    mat = comp.material().create("mat1", "Common")
    mat.label("N-SF? 1.5168 glass")
    mat.propertyGroup().create("RefractiveIndex", "RefractiveIndex", "Refractive_index")
    mat.propertyGroup("RefractiveIndex").set("n", ["n_glass"])
    mat.selection().all()

    # 几何光学接口。
    gop = comp.physics().create("gop", "GeometricalOptics", "geom1")
    gop.label("Geometrical Optics")
    gop.prop("ExteriorUnmeshedProperties").setIndex("next", "n_air", 0)
    gop.prop("ComputeOpticalPathLength").setIndex(
        "ComputeOpticalPathLength", "1", 0
    )
    gop.prop("IntensityComputation").setIndex(
        "IntensityComputation", "ComputeIntensity", 0
    )

    # 点光源位于狭缝中心，用平面扇形光线表示向双棱镜的发散照明。
    release = gop.create("relg1", "ReleaseGrid", -1)
    release.label("Slit point source fan")
    release.setIndex("x0", "-a", 0)
    release.setIndex("x0", "0", 1)
    release.setIndex("x0", "thickness/2", 2)
    release.set("GridType", "AllCombinations")
    release.set("RayDirectionVector", "Conical")
    release.set("ConicalDistribution", "Flat")
    release.set("Nw", "101")
    release.set("rcc", ["1", "0", "0"])
    release.set("alphac", "fan_angle")
    release.set("TransverseDirection", "UserDefined")
    release.set("et", ["0", "1", "0"])
    release.set("InitialPolarizationType", "UnPolarized")
    release.set("lambda0", "lambda0")
    release.set("SamplingFromDistribution", "Deterministic")

    # 普通空气-玻璃界面；棱镜的全部外表面都需要折射。
    try:
        disc = gop.feature("matd1")
        disc.label("Glass-air interfaces")
        print("材料不连续面使用默认选择")
    except Exception as exc:
        print("未找到默认材料不连续面:", str(exc)[:160])

    mesh = comp.mesh().create("mesh1")
    mesh.label("Mesh 1")
    mesh.create("ftet1", "FreeTet")
    mesh.feature("ftet1").create("size1", "Size")
    mesh.feature("ftet1").feature("size1").set("hmax", "1.5")
    mesh.run()
    print("几何域数:", geom.getNDomains())
    print("网格单元数:", mesh.stat().getNumElem())

    study = java.study().create("std1")
    study.label("Ray Tracing Study")
    rtrac = study.create("rtrac", "RayTracing")
    rtrac.set("timestepspec", "specifylength")
    rtrac.set("llist", "range(0,0.01,1.2)")
    rtrac.set("lunit", "m")
    rtrac.set("numberofreflections", "6")
    study.createAutoSequences("all")
    model.save(OUT)

    print("物理场节点:", list(gop.feature().tags()))
    print(
        "射线源属性:",
        {
            key: release.getString(key)
            for key in ("x0", "rcc", "alphac", "ConicalDistribution", "Nw")
            if release.hasProperty(key)
        },
    )

    for solution_tag in java.sol().tags():
        print("运行求解器:", solution_tag)
        java.sol(solution_tag).runAll()

    model.save(OUT)
    print("模型已保存:", OUT)
    print("问题:", model.problems())


if __name__ == "__main__":
    main()
