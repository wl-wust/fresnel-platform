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
  var rafId = 0;
  var frameCount = 0;
  var lastFrameAt = 0;
  var animationPhase = 0;
  var prefersReduced = !!(global.matchMedia &&
    global.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  function canvas() {
    return doc && doc.getElementById('opticalCanvas');
  }

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

  function getShowLabels() {
    try { return typeof showLabels !== 'undefined' ? !!showLabels : true; } catch (e) { return true; }
  }

  function getBeta() {
    var el = doc && doc.getElementById('beta');
    return clampAngle(el ? parseFloat(el.value) : 1.0, 1.0);
  }

  function getSourceMode() {
    var el = doc && doc.getElementById('sourceMode');
    return el && PRESETS[el.value] ? el.value : 'sodium';
  }

  function isHorizontalLocked() {
    var el = doc && doc.getElementById('horizontalLock');
    return !!(el && el.checked);
  }

  function deviceCenter(device) {
    if (!device) return { x: 0, y: 0 };
    var x = device.x + device.width / 2;
    var y = device.y + device.height / 2;
    if (device.type === 'source') x = Math.max(28, x);
    return { x: x, y: y };
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawEngineeringBackground(ctx, W, H) {
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, W, H);

    for (var x = 0; x <= W; x += 20) {
      ctx.strokeStyle = x % 100 === 0 ? 'rgba(91, 78, 53, .11)' : 'rgba(100, 91, 72, .05)';
      ctx.lineWidth = x % 100 === 0 ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (var y = 0; y <= H; y += 20) {
      ctx.strokeStyle = y % 100 === 0 ? 'rgba(91, 78, 53, .11)' : 'rgba(100, 91, 72, .05)';
      ctx.lineWidth = y % 100 === 0 ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawAxis(ctx, cfg, W) {
    ctx.save();
    ctx.strokeStyle = 'rgba(23, 33, 43, .24)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(16, cfg.railY);
    ctx.lineTo(W - 16, cfg.railY);
    ctx.stroke();
    ctx.restore();
  }

  function drawEngineeringRail(ctx, cfg, W) {
    var y = cfg.railY + 24;
    var left = 20;
    var right = W - 20;
    var scale = cfg.scale > 0 ? cfg.scale : W / 1200;

    ctx.strokeStyle = '#17212b';
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y + 7);
    ctx.lineTo(right, y + 7);
    ctx.stroke();

    ctx.font = '9px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#4f585c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var px = left; px <= right; px += Math.max(5, scale * 20)) {
      var mm = Math.round((px - left) / scale);
      var major = mm % 100 === 0;
      ctx.lineWidth = major ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(px, y + 7);
      ctx.lineTo(px, y + 7 + (major ? 9 : 4));
      ctx.stroke();
      if (major && px < right - 18) ctx.fillText(mm, px, y + 18);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#6c716c';
    ctx.fillText('毫米标尺 / 水平校准', right, y - 18);
  }

  function drawNumberBadge(ctx, device, cx, topY, canvasWidth) {
    // 相邻元件很近，三层错位避免编号与名称互相覆盖。
    var badgeY = Math.max(14, topY - 28 - ((device.id - 1) % 3) * 14);
    ctx.save();
    ctx.fillStyle = '#fffdf7';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, badgeY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#17212b';
    ctx.font = 'bold 10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(device.id), cx, badgeY + 0.5);

    var labels = {
      source: '光源',
      slit: '单缝',
      prism: '双棱镜',
      lens: '凸透镜',
      screen: '观察屏'
    };
    var label = labels[device.type] || device.name || '';
    var textX = cx + 14;
    var textW = Math.max(30, ctx.measureText(label).width + 8);
    var flipLabel = textX + textW > canvasWidth - 8;
    if (flipLabel) textX = cx - 14 - textW;
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + (flipLabel ? -9 : 9), badgeY);
    ctx.lineTo(textX + (flipLabel ? textW : -2), badgeY);
    ctx.stroke();
    ctx.fillStyle = '#17212b';
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, textX, badgeY + 0.5);
    ctx.restore();
    return textW;
  }

  function drawSource(ctx, cx, cy) {
    var style = sourcePreset(getSourceMode());
    var x = cx - 20;
    var y = cy - 24;
    ctx.fillStyle = 'rgba(23, 33, 43, .08)';
    roundRect(ctx, x + 2, y + 3, 40, 48, 6);
    ctx.fill();
    ctx.fillStyle = '#fffdf7';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 2.6;
    roundRect(ctx, x, y, 40, 48, 6);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx - 2, cy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = style.glow;
    ctx.fill();
    ctx.strokeStyle = '#17212b';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx - 2, cy - 8);
    ctx.lineTo(cx - 2, cy + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 11);
    ctx.lineTo(x + 52, y + 4);
    ctx.lineTo(x + 52, y + 44);
    ctx.lineTo(x + 40, y + 37);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 12, y + 48);
    ctx.lineTo(cx - 12, cy + 32);
    ctx.moveTo(cx + 8, y + 48);
    ctx.lineTo(cx + 8, cy + 32);
    ctx.stroke();
  }

  function drawBeamCone(ctx, x1, y1, x2, y2, width1, width2, style, alpha) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.max(1, Math.hypot(dx, dy));
    var nx = -dy / len;
    var ny = dx / len;
    var grd = ctx.createLinearGradient(x1, y1, x2, y2);
    grd.addColorStop(0, 'rgba(' + style.rgb + ',' + (alpha * 0.42) + ')');
    grd.addColorStop(0.72, 'rgba(' + style.rgb + ',' + alpha + ')');
    grd.addColorStop(1, 'rgba(' + style.rgb + ',' + (alpha * 0.56) + ')');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * width1 / 2, y1 + ny * width1 / 2);
    ctx.lineTo(x2 + nx * width2 / 2, y2 + ny * width2 / 2);
    ctx.lineTo(x2 - nx * width2 / 2, y2 - ny * width2 / 2);
    ctx.lineTo(x1 - nx * width1 / 2, y1 - ny * width1 / 2);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = style.core;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * width1 / 2, y1 + ny * width1 / 2);
    ctx.lineTo(x2 + nx * width2 / 2, y2 + ny * width2 / 2);
    ctx.moveTo(x1 - nx * width1 / 2, y1 - ny * width1 / 2);
    ctx.lineTo(x2 - nx * width2 / 2, y2 - ny * width2 / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBeamParticles(ctx, x1, y1, x2, y2, style, count, phase, radius) {
    for (var i = 0; i < count; i++) {
      var t = (phase + i / count) % 1;
      var ease = 0.45 * t + 0.55 * t * t;
      var x = x1 + (x2 - x1) * ease;
      var y = y1 + (y2 - y1) * ease;
      ctx.fillStyle = style.core;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawInterferenceField(ctx, x1, y1, x2, y2, half1, half2, color) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1 - half1);
    ctx.lineTo(x2, y2 - half2);
    ctx.lineTo(x2, y2 + half2);
    ctx.lineTo(x1, y1 + half1);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (var x = x1 - 100; x < x2 + 100; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, y1 - half1);
      ctx.lineTo(x + half2 * 2, y1 + half1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPropagationLayer(ctx) {
    var list = getDevices() || [];
    var source = null;
    var slit = null;
    var prism = null;
    var screen = null;
    list.forEach(function (device) {
      if (device.type === 'source' && !source) source = device;
      if (device.type === 'slit' && !slit) slit = device;
      if (device.type === 'prism' && !prism) prism = device;
      if (device.type === 'screen' && !screen) screen = device;
    });
    if (!source) return;

    var style = sourcePreset(getSourceMode());
    var src = deviceCenter(source);
    var slitP = slit ? deviceCenter(slit) : null;
    var pr = prism ? deviceCenter(prism) : null;
    var scr = screen ? deviceCenter(screen) : null;
    var startX = Math.min(src.x + 28, (slitP ? slitP.x : src.x + 100) - 4);
    var startY = src.y;

    if (slitP) {
      drawBeamCone(ctx, startX, startY, slitP.x - 5, slitP.y,
        beamWidth(style.mode, slitP.x - startX) * 0.7,
        Math.max(4, beamWidth(style.mode, 80) * 0.3), style, 0.20);
    }
    if (slitP && pr) {
      drawBeamCone(ctx, slitP.x + 5, slitP.y, pr.x - 14, pr.y,
        4, beamWidth(style.mode, pr.x - slitP.x) * 0.66, style, 0.23);
    }

    var end = scr || { x: (pr ? pr.x : startX) + 420, y: startY };
    var endX = end.x - 8;
    var endY = end.y;
    if (pr) {
      var beamLen = Math.max(80, endX - pr.x);
      drawBeamCone(ctx, pr.x + 15, pr.y, endX, endY,
        beamWidth(style.mode, beamLen) * 0.58,
        beamWidth(style.mode, beamLen) * 1.05, style, 0.25);
      drawInterferenceField(ctx, pr.x + 34, pr.y,
        endX, endY, 10, Math.min(52, beamWidth(style.mode, beamLen) * 0.42),
        'rgba(' + style.rgb + ',.18)');

      var virtualX = Math.max(20, pr.x - 58);
      var virtualGap = 17 + angleToVisualDegrees(getBeta()) * 1.4;
      ctx.save();
      ctx.strokeStyle = 'rgba(' + style.rgb + ',.48)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(virtualX, pr.y - virtualGap);
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(virtualX, pr.y + virtualGap);
      ctx.moveTo(virtualX, pr.y - virtualGap);
      ctx.lineTo(endX, endY - 22);
      ctx.moveTo(virtualX, pr.y + virtualGap);
      ctx.lineTo(endX, endY + 22);
      ctx.stroke();
      ctx.restore();
      if (getShowLabels()) {
        ctx.fillStyle = '#17212b';
        ctx.font = '10px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('S₁', virtualX, pr.y - virtualGap - 5);
        ctx.fillText('S₂', virtualX, pr.y + virtualGap + 13);
      }
    }

    var phase = prefersReduced ? 0.35 : animationPhase;
    drawBeamParticles(ctx, startX, startY, slitP ? slitP.x - 4 : startX + 80,
      style, 3, phase, style.mode === 'laser' ? 1.5 : 2);
    if (slitP && pr) {
      drawBeamParticles(ctx, slitP.x + 4, slitP.y, pr.x - 8, pr.y,
        style, 3, phase, style.mode === 'laser' ? 1.3 : 1.8);
    }
    if (pr) {
      drawBeamParticles(ctx, pr.x + 18, pr.y, endX, endY,
        style, 5, phase, style.mode === 'laser' ? 1.4 : 2.1);
    }
  }

  function drawSlit(ctx, cx, cy) {
    ctx.fillStyle = '#fffdf7';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 2.2;
    roundRect(ctx, cx - 6, cy - 23, 12, 46, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#17212b';
    ctx.fillRect(cx - 1, cy - 19, 2, 15);
    ctx.fillRect(cx - 1, cy + 4, 2, 15);
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(cx - 1.5, cy - 5, 3, 10);
  }

  function drawBiprism(ctx, cx, cy, beta) {
    var visual = angleToVisualDegrees(beta);
    var flare = 7 + visual * 0.72;
    var halfH = 27;
    ctx.fillStyle = 'rgba(211, 163, 34, .12)';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - flare, cy - halfH);
    ctx.lineTo(cx + 16, cy - halfH);
    ctx.lineTo(cx + 16, cy + halfH);
    ctx.lineTo(cx - flare, cy + halfH);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(23, 33, 43, .45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - flare + 3, cy - halfH + 5);
    ctx.lineTo(cx - 2, cy);
    ctx.lineTo(cx - flare + 3, cy + halfH - 5);
    ctx.stroke();
  }

  function drawLens(ctx, cx, cy) {
    ctx.fillStyle = 'rgba(31, 154, 184, .10)';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 29);
    ctx.bezierCurveTo(cx - 11, cy - 16, cx - 11, cy + 16, cx, cy + 29);
    ctx.bezierCurveTo(cx + 11, cy + 16, cx + 11, cy - 16, cx, cy - 29);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawScreen(ctx, cx, cy) {
    ctx.fillStyle = '#fffdf7';
    ctx.strokeStyle = '#17212b';
    ctx.lineWidth = 2.2;
    roundRect(ctx, cx - 6, cy - 31, 12, 62, 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy + 31);
    ctx.lineTo(cx + 11, cy + 31);
    ctx.moveTo(cx, cy + 31);
    ctx.lineTo(cx, cy + 39);
    ctx.stroke();
  }

  function drawEngineeringDevice(ctx, device, selected, canvasWidth) {
    var p = deviceCenter(device);
    var cx = p.x;
    var cy = p.y;
    var topY = cy - 30;

    if (device.type === 'source') drawSource(ctx, cx, cy);
    else if (device.type === 'slit') drawSlit(ctx, cx, cy);
    else if (device.type === 'prism') drawBiprism(ctx, cx, cy, getBeta());
    else if (device.type === 'lens') drawLens(ctx, cx, cy);
    else if (device.type === 'screen') drawScreen(ctx, cx, cy);

    if (selected) {
      ctx.save();
      ctx.strokeStyle = '#c27616';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - 25, cy - 35, 50, 70);
      ctx.restore();
    }
    if (getShowLabels()) drawNumberBadge(ctx, device, cx, topY, canvasWidth);
  }

  function renderEngineeringScene() {
    var ctx = context();
    var cv = canvas();
    if (!ctx || !cv) return false;
    var cfg = getConfig();
    if (!cfg) return false;
    var W = cfg.W || cv.clientWidth;
    var H = cfg.H || cv.clientHeight;

    ctx.clearRect(0, 0, W, H);
    drawEngineeringBackground(ctx, W, H);
    drawAxis(ctx, cfg, W);
    drawEngineeringRail(ctx, cfg, W);
    if (getShowLight()) drawPropagationLayer(ctx);

    var list = getDevices() || [];
    list.forEach(function (device) {
      drawEngineeringDevice(ctx, device, device === getSelected(), W);
    });
    return true;
  }

  function requestRender() {
    return renderEngineeringScene();
  }

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
    animationPhase = (ts % 2600) / 2600;
    requestRender();
    if (!prefersReduced) rafId = global.requestAnimationFrame(animationTick);
  }

  function startAnimation() {
    if (prefersReduced) {
      requestRender();
      return false;
    }
    if (rafId || !getShowLight() || doc.hidden || !canvas()) return false;
    rafId = global.requestAnimationFrame(animationTick);
    return true;
  }

  function getAnimationState() {
    return {
      running: !!rafId,
      frames: frameCount,
      lastFrameAt: lastFrameAt,
      phase: animationPhase,
      reducedMotion: prefersReduced
    };
  }

  function setShowLight(value) {
    try { showLight = !!value; } catch (e) { /* 页面尚未初始化时忽略 */ }
    var box = doc && doc.getElementById('showLight');
    if (box) box.checked = !!value;
  }

  function toggleEngineeringLight() {
    var box = doc && doc.getElementById('showLight');
    setShowLight(!!(box && box.checked));
    if (getShowLight()) {
      requestRender();
      startAnimation();
    } else {
      stopAnimation();
    }
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

  function enlargeDeviceTypes() {
    var types = null;
    try { types = typeof DEVICE_TYPES !== 'undefined' ? DEVICE_TYPES : null; } catch (e) { types = null; }
    if (!types) return;
    var sizes = {
      source: { width: 38, height: 54 },
      slit: { width: 10, height: 46 },
      prism: { width: 32, height: 54 },
      lens: { width: 18, height: 58 },
      screen: { width: 12, height: 64 }
    };
    Object.keys(sizes).forEach(function (type) {
      if (!types[type]) return;
      types[type].width = sizes[type].width;
      types[type].height = sizes[type].height;
    });
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
    requestRender: requestRender,
    renderEngineeringScene: renderEngineeringScene,
    getBeta: getBeta,
    getAnimationState: getAnimationState,
    startAnimation: startAnimation,
    stopAnimation: stopAnimation,
    toggleEngineeringLight: toggleEngineeringLight
  };

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.opticalVisual = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (doc) {
    var boot = function () {
      bindControls();
      global.render = requestRender;
      global.toggleLight = toggleEngineeringLight;
      enlargeDeviceTypes();
      global.setTimeout(function () {
        if (typeof global.layoutFromPanel === 'function') global.layoutFromPanel();
        requestRender();
        if (getShowLight()) startAnimation();
      }, 260);
      doc.addEventListener('visibilitychange', function () {
        if (doc.hidden) stopAnimation();
        else if (getShowLight()) startAnimation();
      });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else global.setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
