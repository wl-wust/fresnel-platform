# COMSOL 参数控制台

这是一个独立桌面工具，不接入 GitHub Pages。网页只负责教学画布和实验数据处理；COMSOL 参数调整、模型更新与基准数据导出在这里完成。

## 使用

1. 双击 `run_console.bat`。
2. 用滑块或数字框修改参数。此时只刷新本地二维预览和傍轴计算结果。
3. 点“更新 COMSOL”写入参数、重建几何和网格，不求解。
4. 点“求解并导出”运行 `std1` 射线追踪，并输出模型、配置和射线数据。

也可以直接运行：

```powershell
python comsol_console/app.py
```

## 三步口径

- `仅预览`：不导入 `mph`，不启动 COMSOL。
- `更新 COMSOL`：加载 `comsol/FresnelBiprism_RayOptics.mph`，写入参数、构建几何和网格。
- `求解并导出`：在更新后运行射线追踪，输出：
  - `outputs/latest_scene.json`
  - `outputs/latest_ray_trajectories.txt`
  - `outputs/fresnel_scene_*.mph`

## 当前模型边界

当前真正映射到 COMSOL 的参数：

- 波长、玻璃折射率、单侧棱镜角
- 光源/单缝到棱镜距离 `a`
- 棱镜到光屏距离 `z2`
- 单缝宽度
- 棱镜半高、厚度、钝顶半宽

报告装置中的滤光片、衰减片、45° 半反镜、可插拔凸透镜 L′、圆孔光阑、测微目镜、手机和完整机械支架目前只出现在界面链路中，尚未进入求解模型。界面会用虚线标示这些待扩展部件。

## 测试

```powershell
python -m unittest discover -s comsol_console/tests -v
python comsol_console/apply_scene.py --mode preview
```
