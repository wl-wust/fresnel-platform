'use strict';

const assert = require('assert');
const physics = require('../js/physics.js');
const S = require('../js/core/sessions.js');
const D = require('../js/core/session-data.js');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    pass += 1;
    console.log('PASS  ' + name + (detail ? '  ' + detail : ''));
  } catch (e) {
    fail += 1;
    console.log('FAIL  ' + name + '  ' + e.message);
  }
}

async function createWithFrames(method, frames, extra) {
  const session = S.createSession(Object.assign({ method }, extra || {}));
  for (const frame of frames) await S.addFrame(session.id, frame);
  return S.getSession(session.id);
}

function accepted(frame, kMmPx) {
  const k = kMmPx || 0.004;
  return Object.assign({
    calibrationStatus: 'autoAccepted',
    localCalibration: {
      schema: 'bp.frame-calibration/1',
      status: 'autoAccepted',
      tkSpacingMm: 1,
      tickSpacingMm: 1,
      tickSpacingPx: 1 / k,
      kMmPx: k,
      lineCount: 4,
      relativeRms: 0.003
    }
  }, frame);
}

(async () => {
  global.BP = global.BP || {};
  global.BP.physics = physics;

  await check('基本公式法构建多帧波长与来源', async () => {
    const session = await createWithFrames('basic', [
      accepted({ role: 'sodium', deltaXPx: 163.0, deltaXmm: 0.652 }, 0.004),
      accepted({ role: 'sodium', deltaXPx: 163.6, deltaXmm: 0.6544 }, 0.004)
    ], {
      calibration: {
        k_mm_px: 0.004,
        source: '自动刻线标定',
        L_source: '报告预设，待核实'
      },
      params: { d: 0.90213, D: 1000 },
      paramsSources: { d: '报告预设', D: '报告预设' }
    });
    const out = D.build(session);
    assert.strictEqual(out.method, 'basic');
    assert(Math.abs(out.values.dxNaPx - 163.3) < 1e-9);
    assert(Math.abs(out.values.k - 0.004) < 1e-12);
    assert(Math.abs(out.values.lambdaNm - 589.2713) < 0.01);
    assert.strictEqual(out.stats.lambda.n, 2);
    assert(out.stats.lambda.sdNm > 0);
    assert.strictEqual(out.sources.dxNaPx, '自动识别');
    assert.strictEqual(out.sources.k, '来自标定');
    assert(/逐帧同框刻线/.test(out.sourceDetails.k));
    assert.strictEqual(out.sources.d, '报告预设');
    assert.strictEqual(out.complete, true);
  });

  await check('比值法缺参考条纹时明确标记缺失', async () => {
    const session = await createWithFrames('ratio', [
      accepted({ role: 'sodium', deltaXPx: 163.3, deltaXmm: 0.6532 })
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { lambdaStandardNm: 589.3, nStandard: 1.5168, nTarget: 1.5145 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.dxNaPx, 163.3);
    assert.strictEqual(out.values.dxRefPx, null);
    assert.strictEqual(out.values.lambdaStandardNm, 589.3);
    assert.strictEqual(out.stats.reference.label, '红光待测条纹');
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'dxRefMm'));
  });

  await check('放大率法用毫米帧值且不伪造 d′/β', async () => {
    const session = await createWithFrames('magnification', [
      accepted({ role: 'no_lens', deltaXPx: 163.33, deltaXmm: 0.65332 }),
      accepted({ role: 'with_lens', deltaXPx: 718.65, deltaXmm: 2.8746 })
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { D: 1000 }
    });
    const out = D.build(session);
    assert(Math.abs(out.values.dxNaMm - 0.65332) < 1e-12);
    assert(Math.abs(out.values.dxPrimeMm - 2.8746) < 1e-12);
    assert.strictEqual(out.values.dPrime, null);
    assert.strictEqual(out.values.beta, null);
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'dPrime'));
    assert(out.missing.some(item => item.key === 'beta'));
  });

  await check('追迹法继承追迹 d 与标定 k', async () => {
    const session = await createWithFrames('trace', [
      accepted({ role: 'sodium', deltaXPx: 163.3, deltaXmm: 0.6532 })
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { D: 1000 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.d, S.TRACE_PRESET.d_mm);
    assert.strictEqual(out.sources.d, '追迹预设');
    assert(Math.abs(out.values.k - 0.004) < 1e-12);
    assert.strictEqual(out.complete, true);
  });

  await check('没有会话参数时不使用报告默认值冒充数据', async () => {
    const session = await createWithFrames('basic', [
      accepted({ role: 'sodium', deltaXPx: 163.3, deltaXmm: 0.6532 })
    ], {
      calibration: { k_mm_px: 0.004 }
    });
    const out = D.build(session);
    assert.strictEqual(out.values.d, null);
    assert.strictEqual(out.values.D, null);
    assert.strictEqual(out.complete, false);
    assert(out.missing.some(item => item.key === 'd'));
    assert(out.missing.some(item => item.key === 'D'));
  });

  await check('会话保留 d/D 的参数来源标记', async () => {
    const session = await createWithFrames('basic', [
      accepted({ role: 'sodium', deltaXPx: 163.3, deltaXmm: 0.6532 })
    ], {
      calibration: { k_mm_px: 0.004 },
      params: { d: 0.90213, D: 1000 },
      paramsSources: { d: '报告预设', D: '手动输入' }
    });
    const out = D.build(session);
    assert.strictEqual(out.sources.d, '报告预设');
    assert.strictEqual(out.sources.D, '手动输入');
  });

  await check('不同帧 k_i 直接使用各自毫米值，不按全局 k 回填', async () => {
    const session = await createWithFrames('basic', [
      accepted({ role: 'sodium', deltaXPx: 100, deltaXmm: 0.5 }, 0.005),
      accepted({ role: 'sodium', deltaXPx: 100, deltaXmm: 0.4 }, 0.004)
    ], {
      calibration: { k_mm_px: 0.001 },
      params: { d: 1, D: 1000 },
      paramsSources: { d: '手动输入', D: '手动输入' }
    });
    const out = D.build(session);
    assert(Math.abs(out.values.dxNaMm - 0.45) < 1e-12);
    assert(Math.abs(out.values.dxNaPx - 100) < 1e-12);
    assert(Math.abs(out.values.k - 0.0045) < 1e-12);
    assert(Math.abs(out.values.lambdaNm - 450) < 1e-9);
    assert(/逐帧同框标定/.test(out.sourceDetails.dxNaMm));
    return 'mm=' + out.values.dxNaMm + ' / k均值=' + out.values.k;
  });

  await check('待定、拒绝和旧全局 k 不参与方法计算', async () => {
    const session = await createWithFrames('basic', [
      accepted({ role: 'sodium', deltaXPx: 100, deltaXmm: 0.4 }, 0.004),
      { role: 'sodium', deltaXPx: 200, deltaXmm: 0.8, calibrationStatus: 'pending' },
      { role: 'sodium', deltaXPx: 300, deltaXmm: 1.2, calibrationStatus: 'rejected' },
      { role: 'sodium', deltaXPx: 400, deltaXmm: 1.6 }
    ], {
      params: { d: 1, D: 1000 },
      paramsSources: { d: '手动输入', D: '手动输入' }
    });
    const out = D.build(session);
    assert.strictEqual(out.stats.sodium.n, 1);
    assert.strictEqual(out.stats.sodium.pending, 1);
    assert.strictEqual(out.stats.sodium.rejected, 1);
    assert.strictEqual(out.stats.sodium.legacyGlobalK, 1);
    assert.strictEqual(out.stats.sodium.nPx, 4);
    assert.strictEqual(out.stats.sodium.nEvidence, 4);
    assert.strictEqual(out.stats.sodium.meanPx, 250);
    assert(Math.abs(out.values.dxNaMm - 0.4) < 1e-12);
    assert.strictEqual(out.values.dxNaPx, 250);
    assert(Math.abs(out.values.lambdaNm - 400) < 1e-9);
    return '1 个正式帧 / 4 个像素证据帧';
  });

  await check('比值法按钠光标准与红光待测同帧毫米均值计算', async () => {
    const session = await createWithFrames('ratio', [
      accepted({ role: 'sodium', deltaXPx: 100, deltaXmm: 0.50 }, 0.005),
      accepted({ role: 'sodium', deltaXPx: 125, deltaXmm: 0.50 }, 0.004),
      accepted({ role: 'reference', deltaXPx: 100, deltaXmm: 0.70 }, 0.007)
    ], {
      calibration: { k_mm_px: 0.001 },
      params: { lambdaStandardNm: 589.3, nStandard: 1.5168, nTarget: 1.5145 },
      paramsSources: {
        lambdaStandardNm: '标准值（报告预设，非实测）',
        nStandard: 'N-BK7 折射率报告预设，非实测',
        nTarget: 'N-BK7 折射率报告预设，非实测'
      }
    });
    const out = D.build(session);
    const expected = 589.3 * (0.70 / 0.50) * ((1.5145 - 1) / (1.5168 - 1));
    assert(Math.abs(out.values.dxNaMm - 0.50) < 1e-12);
    assert(Math.abs(out.values.dxRefMm - 0.70) < 1e-12);
    assert(Math.abs(out.values.lambdaNm - expected) < 1e-9);
    assert.strictEqual(out.stats.reference.label, '红光待测条纹');
    assert(/红光待测条纹/.test(out.sourceDetails.dxRefMm));
    assert(/报告预设/.test(out.sources.lambdaStandardNm));
    assert.strictEqual(out.complete, true);
    return out.values.lambdaNm.toFixed(3) + ' nm';
  });

  console.log(pass + ' pass / ' + fail + ' fail');
  if (fail) process.exit(1);
})();
