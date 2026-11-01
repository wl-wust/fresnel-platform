# COMSOL 2D Interference View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成二维 COMSOL 展示模型，在同一画面中显示完整仪器、入射光、上下折射束、干涉区和光屏条纹位置。

**Architecture:** 从已验证的 `FresnelBiprism_RayOptics.txt` 提取 80 条折射光线，按上/下光束分类写出三份 COMSOL sectionwise 数据文件。用二维几何绘制仪器和干涉区，用三个 `InterpolationCurve` 显示三组光线，并同步生成 Matplotlib 高清总览图。

**Tech Stack:** Python 3.12、NumPy、Matplotlib、MPh 1.4、COMSOL 6.4 Java Geometry API。

---

### Task 1: 二维模型验证脚本

**Files:**
- Create: `comsol/verify_2d_view.py`

- [ ] **Step 1: 写入验收脚本**

```python
from pathlib import Path
import sys
import mph

BASE = Path(__file__).resolve().parent
MODEL = BASE / "FresnelBiprism_2D_View.mph"

client = mph.Client(cores=1)
model = client.load(MODEL)
comp = model.java.component("comp1")
geoms = list(comp.geom().tags())
checks = {
    "view2d": "view2d" in geoms,
    "原模型存在": (BASE / "FresnelBiprism_RayOptics.mph").exists(),
    "总览图存在": (BASE / "FresnelBiprism_2D_View.png").exists(),
}
for name, passed in checks.items():
    print(("PASS " if passed else "FAIL ") + name)
client.remove(model)
sys.exit(0 if all(checks.values()) else 1)
```

- [ ] **Step 2: 运行并确认当前失败**

Run: `python comsol/verify_2d_view.py`

Expected: 因 `FresnelBiprism_2D_View.mph` 不存在而失败。

### Task 2: 生成二维 COMSOL 模型

**Files:**
- Create: `comsol/build_2d_view.py`
- Create: `comsol/rays_incoming.txt`
- Create: `comsol/rays_upper.txt`
- Create: `comsol/rays_lower.txt`
- Create: `comsol/FresnelBiprism_2D_View.mph`

- [ ] **Step 1: 解析射线数据**

```python
for line in DATA.read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("%"):
        continue
    parts = line.split()
    x, y, z = map(float, parts[:3])
    ray = int(float(parts[3]))
    vx, vy, vz = map(float, parts[5:8])
    groups[ray].append((x, y, vx, vy))
```

- [ ] **Step 2: 写出 sectionwise 文件**

```python
def write_sectionwise(path, polylines):
    points = []
    segments = []
    offset = 1
    for polyline in polylines:
        points.extend(polyline)
        segments.extend((offset + i, offset + i + 1) for i in range(len(polyline) - 1))
        offset += len(polyline)
    lines = ["% Coordinates"]
    lines += [f"{x:.9f} {y:.9f}" for x, y in points]
    lines.append("% Elements (segments)")
    lines += [f"{a} {b}" for a, b in segments]
    path.write_text("\n".join(lines), encoding="ascii")
```

- [ ] **Step 3: 创建二维仪器几何**

```python
geom = comp.geom().create("view2d", 2)
geom.lengthUnit("mm")
rail = geom.create("rail", "Rectangle")
rail.set("size", ["1160", "20"])
rail.set("pos", ["-80", "-35"])

screen = geom.create("screen", "Rectangle")
screen.set("size", ["3", "220"])
screen.set("pos", ["1000", "-110"])
```

- [ ] **Step 4: 导入三组光线**

```python
for tag, filename, color in (
    ("rays_incoming", "rays_incoming.txt", ("0.95", "0.75", "0.25")),
    ("rays_upper", "rays_upper.txt", ("0.90", "0.35", "0.15")),
    ("rays_lower", "rays_lower.txt", ("0.20", "0.45", "0.80")),
):
    curve = geom.create(tag, "InterpolationCurve")
    curve.set("source", "file")
    curve.set("struct", "sectionwise")
    curve.set("filename", str(BASE / filename))
    curve.set("type", "open")
```

- [ ] **Step 5: 保存并检查**

```python
model.save(MODEL)
print(model.geometries())
print(geom.getBoundingBox())
print(geom.getNEdges())
```

Expected: `view2d` 存在，几何边数大于 300。

### Task 3: 高清二维总览图

**Files:**
- Create: `comsol/render_2d_view.py`
- Create: `comsol/FresnelBiprism_2D_View.png`

- [ ] **Step 1: 绘制仪器和光线**

```python
fig, (ax_full, ax_zoom) = plt.subplots(2, 1, figsize=(16, 9), dpi=180)
for polyline, color in incoming:
    ax_full.plot(polyline[:, 0], polyline[:, 1], color="#e4b949", lw=0.45)
for polyline in upper:
    ax_full.plot(polyline[:, 0], polyline[:, 1], color="#df5b3e", lw=0.55)
for polyline in lower:
    ax_full.plot(polyline[:, 0], polyline[:, 1], color="#3478c8", lw=0.55)
```

- [ ] **Step 2: 绘制干涉区和仪器**

```python
ax_full.fill_between(overlap_x, overlap_low, overlap_high, color="#68b96f", alpha=0.42)
ax_full.add_patch(Rectangle((-80, -35), 1160, 20, color="#38414c"))
ax_full.add_patch(Rectangle((1000, -110), 3, 220, color="#f8fafc", ec="#26313c"))
```

- [ ] **Step 3: 标注关键结果**

```python
ax_full.text(220, 25, "Interference region x = 192 to 1000 mm", color="#2f6c3d")
ax_full.text(700, -95, "Screen overlap = 3.015 mm", color="#2f6c3d")
```

- [ ] **Step 4: 保存图片**

Run: `python comsol/render_2d_view.py`

Expected: 输出 `FresnelBiprism_2D_View.png`，尺寸不低于 1800×1000。

### Task 4: 回归验证与文档

**Files:**
- Modify: `comsol/README.md`

- [ ] **Step 1: 运行二维验收**

Run: `python comsol/verify_2d_view.py`

Expected: 全部 PASS。

- [ ] **Step 2: 检查原三维模型**

Run: `python comsol/verify_appearance.py`

Expected: 原 Ray Optics 解和轨迹绘图全部 PASS。

- [ ] **Step 3: 编译脚本**

Run: `python -m py_compile comsol/build_2d_view.py comsol/render_2d_view.py comsol/verify_2d_view.py`

Expected: 无输出，退出码 0。

- [ ] **Step 4: 更新 README 并提交**

```bash
git add docs/superpowers/plans/2026-11-01-comsol-2d-interference-view.md comsol/build_2d_view.py comsol/render_2d_view.py comsol/verify_2d_view.py comsol/README.md comsol/FresnelBiprism_2D_View.mph comsol/FresnelBiprism_2D_View.png comsol/rays_incoming.txt comsol/rays_upper.txt comsol/rays_lower.txt
git commit -m "feat(comsol): add 2D apparatus ray and interference view"
```
