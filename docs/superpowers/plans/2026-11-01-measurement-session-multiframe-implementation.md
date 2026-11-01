# Measurement Session and Multi-frame Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 PC/手机页签，建立方法优先的测量会话与多帧图像存储，并加入 N-BK7 等效棱镜角工具。

**Architecture:** 在现有 `BP` 命名空间下新增 `core/nbk7.js` 和 `core/sessions.js`。图片 Blob 存 IndexedDB，会话/帧元数据存 localStorage；手机端负责角色化采集和识别，PC 端读取同一会话数据并显示来源标记。所有方法通过固定角色读取，不共享无归属测量值。

**Tech Stack:** 原生 JavaScript、IndexedDB、localStorage、Canvas、现有 `BP.physics`/`BP.fringe`/`BP.store`、Node 自测、Playwright。

---

### Task 1: 修复 PC/手机页签

**Files:**
- Modify: `js/pages/pc.js`
- Modify: `js/pages/mobile.js`

- [ ] 将 `BP.ui.$('.tab').forEach` 改为 `BP.ui.$$('.tab').forEach`。
- [ ] 将 `BP.ui.$('.tab-btn').forEach` 改为 `BP.ui.$$('.tab-btn').forEach`。
- [ ] Node 静态检查确认两个错误模式不再存在。

### Task 2: N-BK7 与 A_eff

**Files:**
- Create: `js/core/nbk7.js`
- Create: `tools/check-nbk7.js`
- Modify: `index.html`
- Modify: `mobile.html`

- [ ] 实现 Sellmeier `n(λ)`。
- [ ] 实现 `tanβ=-2Δx/Δw`、`β=atan(...)`、`A_eff=β/(n−1)`。
- [ ] 检查 `589.3 nm → 1.5168`、`650 nm → 1.5145`。
- [ ] 添加 PC/手机 A_eff 输入卡和结果来源标记。

### Task 3: 会话与多帧存储

**Files:**
- Create: `js/core/sessions.js`
- Modify: `index.html`
- Modify: `mobile.html`

- [ ] 建立 `bp.session/2`、`bp.frame/1` 元数据。
- [ ] 图片 Blob 存 IndexedDB，frame 元数据存 localStorage。
- [ ] 方法角色表固定为 `sodium/reference/no_lens/with_lens/calibration`。
- [ ] 提供 `createSession`、`addFrame`、`listFrames`、`removeFrame`、`roleStats`。

### Task 4: 手机端方法优先采集

**Files:**
- Modify: `mobile.html`
- Modify: `js/pages/mobile.js`
- Modify: `css/mobile.css`

- [ ] 新增会话栏：方法选择、新建会话、角色选择。
- [ ] 拍照/选图后追加帧，不覆盖旧帧。
- [ ] 每帧调用现有 `BP.fringe.analyzeFile()`，写入 `role + sessionId`。
- [ ] 显示缩略图、帧数、Δx 均值/标准差，支持删除。

### Task 5: PC 端会话读取与追迹预设

**Files:**
- Modify: `index.html`
- Modify: `js/pages/pc.js`
- Modify: `css/style.css`

- [ ] 图像分析页显示当前会话和角色统计。
- [ ] 追迹卡内置 MATLAB 严格追迹 `d=0.90213 mm`。
- [ ] 修改 `a/A/n/D` 时提示更新 `d_trace`。
- [ ] 比值法和放大率法只读取对应角色，缺失时给出明确提示。

### Task 6: 记录兼容与浏览器验收

**Files:**
- Modify: `js/core/store.js`
- Modify: `README.md`

- [ ] 导出 `bp.record/2`，保留 `bp.record/1` 导入兼容。
- [ ] 浏览器点击 PC/手机全部页签。
- [ ] 同一角色连续添加 3 帧，刷新后仍在。
- [ ] 检查 N-BK7 两个基准折射率。
- [ ] 检查追迹卡显示 MATLAB 来源和 `d=0.90213 mm`。
- [ ] 提交实现。
