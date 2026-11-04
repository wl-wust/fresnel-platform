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

console.log('视频抽帧评分检查通过（10 项）');
