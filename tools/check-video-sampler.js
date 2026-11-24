/* 视频抽帧评分与候选选择门禁 */
const assert = require('assert');

let S;
try {
  S = require('../js/core/video-sampler.js');
} catch (error) {
  console.error('无法加载 js/core/video-sampler.js：' + error.message);
  process.exit(1);
}

const good = {
  timeMs: 1000,
  deltaXPx: 163.3,
  visibility: 0.20,
  spectralSnr: 12,
  acfPeak: 0.6,
  crossDiff: 0.005,
  saturationRatio: 0.001
};

assert.strictEqual(S.isValid(good), true, '合格帧应通过门限');
assert.strictEqual(S.isValid({ ...good, visibility: 0.01 }), false, '低可见度帧应被拒绝');
assert.strictEqual(S.isValid({ ...good, saturationRatio: 0.03 }), false, '过曝帧应被拒绝');
assert(S.score(good) > S.score({ ...good, visibility: 0.05 }), '可见度越高分数应越高');
assert(S.score(good) > S.score({ ...good, crossDiff: 0.015 }), '周期一致性越差分数应越低');

const picked = S.selectCandidates([
  good,
  { ...good, timeMs: 1100, deltaXPx: 163.4 },
  { ...good, timeMs: 1600, deltaXPx: 163.6, visibility: 0.12 }
], { minGapMs: 500, maxCandidates: 10 });
assert.strictEqual(picked.length, 2, '相邻时间候选应去重');
assert(picked[0].score >= picked[1].score, '候选池排序应稳定');

const stable = Array.from({ length: 20 }, (_, i) => ({
  ...good,
  timeMs: i * 500,
  stripeCount: 12 + (i % 2),
  deltaXPx: 163.3 + (i % 2 ? 0.1 : -0.1)
}));
assert.strictEqual(S.summary(stable).n, 20, '应统计全部有效候选');
assert.strictEqual(S.summary(stable).meanStripeCount, 12.5, '应统计平均可见条纹数');
assert.strictEqual(S.summary(stable).cv <= 0.005, true, '示例数据应满足稳定度');

const calibrationPriority = S.selectCandidates([
  { ...good, timeMs: 0, score: 0.99, calibrationStatus: 'rejected' },
  { ...good, timeMs: 600, score: 0.60, calibrationStatus: 'autoAccepted' },
  { ...good, timeMs: 1200, score: 0.90, calibrationStatus: 'pending' }
], { minGapMs: 500, maxCandidates: 3 });
assert.deepStrictEqual(
  calibrationPriority.map(item => item.calibrationStatus),
  ['autoAccepted', 'pending', 'rejected'],
  '质量门限通过后应优先保留同帧标定证据，不能降低单帧质量门禁'
);

/* 真实视频中常有少量高分行伴随周期漂移。
 * 选择器应优先取主周期附近的稳定簇，而不是让这些高分行挤掉多数稳定帧。
 */
const driftOutliers = Array.from({ length: 8 }, (_, i) => ({
  ...good,
  timeMs: i * 600,
  deltaXPx: 108 + (i % 2 ? 0.3 : -0.3),
  score: 0.99,
  calibrationStatus: 'autoAccepted'
}));
const stablePeriodCluster = Array.from({ length: 20 }, (_, i) => ({
  ...good,
  timeMs: 6000 + i * 600,
  deltaXPx: 100 + (i % 2 ? 0.04 : -0.04),
  score: 0.70,
  calibrationStatus: 'rejected'
}));
const clusterPicked = S.selectCandidates(
  driftOutliers.concat(stablePeriodCluster),
  { minGapMs: 500, maxCandidates: 20 }
);
assert.strictEqual(clusterPicked.length, 20, '稳定周期簇足够时应选满目标帧数');
assert.strictEqual(
  clusterPicked.every(item => Math.abs(item.deltaXPx - 100) <= 0.05),
  true,
  '周期明显偏离的高分帧不得挤占稳定周期簇'
);
assert.strictEqual(
  S.summary(clusterPicked).cv <= S.DEFAULTS.maxCv,
  true,
  '稳定周期簇应满足现有波动门限'
);

const edgeHighScore = Array.from({ length: 20 }, (_, i) => ({
  ...good,
  timeMs: i * 600,
  deltaXPx: 100 + (i % 2 ? 0.8 : -0.8),
  score: 0.99,
  calibrationStatus: 'autoAccepted'
}));
const centerLowScore = Array.from({ length: 20 }, (_, i) => ({
  ...good,
  timeMs: 8000 + i * 600,
  deltaXPx: 100 + (i % 2 ? 0.02 : -0.02),
  score: 0.60,
  calibrationStatus: 'rejected'
}));
const centerPicked = S.selectCandidates(
  edgeHighScore.concat(centerLowScore),
  { minGapMs: 500, maxCandidates: 20 }
);
assert.strictEqual(
  centerPicked.every(item => Math.abs(item.deltaXPx - 100) <= 0.03),
  true,
  '簇内帧数超过目标时应优先保留距主周期中心最近的帧'
);
assert.strictEqual(
  S.summary(centerPicked).cv <= S.DEFAULTS.maxCv,
  true,
  '簇内第二轮选择也必须满足现有波动门限'
);

assert.strictEqual(
  S.isEnough(
    driftOutliers.concat(stablePeriodCluster.slice(0, 5)),
    20
  ),
  false,
  '稳定周期簇不足时必须继续明确拒绝，不能用离群帧凑数'
);

assert.strictEqual(S.isEnough(stable, 20), true, '20 个稳定候选应判定为足够');
assert.strictEqual(S.isEnough(stable.slice(0, 19), 20), false, '不足目标数时不应提示足够');
assert.strictEqual(
  S.isEnough(stable.map((x, i) => ({ ...x, deltaXPx: 150 + i * 2 })), 20),
  false,
  '主频波动过大时不应提示足够'
);

assert.strictEqual(
  S.recordingFilename('session-a', 'ratio', 'sodium').startsWith('session-a-ratio-sodium-'),
  true,
  '录制文件名应包含会话、方法与角色'
);
assert(/\.webm$/.test(S.recordingFilename('session-a', 'ratio', 'sodium')), '原始视频应保存为 WebM');
assert.strictEqual(
  S.pickMimeType([
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8'
  ], {
    isTypeSupported: function (type) { return type.indexOf('vp9') >= 0; }
  }),
  'video/webm;codecs=vp9',
  '应选择浏览器支持的首个编码'
);

const samplePlan = S.sampleTimes(10, 0.5);
assert.strictEqual(samplePlan.length, 20, '10 秒视频应按 0.5 秒生成 20 个采样点');
assert.strictEqual(samplePlan[0], 0, '采样应从视频开头开始');
assert.strictEqual(samplePlan[samplePlan.length - 1], 9.5, '采样点不应越过视频结尾');
assert.strictEqual(S.sampleTimes(2, 0.5).length, 4, '短片段也应按固定间隔采样');
assert.strictEqual(S.adaptiveGap(8.692), 0.2, '8.7 秒短片应采用 0.2 秒覆盖采样');
assert.strictEqual(S.adaptiveGap(44.159), 0.5, '44 秒视频应保持 0.5 秒采样');
assert.strictEqual(S.adaptiveGap(600), 1, '十分钟视频应采用 1 秒采样以限制解码次数');
assert.strictEqual(S.recommendedTarget(8.692, 20), 5, '短片应显式切换为 5 帧参考目标');
assert.strictEqual(S.recommendedTarget(44.159, 20), 20, '长视频应保留用户目标帧数');
assert.strictEqual(S.recommendedTarget(8.692, 5), 5, '用户已选 5 帧时不应改变');
assert.strictEqual(
  typeof S.planImportTargets,
  'function',
  '应提供短片自动目标后的下一次导入恢复策略'
);
assert.deepStrictEqual(
  S.planImportTargets(44.159, 5, 20),
  { requestedTarget: 20, effectiveTarget: 20, autoAdjusted: false, restored: true },
  '短片自动切到 5 帧后，下一段长视频应恢复上次显式目标'
);
assert.deepStrictEqual(
  S.planImportTargets(44.159, 5, 5),
  { requestedTarget: 5, effectiveTarget: 5, autoAdjusted: false, restored: false },
  '用户手动选择 5 帧后，长视频应尊重用户选择'
);

console.log('视频抽帧评分检查通过（30 项）');
