# 菲涅耳双棱镜 AI 实验数据报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有纯前端平台中新增论文级、可轻交互、可导入导出且严格区分数据来源的 AI 实验数据报告，并整理报告精选图片。

**Architecture:** 报告页独立于 PC/手机采集中枢，复用 `bp.record/2` 会话、物理公式和浏览器本地存储。数据层先统一成 `ReportDataset`，误差层只根据显式来源计算；页面只负责渲染、交互和导入确认，不把缺失值或历史仿真改写成实测。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js 自检、Python Pillow/OpenCV、Playwright、PowerShell。

---

### Task 1: 报告数据内核与自检

**Files:**
- Create: `tools/check-report-data.js`
- Create: `js/core/report-errors.js`
- Create: `js/core/report-data.js`

- [ ] **Step 1: 写失败自检**

自检覆盖：比值法条件结果 `597.1015 nm ± 4.20 nm`、红光仅参考、缺失角色不补零、`bp.record/2` 与 `bp.report/1` 往返、来源类型白名单、准确度与一致性。

Run: `node tools/check-report-data.js`
Expected: FAIL，提示 `report-errors` 或 `report-data` 尚不存在。

- [ ] **Step 2: 实现误差层**

`report-errors.js` 导出样本统计、比值法条件误差、准确度、χ² 临界值与来源敏感误差分量。所有不确定度只在输入有定义时传播。

- [ ] **Step 3: 实现数据层**

`report-data.js` 校验并归一化 `bp.record/2`、`bp.report/1`；按 `sodium`、`reference`、`no_lens`、`with_lens`、`calibration` 隔离角色；为每个关键字段生成 `provenance`，并生成 `warnings`。

- [ ] **Step 4: 运行自检**

Run: `node tools/check-report-data.js`
Expected: 全部 PASS。

### Task 2: 报告页面与交互

**Files:**
- Create: `report.html`
- Create: `css/report.css`
- Create: `js/pages/report.js`
- Modify: `index.html`
- Modify: `mobile.html`

- [ ] **Step 1: 创建页面骨架**

页面包含摘要、三方法对比、三层误差、交互追迹图、来源审计、图片精选、导入/导出与打印控件；全部脚本带 `?v=bda63a6`。

- [ ] **Step 2: 实现导入预览确认**

用户选择 JSON 后先显示会话、角色、帧数、版本与字段错误；点击确认后才更新报告和本地快照。无效 JSON 不清空当前数据。

- [ ] **Step 3: 实现三方法与交互图**

比值法显示条件结果及两套角色帧；追迹法绘制精确/傍轴曲线与残差并提供悬停读数；放大率法缺角色时显示“不可计算”及原因。

- [ ] **Step 4: 实现导出、恢复和打印**

导出 `bp.report/1`，刷新后从 localStorage 恢复；打印隐藏按钮、保留表格、来源和警告。

- [ ] **Step 5: 增加入口**

PC 与手机首页均增加 `report.html` 入口，不改变现有采集中枢和视频兜底功能。

### Task 3: 报告精选图片

**Files:**
- Create: `tools/select-report-images.py`
- Create: `D:\物理实验\第二次自主设计\报告精选图片\manifest.json`
- Create: `assets/report-images/*`

- [ ] **Step 1: 自动评分**

对实验目录 JPG/PNG 计算清晰度、曝光、对比度、条纹质量和重复度；仅复制，不移动、不覆盖、不删除原图。

- [ ] **Step 2: 人工复核**

检查装置、钠光条纹、红光参考、二次成像、刻线和手写原始记录的候选；排除重复截图和低质量图。

- [ ] **Step 3: 生成副本与台账**

按可读名称复制到报告精选目录，生成含原路径、副本路径、类别、评分、图注和 SHA256 的 `manifest.json`；平台资源使用压缩副本。

### Task 4: 页面台账与浏览器回归

**Files:**
- Modify: `tools/check-pages.js`
- Modify: `tools/check-versions.js`
- Modify: `tools/check-release.js`
- Create: `tools/check-report-browser.py`

- [ ] **Step 1: 同步页面台账**

将 `report.html` 纳入本地引用、缓存版本和发布审计；更新版本计数。

- [ ] **Step 2: Node 与 Python 自检**

Run:
`node tools/check-report-data.js`
`node tools/check-pages.js`
`node tools/check-versions.js`
`node tools/check-release.js`
`python tools/check-report-browser.py`
Expected: 全部 PASS。

- [ ] **Step 3: 现有功能回归**

运行 Node 全部语法检查、PowerShell 语法检查、现有页面/条纹/会话/视频自检；确认 `52224` 本地平台、`FresnelPlatformLAN`、视频导入、二维码和原始视频录制代码仍在。

- [ ] **Step 4: 启动本地平台**

启动或复用 `https://localhost:52224/`，验证 `report.html` 在 PC/手机视口可打开、无横向溢出、导入预览与导出可用。

### Task 5: 交付审计

- [ ] 列出本轮改动文件、真实误差、图片精选清单和自动化测试结果。
- [ ] 明确剩余风险：红光 5 帧仅参考、视频/照片缩放口径不可直接拼接、放大率法缺同口径角色时不出数值。
- [ ] 仅询问是否确认提交和发布，不执行 `git add .`、提交、推送、hosts、网络切换或 GitHub Pages 发布。
