/**
 * 光学页 COMSOL 预计算视图。
 * 只负责模式切换、图源切换和参数口径提醒，不参与物理计算。
 */
(function (global) {
  'use strict';

  var doc = global.document || null;
  var BASELINE = {
    lambdaNm: 589.3,
    refractiveIndex: 1.5168,
    betaDeg: 1.0,
    z1Mm: 50,
    z2Mm: 950
  };
  var TOLERANCE = {
    lambdaNm: 0.15,
    refractiveIndex: 0.0002,
    betaDeg: 0.005,
    z1Mm: 0.5,
    z2Mm: 0.5
  };

  function numberOrNull(value) {
    var parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function readParameter(id) {
    var input = doc && doc.getElementById(id);
    return input ? numberOrNull(input.value) : null;
  }

  function parameterState(values) {
    var source = values || {};
    var current = {
      lambdaNm: numberOrNull(source.lambdaNm),
      refractiveIndex: numberOrNull(source.refractiveIndex),
      betaDeg: numberOrNull(source.betaDeg),
      z1Mm: numberOrNull(source.z1Mm),
      z2Mm: numberOrNull(source.z2Mm)
    };
    var changed = Object.keys(BASELINE).filter(function (key) {
      var value = current[key];
      return value === null || Math.abs(value - BASELINE[key]) > TOLERANCE[key];
    });
    return { matches: changed.length === 0, changed: changed };
  }

  function updateParameterNotice() {
    if (!doc) return parameterState({});
    var state = parameterState({
      lambdaNm: readParameter('lambda'),
      refractiveIndex: readParameter('n'),
      betaDeg: readParameter('beta'),
      z1Mm: readParameter('z1'),
      z2Mm: readParameter('z2')
    });
    var notice = doc.getElementById('comsolParamNotice');
    var badge = doc.getElementById('comsolMatch');
    if (notice) notice.hidden = state.matches;
    if (badge) {
      badge.textContent = state.matches ? '参数匹配基准场景' : '参数已偏离基准';
      badge.classList.toggle('mismatch', !state.matches);
    }
    return state;
  }

  function setMode(mode) {
    if (!doc) return false;
    var next = mode === 'comsol' ? 'comsol' : 'teaching';
    var area = doc.getElementById('opticalCanvasArea');
    var comsolView = doc.getElementById('comsolView');
    var tabs = doc.querySelectorAll('[data-optical-mode]');
    if (!area || !comsolView) return false;

    area.setAttribute('data-mode', next);
    comsolView.hidden = next !== 'comsol';
    Array.prototype.forEach.call(tabs, function (tab) {
      var selected = tab.getAttribute('data-optical-mode') === next;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });

    if (next === 'comsol') {
      updateParameterNotice();
    } else {
      var api = global.BP && global.BP.pages && global.BP.pages.opticalVisual;
      if (api && api.requestRender) {
        global.setTimeout(function () {
          api.requestRender();
          if (api.startAnimation) api.startAnimation();
        }, 0);
      }
    }
    return true;
  }

  function setFigure(figureId) {
    if (!doc) return false;
    var images = doc.querySelectorAll('.comsol-figure-image');
    var buttons = doc.querySelectorAll('[data-comsol-figure]');
    var selectedImage = null;
    Array.prototype.forEach.call(images, function (image) {
      var selected = image.id === figureId;
      image.classList.toggle('active', selected);
      if (selected) selectedImage = image;
    });
    if (!selectedImage) return false;
    Array.prototype.forEach.call(buttons, function (button) {
      var selected = button.getAttribute('data-comsol-figure') === figureId;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
    var caption = doc.getElementById('comsolFigureCaption');
    if (caption) caption.textContent = selectedImage.getAttribute('data-caption') || '';
    var originalLink = doc.getElementById('comsolOpenOriginal');
    if (originalLink) originalLink.href = selectedImage.getAttribute('src') || '';
    return true;
  }

  function focusSiblingTab(event, selector) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    var tabs = Array.prototype.slice.call(doc.querySelectorAll(selector));
    var index = tabs.indexOf(doc.activeElement);
    if (index < 0) return;
    event.preventDefault();
    var step = event.key === 'ArrowRight' ? 1 : -1;
    var target = tabs[(index + step + tabs.length) % tabs.length];
    target.focus();
    target.click();
  }

  function bindControls() {
    if (!doc) return;
    var modeTabs = doc.querySelectorAll('[data-optical-mode]');
    var figureTabs = doc.querySelectorAll('[data-comsol-figure]');
    var parameterIds = ['lambda', 'n', 'beta', 'z1', 'z2'];

    Array.prototype.forEach.call(modeTabs, function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.getAttribute('data-optical-mode'));
      });
      tab.addEventListener('keydown', function (event) {
        focusSiblingTab(event, '[data-optical-mode]');
      });
    });
    Array.prototype.forEach.call(figureTabs, function (tab) {
      tab.addEventListener('click', function () {
        setFigure(tab.getAttribute('data-comsol-figure'));
      });
      tab.addEventListener('keydown', function (event) {
        focusSiblingTab(event, '[data-comsol-figure]');
      });
    });
    parameterIds.forEach(function (id) {
      var input = doc.getElementById(id);
      if (!input) return;
      input.addEventListener('change', updateParameterNotice);
      input.addEventListener('input', updateParameterNotice);
    });
    setMode('teaching');
    setFigure('comsolFigure2d');
    updateParameterNotice();
  }

  var API = {
    BASELINE: BASELINE,
    parameterState: parameterState,
    setMode: setMode,
    setFigure: setFigure,
    updateParameterNotice: updateParameterNotice
  };

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.opticalComsol = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (doc) {
    var boot = function () { bindControls(); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else global.setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
