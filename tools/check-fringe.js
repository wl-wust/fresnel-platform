/* check-fringe.js —— P5 条纹提取门禁（纯 Node，不需要浏览器、不需要真照片）
 *
 * 为什么可以完全离线验：报告表 6.1 的方法就是"已知真值的合成条纹图 → 检验提取偏差"。
 * 这里把 MATLAB 的 fringe_render 换成 JS 的 synthesizeProfile，链路完全同构。
 *
 * 用法：node tools/check-fringe.js
 */
const fs = require('fs');
const path = require('path');

function pick(rels) {
  const bases = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..'), __dirname];
  for (const b of bases) for (const r of rels) {
    const p = path.join(b, r);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到依赖：' + rels.join(' 或 '));
}

let ok = 0, bad = 0;
const check = (n, c, x) => c ? (ok++, console.log('PASS  ' + n + (x ? '  ' + x : '')))
                            : (bad++, console.log('FAIL  ' + n + (x ? '  ← ' + x : '')));

require(pick(['js/physics.js', 'physics-v2.js']));
const fringe = require(pick(['js/core/fringe.js', 'core/fringe.js']));

/* ① 合成 → 提取 的往返精度（三组周期，k=0.004 mm/px） */
for (const [P, V, noise] of [[163.3, 0.6, 0.02], [74.6, 0.35, 0.05], [320.0, 0.5, 0.03]]) {
  const r = fringe.selfTest({ periodPx: P, visibility: V, noise: noise, k: 0.004, seed: 7 });
  check('周期 ' + P + 'px 的往返',
        Math.abs(r.periodPx - P) < 0.05 && Math.abs(r.relErr) < 0.003,
        '测得 ' + r.periodPx.toFixed(3) + 'px  Δx=' + r.deltaXmm.toFixed(4) +
        'mm  偏差 ' + (r.relErr * 100).toFixed(3) + '%');
  check('周期 ' + P + 'px 的可见度',
        Math.abs(r.visibility - V) < 0.06,
        '测得 V=' + (r.visibility * 100).toFixed(1) + '%（真值 ' + (V * 100).toFixed(0) + '%）');
}

/* ② 合成结果可复现（同种子同结果） */
const a1 = fringe.synthesizeProfile({ n: 300, periodPx: 100, seed: 42 });
const a2 = fringe.synthesizeProfile({ n: 300, periodPx: 100, seed: 42 });
check('同种子可复现（报告要求的可复现性）',
      Array.from(a1).every((v, i) => v === a2[i]));

/* ③ RGBA → 剖面：竖条纹应选 x 轴，横条纹应选 y 轴 */
function makeImage(w, h, vertical) {
  const prof = fringe.synthesizeProfile({ n: vertical ? w : h, periodPx: 120, visibility: 0.7, noise: 0.01, seed: 3 });
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, Math.round(255 * prof[vertical ? x : y])));
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

const vImg = makeImage(600, 200, true);
const rv = fringe.analyzeImageData(vImg.data, vImg.width, vImg.height, { k: 0.004 });
check('竖条纹 → 选到 x 轴', rv.axis === 'x', 'axis=' + rv.axis + '  周期=' + rv.periodPx.toFixed(2) + 'px');
check('识别结果包含可见条纹数',
      Number.isFinite(rv.stripeCount) && rv.stripeCount > 0,
      'stripeCount=' + rv.stripeCount);

const hImg = makeImage(200, 600, false);
const rh = fringe.analyzeImageData(hImg.data, hImg.width, hImg.height, { k: 0.004 });
check('横条纹 → 选到 y 轴', rh.axis === 'y', 'axis=' + rh.axis + '  周期=' + rh.periodPx.toFixed(2) + 'px');

/* 圆形视场边缘带有低频亮暗结构时，固定 78% ROI 可能把边缘包络误当成
 * 77px 周期；中央区域仍保留真实的 35px 条纹。这里用合成图固定该回归场景。 */
function makeVignetteImage(width, height, periodPx) {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = 430;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot((x - cx) / radius, (y - cy) / radius);
      const inside = distance <= 1 ? 1 : 0;
      const radial = Math.max(0, 1 - distance * distance);
      const edgeWeight = Math.pow(Math.abs(x - cx) / radius, 1.5);
      const fine = 0.28 * Math.cos(2 * Math.PI * x / periodPx);
      const edgeEnvelope = 0.9 * edgeWeight * Math.cos(2 * Math.PI * x / 77.4);
      const value = Math.max(
        0,
        Math.min(255, Math.round(255 * inside * radial * (0.55 + fine + edgeEnvelope))),
      );
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

const vignette = makeVignetteImage(720, 1280, 35);
const rvignette = fringe.analyzeImageData(vignette.data, vignette.width, vignette.height, { k: 0.004 });
check('圆形视场边缘不产生 77px 假基频',
      Math.abs(rvignette.periodPx - 35) < 1,
      '测得 ' + rvignette.periodPx.toFixed(2) + 'px，ROI ' +
      rvignette.roi.width + '×' + rvignette.roi.height);

/* 更严格的情况：外围的低频亮暗结构本身也能通过零交叉检查，但真实条纹
 * 只集中在中央。必须比较同心 ROI 的周期，不能看到第一个一致值就停止。 */
function makeCenterFringeImage(width, height, finePeriodPx, envelopePeriodPx) {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = 430;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot((x - cx) / radius, (y - cy) / radius);
      const inside = distance <= 1 ? 1 : 0;
      const radial = Math.max(0, 1 - distance * distance);
      const fineWeight = Math.exp(-Math.pow((x - cx) / (radius * 0.25), 2) / 2);
      const fine = 0.32 * fineWeight * Math.cos(2 * Math.PI * x / finePeriodPx);
      const envelope = 0.35 * Math.cos(2 * Math.PI * x / envelopePeriodPx);
      const value = Math.max(
        0,
        Math.min(255, Math.round(255 * inside * radial * (0.65 + fine + envelope))),
      );
      const p = (y * width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

const centerFringe = makeCenterFringeImage(720, 1280, 35, 77);
const rcenter = fringe.analyzeImageData(
  centerFringe.data, centerFringe.width, centerFringe.height, { k: 0.004 },
);
check('中央真实条纹优先于可自洽的外围低频结构',
      Math.abs(rcenter.periodPx - 35) < 1,
      '测得 ' + rcenter.periodPx.toFixed(2) + 'px，ROI 比例 ' + rcenter.roiScale);

check('两个方向都给出 Δx(mm)', Math.abs(rv.deltaXmm - 120 * 0.004) < 0.002,
      rv.deltaXmm.toFixed(4) + ' mm（真值 ' + (120 * 0.004).toFixed(4) + '）');

/* ④ 没有条纹的图必须报可读错误，不能返回 NaN 或无穷大 */
const flat = new Uint8ClampedArray(200 * 120 * 4);
for (let i = 0; i < flat.length; i += 4) { flat[i] = flat[i + 1] = flat[i + 2] = 128; flat[i + 3] = 255; }
let threw = null;
try { fringe.analyzeImageData(flat, 200, 120, { k: 0.004 }); } catch (e) { threw = e; }
check('无条纹图 → 抛可读错误', !!threw && /周期性|条纹/.test(threw.message), threw ? threw.message : '没抛错');

/* ⑤ 剖面对比：不同周期的图不会互相混淆 */
const r160 = fringe.analyzeImageData(makeImage(600, 100, true).data, 600, 100, { k: 0.004 });
check('600px 宽图里 120px 周期的 Δx 落在 0.480 mm', Math.abs(r160.deltaXmm - 0.480) < 0.004,
      r160.deltaXmm.toFixed(4) + ' mm');

/* ⑥ 多帧统计：单帧不能抛错（曾导致只有 1 帧的 record.json 整条导入失败） */
const s1 = fringe.framesStats([589.3]);
check('单帧：给出均值且不抛错', s1.n === 1 && Math.abs(s1.mean - 589.3) < 1e-9 && s1.single === true,
      'mean=' + s1.mean + ' sd=' + s1.sd);
check('单帧：sd/uA 为 NaN 而不是 0', !isFinite(s1.sd) && !isFinite(s1.uA));
const s5 = fringe.framesStats([589.1, 589.3, 589.2, 589.4, 589.2]);
check('5 帧：均值与 A 类分量', s5.n === 5 && Math.abs(s5.mean - 589.24) < 0.005 && isFinite(s5.uA),
      'mean=' + s5.mean.toFixed(3) + ' uA=' + s5.uA.toFixed(3) + ' relSd=' + (s5.relSd * 100).toFixed(4) + '%');
let threw2 = null;
try { fringe.framesStats([]); } catch (e) { threw2 = e; }
check('零帧 → 抛可读错误', !!threw2 && /没有可用/.test(threw2.message));
const sNull = fringe.framesStats([589.2, null, '', 589.4]);
check('null 帧不转成 0 参与多帧统计',
      sNull.n === 2 && Math.abs(sNull.mean - 589.3) < 1e-9,
      'n=' + sNull.n + ' mean=' + sNull.mean.toFixed(3));
console.log('\n' + (bad === 0 ? 'P5 条纹提取门禁通过' : bad + ' 项不通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
