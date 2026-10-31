/* check-optical-geometry.js —— P7 空间模型门禁（纯 Node）
 *
 * 专治用户实测反馈的三件事：
 *   ① 移动光屏条纹不变   → 断言 z₂ 变化必须让 Δx 变化
 *   ② 凸透镜加入后无作用 → 断言插透镜后 d′、Δx′、β 都变，且物在焦点内要如实报"无实像"
 *   ③ 只有两个位置有条纹 → 断言"固定屏面视场内的条纹数"随 Δx 变化
 *
 * 用法：node tools/check-optical-geometry.js
 */
const fs = require('fs');
const path = require('path');

function pick(rels) {
  const bases = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../..'), __dirname];
  for (const b of bases) for (const r of rels) { const p = path.join(b, r); if (fs.existsSync(p)) return p; }
  throw new Error('找不到依赖：' + rels.join(' 或 '));
}

let ok = 0, bad = 0;
const check = (n, c, x) => c ? (ok++, console.log('PASS  ' + n + (x ? '  ' + x : '')))
                            : (bad++, console.log('FAIL  ' + n + (x ? '  ← ' + x : '')));

const rail = require(pick(['js/pages/optical-rail.js', 'pages/optical-rail.js']));
const BASE = { lamNm: 589.3, n: 1.5168, Adeg: 1.0, b: 0.08, z1: 50, z2: 950 };

/* ① 默认装置与表 5.1 一致 */
const r0 = rail.solveScene(BASE);
check('默认 d = 0.9020 mm（表 5.1 傍轴 0.90199）', Math.abs(r0.d - 0.90199) < 0.001, r0.d.toFixed(5));
check('默认 Δx = 0.6533 mm（表 5.1 0.6533）', Math.abs(r0.dx - 0.6533) < 0.001, r0.dx.toFixed(5));

/* ② 移动光屏必须改变 Δx（Δx ∝ z₁+z₂） */
const near = rail.solveScene({ ...BASE, z2: 400 });
const far = rail.solveScene({ ...BASE, z2: 950 });
check('光屏靠近 ⇒ Δx 变小（条纹变密）', near.dx < far.dx,
      'z₂=400 → Δx=' + near.dx.toFixed(4) + ' ｜ z₂=950 → Δx=' + far.dx.toFixed(4));
check('Δx 与 z₁+z₂ 成正比（同 z₁）',
      Math.abs(near.dx / far.dx - (50 + 400) / (50 + 950)) < 1e-9,
      (near.dx / far.dx).toFixed(6));

/* ③ 移动单缝必须改变 d 与 Δx（Δx ∝ 1 + z₂/z₁） */
const a20 = rail.solveScene({ ...BASE, z1: 20, z2: 980 });
const a80 = rail.solveScene({ ...BASE, z1: 80, z2: 920 });
check('d 与 z₁ 成正比', Math.abs(a80.d / a20.d - 4) < 1e-9, (a80.d / a20.d).toFixed(6));
check('z₁ 变大 ⇒ Δx 变小', a80.dx < r0.dx && r0.dx < a20.dx,
      'a=20 → ' + a20.dx.toFixed(4) + ' ｜ a=50 → ' + r0.dx.toFixed(4) + ' ｜ a=80 → ' + a80.dx.toFixed(4));

/* ④ 透镜：插上之后必须"有作用" */
const u = 200, f = 150, L2 = 800;
const withLens = rail.solveScene({ ...BASE, lens: { f: f, u: u, L2: L2 } });
const vExpect = u * f / (u - f);          // 600
const mExpect = vExpect / u;              // 3
const dxExpect = BASE.lamNm * 1e-6 * Math.abs(L2 - vExpect) / (mExpect * r0.d);
check('透镜成像：v = uf/(u−f) = 600 mm', Math.abs(withLens.lens.v - vExpect) < 1e-9, withLens.lens.v.toFixed(3));
check('放大率 |β| = v/u = 3', Math.abs(withLens.m - mExpect) < 1e-9, withLens.m.toFixed(4));
check('像间距 d′ = |β|·d', Math.abs(withLens.dPrime - mExpect * r0.d) < 1e-12, withLens.dPrime.toFixed(5));
check('屏上条纹间距 Δx′ 与无透镜时不同', Math.abs(withLens.dxPrime - r0.dx) > 1e-3,
      'Δx′=' + withLens.dxPrime.toFixed(5) + ' ｜ Δx=' + r0.dx.toFixed(5));
check('Δx′ 数值符合 λ|L₂−v|/d′', Math.abs(withLens.dxPrime - dxExpect) < 1e-12, dxExpect.toFixed(6));
check('β = Δx′/Δx 给出可核对的比值', isFinite(withLens.beta) && withLens.beta > 0,
      'β=' + withLens.beta.toFixed(4));

/* ⑤ 屏正好在像面 ⇒ 条纹间距趋零（两像点，不形成条纹） */
const atImage = rail.solveScene({ ...BASE, lens: { f: f, u: u, L2: vExpect } });
check('屏在像面 ⇒ Δx′ → 0（应能看到提示）', atImage.dxPrime < 1e-9, atImage.dxPrime.toExponential(2));

/* ⑥ 物在焦点内 ⇒ 无实像，必须如实说明而不是给个数 */
const focal = rail.solveScene({ ...BASE, lens: { f: f, u: 100, L2: L2 } });
check('物距 ≤ f′ ⇒ 标"无实像"且不给 Δx′', focal.lens.image === false && !isFinite(focal.dxPrime) && /无实像/.test(focal.note || ''),
      focal.note);

/* ⑦ 固定屏面视场内的条纹数必须随 Δx 变（修"只有两个位置有条纹"） */
const nFringes = (dx) => rail.FOV_MM / dx;
check('视场 ±3 mm（共 6 mm）', rail.FOV_MM === 6, rail.FOV_MM + ' mm');
check('z₂=400 与 z₂=950 的条纹数不同',
      Math.abs(nFringes(near.dx) - nFringes(far.dx)) > 1,
      nFringes(near.dx).toFixed(1) + ' 条 vs ' + nFringes(far.dx).toFixed(1) + ' 条');

/* ⑧ 台面跨度与 mm/px 换算自洽 */
check('台面跨度 1200 mm', rail.RAIL_SPAN_MM === 1200);
const ppm = rail.pxPerMm(800);
check('800 px 画布 ⇒ 0.667 px/mm（即 1.5 mm/px）', Math.abs(ppm - 800 / 1200) < 1e-12, ppm.toFixed(6) + ' px/mm');
check('px↔mm 往返一致', Math.abs(rail.pxToMm(rail.mmToPx(523.4, 800), 800) - 523.4) < 1e-9);

/* ⑨ 非法输入要报错 */
let threw = null;
try { rail.solveScene({ ...BASE, n: 0.9 }); } catch (e) { threw = e; }
check('n ≤ 1 抛可读错误', !!threw && /折射率/.test(threw.message));

console.log('\n' + (bad === 0 ? 'P7 空间模型门禁通过' : bad + ' 项不通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
