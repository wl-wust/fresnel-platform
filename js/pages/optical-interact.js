/* =========================================================================
 * pages/optical-interact.js —— P3b：触摸/指针交互 + 选中删除（手机上可达）
 *
 * 为什么单独一层：optical_simulator.js 只绑了 mouse 事件（报告 P2-7），
 * 手机上完全拖不动元件；而它的绘制函数本身没问题。所以这里只做三件事：
 *   ① 把 mouse 监听换成 Pointer Events 一套通吃（鼠标/触控笔/手指）
 *   ② 提供 deleteSelected()，让"右键删除"在手机上变成工具栏按钮（报告 P2-7）
 *   ③ 声明 touch-action: none，避免手指拖拽时页面跟着滚动
 *
 * 刻意**不做**的两件事（留给 P6）：
 *   · devicePixelRatio：需要同时改 resizeCanvas/render/drawRail/drawLightPath/
 *     onMouseMove/getEventPos 六个直接读 canvas.width 的函数，属绘制内部重构；
 *   · CSS 合并：目前用 css/optical-responsive.css 叠加，P6 再并进 optical.css。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP || {};
  var doc = global.document;

  function cv() { return doc && doc.getElementById('opticalCanvas'); }

  /* ---------------- 取 optical_simulator.js 的顶层绑定 ----------------
   * 它用的是 `let selectedDevice` / `let devices`。`let` 在经典脚本里是
   * **全局词法绑定，不是 window 属性** —— `window.selectedDevice` 永远 undefined。
   * 直接按名字取（同一全局词法作用域），但先 typeof 判存在，避免 ReferenceError。
   */
  function getSelected() {
    try { return typeof selectedDevice !== 'undefined' ? selectedDevice : null; } catch (e) { return null; }
  }

  /* ---------------- ① Pointer Events 一套通吃 ---------------- */
  function setupPointer() {
    var c = cv();
    if (!c || c.dataset && c.dataset.pointerReady === '1') return;
    if (c.dataset) c.dataset.pointerReady = '1';

    c.style.touchAction = 'none';
    c.style.webkitUserSelect = 'none';
    c.style.userSelect = 'none';

    // 去掉原有的 mouse 监听，避免 Pointer 与 Mouse 双触发（同一拖动每帧跑两遍）
    var M = { mousedown: 'onMouseDown', mousemove: 'onMouseMove', mouseup: 'onMouseUp', mouseleave: 'onMouseUp' };
    Object.keys(M).forEach(function (type) {
      var fn = global[M[type]];
      if (typeof fn === 'function') c.removeEventListener(type, fn);
    });

    c.addEventListener('pointerdown', function (e) {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
      if (typeof global.onMouseDown === 'function') global.onMouseDown(e);
    }, { passive: false });

    c.addEventListener('pointermove', function (e) {
      if (typeof global.onMouseMove === 'function') global.onMouseMove(e);
    }, { passive: false });

    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
      c.addEventListener(type, function () {
        if (typeof global.onMouseUp === 'function') global.onMouseUp();
      });
    });
  }

  /* ---------------- ② 选中 → 删除（手机可达） ---------------- */
  function deleteSelected() {
    var sel = getSelected();
    if (!sel) {
      if (BP.ui) BP.ui.alert('请先在画布上点选一个元件');
      return false;
    }
    if (typeof global.deleteDevice === 'function') {
      global.deleteDevice(sel);
      return true;
    }
    return false;
  }

  /* ---------------- ③ 顺带把光学页的"运行仿真"接到新实现 ---------------- */
  // optical_simulator.js 里同名函数已被 P3a 的 optical-fix.js 覆盖；
  // 这里只保证即使加载顺序反过来也不会退回旧实现。
  function runSim() {
    if (typeof global.simulateInterference === 'function') global.simulateInterference();
  }

  var API = { setupPointer: setupPointer, deleteSelected: deleteSelected, runSim: runSim };

  global.deleteSelected = deleteSelected;
  BP.pages = BP.pages || {};
  BP.pages.opticalInteract = API;
  global.BP = BP;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (doc) {
    var boot = function () { setupPointer(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else global.setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
