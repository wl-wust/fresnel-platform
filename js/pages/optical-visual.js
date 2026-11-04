/* =========================================================================
 * pages/optical-visual.js —— 光学实验台工程线稿视觉层
 *
 * 本文件只接管绘制与视觉状态，物理计算仍由 optical-rail.js 负责。
 * ========================================================================= */
(function (global) {
  'use strict';

  var doc = global.document;
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
      mode: 'sodium',
      label: '钠光灯',
      lambda: 589.3,
      color: '#d6a400',
      rgb: '214,164,0',
      glow: 'rgba(238, 190, 42, 0.34)',
      core: 'rgba(255, 218, 88, 0.84)'
    },
    laser: {
      mode: 'laser',
      label: '激光',
      lambda: 650,
      color: '#d24040',
      rgb: '210,64,64',
      glow: 'rgba(224, 68, 68, 0.28)',
      core: 'rgba(255, 104, 104, 0.92)'
    }
  };

  function sourcePreset(mode) {
    return PRESETS[mode] || PRESETS.sodium;
  }

  function beamWidth(mode, length) {
    var px = Math.max(0, +length || 0);
    return mode === 'laser' ? Math.max(3, px * 0.025) : Math.max(14, px * 0.14);
  }

  function getSourceMode() {
    var el = doc && doc.getElementById('sourceMode');
    return el && PRESETS[el.value] ? el.value : 'sodium';
  }

  function isHorizontalLocked() {
    var el = doc && doc.getElementById('horizontalLock');
    return !!(el && el.checked);
  }

  function requestRender() {
    if (typeof global.render === 'function') global.render();
  }

  function bindControls() {
    if (!doc) return;
    var source = doc.getElementById('sourceMode');
    var lambda = doc.getElementById('lambda');
    var beta = doc.getElementById('beta');
    var betaRange = doc.getElementById('betaRange');
    var lock = doc.getElementById('horizontalLock');
    var syncing = false;

    function syncAngle(value, target) {
      if (syncing || !beta || !betaRange) return;
      syncing = true;
      var next = clampAngle(value, parseFloat(beta.value) || 1.0);
      beta.value = next.toFixed(2);
      betaRange.value = next.toFixed(2);
      target.dispatchEvent(new Event('change', { bubbles: true }));
      syncing = false;
    }

    if (source && lambda) {
      source.addEventListener('change', function () {
        lambda.value = sourcePreset(source.value).lambda;
        lambda.dispatchEvent(new Event('change', { bubbles: true }));
        requestRender();
      });
    }
    if (betaRange) betaRange.addEventListener('input', function () {
      syncAngle(betaRange.value, beta);
    });
    if (beta) beta.addEventListener('change', function () {
      syncAngle(beta.value, betaRange);
    });
    if (lock) lock.addEventListener('change', requestRender);
  }

  var API = {
    ANGLE_MIN: ANGLE_MIN,
    ANGLE_MAX: ANGLE_MAX,
    clampAngle: clampAngle,
    angleToVisualDegrees: angleToVisualDegrees,
    sourcePreset: sourcePreset,
    beamWidth: beamWidth,
    bindControls: bindControls,
    getSourceMode: getSourceMode,
    isHorizontalLocked: isHorizontalLocked,
    requestRender: requestRender
  };

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.opticalVisual = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (doc) {
    var boot = function () { bindControls(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else global.setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
