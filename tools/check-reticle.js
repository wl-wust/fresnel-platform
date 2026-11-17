/* check-reticle.js —— 分划板自动刻线识别门禁
 * 运行：node tools/check-reticle.js
 */
'use strict';

global.BP = {
  ui: { $: function () { return null; } },
  fmt: {}
};

var page = require('../js/pages/mobile.js');
var ok = 0, bad = 0;

function check(name, cond, detail) {
  if (cond) {
    ok++;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } else {
    bad++;
    console.log('FAIL  ' + name + (detail ? '  ← ' + detail : ''));
  }
}

function makeReticleImage(opts) {
  var w = opts.width || 480;
  var h = opts.height || 620;
  var data = new Uint8ClampedArray(w * h * 4);
  var seed = 7;
  function rnd() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var p = (y * w + x) * 4;
      var fringe = opts.fringes ? 24 * Math.sin(2 * Math.PI * (x + y * 0.12) / 42) : 0;
      var glare = 18 * (1 - Math.abs(x - w / 2) / (w / 2));
      var v = 170 + fringe + glare + 2.5 * rnd();
      data[p] = v;
      data[p + 1] = v * 0.92;
      data[p + 2] = v * 0.68;
      data[p + 3] = 255;
    }
  }
  (opts.ticks || []).forEach(function (x) {
    for (var yy = 145; yy <= 430; yy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var p = (yy * w + x + dx) * 4;
        data[p] = 38;
        data[p + 1] = 34;
        data[p + 2] = 24;
      }
    }
  });
  return { data: data, width: w, height: h };
}

/* 只有规则暗纹、没有任何目镜刻线的视场。
 * 旧算法把整段上半视场压成一条列投影，会把这些暗纹误当成 8 条刻线。
 */
function makeStripeFieldImage(width, height, periodPx, amplitude) {
  var data = new Uint8ClampedArray(width * height * 4);
  var cx = (width - 1) / 2;
  var cy = 600;
  var radius = width * 0.6;
  var seed = 11;
  function rnd() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      var inside = Math.hypot(x - cx, y - cy) <= radius ? 1 : 0;
      var fringe = amplitude * Math.sin(2 * Math.PI * (x + y * 0.12) / periodPx);
      var glare = 15 * (1 - Math.abs(x - cx) / radius);
      var v = inside * (180 + fringe + glare + 3 * rnd());
      data[p] = v;
      data[p + 1] = v * 0.82;
      data[p + 2] = v * 0.35;
      data[p + 3] = 255;
    }
  }
  return { data: data, width: width, height: height };
}

var image = makeReticleImage({ fringes: true, ticks: [120, 200, 280, 360] });
var detected = page.detectReticleLines
  ? page.detectReticleLines(image.data, image.width, image.height)
  : null;
check('自动识别函数存在', !!detected, detected ? '' : 'mobile.js 未导出 detectReticleLines');
check('完整识别 4 条合成刻线', !!detected && detected.lines.length === 4,
  detected ? JSON.stringify(detected) : '无结果');
check('相邻间距为 80 px', !!detected && Math.abs(detected.spacingPx - 80) <= 2,
  detected ? 'spacing=' + detected.spacingPx : '无结果');

var noisy = makeReticleImage({ fringes: true, ticks: [] });
var falsePositive = page.detectReticleLines
  ? page.detectReticleLines(noisy.data, noisy.width, noisy.height)
  : null;
check('宽干涉条纹不冒充刻线',
  !falsePositive || !falsePositive.lines || falsePositive.lines.length < 3,
  falsePositive ? JSON.stringify(falsePositive) : '未误检');

var stripeField = makeStripeFieldImage(1080, 1440, 120, 75);
var stripeFalsePositive = page.detectReticleLines
  ? page.detectReticleLines(stripeField.data, stripeField.width, stripeField.height)
  : null;
check('规则暗纹场不冒充 8 条等距刻线',
  !stripeFalsePositive || !stripeFalsePositive.lines || stripeFalsePositive.lines.length < 3,
  stripeFalsePositive ? JSON.stringify(stripeFalsePositive) : '未误检');

var manual = page.manualReticlePixels
  ? page.manualReticlePixels({ x: 100, y: 100 }, { x: 300, y: 160 }, 0.5)
  : null;
check('手点只计水平差', manual === 400, 'got=' + manual);

console.log('\n' + (bad === 0 ? '分划板识别检查通过' : bad + ' 项未通过') +
  '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
