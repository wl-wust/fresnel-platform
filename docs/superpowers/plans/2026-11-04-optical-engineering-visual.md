# 光学平台工程线稿与交互增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `optical.html` 的仪器与光路升级为精密工程线稿，并加入钠灯/激光切换、可调顶角、传播动画和水平拖动锁。

**Architecture:** 保留 `optical_simulator.js` 的设备状态和 `optical-rail.js` 的物理计算，新建 `js/pages/optical-visual.js` 接管绘制与视觉状态。新模块在现有覆盖层之后加载，通过现有全局函数和 `change` 事件连接界面，不复制公式或设备位置。

**Tech Stack:** 原生 JavaScript、Canvas 2D、Pointer Events、CSS、Node.js 检查脚本、Playwright

---

## 文件结构

- Create: `js/pages/optical-visual.js`：工程线稿绘制、光源样式、动画、控件绑定和测试接口。
- Create: `tools/check-optical-visual.js`：纯 JavaScript 视觉参数与状态检查。
- Create: `tools/check-optical-visual-browser.py`：PC/手机浏览器交互与画布检查。
- Modify: `optical.html`：新控件、提示文字和视觉模块引用。
- Modify: `css/optical_v2.css`：新控件和工程线稿页面外观。
- Modify: `css/optical-responsive.css`：窄屏布局。
- Modify: `js/pages/optical-dpr.js`：水平锁拖动逻辑。
- Modify: `js/pages/optical-rail.js`：只补参数变化后的视觉刷新通知。
- Modify: `tools/browser-check.py`：把新增交互纳入总回归。
- Modify: 四个 HTML 的版本参数由 `tools/stamp-version.js` 统一刷新。

## Task 1: 视觉模块纯函数与测试门禁

**Files:**
- Create: `tools/check-optical-visual.js`
- Create: `js/pages/optical-visual.js`

- [ ] **Step 1: 写失败测试**

创建 `tools/check-optical-visual.js`：

```js
const path = require('path');
const visual = require(path.resolve(__dirname, '../js/pages/optical-visual.js'));

let ok = 0;
let bad = 0;
function check(name, condition, detail) {
  if (condition) {
    ok += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } else {
    bad += 1;
    console.log('FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
}

check('顶角下限限制为 0.2°', visual.clampAngle(0.1) === 0.2);
check('顶角上限限制为 2.0°', visual.clampAngle(2.5) === 2);
check('空值回退到上一次有效值', visual.clampAngle(NaN, 1.2) === 1.2);
check('画布顶角随真实顶角增大', visual.angleToVisualDegrees(2) > visual.angleToVisualDegrees(0.5));
check('激光默认 650 nm', visual.sourcePreset('laser').lambda === 650);
check('钠灯默认 589.3 nm', visual.sourcePreset('sodium').lambda === 589.3);
check('未知光源回退到钠灯', visual.sourcePreset('unknown').mode === 'sodium');
check('激光光束窄于钠灯光束', visual.beamWidth('laser', 400) < visual.beamWidth('sodium', 400));

console.log('\n' + (bad === 0 ? '光学视觉门禁通过' : bad + ' 项不通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
node tools/check-optical-visual.js
```

Expected: FAIL，提示找不到 `js/pages/optical-visual.js`。

- [ ] **Step 3: 实现最小纯函数**

创建 `js/pages/optical-visual.js`，先提供纯函数骨架：

```js
(function (global) {
  'use strict';

  var ANGLE_MIN = 0.2;
  var ANGLE_MAX = 2.0;

  function clampAngle(value, fallback) {
    var base = isFinite(+fallback) ? +fallback : 1.0;
    var v = isFinite(+value) ? +value : base;
    return Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, v));
  }

  // 真实顶角很小；画布采用教学示意放大，数值计算仍使用真实值。
  function angleToVisualDegrees(value) {
    var a = clampAngle(value);
    return 0.8 + (a - ANGLE_MIN) * 7.5;
  }

  var PRESETS = {
    sodium: {
      mode: 'sodium', label: '钠光灯', lambda: 589.3,
      color: '#d6a400', rgb: '214,164,0',
      glow: 'rgba(238, 190, 42, 0.34)', core: 'rgba(255, 218, 88, 0.84)'
    },
    laser: {
      mode: 'laser', label: '激光', lambda: 650,
      color: '#d24040', rgb: '210,64,64',
      glow: 'rgba(224, 68, 68, 0.28)', core: 'rgba(255, 104, 104, 0.92)'
    }
  };

  function sourcePreset(mode) {
    return PRESETS[mode] || PRESETS.sodium;
  }

  function beamWidth(mode, length) {
    var px = Math.max(0, +length || 0);
    return mode === 'laser' ? Math.max(3, px * 0.025) : Math.max(14, px * 0.14);
  }

  var API = {
    ANGLE_MIN: ANGLE_MIN,
    ANGLE_MAX: ANGLE_MAX,
    clampAngle: clampAngle,
    angleToVisualDegrees: angleToVisualDegrees,
    sourcePreset: sourcePreset,
    beamWidth: beamWidth
  };

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.opticalVisual = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
node tools/check-optical-visual.js
```

Expected: `光学视觉门禁通过（8 pass / 0 fail）`

- [ ] **Step 5: 提交**

```powershell
git add -- js/pages/optical-visual.js tools/check-optical-visual.js
git commit -m "test: 建立光学视觉参数门禁"
```

## Task 2: 新控件与状态同步

**Files:**
- Modify: `optical.html:80-93`
- Modify: `optical.html:154-164`
- Modify: `css/optical_v2.css`
- Modify: `css/optical-responsive.css`
- Modify: `js/pages/optical-visual.js`
- Create: `tools/check-optical-visual-browser.py`

- [ ] **Step 1: 写失败的浏览器测试**

创建 `tools/check-optical-visual-browser.py`。所有命令假设项目已在 `127.0.0.1:8099` 提供服务：

```python
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8099"


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto(BASE + "/optical.html", wait_until="networkidle")
        assert page.locator("#sourceMode").count() == 1
        assert page.locator("#betaRange").count() == 1
        assert page.locator("#horizontalLock").count() == 1

        page.select_option("#sourceMode", "laser")
        assert page.input_value("#lambda") == "650"
        page.fill("#beta", "1.5")
        page.dispatch_event("#beta", "change")
        assert page.input_value("#betaRange") == "1.5"
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
```

Run:

```powershell
python tools/check-optical-visual-browser.py
```

Expected: FAIL，`#sourceMode` 数量为 0。

- [ ] **Step 2: 加入控件**

在 `optical.html` 的“显示选项”中加入：

```html
<label class="tool-btn" style="justify-content: flex-start;">
  <input type="checkbox" id="horizontalLock"> 水平校准
</label>
```

把顶角参数行替换为：

```html
<div class="param-row param-row-stack">
  <span class="param-label">光源</span>
  <select class="param-input param-select" id="sourceMode">
    <option value="sodium" selected>钠光灯 · 589.3 nm</option>
    <option value="laser">激光 · 650 nm</option>
  </select>
</div>
<div class="param-row param-row-stack">
  <span class="param-label">顶角 β <small>画布角为示意放大</small></span>
  <div class="angle-control">
    <input type="range" id="betaRange" min="0.2" max="2.0" step="0.01" value="1.0">
    <input type="number" class="param-input" id="beta" value="1.0" min="0.2" max="2.0" step="0.01" onchange="updateParams()">
    <span class="param-unit">度</span>
  </div>
</div>
```

在 `optical-rail.js` 后加入：

```html
<script src="js/pages/optical-visual.js?v=a166ffe"></script>
```

- [ ] **Step 3: 加入控件样式**

追加到 `css/optical_v2.css`：

```css
.param-row-stack { align-items: stretch; flex-direction: column; gap: 6px; }
.param-row-stack .param-label { display: flex; justify-content: space-between; gap: 8px; }
.param-row-stack .param-label small { color: #7d8a96; font-size: 9px; font-weight: normal; }
.param-select { width: 100%; text-align: left; }
.angle-control { display: grid; grid-template-columns: minmax(0, 1fr) 72px auto; align-items: center; gap: 7px; }
.angle-control input[type="range"] { min-width: 0; accent-color: #cf9d16; }
.canvas-area {
  background: #f6f1e6;
  border-left: 1px solid rgba(23, 33, 43, .14);
  border-right: 1px solid rgba(23, 33, 43, .14);
}
.canvas-overlay { background: rgba(255, 253, 247, .92); color: #17212b; border: 1px solid #d7d0c2; }
.canvas-footer { background: rgba(255, 253, 247, .94); color: #5f675f; border-top: 1px solid #d7d0c2; }
```

在 `css/optical-responsive.css` 的 `max-width: 520px` 中加入：

```css
.angle-control { grid-template-columns: minmax(0, 1fr) 64px auto; }
.param-select { font-size: 11px; }
```

- [ ] **Step 4: 绑定控件事件**

在 `js/pages/optical-visual.js` 的 IIFE 中加入 `bindControls()`：

```js
function bindControls() {
  var source = doc.getElementById('sourceMode');
  var lambda = doc.getElementById('lambda');
  var beta = doc.getElementById('beta');
  var betaRange = doc.getElementById('betaRange');
  var lock = doc.getElementById('horizontalLock');
  var syncing = false;

  function syncAngle(value, target) {
    if (syncing) return;
    syncing = true;
    var next = clampAngle(value, parseFloat(beta.value) || 1.0);
    beta.value = next.toFixed(2);
    betaRange.value = next.toFixed(2);
    target.dispatchEvent(new Event('change', { bubbles: true }));
    syncing = false;
  }

  if (source && lambda) source.addEventListener('change', function () {
    lambda.value = sourcePreset(source.value).lambda;
    lambda.dispatchEvent(new Event('change', { bubbles: true }));
    requestRender();
  });
  if (betaRange) betaRange.addEventListener('input', function () { syncAngle(betaRange.value, beta); });
  if (beta) beta.addEventListener('change', function () { syncAngle(beta.value, betaRange); });
  if (lock) lock.addEventListener('change', requestRender);
}

function isHorizontalLocked() {
  var el = doc && doc.getElementById('horizontalLock');
  return !!(el && el.checked);
}
```

把 `isHorizontalLocked` 加入 `API`，并在 DOM 加载完成后调用 `bindControls()`。`requestRender()` 暂时调用全局 `render()`，后续任务替换为视觉渲染。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
python tools/check-optical-visual-browser.py
node tools/check-optical-numbers.js
```

Expected: 浏览器断言通过；光学数值检查仍全部 PASS。

```powershell
git add -- optical.html css/optical_v2.css css/optical-responsive.css js/pages/optical-visual.js tools/check-optical-visual-browser.py
git commit -m "feat: 增加光源与顶角控制"
```

## Task 3: 工程线稿绘制

**Files:**
- Modify: `js/pages/optical-visual.js`
- Modify: `tools/check-optical-visual-browser.py`

- [ ] **Step 1: 先加画布风格失败测试**

在 `tools/check-optical-visual-browser.py` 的 `page.goto` 后加入：

```python
page.wait_for_function("window.BP?.pages?.opticalVisual?.renderEngineeringScene")
page.wait_for_timeout(300)
style_sample = page.evaluate("""
  () => {
    const cv = document.getElementById('opticalCanvas');
    const data = cv.getContext('2d').getImageData(8, 8, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2] };
  }
""")
assert style_sample["r"] > 220 and style_sample["g"] > 215 and style_sample["b"] > 200
```

Run:

```powershell
python tools/check-optical-visual-browser.py
```

Expected: FAIL，等待 `renderEngineeringScene` 超时。

- [ ] **Step 2: 实现工程线稿基础绘制**

在 `optical-visual.js` 中加入 Canvas 获取、状态读取和以下绘制函数：

```js
function canvas() { return doc && doc.getElementById('opticalCanvas'); }
function context() {
  var cv = canvas();
  return cv && cv.getContext ? cv.getContext('2d') : null;
}
function getConfig() {
  try { return typeof CONFIG !== 'undefined' ? CONFIG : null; } catch (e) { return null; }
}
function getDevices() {
  try { return typeof devices !== 'undefined' ? devices : null; } catch (e) { return null; }
}
function getSelected() {
  try { return typeof selectedDevice !== 'undefined' ? selectedDevice : null; } catch (e) { return null; }
}
function getShowLight() {
  try { return typeof showLight !== 'undefined' ? !!showLight : true; } catch (e) { return true; }
}

function drawEngineeringBackground(ctx, W, H) {
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(100, 91, 72, .08)';
  ctx.lineWidth = 1;
  for (var x = 0; x < W; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (var y = 0; y < H; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function drawEngineeringRail(ctx, cfg, W) {
  ctx.strokeStyle = '#17212b';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(20, cfg.railY + 18); ctx.lineTo(W - 20, cfg.railY + 18); ctx.stroke();
  ctx.lineWidth = 1;
  for (var px = 20; px <= W - 20; px += 10) {
    var major = Math.round(px - 20) % 50 === 0;
    ctx.beginPath();
    ctx.moveTo(px, cfg.railY + 18);
    ctx.lineTo(px, cfg.railY + 18 + (major ? 12 : 6));
    ctx.stroke();
  }
}
```

再实现 `drawEngineeringDevice(ctx, device, selected)`：

- `source`：灯箱圆角矩形、内部同心圆和出光喇叭。
- `slit`：双层窄竖板与中间缝隙。
- `prism`：用 `angleToVisualDegrees(beta)` 计算左右斜面，画出中央棱脊。
- `lens`：上下开口的双弧线透镜。
- `screen`：窄支架与观察面横板。
- 所有元件统一 `#17212b` 轮廓、`#fffdf7` 浅填充、选中时 `#c27616` 外框。
- 在元件上方绘制小圆编号，使用 `device.id`，再通过短线连接元件轮廓。

覆盖全局绘制入口：

```js
function renderEngineeringScene() {
  var ctx = context();
  var cv = canvas();
  if (!ctx || !cv) return;
  var cfg = getConfig();
  var W = cfg.W || cv.getBoundingClientRect().width;
  var H = cfg.H || cv.getBoundingClientRect().height;
  var list = getDevices() || [];
  drawEngineeringBackground(ctx, W, H);
  drawEngineeringRail(ctx, cfg, W);
  list.forEach(function (device) { drawEngineeringDevice(ctx, device, device === getSelected()); });
}
```

将 `renderEngineeringScene` 暴露在 API 中，并让 `requestRender()` 调用它。

- [ ] **Step 3: 保持旧交互入口**

不要删除原 `render()` 和命中测试。在新视觉层里把 `requestRender()` 定义为：

```js
function requestRender() {
  var ctx = context();
  var cv = canvas();
  if (!ctx || !cv) return false;
  var cfg = getConfig();
  ctx.clearRect(0, 0, cfg.W || cv.clientWidth, cfg.H || cv.clientHeight);
  renderEngineeringScene();
  return true;
}
```

再把 `global.render = requestRender`，使旧拖动和 DPR 逻辑自动进入新绘制层。Task 4 会在 `requestRender()` 末尾加入光路绘制。

- [ ] **Step 4: 跑浏览器与数值回归**

Run:

```powershell
python tools/check-optical-visual-browser.py
node tools/check-optical-geometry.js
```

Expected: 画布左上角为暖白工程纸；几何检查全部 PASS。

- [ ] **Step 5: 人工截图复核并提交**

用 Playwright 截取 `1440×1000` 页面，确认：

- 没有 emoji 充当仪器主体。
- 仪器轮廓、编号和毫米标尺清楚。
- 设备仍可选中，参数拖动不报错。

```powershell
git add -- js/pages/optical-visual.js tools/check-optical-visual-browser.py
git commit -m "feat: 重绘光学实验台工程线稿"
```

## Task 4: 光锥、虚光路与传播动画

**Files:**
- Modify: `js/pages/optical-visual.js`
- Modify: `js/pages/optical-rail.js`
- Modify: `tools/check-optical-visual-browser.py`

- [ ] **Step 1: 写动画失败测试**

在浏览器测试中加入：

```python
page.uncheck("#showLight")
state0 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
page.check("#showLight")
page.wait_for_timeout(250)
state1 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
page.uncheck("#showLight")
page.wait_for_timeout(100)
state2 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
page.wait_for_timeout(250)
state3 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
assert state1["running"] is True and state1["frames"] > state0["frames"]
assert state2["running"] is False and state3["frames"] == state2["frames"]
```

Run:

```powershell
python tools/check-optical-visual-browser.py
```

Expected: FAIL，`getAnimationState` 不存在。

- [ ] **Step 2: 实现光锥与虚光路**

在 `optical-visual.js` 中实现：

```js
function drawBeamCone(ctx, x1, y1, x2, y2, width1, width2, style, alpha) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  var len = Math.max(1, Math.hypot(dx, dy));
  var nx = -dy / len;
  var ny = dx / len;
  var grd = ctx.createLinearGradient(x1, y1, x2, y2);
  grd.addColorStop(0, 'rgba(' + style.rgb + ',' + (alpha * 0.45) + ')');
  grd.addColorStop(1, 'rgba(' + style.rgb + ',' + alpha + ')');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * width1 / 2, y1 + ny * width1 / 2);
  ctx.lineTo(x2 + nx * width2 / 2, y2 + ny * width2 / 2);
  ctx.lineTo(x2 - nx * width2 / 2, y2 - ny * width2 / 2);
  ctx.lineTo(x1 - nx * width1 / 2, y1 - ny * width1 / 2);
  ctx.closePath();
  ctx.fill();
}
```

`drawPropagationLayer()` 必须完成：

1. 从光源到单缝画宽光锥。
2. 从单缝到双棱镜画收束光锥。
3. 从棱镜向屏幕画两条分束光锥并形成重叠区。
4. 用虚线绘制 `S₁/S₂` 虚光源路径。
5. 重叠区加浅色斜线阴影。
6. 用 `beamWidth(mode, length)` 控制钠灯宽束和激光窄束。

实现完成后把 `requestRender()` 更新为：

```js
function requestRender() {
  var ctx = context();
  var cv = canvas();
  if (!ctx || !cv) return false;
  var cfg = getConfig();
  ctx.clearRect(0, 0, cfg.W || cv.clientWidth, cfg.H || cv.clientHeight);
  renderEngineeringScene();
  if (getShowLight()) drawPropagationLayer();
  return true;
}
```

- [ ] **Step 3: 实现单循环动画**

在模块顶部维护：

```js
var rafId = 0;
var frameCount = 0;
var lastFrameAt = 0;
var prefersReduced = global.matchMedia &&
  global.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

实现：

```js
function stopAnimation() {
  if (rafId && global.cancelAnimationFrame) global.cancelAnimationFrame(rafId);
  rafId = 0;
  requestRender();
}

function animationTick(ts) {
  rafId = 0;
  if (!getShowLight() || doc.hidden || !canvas()) return;
  frameCount += 1;
  lastFrameAt = ts;
  requestRender();
  if (!prefersReduced) rafId = global.requestAnimationFrame(animationTick);
}

function startAnimation() {
  if (rafId || prefersReduced || !getShowLight() || doc.hidden) return;
  rafId = global.requestAnimationFrame(animationTick);
}

function getAnimationState() {
  return { running: !!rafId, frames: frameCount, lastFrameAt: lastFrameAt };
}

function setShowLight(value) {
  try { showLight = !!value; } catch (e) { /* 页面尚未初始化时忽略 */ }
  var box = doc.getElementById('showLight');
  if (box) box.checked = !!value;
}
```

光点位置使用 `((ts % 2600) / 2600)` 控制，在光锥中线移动；关闭光路时 `stopAnimation()` 只渲染一次静态场景。

覆盖 `toggleLight`：

```js
function toggleEngineeringLight() {
  var box = doc.getElementById('showLight');
  setShowLight(!!(box && box.checked));
  requestRender();
  if (getShowLight()) startAnimation(); else stopAnimation();
}
```

把 `global.toggleLight = toggleEngineeringLight` 和 `getAnimationState` 加入 API，再注册 `visibilitychange`：页面隐藏时停止，恢复可见且光路开启时重启。

- [ ] **Step 4: 验证动画与数值**

Run:

```powershell
python tools/check-optical-visual-browser.py
node tools/check-optical-geometry.js
```

Expected: 开灯后帧数增长；关灯后帧数冻结；几何数值不变。

- [ ] **Step 5: 提交**

```powershell
git add -- js/pages/optical-visual.js js/pages/optical-rail.js tools/check-optical-visual-browser.py
git commit -m "feat: 增加光学传播光锥动画"
```

## Task 5: 水平校准拖动锁

**Files:**
- Modify: `js/pages/optical-dpr.js`
- Modify: `tools/check-optical-visual-browser.py`

- [ ] **Step 1: 写拖动锁失败测试**

加入浏览器测试：

```python
page.check("#horizontalLock")
before = page.evaluate("() => { const d = devices.find(x => x.type === 'source'); return {x:d.x,y:d.y,w:d.width,h:d.height}; }")
page.mouse.move(before["x"] + before["w"] / 2, before["y"] + before["h"] / 2)
page.mouse.down()
page.mouse.move(before["x"] + before["w"] / 2 + 70, before["y"] + before["h"] / 2 + 60)
page.mouse.up()
locked = page.evaluate("() => { const d = devices.find(x => x.type === 'source'); return {x:d.x,y:d.y}; }")
assert abs(locked["x"] - before["x"]) > 20
assert abs(locked["y"] - before["y"]) < 0.01
```

Run:

```powershell
python tools/check-optical-visual-browser.py
```

Expected: FAIL，纵向位置 `y` 仍发生变化。

- [ ] **Step 2: 在拖动入口读取水平锁状态**

修改 `js/pages/optical-dpr.js` 的 `onMouseMove()`：

```js
function horizontalLocked() {
  var api = global.BP && global.BP.pages && global.BP.pages.opticalVisual;
  return !!(api && typeof api.isHorizontalLocked === 'function' && api.isHorizontalLocked());
}
```

把位置更新替换为：

```js
sel.x = Math.max(0, Math.min(cssW - sel.width, p.x - off.x));
if (!horizontalLocked()) {
  sel.y = Math.max(0, Math.min(cssH - sel.height, p.y - off.y));
}
```

- [ ] **Step 3: 保证结束同步仍工作**

保留 `optical-rail.js` 注册的 `pointerup` 同步：

```js
var onUp = function () { syncPanelFromDevices(); };
cv.addEventListener('pointerup', onUp);
cv.addEventListener('pointercancel', onUp);
```

水平锁只限制 `y`，不得跳过 `syncPanelFromDevices()` 和 `simulateInterference()`。

- [ ] **Step 4: 验证锁定与解锁**

先在测试中验证锁定，再追加：

```python
page.uncheck("#horizontalLock")
page.mouse.move(locked["x"] + before["w"] / 2, locked["y"] + before["h"] / 2)
page.mouse.down()
page.mouse.move(locked["x"] + before["w"] / 2 + 30, locked["y"] + before["h"] / 2 + 50)
page.mouse.up()
free = page.evaluate("() => { const d = devices.find(x => x.type === 'source'); return {x:d.x,y:d.y}; }")
assert abs(free["y"] - locked["y"]) > 20
```

Run:

```powershell
python tools/check-optical-visual-browser.py
```

Expected: 开启时 `x` 变、`y` 不变；关闭后 `x/y` 都变。

- [ ] **Step 5: 提交**

```powershell
git add -- js/pages/optical-dpr.js tools/check-optical-visual-browser.py
git commit -m "feat: 增加仪器水平拖动锁"
```

## Task 6: 响应式、总回归与发布

**Files:**
- Modify: `tools/browser-check.py`
- Modify: `tools/check-pages.js`
- Modify: `tools/check-versions.js`（仅在版本规则需要时）
- Modify: `optical.html`
- Modify: 由 `tools/stamp-version.js` 更新的四个 HTML

- [ ] **Step 1: 扩展总回归**

在 `tools/browser-check.py` 的 `optical_desktop` 返回值中增加：

```python
"sourceMode": page.input_value("#sourceMode"),
"betaRange": page.input_value("#betaRange"),
"horizontalLock": page.is_checked("#horizontalLock"),
"visualApi": page.evaluate("!!(window.BP && BP.pages && BP.pages.opticalVisual)")
```

在 `optical_mobile` 中加入：

```python
"controlsFit": mobile_optical.evaluate("""
  () => [...document.querySelectorAll('.angle-control, .param-select')].every(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth && r.height > 0;
  })
""")
```

加断言：

```python
if not result["optical"]["desktop"]["visualApi"]:
    raise SystemExit(23)
if not result["optical"]["mobile"]["controlsFit"]:
    raise SystemExit(24)
```

- [ ] **Step 2: 运行完整测试**

项目服务器启动后依次运行：

```powershell
node tools/check-optical-visual.js
node tools/check-optical-geometry.js
node tools/check-optical-numbers.js
node tools/check-pages.js
node tools/check-versions.js
python tools/check-optical-visual-browser.py
python tools/browser-check.py
```

Expected:

- 光学视觉门禁全部 PASS。
- 光学几何与数值没有回归。
- 页面结构检查通过。
- PC 与手机均无控制台错误、横向溢出或控件裁切。

- [ ] **Step 3: 截图复核**

生成并查看：

- PC：`1440×1000`，开启光路，钠灯。
- PC：`1440×1000`，激光，顶角 `2.0°`。
- 手机：`390×844`，开启光路。
- 对比开关光路前后截图，确认光锥明显但仪器轮廓仍清楚。

Expected: 仪器为工程线稿；钠灯宽黄束、激光窄红束；无文字重叠。

- [ ] **Step 4: 刷新统一版本并提交功能**

先提交功能源码：

```powershell
git add -- js/pages/optical-visual.js js/pages/optical-dpr.js js/pages/optical-rail.js optical.html css/optical_v2.css css/optical-responsive.css tools/check-optical-visual.js tools/check-optical-visual-browser.py tools/browser-check.py docs/superpowers/plans/2026-11-04-optical-engineering-visual.md
git commit -m "feat: 升级光学实验台工程线稿交互"
```

读取短哈希并刷新四个 HTML：

```powershell
$sha = git rev-parse --short HEAD
node tools/stamp-version.js --sha $sha
```

Expected: 四个 HTML 的 `?v=` 统一变为该短哈希。

```powershell
git add -- index.html optical.html mobile.html analysis.html
git commit -m "chore: 刷新光学平台缓存版本 $sha"
```

- [ ] **Step 5: 发布 gh-pages 并验证线上**

```powershell
git push origin fix/pure-frontend:gh-pages
```

等待 GitHub Pages 更新后打开：

- `https://wl-wust.github.io/fresnel-platform/optical.html`
- `https://wl-wust.github.io/fresnel-platform/mobile.html`

Expected: 线上版本号等于最新短哈希；光学页显示工程线稿和新控件。
