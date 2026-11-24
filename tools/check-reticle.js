/* check-reticle.js —— 同框逐帧分划板标定门禁
 * 运行：node tools/check-reticle.js
 */
'use strict';

var C = require('../js/core/frame-calibration.js');
var ok = 0;
var bad = 0;

function check(name, condition, detail) {
  if (condition) {
    ok += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } else {
    bad += 1;
    console.log('FAIL  ' + name + (detail ? '  ← ' + detail : ''));
  }
}

function near(actual, expected, tolerance) {
  return isFinite(actual) && Math.abs(Number(actual) - expected) <= tolerance;
}

function makeReticleImage(options) {
  options = options || {};
  var width = options.width || 480;
  var height = options.height || 620;
  var data = new Uint8ClampedArray(width * height * 4);
  var seed = options.seed || 7;
  var y0 = options.tickY0 || 145;
  var y1 = options.tickY1 || 430;
  var slope = options.tickSlope || 0;
  var yMid = (y0 + y1) / 2;

  function random() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      var fringe = options.fringes
        ? 24 * Math.sin(2 * Math.PI * (x + y * 0.12) / 42)
        : 0;
      var glare = 18 * (1 - Math.abs(x - width / 2) / (width / 2));
      var value = 170 + fringe + glare + 2.5 * random();
      data[p] = value;
      data[p + 1] = value * 0.92;
      data[p + 2] = value * 0.68;
      data[p + 3] = 255;
    }
  }

  (options.ticks || []).forEach(function (tickX) {
    for (var yy = y0; yy <= y1; yy++) {
      var center = Math.round(tickX + slope * (yy - yMid));
      for (var dx = -2; dx <= 2; dx++) {
        var pointX = center + dx;
        if (pointX < 0 || pointX >= width) continue;
        var point = (yy * width + pointX) * 4;
        data[point] = 38;
        data[point + 1] = 34;
        data[point + 2] = 24;
      }
    }
  });
  return { data: data, width: width, height: height };
}

function makeStripeFieldImage(width, height, periodPx, amplitude) {
  var data = new Uint8ClampedArray(width * height * 4);
  var cx = (width - 1) / 2;
  var cy = 600;
  var radius = width * 0.6;
  var seed = 11;

  function random() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      var inside = Math.hypot(x - cx, y - cy) <= radius ? 1 : 0;
      var fringe = amplitude * Math.sin(2 * Math.PI * (x + y * 0.12) / periodPx);
      var glare = 15 * (1 - Math.abs(x - cx) / radius);
      var value = inside * (180 + fringe + glare + 3 * random());
      data[p] = value;
      data[p + 1] = value * 0.82;
      data[p + 2] = value * 0.35;
      data[p + 3] = 255;
    }
  }
  return { data: data, width: width, height: height };
}

/* 真实分划板更像“水平基线 + 短竖刻线”，刻线方向与竖直干涉条纹交叉。
 * 该合成图专门防止把贯穿视场的干涉暗纹当成标尺刻线。
 */
function makeCrossedReticleImage() {
  var width = 640;
  var height = 480;
  var data = new Uint8ClampedArray(width * height * 4);
  var baselineY = 320;
  var tickXs = [120, 220, 320, 420, 520];
  var seed = 19;

  function random() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      var fringe = 34 * Math.sin(2 * Math.PI * x / 48);
      var value = 176 + fringe + 2.5 * random();
      data[p] = value;
      data[p + 1] = value * 0.9;
      data[p + 2] = value * 0.62;
      data[p + 3] = 255;
    }
  }

  for (var bx = 92; bx <= 548; bx++) {
    for (var bdy = -1; bdy <= 1; bdy++) {
      var bp = ((baselineY + bdy) * width + bx) * 4;
      data[bp] = 32;
      data[bp + 1] = 28;
      data[bp + 2] = 20;
    }
  }
  tickXs.forEach(function (tickX) {
    for (var ty = baselineY - 34; ty <= baselineY + 34; ty++) {
      for (var dx = -2; dx <= 2; dx++) {
        var p2 = (ty * width + tickX + dx) * 4;
        data[p2] = 28;
        data[p2 + 1] = 24;
        data[p2 + 2] = 18;
      }
    }
  });
  return { data: data, width: width, height: height, baselineY: baselineY };
}

/* 真实红光照片中，上部短刻线梳与中部水平基线不一定相交；
 * 左侧密集干涉条纹还会产生大量同样竖直、但更宽更长的暗纹碎片。
 */
function makeSeparatedReticleImage(options) {
  options = options || {};
  var width = options.width || 1280;
  var height = options.height || 720;
  var data = new Uint8ClampedArray(width * height * 4);
  var seed = options.seed || 23;
  var ticks = options.ticks || [575, 665, 755, 845];
  var tickY0 = options.tickY0 || 115;
  var tickY1 = options.tickY1 || 160;
  var baselineY = options.baselineY || 340;

  function random() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  }

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var p = (y * width + x) * 4;
      var inField = Math.hypot(x - width * 0.42, y - height * 0.42) <= width * 0.34;
      var fringe = 0;
      if (inField && x >= 120 && x <= 530 && y >= 40 && y <= 350) {
        fringe = 64 * Math.sin(2 * Math.PI * x / 23);
      }
      var value = inField ? 172 + fringe + 2.2 * random() : 5;
      data[p] = value;
      data[p + 1] = value * 0.30;
      data[p + 2] = value * 0.42;
      data[p + 3] = 255;
    }
  }

  // 水平基线位于刻线下方，模拟真实照片中两条结构分离的情况。
  for (var bx = 500; bx <= 1000; bx++) {
    for (var bdy = -1; bdy <= 1; bdy++) {
      var bp = ((baselineY + bdy) * width + bx) * 4;
      data[bp] = 34;
      data[bp + 1] = 28;
      data[bp + 2] = 20;
    }
  }

  // 刻线较细且只在画面上部出现，不能被左侧长条状干涉暗纹替代。
  ticks.forEach(function (tickX) {
    for (var ty = tickY0; ty <= tickY1; ty++) {
      for (var dx = -1; dx <= 1; dx++) {
        var p2 = (ty * width + tickX + dx) * 4;
        data[p2] = 48;
        data[p2 + 1] = 34;
        data[p2 + 2] = 30;
      }
    }
  });
  return {
    data: data,
    width: width,
    height: height,
    ticks: ticks,
    baselineY: baselineY
  };
}

/* 在真实分离刻线之外加入“穿过横基线、斜率互相冲突”的伪竖线。
 * 旧实现会先把它们当成 3 条交叉刻线返回，从而压过更可靠的上部刻线梳。
 */
function makeCrossingTrapWithSeparatedReticle() {
  var base = makeSeparatedReticleImage();
  var width = base.width;
  var height = base.height;
  var baselineY = base.baselineY;
  var falseTicks = [
    { x: 220, slope: 0.16 },
    { x: 300, slope: -0.18 },
    { x: 380, slope: 0.14 }
  ];

  // 加粗并延长横线，确保交叉刻线分支会把它识别为真实基线。
  for (var by = baselineY - 6; by <= baselineY + 6; by++) {
    for (var bx = 120; bx <= 1080; bx++) {
      var bp = (by * width + bx) * 4;
      base.data[bp] = 28;
      base.data[bp + 1] = 24;
      base.data[bp + 2] = 20;
    }
  }

  falseTicks.forEach(function (tick) {
    for (var y = baselineY - 30; y <= baselineY + 30; y++) {
      var center = Math.round(tick.x + tick.slope * (y - baselineY));
      for (var dx = -1; dx <= 1; dx++) {
        var point = (y * width + center + dx) * 4;
        base.data[point] = 28;
        base.data[point + 1] = 24;
        base.data[point + 2] = 20;
      }
    }
  });
  base.falseTicks = falseTicks;
  return base;
}

var image = makeReticleImage({ fringes: true, ticks: [120, 220, 320, 420] });
var geometry = C.detectReticleGeometry(image.data, image.width, image.height);
check('自动识别 4 条合成刻线', geometry.count === 4, JSON.stringify(geometry.lines || []));
check('相邻刻线间距为 100 px', near(geometry.spacingPx, 100, 2),
  'spacing=' + geometry.spacingPx);

var local = C.localScaleAtBand(geometry, { y0: 145, y1: 430 });
check('同带局部间距保持 100 px', near(local.tickSpacingPx, 100, 2),
  'spacing=' + local.tickSpacingPx);
check('高质量 4 线自动合格',
  C.calculateLocalCalibration(geometry, { y0: 145, y1: 430 }).status === 'autoAccepted');

var secondImage = makeReticleImage({ fringes: true, ticks: [80, 200, 320, 440] });
var secondGeometry = C.detectReticleGeometry(
  secondImage.data,
  secondImage.width,
  secondImage.height
);
var secondLocal = C.localScaleAtBand(secondGeometry, { y0: 145, y1: 430 });
check('不同帧独立计算像素当量',
  near(secondLocal.tickSpacingPx, 120, 2) &&
  !near(secondLocal.tickSpacingPx, local.tickSpacingPx, 1),
  'frame1=' + local.tickSpacingPx + ', frame2=' + secondLocal.tickSpacingPx);

var threeImage = makeReticleImage({ fringes: true, ticks: [120, 220, 320] });
var threeGeometry = C.detectReticleGeometry(
  threeImage.data,
  threeImage.width,
  threeImage.height
);
check('3 条刻线只进入待确认',
  C.calculateLocalCalibration(threeGeometry, { y0: 145, y1: 430 }).status === 'pending');

var harmonicGeometry = {
  schema: C.GEOMETRY_SCHEMA,
  coordinateSpace: 'analysisPixels',
  analysisScale: 1,
  lines: [0, 1, 2, 3, 4, 5, 6, 7].map(function (index) {
    return {
      index: index,
      x: 100 + index * 115.7,
      measuredX: 100 + index * 115.7,
      referenceY: 300,
      meanY: 300,
      slopePxPerPx: 0,
      y0: 180,
      y1: 420,
      widthPx: 3,
      heightPx: 240,
      score: 100
    };
  }),
  count: 8,
  spacingPx: 115.7,
  rmsPx: 0,
  relativeRms: 0,
  slopeSpread: 0,
  warnings: []
};
var harmonicCalibration = C.calculateLocalCalibration(
  harmonicGeometry,
  { y0: 180, y1: 420 },
  { fringePeriodPx: 23.14 }
);
check('刻线间距为条纹周期整数倍时拒绝伪标定',
  harmonicCalibration.status === 'rejected' &&
  harmonicCalibration.warnings.indexOf('reticle-fringe-harmonic') >= 0,
  'status=' + harmonicCalibration.status + ' warnings=' +
  JSON.stringify(harmonicCalibration.warnings));

/* 真实视频会先缩放到分析画布；刻线间距与条纹周期几乎相等时，
 * 二者已经不可区分，不能因为整数倍只有 1 倍就自动接受。
 */
var indistinguishableGeometry = {
  schema: C.GEOMETRY_SCHEMA,
  coordinateSpace: 'analysisPixels',
  analysisScale: 1 / 3,
  lines: [0, 1, 2, 3, 4, 5, 6, 7].map(function (index) {
    return {
      index: index,
      x: 100 + index * 38.571,
      measuredX: 100 + index * 38.571,
      referenceY: 300,
      meanY: 300,
      slopePxPerPx: 0,
      y0: 180,
      y1: 420,
      widthPx: 3,
      heightPx: 240,
      score: 100
    };
  }),
  count: 8,
  spacingPx: 38.571,
  rmsPx: 0,
  relativeRms: 0,
  slopeSpread: 0,
  warnings: []
};
var indistinguishableCalibration = C.calculateLocalCalibration(
  indistinguishableGeometry,
  { y0: 180, y1: 420 },
  { fringePeriodPx: 38.5 }
);
check('刻线间距与条纹周期相同时拒绝伪标定',
  indistinguishableCalibration.status === 'rejected' &&
  indistinguishableCalibration.warnings.indexOf('reticle-fringe-harmonic') >= 0,
  'status=' + indistinguishableCalibration.status + ' warnings=' +
  JSON.stringify(indistinguishableCalibration.warnings));

check('刻线纵带与条纹纵带错位时拒绝',
  C.calculateLocalCalibration(geometry, { y0: 500, y1: 600 }).status === 'rejected');

var slantedImage = makeReticleImage({
  fringes: true,
  ticks: [120, 220, 320, 420],
  tickSlope: 0.04
});
var slantedGeometry = C.detectReticleGeometry(
  slantedImage.data,
  slantedImage.width,
  slantedImage.height
);
check('刻线倾斜时仍可拟合', slantedGeometry.count >= 3,
  'count=' + slantedGeometry.count);

var slopePointA = {
  x: 120 + 0.04 * (220 - (145 + 430) / 2),
  y: 220
};
var slopePointB = {
  x: 220 + 0.04 * (300 - (145 + 430) / 2),
  y: 300
};
var estimatedSlopeA = typeof C.estimateLineSlopeAt === 'function'
  ? C.estimateLineSlopeAt(
    slantedImage.data,
    slantedImage.width,
    slantedImage.height,
    slopePointA,
    { radius: 18, searchRadius: 8 }
  )
  : null;
var estimatedSlopeB = typeof C.estimateLineSlopeAt === 'function'
  ? C.estimateLineSlopeAt(
    slantedImage.data,
    slantedImage.width,
    slantedImage.height,
    slopePointB,
    { radius: 18, searchRadius: 8 }
  )
  : null;
check('手点邻域可估计刻线斜率', near(estimatedSlopeA, 0.04, 0.01) &&
  near(estimatedSlopeB, 0.04, 0.01),
  'slopeA=' + estimatedSlopeA + ', slopeB=' + estimatedSlopeB);

var estimatedManual = C.applyManualReticle(
  slantedImage.width,
  slantedImage.height,
  slopePointA,
  slopePointB,
  {
    tickSpacingMm: 1,
    slopePxPerPx: (estimatedSlopeA + estimatedSlopeB) / 2,
    fringeBand: { y0: 145, y1: 430 }
  }
);
check('估计斜率把不同高度的两点投影为 100 px 间距',
  near(estimatedManual.tickSpacingPx, 100, 2),
  'spacing=' + estimatedManual.tickSpacingPx);

var noisy = makeReticleImage({ fringes: true, ticks: [] });
var falsePositive = C.detectReticleGeometry(noisy.data, noisy.width, noisy.height);
check('宽干涉条纹不冒充刻线',
  !falsePositive.lines || falsePositive.lines.length < 3,
  JSON.stringify(falsePositive.debug || {}));

var stripeField = makeStripeFieldImage(1080, 1440, 120, 75);
var stripeFalsePositive = C.detectReticleGeometry(
  stripeField.data,
  stripeField.width,
  stripeField.height
);
check('规则暗纹场不冒充等距刻线',
  !stripeFalsePositive.lines || stripeFalsePositive.lines.length < 3,
  JSON.stringify(stripeFalsePositive.debug || {}));

var crossed = makeCrossedReticleImage();
var crossedGeometry = C.detectReticleGeometry(
  crossed.data,
  crossed.width,
  crossed.height
);
check('优先识别与条纹方向交叉的短刻线',
  crossedGeometry.count === 5 && near(crossedGeometry.spacingPx, 100, 2),
  'count=' + crossedGeometry.count + ' spacing=' + crossedGeometry.spacingPx);
var crossedBand = crossedGeometry.lines.length
  ? {
      y0: Math.min.apply(null, crossedGeometry.lines.map(function (line) { return line.y0; })),
      y1: Math.max.apply(null, crossedGeometry.lines.map(function (line) { return line.y1; }))
    }
  : { y0: crossed.baselineY - 34, y1: crossed.baselineY + 34 };
var crossedLocal = C.localScaleAtBand(crossedGeometry, crossedBand);
check('交叉刻线在条纹带内仍给出 100 px',
  near(crossedLocal.tickSpacingPx, 100, 2),
  'spacing=' + crossedLocal.tickSpacingPx);

var separated = makeSeparatedReticleImage();
var separatedGeometry = C.detectReticleGeometry(
  separated.data,
  separated.width,
  separated.height
);
check('上部独立刻线梳优先于左侧干涉暗纹',
  separatedGeometry.count === 4 &&
  near(separatedGeometry.spacingPx, 90, 3),
  'count=' + separatedGeometry.count + ' spacing=' + separatedGeometry.spacingPx +
  ' lines=' + JSON.stringify((separatedGeometry.lines || []).map(function (line) {
    return { x: line.measuredX, y0: line.y0, y1: line.y1 };
  })) + ' candidates=' + JSON.stringify(separatedGeometry.debug || {}));
check('独立刻线梳拒绝 55/67 px 伪序列',
  !near(separatedGeometry.spacingPx, 55, 3) &&
  !near(separatedGeometry.spacingPx, 67, 3),
  'spacing=' + separatedGeometry.spacingPx);
check('同帧刻线与条纹纵带分离时仍按统一高度投影',
  C.calculateLocalCalibration(
    separatedGeometry,
    { y0: 300, y1: 360 }
  ).status === 'autoAccepted',
  'status=' + C.calculateLocalCalibration(
    separatedGeometry,
    { y0: 300, y1: 360 }
  ).status);

var crossingTrap = makeCrossingTrapWithSeparatedReticle();
var crossingTrapGeometry = C.detectReticleGeometry(
  crossingTrap.data,
  crossingTrap.width,
  crossingTrap.height
);
check('强透视伪交叉刻线不得压过真实分离刻线',
  crossingTrapGeometry.count === 4 &&
  near(crossingTrapGeometry.spacingPx, 90, 3),
  'count=' + crossingTrapGeometry.count +
  ' spacing=' + crossingTrapGeometry.spacingPx +
  ' slopeSpread=' + crossingTrapGeometry.slopeSpread);

var falseCrossedGeometry = {
  count: 3,
  spacingPx: 57,
  relativeRms: 0.005,
  slopeSpread: 0.186,
  warnings: ['strong-perspective']
};
var reliableSeparatedGeometry = {
  count: 4,
  spacingPx: 90,
  relativeRms: 0.003,
  slopeSpread: 0,
  warnings: []
};
var selectedGeometry = typeof C.chooseReticleGeometry === 'function'
  ? C.chooseReticleGeometry(falseCrossedGeometry, reliableSeparatedGeometry)
  : falseCrossedGeometry;
check('几何选择优先采用可靠的分离刻线梳',
  selectedGeometry === reliableSeparatedGeometry,
  'selected=' + (selectedGeometry && selectedGeometry.count) +
  ' lines / slopeSpread=' + (selectedGeometry && selectedGeometry.slopeSpread));

var threeSeparated = makeSeparatedReticleImage({ ticks: [575, 665, 755] });
var threeSeparatedGeometry = C.detectReticleGeometry(
  threeSeparated.data,
  threeSeparated.width,
  threeSeparated.height
);
check('三条可靠独立刻线只进入待确认',
  threeSeparatedGeometry.count === 3 &&
  near(threeSeparatedGeometry.spacingPx, 90, 3) &&
  C.calculateLocalCalibration(
    threeSeparatedGeometry,
    { y0: 100, y1: 180 }
  ).status === 'pending',
  'count=' + threeSeparatedGeometry.count +
  ' spacing=' + threeSeparatedGeometry.spacingPx);

var manual = C.applyManualReticle(
  image.width,
  image.height,
  { x: 100, y: 200 },
  { x: 306, y: 260 },
  {
    tickSpacingMm: 1,
    slopePxPerPx: 0.1,
    fringeBand: { y0: 145, y1: 430 }
  }
);
check('手点按统一高度计算刻线间距', near(manual.tickSpacingPx, 200, 0.01),
  'got=' + manual.tickSpacingPx);
check('人工两点标定状态为 manualAccepted',
  manual.status === 'manualAccepted' && manual.source === 'manual');

var attached = C.attachLocalCalibration(
  { deltaXPx: 100, stripeCount: 10 },
  manual
);
check('人工标定自动填入毫米值', near(attached.deltaXmm, 0.5, 1e-9),
  'deltaXmm=' + attached.deltaXmm);

var summary = C.summarizeLocalCalibrations([
  attached,
  { role: 'sodium', deltaXPx: 100, deltaXmm: null, calibrationStatus: 'pending' },
  { role: 'sodium', deltaXPx: 100, deltaXmm: 0.5, calibrationStatus: 'legacyGlobalK' }
]);
check('正式统计只接受人工/自动确认帧',
  summary.n === 1 && summary.manualAccepted === 1 && summary.pending === 1 &&
  summary.legacyGlobalK === 1,
  JSON.stringify(summary));

console.log('\n' + (bad === 0 ? '同框逐帧标定检查通过' : bad + ' 项未通过') +
  '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
