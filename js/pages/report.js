/* =========================================================================
 * pages/report.js —— AI 实验数据报告页交互
 * 数据只在浏览器本地解析、计算和导出；导入后先预览，用户确认才替换当前报告。
 * ========================================================================= */
(function (global) {
  'use strict';

  var doc = global.document;
  var STORAGE_KEY = 'bp.report.snapshot.v2';
  var SOURCE_LABEL = {
    measured: '实测',
    reportPreset: '报告预设',
    modelTrace: '模型追迹',
    manual: '手动输入',
    referenceOnly: '仅参考',
    missing: '缺失'
  };
  var CATEGORY_LABEL = {
    apparatus: '实验装置',
    sodium_fringe: '钠光条纹',
    reference_fringe: '红光参考',
    second_image: '二次成像',
    reticle: '分划板刻线',
    other_data: '原始记录'
  };

  var dataset = null;
  var pendingDataset = null;
  var currentAuditFilter = 'all';
  var traceState = {
    residual: false,
    showParaxial: true,
    hoverIndex: -1
  };
  var toastTimer = null;
  var chartFrame = null;

  function $(id) {
    return doc.getElementById(id);
  }

  function finite(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value));
  }

  function fmt(value, digits) {
    if (!finite(value)) return '—';
    return Number(value).toFixed(digits == null ? 3 : digits);
  }

  function percent(value, digits) {
    if (!finite(value)) return '—';
    return (Number(value) * 100).toFixed(digits == null ? 2 : digits) + '%';
  }

  function signedPercent(value, digits) {
    if (!finite(value)) return '—';
    var text = percent(value, digits);
    return Number(value) > 0 ? '+' + text : text;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function localDate(iso) {
    if (!iso) return '—';
    var date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return String(iso);
    return date.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function sourceChip(type) {
    var sourceType = SOURCE_LABEL[type] ? type : 'missing';
    return '<span class="source-chip" data-source="' + sourceType + '">' +
      escapeHtml(SOURCE_LABEL[sourceType]) + '</span>';
  }

  function setText(id, text) {
    var node = $(id);
    if (node) node.textContent = text;
  }

  function toast(message) {
    var node = $('reportToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      node.classList.remove('show');
    }, 3200);
  }

  function saveLocal() {
    try {
      var snapshot = global.BP.reportData.toSnapshot(dataset, {
        auditFilter: currentAuditFilter,
        traceView: traceState.residual ? 'residual' : 'd-a'
      });
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      toast('本地保存失败：' + (error.message || error));
    }
  }

  function restoreLocal() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var preview = global.BP.reportData.validateImport(parsed);
      return preview.ok ? preview.dataset : null;
    } catch (error) {
      return null;
    }
  }

  function methodLabel(key) {
    return {
      ratio: '比值法',
      trace: '光线追迹法',
      magnification: '横向放大率法'
    }[key] || key;
  }

  function roleLabel(role) {
    return {
      sodium: '钠光条纹',
      reference: '红光参考条纹',
      no_lens: '无透镜条纹',
      with_lens: '加透镜条纹',
      calibration: '像素标定',
      secondaryImaging: '二次成像记录'
    }[role] || role;
  }

  function methodValueText(method) {
    if (!method || !finite(method.valueNm)) return '不可计算';
    if (finite(method.uNm)) {
      return fmt(method.valueNm, 2) + ' ± ' + fmt(method.uNm, 2) + ' nm';
    }
    return fmt(method.valueNm, 2) + ' nm';
  }

  function methodStatus(method) {
    if (!method || method.sourceType === 'missing') return '缺项';
    if (method.sourceType === 'modelTrace') return '模型条件结果';
    if (method.sourceType === 'reportPreset') return '条件计算';
    return '实测计算';
  }

  function renderSummary() {
    var ratio = dataset.methods.ratio;
    var sodium = dataset.roleStats.sodium;
    var reference = dataset.roleStats.reference;
    var trace = dataset.methods.trace;
    var magnification = dataset.methods.magnification;
    var geometry = dataset.actualGeometry;
    var geometryStats = geometry && geometry.stats;
    var completed = [ratio, trace, magnification].filter(function (method) {
      return method && finite(method.valueNm);
    }).length;
    var completeness = Math.round(completed / 3 * 100);

    setText('generatedAt', localDate(dataset.meta && dataset.meta.generatedAt));
    setText('footerDate', localDate(new Date().toISOString()));
    setText('heroValue', finite(ratio.valueNm) ? fmt(ratio.valueNm, 2) + ' nm' : '不可计算');
    setText('heroUncertainty', finite(ratio.uNm)
      ? 'u = ' + fmt(ratio.uNm, 2) + ' nm · ' + percent(ratio.relativeU)
      : '条件输入不足，未合成误差');
    setText('heroBias', finite(ratio.accuracy && ratio.accuracy.relativeBias)
      ? fmt(ratio.accuracy.biasNm, 2) + ' nm（' + signedPercent(ratio.accuracy.relativeBias) + '）'
      : '—');
    setText('heroCompleteness', completed + ' / 3 条方法可算');
    setText('heroStatus',
      geometryStats
        ? (trace.sameSource ? '几何实测 · 追迹同源' : '几何实测 · 条件核验')
        : (reference.referenceOnly ? '参考性条件结论' : '待交叉核验'));

    var lead = '已按 sodium、reference、no_lens、with_lens 等角色隔离真实识别结果。';
    if (sodium.n && reference.n) {
      lead += ' 钠光 ' + sodium.n + ' 帧给出 Δx=' + fmt(sodium.meanPx, 3) +
        ' px；红光参考 ' + reference.n + ' 帧给出 Δx=' + fmt(reference.meanPx, 3) +
        ' px。比值法在报告预设波长与折射率下得到 ' +
        methodValueText(ratio) + '，相对 589.3 nm 为 ' +
        signedPercent(ratio.accuracy && ratio.accuracy.relativeBias) + '。';
    }
    if (geometryStats) {
      lead += ' 二次成像记录给出 d₁=' + fmt(geometryStats.d1Mm, 4) +
        ' mm、d₂=' + fmt(geometryStats.d2Mm, 4) +
        ' mm，因此 d=' + fmt(geometryStats.dMm, 5) +
        ' mm、β=' + fmt(geometryStats.beta, 4) +
        '、D=a+z₂=' + fmt(geometryStats.DMm, 3) +
        ' mm，并反算 A_eff=' + fmt(geometryStats.Adeg, 5) + '°。';
    }
    if (reference.referenceOnly) {
      lead += ' 红光片段帧数有限且波动偏大，结论只用于验证识别链路与条件误差，不作为正式高精度实验值。';
    }
    setText('summaryLead', lead);

    var warningBox = $('summaryWarnings');
    if (warningBox) {
      warningBox.innerHTML = (dataset.warnings || []).slice(0, 3).map(function (warning, index) {
        return '<div class="inline-warning"><strong>W' + String(index + 1).padStart(2, '0') +
          '</strong><span>' + escapeHtml(warning) + '</span></div>';
      }).join('');
    }

    var metrics = [
      {
        label: '钠光实测',
        value: String(sodium.n || 0),
        sub: finite(sodium.cv)
          ? '帧 · Δx ' + fmt(sodium.meanPx, 3) + ' px · CV ' + percent(sodium.cv)
          : '没有有效识别'
      },
      {
        label: '红光参考',
        value: String(reference.n || 0),
        sub: reference.referenceOnly
          ? '帧 · Δx ' + fmt(reference.meanPx, 3) + ' px · 仅参考'
          : '帧 · 多帧参考'
      },
      {
        label: '虚光源间距 d',
        value: geometryStats ? fmt(geometryStats.dMm, 5) + ' mm' : '—',
        sub: geometryStats
          ? '√(d₁d₂) · uA ' + fmt(geometryStats.uA_dMm, 5) + ' mm'
          : '缺少二次成像记录'
      },
      {
        label: '横向放大率 β',
        value: geometryStats ? fmt(geometryStats.beta, 4) : '—',
        sub: geometryStats
          ? '√(d₁/d₂)'
          : '缺少二次成像记录'
      },
      {
        label: '观察距离 D',
        value: geometryStats ? fmt(geometryStats.DMm, 2) + ' mm' : '—',
        sub: geometryStats
          ? 'a+z₂ · uA ' + fmt(geometryStats.uA_DMm, 3) + ' mm'
          : '不沿用报告 1000 mm'
      },
      {
        label: '等效棱镜角 A',
        value: geometryStats ? fmt(geometryStats.Adeg, 5) + '°' : '—',
        sub: geometryStats
          ? '反算值 · uA ' + fmt(geometryStats.uA_Adeg, 5) + '°'
          : '缺少几何输入'
      }
    ];
    var grid = $('metricGrid');
    if (grid) {
      grid.innerHTML = metrics.map(function (metric) {
        return '<article class="metric-card"><span>' + escapeHtml(metric.label) +
          '</span><strong>' + escapeHtml(metric.value) +
          '</strong><small>' + escapeHtml(metric.sub) + '</small></article>';
      }).join('');
    }
  }

  function renderMethods() {
    var container = $('methodCards');
    if (!container) return;
    var order = ['ratio', 'trace', 'magnification'];
    container.innerHTML = order.map(function (key, index) {
      var method = dataset.methods[key] || {};
      var isMissing = !finite(method.valueNm);
      var bias = method.accuracy && finite(method.accuracy.relativeBias)
        ? '相对 589.3 nm：' + fmt(method.accuracy.biasNm, 2) + ' nm（' +
          signedPercent(method.accuracy.relativeBias) + '）'
        : (isMissing ? '未生成数值' : '准确度输入不足');
      var missingHtml = (method.missing || []).map(function (item) {
        return '<li>' + escapeHtml(roleLabel(item.role)) + '：' + escapeHtml(item.reason) + '</li>';
      }).join('');
      return '<article class="method-card">' +
        '<div class="method-card-head"><span class="method-index">0' + (index + 1) +
        '</span>' + sourceChip(method.sourceType || 'missing') + '</div>' +
        '<h3>' + escapeHtml(methodLabel(key)) + '</h3>' +
        '<p class="method-value' + (isMissing ? ' is-missing' : '') + '">' +
        escapeHtml(methodValueText(method)) + '</p>' +
        '<div class="method-formula">' + escapeHtml(method.formula || '—') +
        '<br><span>' + escapeHtml(methodStatus(method)) + ' · ' + escapeHtml(bias) + '</span></div>' +
        '<p class="method-purpose">' + escapeHtml(global.BP.reportData.METHOD_ROLES[key]) + '</p>' +
        (method.note ? '<p class="method-note">' + escapeHtml(method.note) + '</p>' : '') +
        (missingHtml ? '<ul class="missing-list">' + missingHtml + '</ul>' : '') +
        '</article>';
    }).join('');

    var historical = dataset.historicalSimulation;
    var cells = [
      ['比值法', historical.ratio],
      ['横向放大率法', historical.magnification],
      ['光线追迹法', historical.trace],
      ['三路径合成', historical.combined]
    ];
    var table = $('historicalTable');
    if (table) {
      table.innerHTML = cells.map(function (item) {
        return '<div class="history-cell"><span>' + escapeHtml(item[0]) + '</span><strong>' +
          fmt(item[1].valueNm, 2) + ' ± ' + fmt(item[1].uNm, 2) + ' nm</strong></div>';
      }).join('');
    }
  }

  function renderGeometry() {
    var grid = $('geometryGrid');
    if (!grid) return;
    var geometry = dataset.actualGeometry;
    if (!geometry || !geometry.stats) {
      grid.innerHTML = '<div class="gallery-empty">当前导入数据没有二次成像观测记录，' +
        'd、β、D 与 A 保持缺失。</div>';
      setText('geometryLead', '没有 d₁、d₂、a、z₂ 观测，不能用报告预设冒充本轮几何量。');
      var formulaBox = $('geometryFormulas');
      if (formulaBox) formulaBox.innerHTML = '';
      return;
    }
    var stats = geometry.stats;
    setText('geometryLead',
      geometry.label + '：三组放大像与缩小像位置差分别聚合；所有派生量现算，' +
      '不手工凑到标准波长。');
    var items = [
      {
        label: '放大像位置差 d₁',
        value: fmt(stats.d1Mm, 4) + ' mm',
        sub: 'uA ' + fmt(stats.uA_d1Mm, 4) + ' mm · n=' + geometry.observations.d1Mm.length
      },
      {
        label: '缩小像位置差 d₂',
        value: fmt(stats.d2Mm, 4) + ' mm',
        sub: 'uA ' + fmt(stats.uA_d2Mm, 4) + ' mm · n=' + geometry.observations.d2Mm.length
      },
      {
        label: '虚光源间距 d',
        value: fmt(stats.dMm, 5) + ' mm',
        sub: '√(d₁d₂) · ' + percent(stats.relativeU_d) + ' 条件误差'
      },
      {
        label: '放大率 β',
        value: fmt(stats.beta, 4),
        sub: '√(d₁/d₂) · uA ' + fmt(stats.uA_beta, 4)
      },
      {
        label: '观察距离 D',
        value: fmt(stats.DMm, 2) + ' mm',
        sub: 'a=' + fmt(stats.aMm, 1) + ' + z₂=' + fmt(stats.z2Mm, 2)
      },
      {
        label: '等效角 A_eff',
        value: fmt(stats.Adeg, 5) + '°',
        sub: 'atan[d/(2a(n−1))] · n=' + fmt(stats.nGlass, 4)
      }
    ];
    grid.innerHTML = items.map(function (item, index) {
      // A_eff 含报告预设折射率，不能与纯实测几何量使用同一来源标签。
      var sourceType = item.label === '等效角 A_eff' ? 'reportPreset' : 'measured';
      return '<article class="geometry-card">' +
        '<div class="geometry-head"><span>G' + String(index + 1).padStart(2, '0') +
        '</span>' + sourceChip(sourceType) + '</div>' +
        '<h3>' + escapeHtml(item.label) + '</h3>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<small>' + escapeHtml(item.sub) + '</small></article>';
    }).join('');
    var formulas = $('geometryFormulas');
    if (formulas) {
      formulas.innerHTML = geometry.formulas.map(function (formula) {
        return '<span>' + escapeHtml(formula) + '</span>';
      }).join('');
    }
    var caveat = $('geometryCaveat');
    if (caveat) {
      caveat.textContent = 'A_eff 的不确定度约 ±' + fmt(stats.uA_Adeg, 5) +
        '°。d、a 为实测，n 为报告预设；未计入棱镜厚度和等效角模型的系统误差，A 不是分光计直接测角。';
    }
  }

  function renderErrors() {
    var ratio = dataset.methods.ratio;
    var terms = ratio.terms || [];
    var max = Math.max.apply(null, terms.map(function (term) {
      return finite(term.relU) ? Math.abs(term.relU) : 0;
    }).concat([1e-12]));
    var bars = $('errorBars');
    if (bars) {
      bars.innerHTML = terms.map(function (term, index) {
        var width = Math.max(0.8, Math.abs(term.relU || 0) / max * 100);
        var id = 'errorDetail' + index;
        return '<button class="error-row" type="button" aria-expanded="false" aria-controls="' + id + '">' +
          '<span class="error-label">' + escapeHtml(term.label) + '</span>' +
          '<span class="error-track"><span class="error-fill" style="width:' + width.toFixed(2) + '%"></span></span>' +
          '<span class="error-value">' + percent(term.relU, 3) + '</span></button>' +
          '<div id="' + id + '" class="error-detail">' + escapeHtml(term.source) + '</div>';
      }).join('');
      Array.prototype.forEach.call(bars.querySelectorAll('.error-row'), function (row) {
        row.addEventListener('click', function () {
          var expanded = row.getAttribute('aria-expanded') === 'true';
          row.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        });
      });
    }
    setText('ratioErrorTotal', finite(ratio.relativeU)
      ? 'u(λ)/λ = ' + percent(ratio.relativeU)
      : '不可合成');
    setText('errorFormula', ratio.formula || '—');
    var sodium = dataset.roleStats.sodium;
    var reference = dataset.roleStats.reference;
    setText('dispersionText',
      '钠光：' + sodium.n + ' 帧，s=' + fmt(sodium.sdPx, 3) + ' px，uA=' +
      fmt(sodium.uAPx, 3) + ' px，CV=' + percent(sodium.cv) +
      '。红光：' + reference.n + ' 帧，s=' + fmt(reference.sdPx, 3) + ' px，uA=' +
      fmt(reference.uAPx, 3) + ' px，CV=' + percent(reference.cv) +
      (dataset.actualGeometry
        ? '。几何量：d₁/d₂ 各 3 组，d 的相对均值标准误差 ' +
          percent(dataset.actualGeometry.stats.relativeU_d) + '。'
        : '。'));
    var historical = dataset.historicalSimulation.combined;
    setText('consistencyText',
      '历史仿真三路径 χ²=' + fmt(historical.chi2, 4) + '，ν=' + historical.dof +
      '，临界 ' + fmt(historical.critical95, 3) + '，结论：' +
      (historical.consistent ? '在 95% 水平一致' : '不一致') +
      '。本轮比值法有双视频条件结果；放大率法与追迹法虽已代入本轮几何量，' +
      '但仍受 k 预设限制，追迹还与放大率法同源，不能把历史 χ² 冒充本轮一致性。');
  }

  function traceDataRange() {
    var values = dataset.rayTrace.points.map(function (point) {
      return traceState.residual
        ? point.relativeResidual * 100
        : point.dTraceMm;
    });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var pad = Math.max((max - min) * 0.12, traceState.residual ? 0.0003 : 0.02);
    return { min: min - pad, max: max + pad };
  }

  function drawTraceChart() {
    var canvas = $('traceChart');
    if (!canvas || !dataset || !dataset.rayTrace) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(2.5, global.devicePixelRatio || 1);
    var width = Math.max(280, rect.width);
    var height = Math.max(260, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    var padding = { left: 66, right: 24, top: 28, bottom: 48 };
    var plotW = width - padding.left - padding.right;
    var plotH = height - padding.top - padding.bottom;
    var points = dataset.rayTrace.points;
    var aMin = points[0].aMm;
    var aMax = points[points.length - 1].aMm;
    var yRange = traceDataRange();
    function xScale(a) {
      return padding.left + (a - aMin) / (aMax - aMin) * plotW;
    }
    function yScale(value) {
      return padding.top + (yRange.max - value) / (yRange.max - yRange.min) * plotH;
    }
    function seriesValue(point, series) {
      if (series === 'residual') return point.relativeResidual * 100;
      return series === 'paraxial' ? point.dParaxialMm : point.dTraceMm;
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(151, 181, 207, 0.13)';
    ctx.fillStyle = '#91a2b3';
    ctx.font = '11px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var tick = 0; tick <= 5; tick += 1) {
      var value = yRange.min + (yRange.max - yRange.min) * tick / 5;
      var y = yScale(value);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      var label = traceState.residual ? value.toFixed(4) + '%' : value.toFixed(3);
      ctx.fillText(label, padding.left - 10, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (var xTick = 0; xTick <= 6; xTick += 1) {
      var aValue = aMin + (aMax - aMin) * xTick / 6;
      var x = xScale(aValue);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.fillText(aValue.toFixed(0), x, height - padding.bottom + 10);
    }

    function drawSeries(series, color, dashed, lineWidth) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth || 2;
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath();
      points.forEach(function (point, index) {
        var x = xScale(point.aMm);
        var y = yScale(seriesValue(point, series));
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    if (traceState.residual) {
      drawSeries('residual', '#5fe0bd', false, 2.2);
    } else {
      if (traceState.showParaxial) drawSeries('paraxial', '#77aee8', true, 1.7);
      drawSeries('trace', '#d9aa56', false, 2.4);
      var nominal = points.reduce(function (best, point) {
        return Math.abs(point.aMm - dataset.rayTrace.nominal.aMm) <
          Math.abs(best.aMm - dataset.rayTrace.nominal.aMm) ? point : best;
      }, points[0]);
      ctx.fillStyle = '#d9aa56';
      ctx.beginPath();
      ctx.arc(xScale(nominal.aMm), yScale(nominal.dTraceMm), 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.fillStyle = '#91a2b3';
    ctx.font = '11px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('近脊距离 a (mm)', padding.left + plotW / 2, height - 15);
    ctx.translate(15, padding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(traceState.residual ? '相对残差 (%)' : '虚光源间距 d (mm)', 0, 0);
    ctx.restore();

    if (traceState.hoverIndex >= 0 && points[traceState.hoverIndex]) {
      var point = points[traceState.hoverIndex];
      var hoverX = xScale(point.aMm);
      var hoverY = yScale(seriesValue(point, traceState.residual ? 'residual' : 'trace'));
      ctx.strokeStyle = 'rgba(233, 238, 242, 0.34)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padding.top);
      ctx.lineTo(hoverX, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = traceState.residual ? '#5fe0bd' : '#d9aa56';
      ctx.beginPath();
      ctx.arc(hoverX, hoverY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function scheduleChartDraw() {
    if (chartFrame) global.cancelAnimationFrame(chartFrame);
    chartFrame = global.requestAnimationFrame(drawTraceChart);
  }

  function renderTrace() {
    var nominal = dataset.rayTrace.nominal;
    var notes = $('traceNotes');
    if (notes) {
      notes.innerHTML = [
        ['实测 a · 反算 A', fmt(nominal.aMm, 1) + ' mm · ' + fmt(nominal.Adeg, 5) + '°'],
        ['严格追迹 d', fmt(nominal.dTraceMm, 5) + ' mm'],
        ['傍轴近似 d', fmt(nominal.dParaxialMm, 5) + ' mm'],
        ['模型相对残差', percent((nominal.dTraceMm - nominal.dParaxialMm) / nominal.dParaxialMm, 4)]
      ].map(function (item) {
        return '<div class="trace-note"><span>' + escapeHtml(item[0]) +
          '</span><strong>' + escapeHtml(item[1]) + '</strong></div>';
      }).join('');
    }
    var legend = $('traceLegend');
    if (legend) {
      legend.innerHTML = traceState.residual
        ? '<span class="legend-item"><i class="legend-line residual"></i>严格追迹相对傍轴残差</span>'
        : '<span class="legend-item"><i class="legend-line"></i>严格追迹趋势（模型）</span>' +
          (traceState.showParaxial
            ? '<span class="legend-item"><i class="legend-line paraxial"></i>傍轴近似</span>'
            : '');
    }
    setText('traceReadout', traceState.residual ? '悬停读取相对残差' : '悬停读取 d_trace 与 d_par');
    scheduleChartDraw();
  }

  function bindTrace() {
    var main = $('traceMainView');
    var residual = $('traceResidualView');
    var paraxial = $('traceParaxialToggle');
    if (main) {
      main.addEventListener('click', function () {
        traceState.residual = false;
        main.classList.add('active');
        residual.classList.remove('active');
        renderTrace();
      });
    }
    if (residual) {
      residual.addEventListener('click', function () {
        traceState.residual = true;
        residual.classList.add('active');
        main.classList.remove('active');
        renderTrace();
      });
    }
    if (paraxial) {
      paraxial.addEventListener('click', function () {
        traceState.showParaxial = !traceState.showParaxial;
        paraxial.classList.toggle('active', traceState.showParaxial);
        paraxial.setAttribute('aria-pressed', traceState.showParaxial ? 'true' : 'false');
        renderTrace();
      });
    }
    var canvas = $('traceChart');
    if (!canvas) return;
    canvas.addEventListener('pointermove', function (event) {
      var rect = canvas.getBoundingClientRect();
      var px = event.clientX - rect.left;
      var left = 66;
      var right = rect.width - 24;
      var ratio = Math.max(0, Math.min(1, (px - left) / Math.max(1, right - left)));
      var points = dataset.rayTrace.points;
      var index = Math.round(ratio * (points.length - 1));
      if (index === traceState.hoverIndex) return;
      traceState.hoverIndex = index;
      var point = points[index];
      setText('traceReadout',
        'a=' + fmt(point.aMm, 1) + ' mm · d_trace=' + fmt(point.dTraceMm, 5) +
        ' · d_par=' + fmt(point.dParaxialMm, 5) +
        ' · 残差=' + percent(point.relativeResidual, 3));
      scheduleChartDraw();
    });
    canvas.addEventListener('pointerleave', function () {
      traceState.hoverIndex = -1;
      setText('traceReadout', traceState.residual ? '悬停读取相对残差' : '悬停读取 d_trace 与 d_par');
      scheduleChartDraw();
    });
    global.addEventListener('resize', scheduleChartDraw);
  }

  function auditRows() {
    var rows = [];
    var seen = new Set();
    (dataset.provenance || []).forEach(function (item) {
      if (!item || !global.BP.reportData.isSourceType(item.sourceType)) return;
      var key = [item.field, item.value, item.sourceType, item.sourceDetail].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(item);
    });
    ['ratio', 'trace', 'magnification'].forEach(function (key) {
      var method = dataset.methods[key];
      (method && method.missing || []).forEach(function (item) {
        var keyText = methodLabel(key) + ' / ' + roleLabel(item.role);
        if (seen.has(keyText)) return;
        seen.add(keyText);
        rows.push({
          field: keyText,
          value: null,
          sourceType: 'missing',
          sourceDetail: item.reason
        });
      });
    });
    return rows;
  }

  function formatAuditValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') {
      if (Math.abs(value) > 0 && Math.abs(value) < 0.001) return value.toExponential(5);
      return value.toFixed(Math.abs(value) >= 100 ? 3 : 6).replace(/0+$/, '').replace(/\.$/, '');
    }
    return String(value);
  }

  function renderAudit() {
    var body = $('auditBody');
    if (!body) return;
    var rows = auditRows().filter(function (row) {
      return currentAuditFilter === 'all' || row.sourceType === currentAuditFilter;
    });
    body.innerHTML = rows.length ? rows.map(function (row) {
      return '<tr><td>' + escapeHtml(row.field) + '</td><td>' +
        escapeHtml(formatAuditValue(row.value)) + '</td><td>' +
        sourceChip(row.sourceType) + '</td><td>' +
        escapeHtml(row.sourceDetail || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="4">当前筛选没有记录</td></tr>';
    var list = $('warningList');
    if (list) {
      list.innerHTML = (dataset.warnings || []).map(function (warning, index) {
        return '<div class="warning-item"><span>W' + String(index + 1).padStart(2, '0') +
          '</span><div>' + escapeHtml(warning) + '</div></div>';
      }).join('');
    }
  }

  function renderGallery() {
    var grid = $('galleryGrid');
    if (!grid) return;
    var images = dataset.images || [];
    if (!images.length) {
      grid.innerHTML = '<div class="gallery-empty">尚未加载精选图片清单。' +
        '生成 <code>assets/report-images/manifest.json</code> 后将自动显示。</div>';
      return;
    }
    grid.innerHTML = images.map(function (image) {
      var category = CATEGORY_LABEL[image.category] || image.category || '实验图像';
      var wide = image.category === 'apparatus' || image.category === 'reticle';
      var src = image.reportPath || image.assetPath || '';
      return '<figure class="gallery-card' + (wide ? ' wide' : '') + '">' +
        '<img loading="lazy" src="' + escapeHtml(src) + '" alt="' + escapeHtml(image.caption || category) + '">' +
        '<figcaption class="gallery-copy"><div class="gallery-meta"><span>' +
        escapeHtml(category) + '</span><span>' +
        (finite(image.score) ? 'Q ' + fmt(image.score, 1) : '') + '</span></div>' +
        '<h3>' + escapeHtml(image.caption || category) + '</h3>' +
        '<p>' + escapeHtml(image.note || image.suggestion || '报告精选副本') + '</p>' +
        '<span class="gallery-path" title="' + escapeHtml(image.sourcePath || '') + '">原图：' +
        escapeHtml(image.sourcePath || '未记录') + '</span></figcaption></figure>';
    }).join('');
    Array.prototype.forEach.call(grid.querySelectorAll('img'), function (img) {
      img.addEventListener('error', function () {
        img.alt = '图片文件缺失：' + img.alt;
        img.style.opacity = '0.25';
      });
    });
  }

  function normalizeManifest(manifest) {
    if (Array.isArray(manifest)) return manifest;
    if (manifest && Array.isArray(manifest.images)) return manifest.images;
    return [];
  }

  function loadManifest() {
    return global.fetch('assets/report-images/manifest.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (manifest) {
        dataset.images = normalizeManifest(manifest);
        renderGallery();
      })
      .catch(function () {
        dataset.images = dataset.images || [];
        renderGallery();
      });
  }

  function renderDataset() {
    if (!dataset) return;
    renderSummary();
    renderGeometry();
    renderMethods();
    renderErrors();
    renderTrace();
    renderAudit();
    renderGallery();
  }

  function renderImportPreview(preview) {
    var box = $('importPreview');
    if (!box) return;
    var kind = preview.kind || 'unknown';
    var sessionCount = preview.dataset && preview.dataset.sessions
      ? preview.dataset.sessions.length : 0;
    var roleCounts = preview.dataset && preview.dataset.roleStats
      ? ['sodium', 'reference', 'no_lens', 'with_lens']
        .map(function (role) {
          return roleLabel(role) + ' ' + (preview.dataset.roleStats[role].n || 0) + ' 帧';
        }).join(' · ')
      : '没有可用角色摘要';
    var geometryText = preview.dataset && preview.dataset.actualGeometry
      ? '二次成像 d₁/d₂ 已识别，d=' + fmt(preview.dataset.actualGeometry.stats.dMm, 5) +
        ' mm，A_eff=' + fmt(preview.dataset.actualGeometry.stats.Adeg, 5) + '°'
      : '未携带二次成像 d₁/d₂ 记录';
    var errors = preview.errors || [];
    box.innerHTML =
      '<div class="preview-summary">' +
      '<div class="preview-cell"><span>格式</span><strong>' + escapeHtml(kind) + '</strong></div>' +
      '<div class="preview-cell"><span>摘要</span><strong>' + escapeHtml(preview.summary) + '</strong></div>' +
      '<div class="preview-cell"><span>会话</span><strong>' + sessionCount + '</strong></div>' +
      '</div>' +
      '<p class="method-purpose">' + escapeHtml(roleCounts + ' · ' + geometryText) + '</p>' +
      (errors.length
        ? '<ul class="preview-errors">' + errors.map(function (error) {
          return '<li class="preview-error"><code>' + escapeHtml(error.field || '$') +
            '</code>' + escapeHtml(error.message) + '</li>';
        }).join('') + '</ul>'
        : '<div class="inline-warning"><strong>OK</strong><span>' +
          '解析成功。确认后将替换报告当前数据；原平台 localStorage 会话不会被删除。</span></div>');
    var confirm = $('dialogConfirm');
    if (confirm) confirm.disabled = !preview.ok;
  }

  function openImportDialog(preview) {
    pendingDataset = preview.ok ? preview.dataset : null;
    renderImportPreview(preview);
    var dialog = $('importDialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeImportDialog() {
    var dialog = $('importDialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    pendingDataset = null;
  }

  function handleImportFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        openImportDialog({
          ok: false,
          kind: 'invalid-json',
          summary: file.name,
          errors: [{ field: '$', message: 'JSON 解析失败：' + error.message }],
          dataset: null
        });
        return;
      }
      var preview = global.BP.reportData.validateImport(parsed);
      preview.fileName = file.name;
      openImportDialog(preview);
    }).catch(function (error) {
      openImportDialog({
        ok: false,
        kind: 'read-error',
        summary: file.name,
        errors: [{ field: '$', message: '文件读取失败：' + (error.message || error) }],
        dataset: null
      });
    }).finally(function () {
      event.target.value = '';
    });
  }

  function confirmImport() {
    if (!pendingDataset) return;
    dataset = pendingDataset;
    pendingDataset = null;
    currentAuditFilter = 'all';
    traceState.hoverIndex = -1;
    Array.prototype.forEach.call(doc.querySelectorAll('.audit-filter'), function (button) {
      button.classList.toggle('active', button.dataset.filter === 'all');
    });
    saveLocal();
    renderDataset();
    loadManifest();
    closeImportDialog();
    toast('已更新报告数据；原会话存储未被修改');
    global.setTimeout(function () {
      $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function exportSnapshot() {
    if (!dataset) return;
    var snapshot = global.BP.reportData.toSnapshot(dataset, {
      auditFilter: currentAuditFilter,
      traceView: traceState.residual ? 'residual' : 'd-a',
      exportedFrom: 'report.html'
    });
    var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = 'fresnel-report-' + new Date().toISOString().slice(0, 10) + '.json';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    saveLocal();
    toast('已导出 bp.report/1 快照');
  }

  function bindAuditFilters() {
    Array.prototype.forEach.call(doc.querySelectorAll('.audit-filter'), function (button) {
      button.addEventListener('click', function () {
        currentAuditFilter = button.dataset.filter || 'all';
        Array.prototype.forEach.call(doc.querySelectorAll('.audit-filter'), function (other) {
          other.classList.toggle('active', other === button);
        });
        renderAudit();
      });
    });
  }

  function bindToc() {
    var links = Array.prototype.slice.call(doc.querySelectorAll('.report-toc a'));
    var sections = links.map(function (link) {
      return doc.querySelector(link.getAttribute('href'));
    }).filter(Boolean);
    if (!('IntersectionObserver' in global) || !sections.length) return;
    var observer = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (entry) { return entry.isIntersecting; })
        .sort(function (a, b) { return b.intersectionRatio - a.intersectionRatio; })[0];
      if (!visible) return;
      links.forEach(function (link) {
        link.classList.toggle('active',
          link.getAttribute('href') === '#' + visible.target.id);
      });
    }, { rootMargin: '-18% 0px -65% 0px', threshold: [0.01, 0.2, 0.5] });
    sections.forEach(function (section) { observer.observe(section); });
  }

  function bindUi() {
    var importButton = $('importButton');
    var importInput = $('importInput');
    if (importButton && importInput) {
      importButton.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', handleImportFile);
    }
    var dialogClose = $('dialogClose');
    var dialogCancel = $('dialogCancel');
    var dialogConfirm = $('dialogConfirm');
    if (dialogClose) dialogClose.addEventListener('click', closeImportDialog);
    if (dialogCancel) dialogCancel.addEventListener('click', closeImportDialog);
    if (dialogConfirm) dialogConfirm.addEventListener('click', confirmImport);
    var dialog = $('importDialog');
    if (dialog) {
      dialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        closeImportDialog();
      });
      dialog.addEventListener('click', function (event) {
        if (event.target === dialog) closeImportDialog();
      });
    }
    var exportButton = $('exportButton');
    if (exportButton) exportButton.addEventListener('click', exportSnapshot);
    var printButton = $('printButton');
    if (printButton) printButton.addEventListener('click', function () { global.print(); });
    bindTrace();
    bindAuditFilters();
    bindToc();
  }

  function init() {
    dataset = restoreLocal() || global.BP.reportData.createDefaultDataset();
    bindUi();
    renderDataset();
    loadManifest();
  }

  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
    else init();
  }

  global.BP = global.BP || {};
  global.BP.pages = global.BP.pages || {};
  global.BP.pages.report = {
    getDataset: function () { return dataset; },
    openImportPreview: function (record) {
      var preview = global.BP.reportData.validateImport(record);
      openImportDialog(preview);
      return preview;
    },
    confirmImport: confirmImport,
    render: renderDataset,
    drawTraceChart: drawTraceChart
  };
})(typeof window !== 'undefined' ? window : globalThis);
