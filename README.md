# 菲涅耳双棱镜干涉实验 · 纯前端平台

配合《菲涅耳双棱镜干涉实验的装置改进与计算方法优化》研究报告。
**纯静态、零依赖、零安装**：不需要服务器，不需要 npm，打开网页即用。

> 数值口径与报告 **表 5.1 / 5.2 / 6.1 / 8.1** 逐位对齐，且由自检脚本守住（见文末）。

---

## 三个入口

| 页面 | 地址 | 用来做什么 |
|---|---|---|
| 数据处理（PC 主用） | `index.html` | 条纹提取 → 像素当量 → 三方法解算 → 八分量不确定度折叠 → 加权合成与 χ² → 历史与导出 |
| 现场采集（手机主用） | `mobile.html` | 拍照/选图 → 两点标定 k → 当场快速校验 → 导出 `record.json` |
| 光学模拟 | `optical.html` | 搭台（增删/拖拽元件）→ 由几何现算 d、Δx → 光路与条纹图 |

对应报告的三段链路：**搭台（式 2/5/7）→ 采集（式 24）→ 处理（式 7/9/13/17/19/20）**。
`mobile.html` 导出的 `record.json` 可直接在 `index.html` 的「历史记录 → 导入手机记录」里解算。

---

## 使用方法

### PC 端（`index.html`）

1. **波长计算**：点「填入报告参数（表 5.1）」→「计算波长」→ **589.271 nm**；比值法卡点「比值法计算」→ **589.384 nm**（并显示色散修正因子 1.00447）。
2. **不确定度**：八分量默认值即报告表 8.1 → 点「折叠三条路径」→ 应得 **0.13% / 0.10% / 0.14%**，与表 5.2 一致。
3. **多路径合成**：点「填入报告三路径」→「执行加权合成」→ **589.31 ± 0.42 nm，χ² = 0.0025 ≤ 5.991 → 一致**。
4. **图像分析**：选一张条纹图 →「开始分析」→ Δx、可见度、零交叉交叉检查。没有实验照片时，点「内含自检」——平台会合成一张**已知 Δx 的条纹图**并当场提取，偏差通常在 0.02% 以内。
5. **数据拟合**：填 x/y 做最小二乘；或填 L₃ / Δx 用斜率法（斜率 = λ/d）。

### 手机端（`mobile.html`）

1. **标定**：拍分划板 → 在图上点两条刻线 → 填实际间距 L → `k = L/N`（式 24）。也可直接输 L/N。
2. **拍照**：相机需要 **https**（GitHub Pages 已满足），且 iOS Safari 必须由**用户手势**触发。用本地文件（`file://`）打开时相机不可用，请用「相册选择」。
3. **分析**：填 d、D、条纹间距 →「全部计算」→ λ。多路径合成卡可当场看 χ² 是否一致。
4. **导出记录**：生成 `record.json`（只存原始量，不存结论——换口径不会留下旧数）。

### 光学页（`optical.html`）

- 左侧工具栏加元件、载入预设（标准装置 / a=20 / a=80 / 插透镜）；
- **拖拽元件只调整示意图位置，不按比例**；实验参数以右侧面板为唯一真值；
- 右侧 `d = 2·z₁·(n−1)·β` 是**傍轴近似**值（0.9020 mm），与 MATLAB 严格追迹的 0.90213 mm 相差 0.02%。

---

## 参数（报告表 5.1）

| 量 | 取值 |
|---|---|
| 折射棱角 A | 1.0° |
| 折射率 n(Na) / n(ref) | 1.5168 / 1.5145 |
| 单缝—棱脊 a | 50 mm |
| 观察距离 D | 1000 mm |
| 单缝宽 b | 0.08 mm |
| 像素当量 k | 0.0040 mm/px |
| 波长 λ(Na) / λ(ref) | 589.3 nm / 650 nm |

---

## 已知限制

- **纯前端、无后端**：条纹提取在浏览器里做；不做矢量光线追迹（那部分在 MATLAB 侧）。
- **条纹提取精度**：在合成条纹图上偏差 < 0.02%；真实照片受摩尔纹、条纹倾斜、噪声影响，**不保证**逐位复现表 6.1 的 0.6559 / 0.6538 / 0.6531 mm（那是同一批 30 帧原图的统计）。
- **光学页**：`d` 为傍轴近似；拖拽为示意图操作，不与 mm 刻度对齐。
- **相机**：iOS 需 https + 用户手势；部分机型不开放曝光/变焦等底层参数（本平台因此未提供这些按钮）。
- **Phase-slope 法**：前端只实现 FFT 基频法与零交叉法两种。

---

## 自检（改代码后必须全绿）

```bash
node tools/selftest.js              # 19 项：内核数值口径（13 旧 + 冻结守卫 + 5 折叠）
node tools/check-fringe.js          # 16 项：条纹提取往返精度、方向择取、单帧/零帧边界
node tools/check-optical-numbers.js # 14 项：光学页 d / Δx / 视场 / 可见度
node tools/check-p1-html.js         #  9 项：首页 Python→纯前端迁移
node tools/check-p2-html.js         #  9 项：八分量折叠页
node tools/check-p4-html.js         #  9 项：手机采集端
node tools/check-pages.js           # 18 项：三页死链、废弃文件引用、P5 接线
node tools/check-html-structure.js  #  标签配对
node tools/check-globals.js         #  let/const 绑定被误当 window 属性
node tools/check-ids.js             #  JS 引用的 DOM id 是否存在
node tools/check-deploy.js          # 部署文件与设计侧逐字节一致
node tools/check-versions.js        # 三页 ?v= 版本号一致
```

`tools/selftest.js` 里的金标准（`tools/golden.json`）**只认研究报告**，不认任何实现。

---

## 目录

```
index.html  mobile.html  optical.html  404.html  .nojekyll
css/   style.css mobile.css optical_v2.css optical-responsive.css app-responsive.css
js/    physics.js            数值内核（唯一口径来源）
       core/{fmt,ui,store,fit,api,plot,fringe}.js
       pages/{pc,pc-unc,pc-fringe,mobile,optical-fix,optical-interact}.js
       optical_simulator.js  光学页绘制与拖拽（被 optical-fix 覆盖口径）
data/  params.default.json   报告表 5.1 参数
tools/ 自检与静态检查脚本
```

---

## 许可

MIT。报告中的数据与图表由作者实验/仿真产生。
