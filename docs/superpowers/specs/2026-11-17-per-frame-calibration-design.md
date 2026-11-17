# 同框逐帧分划板标定设计

## 1. 背景

本轮实验拍摄时尽量保留了目镜分划板，但手机位置不固定，不同照片和视频帧中的成像尺度会变化。使用一个全局像素当量 `k` 会把手机位移、拍摄距离变化和局部透视误差带入条纹间距，无法满足本轮数据精度要求。

用户已确认：分划板相邻主刻线的实际间距为 `1.00 mm`。

本设计把分划板刻线与钠光或红光条纹放在同一帧、同一局部纵向区域内识别，逐帧得到像素当量。无法完成同帧标定的数据只作为参考，不能用其他帧的标定或历史全局 `k` 补齐。

## 2. 目标

1. 每帧独立识别分划板主刻线和干涉条纹。
2. 由同帧相邻主刻线间距计算局部像素当量：

   \[
   k_i = \frac{1.00\ \mathrm{mm}}{p_i}
   \]

   其中 `p_i` 是该帧刻线在横向分析坐标中的拟合间距，单位 `px`。

3. 由同帧局部当量得到毫米化条纹周期：

   \[
   \Delta x_{i,\mathrm{mm}} =
   T_{i,\mathrm{px}} \times k_i
   \]

4. 只有同帧刻线和条纹都合格的帧进入正式统计。
5. 自动识别失败或置信度不足时，允许在同一帧手动点两条相邻主刻线。
6. 报告保存逐帧标定证据、来源和排除原因，禁止把全局标定、报告预设或其他角色数据伪装成本帧实测。
7. 所有持久化的 `tickSpacingPx、deltaXPx、linePositionsPx` 统一使用原图或原视频帧像素坐标；为性能进行的缩放只用于内部计算，结束后必须映射回源像素坐标。

## 3. 非目标

- 不补造缺失帧，不通过降低现有条纹质量门限增加有效帧数。
- 不把没有同框刻线的红光帧强行纳入正式比值法。
- 不修改原始照片或视频。
- 不改变二次成像 `d₁、d₂、a、z₂` 的已有计算关系。
- 不删除视频导入、局域网扫码、直播原始视频导出等兜底能力。
- 本设计不包含 hosts、网络、Git 提交、推送或 GitHub Pages 发布操作。

## 4. 总体架构

### 4.1 共用纯函数模块

新增 `js/core/frame-calibration.js`，提供以下职责：

- `detectReticleGeometry(imageData, width, height, options)`：识别候选主刻线，拟合每一条刻线的位置、斜率和有效纵向范围。
- `localScaleAtBand(reticleGeometry, fringeBand)`：在条纹实际分析纵带内计算刻线间距和局部像素当量。
- `calculateLocalCalibration(reticleGeometry, fringeBand, options)`：生成置信度、残差、状态和告警。
- `applyManualReticle(width, height, firstPoint, secondPoint, options)`：把同帧手点的两条相邻主刻线转换为局部标定。
- `attachLocalCalibration(frame, calibration)`：生成写入会话的标准化对象。
- `summarizeLocalCalibrations(frames)`：按角色聚合有效帧、均值、标准差和标准误差。

模块不访问 DOM、摄像头、IndexedDB 或页面状态，可被 Node 自检直接加载。

在不同设备上分析同一照片时，允许使用不同的内部降采样尺寸，但所有刻线坐标、条纹周期和像素当量必须映射回源图像素后再持久化。这样可避免 PC 与手机因预览尺寸不同而保存不同尺度的 `k`。

### 4.2 页面适配层

- `js/pages/pc-video.js`：视频导入和直播抽帧后，对当前分析帧执行同框刻线识别，并显示每帧状态。
- `js/pages/pc-fringe.js`：PC 照片导入复用相同逐帧标定流程。
- `js/pages/mobile.js`：手机照片、摄像头采集和标定页复用同一算法，增加同图缩放与双点选刻线。
- `js/core/sessions.js`：持久化逐帧局部标定，不覆盖会话级旧 `calibration`。
- `js/core/report-data.js`：优先聚合逐帧 `deltaXmm`，区分正式帧、待确认帧和历史全局 `k` 帧。

现有 `js/core/fringe.js` 继续负责条纹方向、周期、可见度和质量交叉检查；逐帧刻线识别不复制条纹识别算法。

### 4.3 同局部区域原则

刻线间距与条纹周期必须使用同一纵向分析带：

1. 先由条纹识别结果得到可靠分析区域和条纹方向。
2. 在该区域的纵向范围内拟合刻线位置。
3. 在分析带中心或拟合直线上计算刻线横向间距。
4. 若刻线有效区间与条纹分析带的交叠不足，本帧标为“刻线与条纹不在同一区域”，不能进入正式统计。

这样可以避免手机移动、倾斜或局部透视导致的上、下区域尺度不同。

## 5. 逐帧标定数据结构

帧记录保留现有字段，并新增：

```json
{
  "localCalibration": {
    "schema": "bp.frame-calibration/1",
    "method": "auto-same-frame",
    "tickSpacingMm": 1,
    "tickSpacingPx": 107.58,
    "kMmPx": 0.009295,
    "coordinateSpace": "sourcePixels",
    "analysisScale": 0.8,
    "lineCount": 5,
    "linePositionsPx": [121.2, 228.8, 336.4, 444.0, 551.6],
    "lineSlopesPxPerPx": [0.012, 0.011, 0.013, 0.012, 0.012],
    "fringeBand": { "y0": 218, "y1": 645 },
    "rmsPx": 0.47,
    "relativeRms": 0.0044,
    "confidence": 0.93,
    "status": "autoAccepted",
    "source": "auto",
    "warnings": []
  }
}
```

字段规则：

- `method`：`auto-same-frame` 或 `manual-same-frame`。
- `tickSpacingMm`：本轮固定为 `1.00`，来自用户对主刻线距离的确认。
- `tickSpacingPx`：在条纹纵带内计算，不是整幅图列投影的粗略间隔。
- `kMmPx`：`tickSpacingMm / tickSpacingPx`。
- `coordinateSpace`：固定为 `sourcePixels`。
- `analysisScale`：内部识别画布相对源图像的缩放比例，只用于审计和坐标反算。
- `linePositionsPx`：参与拟合的主刻线在统一分析高度或其拟合直线上的横向坐标。
- `lineSlopesPxPerPx`：刻线斜率，用于倾斜与透视检查。
- `fringeBand`：条纹分析所用纵向范围。
- `rmsPx`、`relativeRms`：刻线等距拟合残差及相对残差。
- `confidence`：自动识别的综合置信度，范围为 `0..1`。
- `status`：`autoAccepted`、`manualAccepted`、`pending`、`rejected`。
- `source`：`auto` 或 `manual`。
- `warnings`：可审计的失败或降级原因。

帧级结果同时保存：

```json
{
  "deltaXPx": 104.95,
  "deltaXmm": 0.9755,
  "calibrationStatus": "autoAccepted",
  "stripeCount": 11
}
```

只有 `localCalibration.kMmPx` 有效时才能计算 `deltaXmm`。缺少局部标定时，`deltaXmm` 必须为 `null`。

## 6. 识别与置信度规则

### 6.1 条纹质量

现有条纹门限保持不变：

- `visibility >= 0.03`
- `spectralSnr >= 6`
- `acfPeak >= 0.2`
- `crossDiff <= 0.02`
- `saturationRatio <= 0.02`

逐帧标定不得通过放宽上述门限增加合格帧。

### 6.2 自动刻线识别

自动识别需同时满足：

1. 识别到至少 3 条等距主刻线。
2. 刻线间距位于图像宽度的 `4%..30%`，防止把文字、噪声或整幅干涉纹理当成刻线。
3. 相邻刻线与条纹分析带的有效交叠不小于条纹分析带高度的 `70%`。
4. 线性拟合相对残差 `relativeRms <= 0.02`。
5. 刻线斜率和相邻间距变化不得触发“强透视”告警。
6. 刻线区不得与条纹主频混淆；刻线宽度、连续性和纵向跨度必须通过几何检查。

状态划分：

- `autoAccepted`：至少 4 条刻线、`relativeRms <= 0.015`、同带交叠合格，且条纹通过现有门限。
- `pending`：只有 3 条刻线，或 `0.015 < relativeRms <= 0.02`，或存在强透视告警。该帧显示数值但必须人工确认。
- `rejected`：少于 3 条刻线、`relativeRms > 0.02`、刻线与条纹区域不重合，或刻线几何不合格。

自动结果是候选尺度和可视化证据，不能因为“看起来接近”而放行。

`confidence` 用于界面排序和审计，不单独决定放行；放行状态只由上述硬性门限产生。

### 6.3 人工同帧标定

人工兜底只允许点同一帧中两条相邻主刻线：

- PC 支持放大、拖动和精确点选。
- 手机支持双指缩放和点选；界面提示“请选择同一条分划线上相邻的 1 mm 主刻线”。
- 两点按刻线拟合方向计算距离，而不是仅取点击点的纯水平差；若两点接近水平，计算结果与水平差一致。
- 人工点选后仍检查两点是否落在已识别刻线或足够强的刻线响应上。
- 保存原始点击坐标、换算后刻线间距、操作时间和 `manualAccepted` 状态。

人工确认不改变条纹周期，只修正该帧的局部像素当量。

## 7. 会话写入与角色规则

### 7.1 角色隔离

- 钠光条纹写入 `sodium`。
- 红光参考条纹写入 `reference`。
- 无透镜、加透镜和标定图继续使用现有角色。
- 逐帧刻线标定属于当前图像帧，不生成独立“标定角色”代替缺失条纹。

### 7.2 有效帧

正式帧需满足：

- 角色正确。
- `excluded !== true`。
- 条纹周期有效。
- `localCalibration.status` 为 `autoAccepted` 或 `manualAccepted`。
- `deltaXmm` 有效。

`pending` 帧保留在待确认列表，不进入正式统计。`rejected` 帧保留排除原因供审计。

### 7.3 统计

按角色对 `deltaXmm` 计算：

- 有效帧数 `n`
- 均值 `mean`
- 样本标准差 `sd`
- 均值标准误差 `uA = sd / sqrt(n)`
- 相对离散度 `cv = sd / mean`
- 平均可见条纹数
- 自动与人工标定帧数
- `kMmPx` 的最小值、最大值和逐帧分布

报告只把上述统计标为“本轮同帧刻线标定结果”。相机镜头畸变、刻线宽度读取和分划板制造公差等系统误差仍单独列为剩余风险。

## 8. 三种方法的计算

### 8.1 比值法

比值法分别聚合两段不同角色的数据：

1. 由 `sodium` 帧得到 `mean(Δx_Na_mm)`。
2. 由 `reference` 帧得到 `mean(Δx_ref_mm)`。
3. 使用毫米化后的比值计算：

   \[
   \lambda_{\mathrm{Na}} =
   \lambda_{\mathrm{ref}}
   \frac{\overline{\Delta x_{\mathrm{Na,mm}}}}
        {\overline{\Delta x_{\mathrm{ref,mm}}}}
   C_{\mathrm{disp}}
   \]

`C_disp` 继续使用现有色散修正规则。参考波长和折射率若来自报告预设，必须保留 `reportPreset` 来源。

若任一角色没有 `autoAccepted` 或 `manualAccepted` 帧，比值法返回“缺少正式同帧标定数据”，不生成正式数值。

### 8.2 放大率法

继续使用：

\[
d=\sqrt{d_1d_2},\qquad
\beta=\sqrt{\frac{d_1}{d_2}},\qquad
D=a+z_2
\]

波长计算使用钠光逐帧 `Δx_mm`：

\[
\lambda=\frac{d\,\overline{\Delta x_{\mathrm{Na,mm}}}}{D}
\]

### 8.3 条件追迹法

继续使用会话中的追迹参数或由二次成像记录反算的 `d_trace`：

\[
\lambda=\frac{d_{\mathrm{trace}}\,
\overline{\Delta x_{\mathrm{Na,mm}}}}{D}
\]

如果放大率法与追迹法使用同一组 `d₁、d₂、a、n`，报告必须继续标记“同源，不构成独立验证”。

## 9. 兼容与迁移

- `bp.record/2` 和 `bp.report/1` 继续接受旧记录。
- 导出时保留 `localCalibration`、`deltaXmm`、`calibrationStatus` 和来源字段。
- 没有 `localCalibration` 的旧帧标记为 `legacyGlobalK`，只显示历史参考值。
- 旧会话级 `calibration.k_mm_px` 不再自动用于新导入帧。
- 新会话默认不预设 `k`；报告中的 `k=0.004 mm/px` 继续明确标为报告预设。
- 旧帧不会因为导入新版平台而被改写或删除。

## 10. 交互

### 10.1 PC 视频导入

每个候选帧显示：

- 条纹周期
- 条纹数
- 刻线数
- 局部刻线间距
- 局部像素当量 `k_i`
- `Δx_mm`
- 状态及失败原因

低置信度帧进入“待确认帧”列表。用户确认后，批量写入会话；未确认帧保留为待处理或排除。

### 10.2 手机端

- 照片导入后显示相同的刻线、条纹分析带和状态。
- 手动标定支持同图缩放与双点选。
- 手机端保留角色选择和会话写入；完整批量视频审阅仍在 PC 端。
- 同一照片在 PC 与手机端应得到相同的 `tickSpacingPx、kMmPx、deltaXmm`。
- 同一照片即使内部降采样尺寸不同，持久化坐标也必须回到源图像素，`tickSpacingPx` 差值不超过 `0.5 px`，`kMmPx` 相对差值不超过 `0.2%`。

### 10.3 报告

报告展示：

- 各角色帧数与有效帧数
- 逐帧 `k_i` 和 `Δx_mm`
- 自动/人工来源
- 刻线数、残差和条纹数
- 待确认与拒绝原因
- 三种方法的当前结果、误差口径和同源性说明

## 11. 测试与验收

### 11.1 自动自检

更新 `tools/check-reticle.js`，覆盖：

- 不同帧使用不同刻线间距，验证不会复用全局 `k`。
- 刻线倾斜与透视变化。
- 刻线和条纹同框。
- 规则条纹但没有刻线时不误检。
- 刻线与条纹纵向区域错位时拒绝。
- 3 条刻线进入待确认，4 条以上高质量刻线自动合格。
- 手动两点标定。

更新 `tools/check-video-sampler.js` 和 `tools/check-video-html.js`，覆盖：

- 逐帧标定字段写入。
- `pending/rejected` 帧不进入正式统计。
- `sodium` 与 `reference` 角色隔离。
- 旧 `bp.record/2` 兼容。
- 无局部标定时禁止调用全局 `k`。
- 短片 5 帧目标与长视频目标恢复逻辑保持不变。

### 11.2 真实素材

- 钠光：`E:/qq/VID_20261103_152203.mp4`，44.159 s，现有 20 个候选帧。
- 红光：`E:/qq/VID_20261117_144210.mp4`，8.692 s，现有 5 个候选帧。
- 参考照片：`D:/物理实验/第二次自主设计/11.17实验/钠光灯/比值法/4d416170a0ab99512eb66657d01a82e9_720.jpg`。

验收时逐一列出真实有效帧。红光若没有足够同框标定帧，报告必须返回“无正式比值法结果”；不得用钠光照片的 `k` 或全局 `k` 补齐。

### 11.3 浏览器验收

使用 Playwright 验证：

- PC 视频和照片导入。
- 手机照片导入与角色写入。
- 自动合格、待确认、人工两点确认三条路径。
- 参数自动填入与方法对应关系。
- `bp.record/2` 导出后重新导入。
- 报告来源审计和逐帧表。
- PC 与手机对同一照片的计算一致性。

### 11.4 回归

运行：

- Node 语法检查
- PowerShell 语法检查
- 现有页面结构自检
- 条纹、会话、报告和部署自检
- 本地平台 `https://localhost:52224/`
- PC、手机和报告 Playwright 页面测试

发布前仍需用户单独确认，不以测试通过代替发布授权。

## 12. 验收条件

1. 每个正式 `Δx_mm` 都能追溯到同一帧的刻线间距和条纹周期。
2. 任一角色没有合格同帧标定帧时，相关正式结果为空并说明原因。
3. 自动与人工数据来源可审计，报告不把预设参数或旧全局 `k` 冒充实测。
4. 现有条纹质量门限没有降低，未生成或补造帧。
5. PC 和手机对同一图像得到一致的逐帧标定结果。
6. 视频导入、局域网扫码、直播原始视频导出和本地稳定平台没有被破坏。

## 13. 剩余风险

- 红光视频多数画面目前难以确认分划刻线，可能只能形成参考性结果。
- 条纹与刻线在手机移动画面中可能不同时清晰，自动识别可用帧数可能明显少于原始候选帧。
- `1.00 mm` 是用户确认的主刻线间距；若分划板制造间距本身有公差，平台只能记录不能消除。
- 局部拟合可减小手机位移和透视影响，但不能完全消除镜头畸变、刻线宽度和人工点选误差。
- 波长“真实误差”只能给出已有实测离散度和已知系统误差口径；没有更高精度标准仪器时，不能宣称绝对真值误差。

## 14. 预计修改文件

- `js/core/frame-calibration.js`（新增）
- `js/pages/pc-video.js`
- `js/pages/pc-fringe.js`
- `js/pages/mobile.js`
- `js/core/sessions.js`
- `js/core/report-data.js`
- `js/core/session-data.js`
- `tools/check-reticle.js`
- `tools/check-video-sampler.js`
- `tools/check-video-html.js`
- `tools/check-photo-import-browser.py`
- 相关 HTML 脚本加载顺序与缓存版本文件
- 设计对应的实施计划文档

