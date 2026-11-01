"""验证二维仪器光路模型和总览图。"""

from pathlib import Path
import sys

import mph
from PIL import Image


BASE = Path(__file__).resolve().parent
MODEL = BASE / "FresnelBiprism_2D_View.mph"
IMAGE = BASE / "FresnelBiprism_2D_View.png"
SOURCE_MODEL = BASE / "FresnelBiprism_RayOptics.mph"


def main():
    client = mph.Client(cores=1)
    model = client.load(MODEL)
    comp = model.java.component("comp1")
    geom = comp.geom("view2d")
    tags = list(geom.feature().tags())
    bbox = [float(value) for value in geom.getBoundingBox()]
    image_size = Image.open(IMAGE).size
    checks = {
        "二维几何 view2d 存在": "view2d" in list(comp.geom().tags()),
        "入射 InterpolationCurve 存在": "rays_incoming" in tags,
        "上折射 InterpolationCurve 存在": "rays_upper" in tags,
        "下折射 InterpolationCurve 存在": "rays_lower" in tags,
        "干涉区 Polygon 存在": "interference_zone" in tags,
        "二维几何边数 >= 300": geom.getNEdges() >= 300,
        "包围盒覆盖光屏": bbox[1] >= 1080 and bbox[3] >= 110,
        "总览图宽度 >= 1800": image_size[0] >= 1800,
        "原三维光学模型存在": SOURCE_MODEL.exists(),
    }
    print("几何特征数:", len(tags))
    print("几何包围盒:", bbox)
    print("二维模型边数:", geom.getNEdges())
    print("总览图尺寸:", image_size)
    for name, passed in checks.items():
        print(("PASS " if passed else "FAIL ") + name)
    client.remove(model)
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
