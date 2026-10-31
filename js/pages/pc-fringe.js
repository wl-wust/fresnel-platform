/* =========================================================================
 * pages/pc-fringe.js —— P5：PC 端图像分析 + 导入手机记录
 * 依赖：physics.js, core/{fmt,ui,store,plot,fringe}.js, pages/pc.js（在 pc.js 之后加载）
 *
 * 两件事：
 *   ① 覆盖 pc.js 里 analyzeImage 的占位：选图 → 投影 → 提取 Δx → 剖面图
 *   ② 导入手机导出的 record.json：一次算出整批 λ（这才让"手机采集 → PC 处理"闭环）
 *   ③ 内含自检：合成一张已知 Δx 的条纹图当场提取 —— 没有实验仪器也能验证整条链路
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP;
  var doc = global.document;
  var $ = BP.ui.$, F = BP.fmt;

  // 本文件用到的静态 DOM id
  var IDS = ['imageInput', 'analysisResult', 'fringeChartContainer', 'fringeChart',
             'fringeSelfTestResult', 'phoneRecordFile', 'phoneRecordResult', 'pixel_size'];

  function fail(e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }

  // 像素当量：优先用手机标定过的 k，退回波长卡里的 k
  function currentK() {
    var saved = BP.store.loadK();
    if (saved && isFinite(saved.value) && saved.value > 0) return saved.value;
    var el = $('pixel_size');
    var v = el ? parseFloat(el.value) : NaN;
    return isFinite(v) && v > 0 ? v : 0.0040;
  }

  function loadProfilePlot(profile, r) {
    var box = $('fringeChartContainer'), cv = $('fringeChart');
    if (!box || !cv || !BP.plot) return;
    box.style.display = 'block';
    var xs = [], ys = [];
    for (var i = 0; i < profile.length; i++) { xs.push(i); ys.push(profile[i]); }
    BP.plot.line(cv, xs, ys, {
      title: '条纹剖面（' + r.axis + ' 方向投影）· 周期 ' + r.periodPx.toFixed(1) + ' px',
      xTicks: 4, yTicks: 3
    });
  }

  /* ---------------- ① 选图 → 提取 ---------------- */
  function analyzeImage() {
    var input = $('imageInput');
    if (!input || !input.files || !input.files.length) { BP.ui.alert('请先选择图像文件'); return Promise.resolve(); }
    var k = currentK();
    BP.ui.loading(true);
    return BP.fringe.analyzeFile(input.files[0], { k: k }).then(function (r) {
      var rows = [
        { label: '条纹间距 Δx', value: F.mm(r.deltaXmm) + ' mm', cls: 'is-key' },
        { label: 'Δx（像素）', value: F.px(r.periodPx) + ' px' },
        { label: '零交叉法交叉检查', value: F.px(r.periodPxCross) + ' px',
          note: '两种算法相差 ' + (isFinite(r.periodPxCross) ? (Math.abs(r.periodPx - r.periodPxCross) / r.periodPx * 100).toFixed(2) : '—') + '%' },
        { label: '可见度 V', value: isFinite(r.visibility) ? (r.visibility * 100).toFixed(1) + '%' : '—' },
        { label: '投影方向', value: r.axis === 'x' ? '竖直条纹（按列平均）' : '水平条纹（按行平均）' },
        { label: '像素当量 k', value: F.sci(k) + ' mm/px' + (r.scale && r.scale !== 1 ? '（图已缩 ' + r.scale.toFixed(2) + '×，已折算）' : '') },
        { label: '原图尺寸', value: r.sourceSize.width + ' × ' + r.sourceSize.height + ' px' }
      ];
      BP.ui.result($('analysisResult'), rows, { caption: '式 (2)(7)：Δx 提取 → λ = d·Δx/D' });
      loadProfilePlot(r.profile, r);
      BP.store.saveHistory('fringe', { axis: r.axis, periodPx: r.periodPx, deltaXmm: r.deltaXmm, visibility: r.visibility });
      if (BP.pages && BP.pages.pc && BP.pages.pc.renderHistory) BP.pages.pc.renderHistory();
    }).catch(fail).then(function () { BP.ui.loading(false); });
  }

  /* ---------------- ② 导入手机记录 ---------------- */
  function handlePhoneRecord(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    BP.store.importRecord(f).then(function (rec) {
      var d = rec.params && isFinite(rec.params.d) ? rec.params.d : 0.90213;
      var D = rec.params && isFinite(rec.params.D) ? rec.params.D : 1000;
      var k = rec.k && isFinite(rec.k.value) ? rec.k.value : currentK();
      var frames = (rec.frames || []).filter(function (x) { return isFinite(x.dxPx); });
      if (!frames.length) throw new Error('记录里没有可用的 Δx 数据');

      var lams = [], rels = [];
      frames.forEach(function (fr) {
        try {
          var o = BP.physics.wavelengthBasic({ d: d, D: D, dxPx: fr.dxPx, k: k });
          lams.push(o.value); rels.push(o.relU);
        } catch (e) { /* 单帧异常跳过 */ }
      });
      if (!lams.length) throw new Error('所有帧都无法解算，请检查 k 与 d、D');

      var a = BP.physics.typeA(lams);
      var rows = [
        { label: '记录时间', value: (rec.created || '').replace('T', ' ').slice(0, 19) || '—' },
        { label: '帧数', value: frames.length + '（成功 ' + lams.length + '）' },
        { label: '像素当量 k', value: F.sci(k) + ' mm/px' },
        { label: 'd / D', value: F.mm(d) + ' mm / ' + F.num(D, 0) + ' mm' },
        { label: 'λ 均值', value: F.lam(a.mean), cls: 'is-key' },
        { label: '帧间标准差 s', value: isFinite(a.sd) ? F.num(a.sd, 3) + ' nm' : '—' },
        { label: 'A 类 u_A = s/√n', value: isFinite(a.uA) ? F.num(a.uA, 3) + ' nm' : '—' },
        { label: '相对标准差', value: isFinite(a.sd) && a.mean ? F.pct(a.sd / a.mean) : '—' }
      ];
      BP.ui.result($('phoneRecordResult'), rows, { caption: '手机采集 → PC 解算（表 6.1 口径：多帧均值与帧间标准差）' });
      BP.store.saveHistory('phoneRecord', { n: lams.length, meanNm: a.mean, sdNm: a.sd });
      if (BP.pages && BP.pages.pc && BP.pages.pc.renderHistory) BP.pages.pc.renderHistory();
    }).catch(fail);
  }

  /* ---------------- ③ 内含自检：合成已知条纹 → 当场提取 ---------------- */
  function fringeSelfTest() {
    try {
      var r = BP.fringe.selfTest({ periodPx: 163.3, visibility: 0.6, noise: 0.02, k: currentK(), seed: 7 });
      var good = Math.abs(r.relErr) < 0.005;
      BP.ui.result($('fringeSelfTestResult'), [
        { label: '合成真值 Δx', value: F.mm(r.truth.deltaXmm) + ' mm（163.3 px × k）' },
        { label: '提取结果 Δx', value: F.mm(r.deltaXmm) + ' mm', cls: 'is-key' },
        { label: '相对偏差', value: (r.relErr * 100).toFixed(3) + '%', cls: good ? '' : 'is-warn' },
        { label: '可见度（真值 60%）', value: (r.visibility * 100).toFixed(1) + '%' },
        { label: '结论', value: BP.ui.badge(good, '链路正常（偏差 < 0.5%）', '偏差过大，先查 k 与投影方向') }
      ], { caption: '与报告表 6.1 同一方法：已知真值的合成条纹图检验提取偏差' });
      loadProfilePlot(r.profile, r);
      BP.store.saveHistory('fringeSelfTest', { periodPx: r.periodPx, relErr: r.relErr });
      if (BP.pages && BP.pages.pc && BP.pages.pc.renderHistory) BP.pages.pc.renderHistory();
    } catch (e) { fail(e); }
  }

  var API = {
    analyzeImage: analyzeImage,
    handlePhoneRecord: handlePhoneRecord,
    importPhoneRecord: function () {
      var f = $('phoneRecordFile');
      if (f) f.click();
    },
    fringeSelfTest: fringeSelfTest
  };
  for (var k2 in API) if (Object.prototype.hasOwnProperty.call(API, k2)) global[k2] = API[k2];

  BP.pages = BP.pages || {};
  BP.pages.pcFringe = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
