/* =========================================================================
 * pages/optical-dpr.js —— P6b：高分屏清晰度（devicePixelRatio）
 *
 * 为什么只改 2 个函数（原计划要改 6 个）：
 *   optical_simulator.js 里有 5 处直接读 canvas.width / canvas.height：
 *     resizeCanvas / render(clearRect) / drawRail / drawLightPath / onMouseMove(钳制)
 *   一旦在 resizeCanvas 里把后备存储设为 cssW×dpr 并 ctx.setTransform(dpr,0,0,dpr,0,0)，
 *   绘制坐标就变回 CSS 像素，于是：
 *     · render 的 clearRect 清得比画布大      → 被裁掉，无害
 *     · drawRail 的 fillRect / 刻度循环越界   → 被裁掉，无害（只是多迭代 dpr 次）
 *     · drawLightPath 的 lineTo(canvas.width) → 被裁掉，无害
 *   真正会坏的是 **onMouseMove 的钳制**：它用 canvas.width（= dpr×CSS）当边界，
 *   元件能被拖到可视区域之外。所以只要精确覆盖 resizeCanvas + onMouseMove 两个函数。
 *   （getEventPos 返回的是 rect 相对 CSS 像素，配合 transform 正好正确，不用改。）
 *
 * 顺序：必须在 optical_simulator.js 之后加载；本模块自带 resize 监听，
 *       且因为比 init() 里那个监听后注册，所以会最后执行、把 DPR 重新套回去。
 * ========================================================================= */
(function (global) {
  'use strict';

  var doc = global.document;

  function cv() { return doc && doc.getElementById('opticalCanvas'); }
  function dpr() { return Math.max(1, Math.min(3, global.devicePixelRatio || 1)); }

  // 取 optical_simulator.js 的 let/const 绑定（它们不是 window 属性，见 check-globals 的说明）
  function getConfig() {
    try { return typeof CONFIG !== 'undefined' ? CONFIG : undefined; } catch (e) { return undefined; }
  }
  function getIsDragging() {
    try { return typeof isDragging !== 'undefined' ? isDragging : false; } catch (e) { return false; }
  }
  function getDragOffset() {
    try { return typeof dragOffset !== 'undefined' ? dragOffset : { x: 0, y: 0 }; } catch (e) { return { x: 0, y: 0 }; }
  }
  function callRender() { if (typeof global.render === 'function') global.render(); }

  /* ---------------- 覆盖 resizeCanvas（原 41-46 行） ---------------- */
  function resizeCanvas() {
    var c = cv();
    if (!c) return;
    var box = c.parentElement || c;
    var cssW = Math.max(1, box.clientWidth || 800);
    var cssH = Math.max(1, box.clientHeight || 600);
    var r = dpr();

    // 后备存储按 dpr 放大，CSS 尺寸保持 100% —— 这是清晰度的来源
    c.width = Math.round(cssW * r);
    c.height = Math.round(cssH * r);
    c.style.width = '100%';
    c.style.height = '100%';

    var ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(r, 0, 0, r, 0, 0);   // 之后所有绘制仍用 CSS 像素

    var cfg = getConfig();
    if (cfg) {
      cfg.railY = Math.floor(cssH / 2);
      cfg.W = cssW;      // 逻辑宽高（CSS 像素），给需要的模块参考
      cfg.H = cssH;
      cfg.dpr = r;
    }
    callRender();
  }

  /* ---------------- 覆盖 onMouseMove（原 59-70 行，钳制改用 CSS 尺寸） ---------------- */
  function onMouseMove(e) {
    if (typeof global.getEventPos !== 'function') return;
    if (e && e.preventDefault) e.preventDefault();
    var p = global.getEventPos(e);
    var coords = doc && doc.getElementById('coords');
    if (coords) coords.textContent = '(' + Math.round(p.x) + ', ' + Math.round(p.y) + ')';

    var sel = null;
    try { sel = typeof selectedDevice !== 'undefined' ? selectedDevice : null; } catch (err) { sel = null; }
    if (!getIsDragging() || !sel) return;

    var c = cv();
    var cssW = c ? (c.parentElement ? c.parentElement.clientWidth : c.clientWidth) : 0;
    var cssH = c ? (c.parentElement ? c.parentElement.clientHeight : c.clientHeight) : 0;
    var off = getDragOffset();

    sel.x = Math.max(0, Math.min(cssW - sel.width, p.x - off.x));
    sel.y = Math.max(0, Math.min(cssH - sel.height, p.y - off.y));
    callRender();
    if (typeof global.updateParams === 'function') global.updateParams();
    if (typeof global.simulateInterference === 'function') global.simulateInterference();
  }

  var API = { resizeCanvas: resizeCanvas, onMouseMove: onMouseMove, dpr: dpr };
  global.resizeCanvas = resizeCanvas;
  global.onMouseMove = onMouseMove;

  if (doc) {
    // 后注册 ⇒ 在 init() 里那个监听之后执行，保证 DPR 不会被旧 resizeCanvas 抹掉
    global.addEventListener('resize', function () { resizeCanvas(); });
    var boot = function () {
      resizeCanvas();
      // 元件的初始位置/尺寸是按 CSS 像素设计的，DPR 只影响后备存储，无需改动
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { global.setTimeout(boot, 120); });
    else global.setTimeout(boot, 120);
  }

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.opticalDpr = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
