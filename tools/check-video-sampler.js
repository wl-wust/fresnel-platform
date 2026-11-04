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
  deltaXPx: 163.3 + (i % 2 ? 0.1 : -0.1)
}));
assert.strictEqual(S.summary(stable).n, 20, '应统计全部有效候选');
assert.strictEqual(S.summary(stable).cv <= 0.005, true, '示例数据应满足稳定度');
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

console.log('视频抽帧评分检查通过（17 项）');
