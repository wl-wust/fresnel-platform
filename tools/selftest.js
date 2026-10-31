// tools/selftest.js —— 数值内核口径自检（19 项 = 13 旧 + 1 冻结守卫 + 5 表8.1折叠）
// 放置位置：<仓库>/tools/selftest.js；同目录需有 physics.snapshot.js；依赖 ../js/physics.js
// 运行：node tools/selftest.js   期望：19 pass / 0 fail
const P = require('../js/physics.js');

function synth(n, periodPx, vis, noise, seed) {
  let s = seed || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; };
  const y = [];
  for (let i = 0; i < n; i++) {
    const env = Math.exp(-Math.pow((i - n / 2) / (n / 3), 2));      // 高斯包络，模拟有限视场
    y.push(1 + vis * env * Math.cos(2 * Math.PI * i / periodPx + 0.7) + noise * rnd());
  }
  return y;
}

let ok = 0, bad = 0;
function near(name, got, want, tol) {
  const good = Math.abs(got - want) <= tol;
  console.log((good ? 'PASS ' : 'FAIL ') + name + '  got=' + got.toPrecision(6) + '  want=' + want + ' ±' + tol);
  good ? ok++ : bad++;
}

// 1. 条纹周期提取
for (const [n, period, vis, noise] of [[2000, 163.3, 0.6, 0.02], [1200, 74.6, 0.35, 0.05], [4000, 320.0, 0.5, 0.03]]) {
  const r = P.fringePeriod(synth(n, period, vis, noise), { k: 0.004 });
  near('period n=' + n, r.periodPx, period, 0.05);
  near('crossing check n=' + n, r.periodPxCross, period, 0.6);
  console.log('      V=' + (r.visibility * 100).toFixed(1) + '%  Δx=' + r.deltaXmm.toFixed(4) +
              ' mm  (cross=' + r.periodPxCross.toFixed(2) + ')');
}

// 2. 基本公式法（报告表 5.1 参数）
const b = P.wavelengthBasic({ d: 0.90213, D: 1000, dxPx: 163.3, k: 0.004, ud: 0.0009, uD: 0.5, uk: 0.000004 });
near('basic λ', b.value, 589.2, 1.0);
console.log('      relU=' + (b.relU * 100).toFixed(3) + '%');

// 3. 比值法（含色散修正）
const ratioNoFix = 650 * (163.3 / 180.9);
const r = P.wavelengthRatio({ dxNaPx: 163.3, dxRefPx: 180.9, lamRef: 650 });
near('ratio λ (with dispersion)', r.value, 589.3, 1.0);
console.log('      dispersion=' + r.dispersion.toFixed(5) +
            '  without fix=' + ratioNoFix.toFixed(1) + ' nm  (差 ' +
            ((ratioNoFix - r.value) / r.value * 100).toFixed(2) + '%)');

// 4. 放大率法：d′=4.4·d, β=4.4, Δx=k·163.3, Δx′ = Δx·4.4
const mag = P.wavelengthMagnification({
  dPrime: 4.4 * 0.90213, beta: 4.4, dxNaMm: 0.65332, D: 1000, dxPrimeMm: 0.65332 * 4.4
});
near('mag λ', mag.value, 589.3, 1.0);

// 5. 加权合成 + χ²
const comb = P.weightedCombine([
  { name: '比值法', value: 589.33, uncertainty: 0.61 },
  { name: '放大率法', value: 589.28, uncertainty: 0.84 },
  { name: '追迹法', value: 589.30, uncertainty: 0.78 }
], { standard: 589.3, commonRelU: 0.0000064 });
near('comb mean', comb.mean, 589.31, 0.02);
near('comb u', comb.uCombined, 0.42, 0.02);
console.log('      χ²=' + comb.chi2.toFixed(4) + '  ν=' + comb.dof +
            '  χ²95=' + comb.chi2Crit + '  一致=' + comb.consistent +
            '  bias=' + comb.bias.toFixed(3) + ' nm (' + (comb.relBias * 100).toFixed(3) + '%)');

// 6. A 类不确定度
const ta = P.typeA([589.1, 589.3, 589.2, 589.4, 589.2]);
near('typeA mean', ta.mean, 589.24, 0.01);
console.log('      sd=' + ta.sd.toFixed(3) + ' nm  uA=' + ta.uA.toFixed(3) +
            ' nm  relUA=' + (ta.relUA * 100).toFixed(4) + '%');

// 7. 像素当量
near('pixelScale', P.pixelScale({ L: 5, N: 1250 }).k, 0.004, 1e-9);

// 9. 冻结守卫：追加前的冻结段必须逐字节未变
const fs = require('fs'), path = require('path');
const cur = fs.readFileSync(path.join(__dirname, '../js/physics.js'), 'utf8');
const snap = fs.readFileSync(path.join(__dirname, 'physics.snapshot.js'), 'utf8');
const anchor = '  var API = {';
const head = snap.slice(0, snap.indexOf(anchor));
const okFrozen = cur.startsWith(head);
console.log((okFrozen ? 'PASS ' : 'FAIL ') + 'frozen section untouched');
okFrozen ? ok++ : bad++;

// 10. 表8.1 → 三路径折叠（口径金标准）
const comps = {}; P.budgetPreset().forEach(p => comps[p.key] = p.relU);
near('foldD u(d)/d',       P.foldD(comps), 0.0011992, 3e-6);
near('budget basic relU',  P.uncertaintyBudget({ path: 'basic', comps }).relU, 0.0012993, 3e-6);
near('budget trace relU',  P.uncertaintyBudget({ path: 'trace', comps }).relU, 0.0012993, 3e-6);
near('budget ratio relU',  P.uncertaintyBudget({ path: 'ratio', comps }).relU, 0.0009728, 3e-6);
near('budget mag relU',    P.uncertaintyBudget({ path: 'mag',   comps }).relU, 0.0013929, 3e-6);

console.log('\n' + (bad === 0 ? '全部通过' : bad + ' 项未通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
