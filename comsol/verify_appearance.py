"""验证机械外观序列存在，并确认原光学模型未受影响。"""

from pathlib import Path
import sys

import mph


BASE = Path(__file__).resolve().parent
MODEL = BASE / "FresnelBiprism_RayOptics_with_appearance.mph"


def main():
    client = mph.Client(cores=1)
    model = client.load(MODEL)
    comp = model.java.component("comp1")
    geometry_tags = list(comp.geom().tags())
    mech = comp.geom("mech")
    mech_features = list(mech.feature().tags())
    bbox = [float(value) for value in mech.getBoundingBox()]
    checks = {
        "光学几何 geom1 存在": "geom1" in geometry_tags,
        "机械外观序列 mech 存在": "mech" in geometry_tags,
        "外观特征数 >= 30": len(mech_features) >= 30,
        "外观包围盒覆盖光屏": bbox[1] >= 1080,
        "Ray Optics 存在": any("Geometrical" in name for name in model.physics()),
        "射线解存在": bool(model.solutions()),
        "轨迹绘图存在": any("Ray Trajectories" in name for name in model.plots()),
    }
    print("几何序列:", geometry_tags)
    print("外观特征数:", len(mech_features))
    print("外观包围盒:", bbox)
    for name, passed in checks.items():
        print(("PASS " if passed else "FAIL ") + name)
    client.remove(model)
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
