/* =========================================================================
 * pages/pc-unc.js —— P2：表 8.1 八分量折叠页 + Δx–L₃ 斜率法
 * 依赖：physics.js, core/fmt.js, core/ui.js, core/store.js, core/fit.js, core/plot.js,
 *       pages/pc.js（复用 renderHistory），按 §1.4 顺序在 pc.js 之后加载
 * 职责：把表 8.1 的 8 个分量折成表 5.2 的三条路径，并同屏与报告值对照。
 *       八分量的中文名/来源全部来自 physics.budgetPreset()，不在 HTML 里重复一份。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP, doc = global.document;
  var $ = BP.ui.$, F = BP.fmt;

  // 报告表 5.2 原文数值（仅作对照显示；计算一律由 physics.js 现算）
  var TABLE52 = { basic: 0.0013, trace: 0.0013, ratio: 0.0010, mag: 0.0014 };
  var PATH_LABEL = { basic: '基本公式法', trace: '光线追迹法', ratio: '比值法', mag: '横向放大率法' };
  var PATH_ORDER = ['basic', 'trace', 'ratio', 'mag'];
  var TOL = 0.00005;                       // 相对不确定度允许差 0.005%（表 5.2 只给两位小数）

  // 本文件用到的静态 DOM id（tools/check-ids.js 据此核对）
  var IDS = ['u81Body', 'u81Result', 'u81Fold',
             'l3Body', 'l3_d', 'l3Result', 'l3ChartContainer', 'l3Chart'];

  function refreshHistory() {
    if (BP.pages && BP.pages.pc && BP.pages.pc.renderHistory) BP.pages.pc.renderHistory();
  }

  /* ---------------- 表 8.1：八分量输入表（由 budgetPreset 生成） ---------------- */
  function build81() {
    var tb = $('u81Body');
    if (!tb) return;
    BP.ui.clear(tb);
    BP.physics.budgetPreset().forEach(function (p) {
      var tr = doc.createElement('tr');

      var tdKey = doc.createElement('td');
      tdKey.textContent = p.label;

      var tdSrc = doc.createElement('td');
      tdSrc.className = 'is-dim';
      tdSrc.textContent = p.source;

      var tdVal = doc.createElement('td');
      var inp = doc.createElement('input');
      inp.type = 'number';
      inp.step = '0.0001';
      inp.className = 'u81';
      inp.dataset.key = p.key;
      inp.value = F.pct(p.relU).replace('%', '');       // '0.0006' / '0.100' / '0.030' …
      inp.setAttribute('aria-label', p.label + ' 百分数');
      tdVal.appendChild(inp);

      tr.appendChild(tdKey); tr.appendChild(tdSrc); tr.appendChild(tdVal);
      tb.appendChild(tr);
    });
  }

  function read81() {
    var comps = {};
    BP.ui.$$('#u81Body input.u81').forEach(function (inp) {
      var v = parseFloat(inp.value);
      comps[inp.dataset.key] = isFinite(v) ? v / 100 : 0;   // 百分数 → 无量纲
    });
    return comps;
  }

  function fill81Defaults() {
    build81();
    BP.ui.alert('已填入报告表 8.1 的八个分量', 'ok');
  }

  function calc81() {
    try {
      var comps = read81();
      if (!Object.keys(comps).length) throw new Error('八分量表还没生成，请刷新页面或点「填入表 8.1 默认值」');

      var fd = BP.physics.foldD(comps);
      BP.ui.result($('u81Fold'), [
        { label: 'u(d)/d（由 a、n、A 折叠）', value: F.pct(fd), cls: 'is-key',
          note: '√[(u(a)/a)² + (u(n)/(n−1))² + (u(A)/A)²]　—　注意分母是 n−1' }
      ]);

      var rows = [], badCount = 0;
      PATH_ORDER.forEach(function (k) {
        var r = BP.physics.uncertaintyBudget({ path: k, comps: comps });
        var ref = TABLE52[k], diff = r.relU - ref;
        var good = Math.abs(diff) <= TOL;
        if (!good) badCount++;
        rows.push([
          PATH_LABEL[k], F.rel(r.relU), F.rel(ref), (Math.abs(diff) < TOL ? '0.00%' : F.rel(diff)),
          good ? '一致' : '与表 5.2 不符', r.uses.join(' / ')
        ]);
      });

      BP.ui.table($('u81Result'), ['路径', '平台 relU', '表 5.2', '差', '结论', '用到的分量'], rows, {
        caption: '表 8.1 八分量 → 三条路径折叠（对照研究报告表 5.2，容差 0.005%）'
      });

      if (badCount) BP.ui.alert(badCount + ' 条路径与表 5.2 不符，先查分母口径（§2.3）', 'error');
      BP.store.saveHistory('unc81', { foldD: fd, comps: comps });
      refreshHistory();
    } catch (e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }
  }

  /* ---------------- Δx–L₃ 斜率法（式 13、17） ---------------- */
  function addL3Row(v, dx) {
    var tb = $('l3Body');
    if (!tb) return;
    var tr = doc.createElement('tr');

    var td1 = doc.createElement('td');
    var i1 = doc.createElement('input');
    i1.type = 'number'; i1.step = 'any'; i1.className = 'l3-v';
    if (v != null) i1.value = v;
    td1.appendChild(i1);

    var td2 = doc.createElement('td');
    var i2 = doc.createElement('input');
    i2.type = 'number'; i2.step = 'any'; i2.className = 'l3-dx';
    if (dx != null) i2.value = dx;
    td2.appendChild(i2);

    var td3 = doc.createElement('td');
    var btn = doc.createElement('button');
    btn.textContent = '删除';
    btn.addEventListener('click', function () {
      if (tr.parentNode) tr.parentNode.removeChild(tr);
    });
    td3.appendChild(btn);

    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    tb.appendChild(tr);
    return tr;
  }

  function readL3() {
    var Ls = [], dxs = [];
    BP.ui.$$('#l3Body tr').forEach(function (tr) {
      var a = tr.querySelector('.l3-v'), b = tr.querySelector('.l3-dx');
      if (!a || !b) return;
      var va = parseFloat(a.value), vb = parseFloat(b.value);
      if (isFinite(va) && isFinite(vb)) { Ls.push(va); dxs.push(vb); }
    });
    return { Ls: Ls, dxs: dxs };
  }

  function calcL3() {
    try {
      var t = readL3();
      if (t.Ls.length < 2) throw new Error('至少填 2 组 L₃ / Δx');
      var dEl = $('l3_d');
      var d = dEl ? parseFloat(dEl.value) : NaN;
      var r = BP.fit.dxOverL3(t.Ls, t.dxs, d);

      BP.ui.result($('l3Result'), [
        { label: '斜率 k（Δx 对 L₃）', value: F.num(r.slope, 8), cls: 'is-key' },
        { label: '截距', value: F.num(r.fit.intercept, 6) },
        { label: 'R²', value: F.num(r.fit.r2, 6) },
        { label: '数据点 n', value: String(r.fit.n) },
        { label: '斜率相对不确定度',
          value: (isFinite(r.relU) && r.relU > 1e-12) ? F.rel(r.relU)
                                                     : '—（默认数据是精确直线，真实测量才有残差）' },
        { label: 'λ = k·d', value: F.lam(r.lamNm), cls: 'is-key' }
      ], { caption: 'Δx = (λ/d)·L₃　⇒　斜率 = λ/d　（报告图 5.1、式 13/17）' });

      var box = $('l3ChartContainer'), cv = $('l3Chart');
      if (box && cv && BP.plot) {
        box.style.display = 'block';
        var pts = t.Ls.map(function (v, i) { return [v, t.dxs[i]]; });
        BP.plot.scatter(cv, pts, { fitLine: r.fit, title: 'Δx–L₃', xTicks: 3, yTicks: 3 });
      }
      BP.store.saveHistory('l3', { n: r.fit.n, slope: r.slope, lamNm: r.lamNm });
      refreshHistory();
    } catch (e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }
  }

  var API = {
    fill81Defaults: fill81Defaults, calc81: calc81,
    calcL3: calcL3, addL3Row: addL3Row
  };
  for (var k in API) if (Object.prototype.hasOwnProperty.call(API, k)) global[k] = API[k];

  function init() {
    build81();
    var tb = $('l3Body');
    // 三组默认值取自 Δx = (λ/d)·L₃（λ=589.3 nm、d=0.90213 mm），便于开箱验证
    if (tb && !tb.children.length) {
      addL3Row('200', '0.1306');
      addL3Row('600', '0.3919');
      addL3Row('1000', '0.6532');
    }
  }
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }

  BP.pages = BP.pages || {};
  BP.pages.pcUnc = API;
})(typeof window !== 'undefined' ? window : globalThis);
