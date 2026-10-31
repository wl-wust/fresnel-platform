/* check-optical-numbers.js —— P3a 的数值门禁（不需要浏览器）
 *
 * 覆盖三件事：
 *   ① d 与 Δx 必须落在报告表 5.1 的量级（0.9020 mm / 0.6532 mm），不再是 ×500 倍的错数
 *   ② 改 z₁ 条纹确实变密/变疏（报告 P3 验收项）
 *   ③ 可见度落在合理区间（不是恒等于 ≈100% 的假值）
 *
 * 用法：node tools/check-optical-numbers.js
 */
const path = require('path');

let ok = 0, bad = 0;
function check(name, cond, extra) {
  if (cond) { ok++; console.log('PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { bad++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

// 设计侧（plat_review/）与部署侧（<仓库>/js/）两种布局都要能跑
// —— 早期版本直接 require('../physics-v2.js')，cp 到 <仓库>/tools/ 后就找不到依赖
const fs = require('fs');
function pick(rels) {
  const bases = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..'), __dirname];
  for (const b of bases) for (const r of rels) {
    const p = path.join(b, r);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到依赖：' + rels.join(' 或 '));
}
require(pick(['js/physics.js', 'physics-v2.js']));
require(pick(['js/core/fmt.js', 'core/fmt.js']));
const fx = require(pick(['js/pages/optical-fix.js', 'pages/optical-fix.js']));

/* ① 默认参数（报告表 5.1） */
const base = { lamNm: 589.3, n: 1.5168, Adeg: 1.0, b: 0.08, z1: 50, z2: 950 };
const r = fx.solve(base);
check('d ≈ 0.9020 mm（表 5.1 傍轴 0.90199）', Math.abs(r.d - 0.9020) <= 0.002, 'd=' + r.d.toFixed(5));
check('Δx ≈ 0.6532 mm（表 5.1 0.6533）', Math.abs(r.dx - 0.6532) <= 0.002, 'Δx=' + r.dx.toFixed(5));
check('D = z₁+z₂ = 1000 mm', Math.abs(r.D - 1000) < 1e-9, 'D=' + r.D);
check('不再有 ×500 倍错数（旧代码给 1361.4 mm）', r.d < 10, 'd=' + r.d.toFixed(4));

/* ② z₁ 变化 ⇒ 条纹疏密单调变化（验收项"改 z₁ 条纹变密/变疏"） */
const a20 = fx.solve({ ...base, z1: 20, z2: 980 });
const a80 = fx.solve({ ...base, z1: 80, z2: 920 });
check('a=20 ⇒ 条纹变疏（Δx 变大）', a20.dx > r.dx, 'Δx=' + a20.dx.toFixed(4));
check('a=80 ⇒ 条纹变密（Δx 变小）', a80.dx < r.dx, 'Δx=' + a80.dx.toFixed(4));
check('d 与 z₁ 成正比', Math.abs(a80.d / a20.d - 4) < 1e-9, (a80.d / a20.d).toFixed(6));

/* ③ 视场自适应 + 边缘可见度（复算与页面完全同一套式子） */
function fringe(p) {
  const q = fx.solve(p);
  const W = 260, xMax = 7 * q.dx, I = [];
  for (let i = 0; i < W; i++) {
    const x = (i / (W - 1)) * 2 * xMax - xMax;
    const u = Math.PI * p.b * x / (q.lamMm * q.D);          // 扩展光源 ⇒ 衰减干涉项对比度
    const V = u === 0 ? 1 : Math.sin(u) / u;
    let val = 0.5 * (1 + V * Math.cos(2 * Math.PI * x / q.dx));
    I.push(val < 0 ? 0 : (val > 1 ? 1 : val));
  }
  const uE = Math.PI * p.b * xMax / (q.lamMm * q.D);
  const vEdge = Math.abs(uE === 0 ? 1 : Math.sin(uE) / uE);
  const pr = globalThis.BP.physics.fringePeriod(I, { k: 2 * xMax / (W - 1) });
  return { I, pr, vEdge, nFringe: 2 * xMax / q.dx, q };
}

const f = fringe(base);
check('视场里约 14 个条纹（7Δx 半宽）', Math.abs(f.nFringe - 14) < 0.5, f.nFringe.toFixed(1) + ' 条');
check('强度全部落在 [0,1]', f.I.every(v => v >= 0 && v <= 1));
check('合成剖面仍是等间距条纹（fringePeriod 能解出 Δx）',
      Math.abs(f.pr.deltaXmm - r.dx) / r.dx < 0.02,
      f.pr.deltaXmm.toFixed(4) + ' vs ' + r.dx.toFixed(4));
check('默认 b=0.08 的边缘可见度在合理区间',
      f.vEdge > 0.2 && f.vEdge < 0.99, 'V_edge=' + (f.vEdge * 100).toFixed(1) + '%');

// 缝宽变大 ⇒ 光源更宽 ⇒ 干涉项对比度下降（"调 b 看可见度"必须看得出来）
const thin = fringe({ ...base, b: 0.02 });
const wide = fringe({ ...base, b: 0.16 });
check('b 变小 ⇒ 边缘可见度升高', thin.vEdge > wide.vEdge,
      'b=0.02 → ' + (thin.vEdge * 100).toFixed(1) + '% ｜ b=0.16 → ' + (wide.vEdge * 100).toFixed(1) + '%');
check('加性模型下中视场对比度仍≈1（模型本身如此，不是 bug）',
      f.pr.visibility > 0.9, '中视场 V=' + (f.pr.visibility * 100).toFixed(1) + '%');

/* ④ 非法输入必须报错而不是给 NaN */
let threw = false;
try { fx.solve({ ...base, n: 0.9 }); } catch (e) { threw = /折射率/.test(e.message); }
check('n≤1 时抛可读错误', threw);

console.log('\n' + (bad === 0 ? 'P3a 数值门禁通过' : bad + ' 项不通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
