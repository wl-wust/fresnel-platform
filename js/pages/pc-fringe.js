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
  var LOW_VISIBILITY = 0.2;

  function fail(e) { BP.ui.alert(e && e.message ? e.message : String(e), 'error'); }

  function finiteNumber(value) {
    return value !== null && value !== undefined && value !== '' && isFinite(value)
      ? Number(value)
      : null;
  }

  // 像素当量：优先用手机标定过的 k，退回波长卡里的 k
  function currentK() {
    var saved = BP.store.loadK();
    if (saved && isFinite(saved.value) && saved.value > 0) return saved.value;
    var el = $('pixel_size');
    var v = el ? parseFloat(el.value) : NaN;
    return el && el.dataset.sessionManual === '1' && isFinite(v) && v > 0 ? v : NaN;
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

  function stripeDirectionLabel(r) {
    var a = ((r.stripeAngleDeg || 0) % 180 + 180) % 180;
    if (r.axis === 'x') return '竖直条纹，偏离竖轴 ' + Math.abs(a - 90).toFixed(1) + '°';
    if (r.axis === 'y') return '水平条纹，偏离横轴 ' + Math.min(a, 180 - a).toFixed(1) + '°';
    return '斜条纹，' + a.toFixed(1) + '°';
  }

  /* ---------------- ① 选图 → 提取 ---------------- */
  function analyzeImage() {
    var input = $('imageInput');
    if (!input || !input.files || !input.files.length) { BP.ui.alert('请先选择图像文件'); return Promise.resolve(); }
    var k = currentK();
    BP.ui.loading(true);
    return BP.fringe.analyzeFile(input.files[0], { k: k }).then(function (r) {
      var dxMm = finiteNumber(r.deltaXmm);
      var visibility = finiteNumber(r.visibility);
      var lowVisibility = visibility !== null && visibility < LOW_VISIBILITY;
      var rows = [
        {
          label: '条纹间距 Δx',
          value: dxMm !== null ? F.mm(dxMm) + ' mm' : '—（未标定 k）',
          cls: 'is-key',
          note: dxMm === null ? '像素间距已提取；完成像素当量标定后才能得到毫米值' : ''
        },
        { label: 'Δx（像素）', value: F.px(r.periodPx) + ' px' },
        { label: '零交叉法交叉检查', value: F.px(r.periodPxCross) + ' px',
          note: '两种算法相差 ' + (isFinite(r.periodPxCross) ? (Math.abs(r.periodPx - r.periodPxCross) / r.periodPx * 100).toFixed(2) : '—') + '%' },
        {
          label: '可见度 V',
          value: visibility !== null ? (visibility * 100).toFixed(1) + '%' : '—',
          cls: lowVisibility ? 'is-warn' : '',
          note: lowVisibility ? '对比度偏低，结果可作粗查；建议改善遮光或减少反光后重拍' : ''
        },
        { label: '条纹方向', value: stripeDirectionLabel(r) },
        { label: '识别通道 / 中央 ROI', value: r.signal + ' 通道 · ' + r.roi.width + ' × ' + r.roi.height + ' px' },
        { label: '自相关 / 频谱信噪比', value: (r.acfPeak * 100).toFixed(1) + '% / ' + r.spectralSnr.toFixed(1) },
        {
          label: '像素当量 k',
          value: finiteNumber(k) !== null ? F.sci(k) + ' mm/px' : '未标定',
          cls: finiteNumber(k) === null ? 'is-warn' : '',
          note: r.scale && r.scale !== 1 ? '图已缩 ' + r.scale.toFixed(2) + '×，已折算' : ''
        },
        { label: '原图尺寸', value: r.sourceSize.width + ' × ' + r.sourceSize.height + ' px' }
      ];
      BP.ui.result($('analysisResult'), rows, { caption: '式 (2)(7)：Δx 提取 → λ = d·Δx/D' });
      loadProfilePlot(r.profile, r);
      if (BP.sessions) {
        var session = BP.sessions.getActiveSession();
        if (!session) session = BP.sessions.createSession({ method: 'basic', title: 'PC 图像分析' });
        if (isFinite(k) && k > 0) {
          BP.sessions.updateSession(session.id, {
            calibration: {
              k_mm_px: k,
              source: 'manual',
              at: new Date().toISOString()
            }
          });
          session = BP.sessions.getSession(session.id);
        }
        var roleEl = $('pcRoleSelect');
        var role = roleEl && roleEl.value ? roleEl.value : 'sodium';
        BP.sessions.addFrame(session.id, {
          role: role,
          blob: input.files[0],
          name: input.files[0].name,
          size: input.files[0].size,
          deltaXPx: r.periodPx,
          deltaXmm: r.deltaXmm,
          quality: r.visibility,
          analysis: {
            axis: r.axis,
            visibility: r.visibility,
            periodPxCross: r.periodPxCross,
            stripeAngleDeg: r.stripeAngleDeg,
            roi: r.roi,
            signal: r.signal,
            spectralSnr: r.spectralSnr,
            acfPeak: r.acfPeak
          }
        }).then(function () {
          if (BP.pages && BP.pages.pc && BP.pages.pc.renderPcSession) {
            BP.pages.pc.renderPcSession();
          }
          if (BP.pages && BP.pages.pc && BP.pages.pc.applySessionData) {
            BP.pages.pc.applySessionData({ silent: true, calculate: true });
          }
        }).catch(fail);
      }
      BP.store.saveHistory('fringe', { axis: r.axis, periodPx: r.periodPx, deltaXmm: r.deltaXmm, visibility: r.visibility });
      if (BP.pages && BP.pages.pc && BP.pages.pc.renderHistory) BP.pages.pc.renderHistory();
    }).catch(fail).then(function () { BP.ui.loading(false); });
  }

  /* ---------------- ② 导入手机记录 ---------------- */
  function handlePhoneRecord(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    BP.store.importRecord(f).then(function (rec) {
      if (rec.schema === 'bp.record/2' && BP.sessions) {
        BP.sessions.importRecord(rec);
        var sessions = rec.sessions || [];
        var activeId = rec.activeSessionId;
        var session = sessions.filter(function (s) { return s.id === activeId; })[0] || sessions[0];
        if (session) BP.sessions.setActiveSession(session.id);
        var roleRows = session
          ? BP.sessions.requiredRoles(session.method).map(function (role) {
              var stat = BP.sessions.roleStats(session.id, role);
              return { label: stat.label, value: stat.n + ' 帧' + (stat.n ? '，Δx=' + F.px(stat.meanPx) : '') };
            })
          : [];
        var rows = [
          { label: '记录版本', value: 'bp.record/2', cls: 'is-key' },
          { label: '会话数', value: String(sessions.length) },
          { label: '当前会话', value: session ? session.title + '（' + session.method + '）' : '—' }
        ].concat(roleRows);

        if (session && (session.method === 'basic' || session.method === 'trace')) {
          var sodium = BP.sessions.roleStats(session.id, 'sodium');
          var d = session.method === 'trace' && session.trace
            ? finiteNumber(session.trace.d_mm)
            : finiteNumber(session.params && session.params.d);
          var D = finiteNumber(session.params && session.params.D);
          if (session.method === 'trace' && D === null && session.trace) {
            D = finiteNumber(session.trace.D_mm);
          }
          var sessionK = finiteNumber(session.calibration && session.calibration.k_mm_px);
          var k = sessionK !== null ? sessionK : finiteNumber(currentK());
          if (sodium.n && d !== null && D !== null && k !== null) {
            var lam = BP.physics.wavelengthBasic({
              d: d, D: D, dxPx: sodium.meanPx, k: k
            });
            rows.push({ label: 'λ 均值', value: F.lam(lam.value), cls: 'is-key' });
            rows.push({ label: '追迹来源', value: session.trace ? session.trace.label : '基本公式 d' });
          } else if (sodium.n) {
            var missing = [];
            if (d === null) missing.push('d');
            if (D === null) missing.push('D');
            if (k === null) missing.push('k');
            rows.push({
              label: 'λ 均值', value: '未计算', cls: 'is-warn',
              note: '缺少 ' + missing.join('、') + '，不使用报告默认值代算'
            });
          }
        }
        BP.ui.result($('phoneRecordResult'), rows, { caption: '手机会话与角色数据已导入' });
        if (BP.pages && BP.pages.pc && BP.pages.pc.renderPcSession) BP.pages.pc.renderPcSession();
        if (BP.pages && BP.pages.pc && BP.pages.pc.applySessionData) {
          BP.pages.pc.applySessionData({ silent: true, calculate: true });
        }
        return;
      }
      var d = finiteNumber(rec.params && rec.params.d);
      var D = finiteNumber(rec.params && rec.params.D);
      var k = finiteNumber(rec.k && rec.k.value);
      if (k === null) k = finiteNumber(currentK());
      if (d === null || D === null || k === null) {
        throw new Error('旧版记录缺少 d、D 或 k，不使用报告默认值代算');
      }
      var frames = (rec.frames || []).filter(function (x) { return finiteNumber(x.dxPx) !== null; });
      if (!frames.length) throw new Error('记录里没有可用的 Δx 数据');

      var lams = [], rels = [];
      frames.forEach(function (fr) {
        try {
          var o = BP.physics.wavelengthBasic({ d: d, D: D, dxPx: fr.dxPx, k: k });
          lams.push(o.value); rels.push(o.relU);
        } catch (e) { /* 单帧异常跳过 */ }
      });
      if (!lams.length) throw new Error('所有帧都无法解算，请检查 k 与 d、D');

      // 单帧也要能走通：framesStats 在 n=1 时只给 mean，不抛错（typeA 要求 ≥2）
      var a = BP.fringe.framesStats(lams);
      var rows = [
        { label: '记录时间', value: (rec.created || '').replace('T', ' ').slice(0, 19) || '—' },
        { label: '帧数', value: frames.length + '（成功 ' + lams.length + '）' },
        { label: '像素当量 k', value: F.sci(k) + ' mm/px' },
        { label: 'd / D', value: F.mm(d) + ' mm / ' + F.num(D, 0) + ' mm' },
        { label: 'λ' + (a.single ? '' : ' 均值'), value: F.lam(a.mean), cls: 'is-key' },
        { label: '帧间标准差 s', value: a.single ? '—（单帧，A 类需 ≥2 帧）' : F.num(a.sd, 3) + ' nm' },
        { label: 'A 类 u_A = s/√n', value: a.single ? '—' : F.num(a.uA, 3) + ' nm' },
        { label: '相对标准差', value: a.single ? '—' : F.pct(a.relSd) }
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
