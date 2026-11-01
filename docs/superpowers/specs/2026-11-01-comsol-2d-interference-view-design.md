# 菲涅耳双棱镜二维光路与干涉区展示模型设计

## 目标

提供一个二维观看模型，在同一画面中显示完整实验装置、上下两束折射光和干涉交叠区，便于教学演示与报告截图。

现有三维薄片 Ray Optics 模型继续保持为数值计算来源。本设计不修改其几何、物理场、网格或求解结果。

## 背景与约束

COMSOL 6.4 在当前 Windows 环境中创建 2D `Geometrical Optics` 接口会触发内部 `StackOverflowError`。因此不将该接口作为二维展示模型的计算基础，而使用现有已验证的 3D 薄片射线结果生成二维光线路径。

## 非目标

- 不重新实现波动光学或计算条纹强度。
- 不修改现有 `FresnelBiprism_RayOptics.mph` 和外观版模型。
- 不把二维展示模型作为新的独立数值验证来源。
- 不引入三维机械细节；本模型只显示二维截面轮廓。

## 输出文件

- `comsol/FresnelBiprism_2D_View.mph`：二维 COMSOL 展示模型。
- `comsol/FresnelBiprism_2D_View.png`：二维光路与干涉区总览图。
- `comsol/build_2d_view.py`：生成二维模型、导入光线和干涉区的脚本。
- `comsol/verify_2d_view.py`：验证二维模型和原三维模型完整性。

## 二维模型结构

使用一个 2D 组件，坐标单位为 mm：

- 光学轴沿 `x`，横向为 `y`。
- 点光源/狭缝：`x=-50, y=0`。
- 双棱镜玻璃体：`x=-0.2618 ... 0, y=-15 ... 15`。
- 光屏：`x=1000, y=-110 ... 110`。
- 导轨与支架：使用二维矩形轮廓表示。

模型使用一个二维几何序列 `view2d`，末端动作设为 `Form Assembly`。同一序列包含：

- 仪器轮廓、干涉区填充面和光屏条纹刻度。
- 三个 `InterpolationCurve` 特征 `rays_incoming`、`rays_upper`、`rays_lower`，分别读取 sectionwise 数据文件。每条光线是独立曲线段，不创建实体域，不参与网格和物理场。

使用单一 Assembly 序列是为了让 COMSOL 图形窗口同时显示仪器、光线和绿色干涉区，并避免重叠对象被 Form Union 合并后丢失颜色。

干涉区用单独的多边形区域表示，边界来自上下两组出射光线的包络：

- 起点约在 `x=192 mm`。
- 延伸到光屏 `x=1000 mm`。
- 屏面交叠宽度约 `3.015 mm`。

## 视觉约定

- 仪器轮廓：深灰色。
- 入射光：浅黄色。
- 上折射束：橙红色。
- 下折射束：蓝色。
- 干涉区：半透明绿色。
- 光屏：白底深灰边框。
- 光屏上的条纹位置使用橙色短刻度，间距 `Δx=0.653336 mm`。

## 数据流

1. 读取 `FresnelBiprism_RayOptics.txt`。
2. 按射线 ID 分组，并通过前后方向差识别折射光线。
3. 将每条三维光线投影为 `(x,y)` 二维折线。
4. 按玻璃入射位置 `y>0` 或 `y<0` 分为上下两组。
5. 分别写出 `rays_incoming.txt`、`rays_upper.txt`、`rays_lower.txt`，格式为 COMSOL sectionwise 曲线数据。
6. 对出射直线做包络，生成干涉区多边形。
7. 将仪器轮廓、三个 `InterpolationCurve` 和干涉区写入同一个 `view2d` Assembly 几何序列。
8. 同时用 Matplotlib 输出高清二维总览图。

## 验证

- `FresnelBiprism_2D_View.mph` 能正常加载并包含二维几何序列 `view2d`。
- 二维模型只显示实际落到 `±110 mm` 光屏内的 30 条折射光线，其中上、下光束各 15 条。
- 干涉区起点约为 `192 mm`，屏面宽度约为 `3.015 mm`。
- 原 `FresnelBiprism_RayOptics.mph`、Ray Optics 解和轨迹绘图仍存在。
- 导出图尺寸不低于 1800×1000 像素。

## 风险

- sectionwise 曲线数据只保存离散点和线段；COMSOL 中应保持“一个颜色组一个 InterpolationCurve”，避免逐条创建上百个节点。
- 二维展示模型不参与原光学的重新求解，因此修改二维轮廓不会改变光学数值。
