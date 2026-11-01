# COMSOL Mechanical Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 COMSOL 光学模型中增加一套仅用于显示的教学级机械实验装置，并保持射线追踪结果不变。

**Architecture:** 在 `D:\cc\test-1\comsol\` 下新增独立外观构建脚本和验证脚本。脚本加载已求解的 `.mph`，在组件内创建独立 3D 几何序列 `mech`，保存为新文件后验证原有光学几何、物理场、解和轨迹绘图均存在。最终用生成的外观图与 README 记录查看方法。

**Tech Stack:** Python 3.12、MPh 1.4、JPype、COMSOL 6.4 Java API、Matplotlib、PowerShell。

---

### Task 1: 外观模型验收脚本

**Files:**
- Create: `D:\cc\test-1\comsol\verify_appearance.py`
- Test: `D:\cc\test-1\comsol\verify_appearance.py`

- [ ] **Step 1: 写入验收断言**

```python
"""验证机械外观序列和原光学模型完整性。"""

from pathlib import Path
import sys

import mph


BASE = Path(__file__).resolve().parent
MODEL = BASE / "FresnelBiprism_RayOptics.mph"


def main():
    client = mph.Client(cores=1)
    model = client.load(MODEL)
    checks = {
        "光学几何存在": any("几何 1" == name for name in model.geometries()),
        "机械外观序列存在": any("mech" in str(name).lower() for name in model.geometries()),
        "Ray Optics 存在": any("Geometrical" in name for name in model.physics()),
        "射线解存在": bool(model.solutions()),
        "轨迹绘图存在": any("Ray Trajectories" in name for name in model.plots()),
    }
    for name, passed in checks.items():
        print(("PASS " if passed else "FAIL ") + name)
    client.remove(model)
    sys.exit(0 if all(checks.values()) else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行并确认当前失败**

Run: `python D:\cc\test-1\comsol\verify_appearance.py`

Expected: `FAIL 机械外观序列存在`，退出码 1。

### Task 2: 外观几何构建脚本

**Files:**
- Create: `D:\cc\test-1\comsol\add_mechanical_appearance.py`
- Modify: `D:\cc\test-1\comsol\FresnelBiprism_RayOptics.mph` through COMSOL API only

- [ ] **Step 1: 创建独立 3D 几何序列**

```python
comp = model.java.component("comp1")
mech = comp.geom().create("mech", 3)
mech.lengthUnit("mm")
```

- [ ] **Step 2: 添加导轨、支脚和滑块**

```python
rail = mech.create("rail", "Block")
rail.set("size", ["1160", "60", "10"])
rail.set("pos", ["-80", "-30", "0"])

for tag, x in (("slider_source", -50), ("slider_prism", 0), ("slider_screen", 1000)):
    slider = mech.create(tag, "Block")
    slider.set("size", ["55", "80", "12"])
    slider.set("pos", [str(x - 27.5), "-40", "10"])
```

- [ ] **Step 3: 添加光源、棱镜架和光屏外观**

```python
post_source = mech.create("post_source", "Cylinder")
post_source.set("r", "4")
post_source.set("h", "65")
post_source.set("pos", ["-50", "0", "22"])

screen = mech.create("screen_face", "Block")
screen.set("size", ["3", "220", "130"])
screen.set("pos", ["1000", "-110", "30"])
```

- [ ] **Step 4: 构建并保存**

```python
mech.run()
model.save(str(BASE / "FresnelBiprism_RayOptics.mph"))
```

### Task 3: 外观渲染图

**Files:**
- Create: `D:\cc\test-1\comsol\render_appearance.py`
- Create: `D:\cc\test-1\comsol\FresnelBiprism_Apparatus_Appearance.png`

- [ ] **Step 1: 用同一尺寸表绘制等轴测外观**

```python
import numpy as np
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def box(ax, origin, size, color, alpha=1.0):
    """绘制一个长方体外观块。"""
    x, y, z = origin
    dx, dy, dz = size
    vertices = np.array(
        [
            [x, y, z], [x + dx, y, z], [x + dx, y + dy, z], [x, y + dy, z],
            [x, y, z + dz], [x + dx, y, z + dz],
            [x + dx, y + dy, z + dz], [x, y + dy, z + dz],
        ]
    )
    faces = [
        [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
        [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ]
    ax.add_collection3d(
        Poly3DCollection(
            [vertices[index] for index in faces],
            facecolor=color,
            edgecolor="#334155",
            linewidth=0.5,
            alpha=alpha,
        )
    )
```

- [ ] **Step 2: 保存图像并检查尺寸**

Run: `python D:\cc\test-1\comsol\render_appearance.py`

Expected: 输出 `FresnelBiprism_Apparatus_Appearance.png`，图像宽高均大于 1000 像素。

### Task 4: 文档与回归验证

**Files:**
- Modify: `D:\cc\test-1\comsol\README.md`

- [ ] **Step 1: 运行外观验收**

Run: `python D:\cc\test-1\comsol\verify_appearance.py`

Expected: 5 项全部 PASS。

- [ ] **Step 2: 复核原光学数值未变化**

Run: `python D:\cc\test-1\comsol\analyze_rays.py`

Expected: `d=0.898786 mm`、屏面重叠宽度约 `3.015 mm`。

- [ ] **Step 3: 更新 README**

增加 `mech` 几何序列、外观截图和查看方式说明。

- [ ] **Step 4: 提交**

```bash
git add comsol/add_mechanical_appearance.py comsol/render_appearance.py comsol/verify_appearance.py comsol/README.md comsol/FresnelBiprism_Apparatus_Appearance.png comsol/FresnelBiprism_RayOptics.mph
git commit -m "feat(comsol): add mechanical apparatus appearance model"
```
