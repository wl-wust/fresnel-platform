/* video-sampler.js —— 视频抽帧评分、候选去重与达标判断
 * 纯函数模块，浏览器的实时采集和本地视频导入共用同一套口径。
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    target: 20,
    minGapMs: 500,
    minVisibility: 0.03,
    minSnr: 6,
    minAcf: 0.2,
    maxCrossDiff: 0.02,
    maxSaturation: 0.02,
    maxCv: 0.005,
    // 稳健簇宽度以 MAD 的倍数定义，避免少数高分行把主周期整体拉偏。
    clusterMadScale: 2
  };
  var SHORT_VIDEO_SECONDS = 10;
  var SHORT_VIDEO_TARGET = 5;

  function num(value) {
    return isFinite(Number(value)) ? Number(value) : 0;
  }

  function options(overrides) {
    return Object.assign({}, DEFAULTS, overrides || {});
  }

  function isValid(item, overrides) {
    var o = options(overrides);
    return !!item &&
      isFinite(item.deltaXPx) && Number(item.deltaXPx) > 0 &&
      num(item.visibility) >= o.minVisibility &&
      num(item.spectralSnr) >= o.minSnr &&
      num(item.acfPeak) >= o.minAcf &&
      num(item.crossDiff) <= o.maxCrossDiff &&
      num(item.saturationRatio) <= o.maxSaturation;
  }

  // 五个指标统一到 0~1，避免可见度单独主导选择结果。
  function score(item) {
    if (!item) return 0;
    var visibility = Math.min(1, Math.max(0, num(item.visibility)) / 0.25);
    var snr = Math.min(1, Math.max(0, num(item.spectralSnr)) / 15);
    var acf = Math.min(1, Math.max(0, num(item.acfPeak)));
    var cross = 1 - Math.min(1, Math.max(0, num(item.crossDiff)) / DEFAULTS.maxCrossDiff);
    var saturation = 1 - Math.min(1, Math.max(0, num(item.saturationRatio)) / DEFAULTS.maxSaturation);
    return 0.35 * visibility + 0.25 * snr + 0.20 * acf + 0.10 * cross + 0.10 * saturation;
  }

  function calibrationRank(item) {
    var status = item && item.calibrationStatus;
    if (status === 'autoAccepted' || status === 'manualAccepted') return 2;
    if (status === 'pending') return 1;
    return 0;
  }

  function median(values) {
    if (!values || !values.length) return NaN;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /* 只从已通过原有单帧门限的候选中选取主周期稳健簇。
   * MAD 对少量漂移帧不敏感；簇宽以外的帧仍留在页面候选池中供用户检查。
   */
  function clusterCandidates(items, overrides) {
    var o = options(overrides);
    var valid = (items || [])
      .filter(function (item) { return isValid(item, o) && !item.excluded; })
      .map(function (item) {
        return Object.assign({}, item, { score: isFinite(item.score) ? Number(item.score) : score(item) });
      });
    var values = valid.map(function (item) { return Number(item.deltaXPx); });
    var center = median(values);
    var deviations = values.map(function (value) { return Math.abs(value - center); });
    var mad = median(deviations);
    var tolerance = isFinite(mad) && mad > 0
      ? Number(o.clusterMadScale) * 1.4826 * mad
      : 0;
    var clustered = valid.filter(function (item) {
      return Math.abs(Number(item.deltaXPx) - center) <= tolerance + 1e-9;
    });
    return {
      items: clustered,
      validCount: valid.length,
      clusterCount: clustered.length,
      excludedCount: valid.length - clustered.length,
      centerPx: isFinite(center) ? center : null,
      madPx: isFinite(mad) ? mad : null,
      tolerancePx: tolerance
    };
  }

  // 先取主周期稳健簇，再优先选已有同帧标定证据者，最后按质量排序。
  function selectCandidates(items, overrides) {
    var o = options(overrides);
    var max = isFinite(o.maxCandidates) && Number(o.maxCandidates) > 0
      ? Math.floor(Number(o.maxCandidates))
      : 60;
    var cluster = clusterCandidates(items, o);
    var center = cluster.centerPx;
    return cluster.items
      .sort(function (a, b) {
        var distanceA = Math.abs(Number(a.deltaXPx) - center);
        var distanceB = Math.abs(Number(b.deltaXPx) - center);
        if (distanceA !== distanceB) return distanceA - distanceB;
        if (calibrationRank(b) !== calibrationRank(a)) {
          return calibrationRank(b) - calibrationRank(a);
        }
        if (b.score !== a.score) return b.score - a.score;
        return num(a.timeMs) - num(b.timeMs);
      })
      .reduce(function (out, item) {
        if (out.length >= max) return out;
        var tooClose = out.some(function (kept) {
          return Math.abs(num(kept.timeMs) - num(item.timeMs)) < o.minGapMs;
        });
        if (!tooClose) out.push(item);
        return out;
      }, []);
  }

  function summary(items) {
    var values = (items || []).map(function (item) {
      return Number(item.deltaXPx);
    }).filter(function (value) {
      return isFinite(value) && value > 0;
    });
    var mean = values.length
      ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length
      : NaN;
    var sd = NaN;
    if (values.length > 1) {
      sd = Math.sqrt(values.reduce(function (sum, value) {
        return sum + (value - mean) * (value - mean);
      }, 0) / (values.length - 1));
    }
    var stripeValues = (items || []).map(function (item) {
      return Number(item.stripeCount);
    }).filter(function (value) {
      return isFinite(value) && value > 0;
    });
    var meanStripeCount = stripeValues.length
      ? stripeValues.reduce(function (sum, value) { return sum + value; }, 0) / stripeValues.length
      : NaN;
    return {
      n: values.length,
      meanPx: mean,
      sdPx: sd,
      cv: isFinite(mean) && mean ? sd / mean : NaN,
      meanStripeCount: meanStripeCount
    };
  }

  function isEnough(items, target, overrides) {
    var o = options(overrides);
    var wanted = isFinite(target) && Number(target) > 0 ? Math.floor(Number(target)) : o.target;
    var picked = selectCandidates(items, {
      minGapMs: o.minGapMs,
      maxCandidates: wanted
    });
    var stats = summary(picked);
    return stats.n >= wanted && isFinite(stats.cv) && stats.cv <= o.maxCv;
  }

  function pickMimeType(list, recorderCtor) {
    var probe = recorderCtor || global.MediaRecorder;
    if (!probe || typeof probe.isTypeSupported !== 'function') return '';
    for (var i = 0; i < (list || []).length; i++) {
      if (probe.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }

  function filenamePart(value) {
    return String(value || 'session').replace(/[^A-Za-z0-9_-]+/g, '-');
  }

  function recordingFilename(sessionId, method, role, date) {
    var stamp = (date || new Date()).toISOString().replace(/[:.]/g, '-');
    return filenamePart(sessionId) + '-' + filenamePart(method) + '-' +
      filenamePart(role) + '-' + stamp + '.webm';
  }

  function sampleTimes(durationSec, gapSec) {
    var gap = Number(gapSec) > 0 ? Number(gapSec) : 0.5;
    var duration = Number(durationSec);
    var count = isFinite(duration) && duration > 0
      ? Math.max(1, Math.floor(duration / gap))
      : 1;
    var result = [];
    for (var i = 0; i < count; i++) result.push(Number((i * gap).toFixed(3)));
    return result;
  }

  /* 短片采用更密的覆盖采样；长视频仍限制解码次数。
   * 该函数只改变采样覆盖，不改变任何单帧质量门限。
   */
  function adaptiveGap(durationSec) {
    var duration = Number(durationSec);
    if (!(duration > 0)) return DEFAULTS.minGapMs / 1000;
    if (duration <= 12) {
      var raw = duration / 40;
      var rounded = Math.round(raw / 0.05) * 0.05;
      return Number(Math.max(0.1, Math.min(0.5, rounded)).toFixed(2));
    }
    return Math.max(0.5, Math.ceil(duration / 600 * 2) / 2);
  }

  /* 10 秒以内视频自动建议 5 帧参考目标；页面会显示该策略。
   * 该目标只调整样本数，不降低 isValid 的质量门限。
   */
  function recommendedTarget(durationSec, requested) {
    var duration = Number(durationSec);
    var target = isFinite(requested) && Number(requested) > 0
      ? Math.floor(Number(requested))
      : DEFAULTS.target;
    return duration > 0 && duration <= SHORT_VIDEO_SECONDS && target > SHORT_VIDEO_TARGET
      ? SHORT_VIDEO_TARGET
      : target;
  }

  /* 短片自动切到 5 帧后，选择器会保留 5 以便确认参考帧。
   * 下一次导入长视频时，需恢复用户上一次显式选择，避免批量导入悄然降标。
   */
  function planImportTargets(durationSec, selectedTarget, previousExplicitTarget) {
    var duration = Number(durationSec);
    var selected = isFinite(selectedTarget) && Number(selectedTarget) > 0
      ? Math.floor(Number(selectedTarget))
      : DEFAULTS.target;
    var explicit = isFinite(previousExplicitTarget) && Number(previousExplicitTarget) > 0
      ? Math.floor(Number(previousExplicitTarget))
      : selected;
    var restored = duration > SHORT_VIDEO_SECONDS &&
      selected === SHORT_VIDEO_TARGET && explicit !== SHORT_VIDEO_TARGET;
    var requested = restored ? explicit : selected;
    var effective = recommendedTarget(duration, requested);
    return {
      requestedTarget: requested,
      effectiveTarget: effective,
      autoAdjusted: effective !== requested,
      restored: restored
    };
  }

  var API = {
    DEFAULTS: DEFAULTS,
    isValid: isValid,
    score: score,
    clusterCandidates: clusterCandidates,
    selectCandidates: selectCandidates,
    summary: summary,
    isEnough: isEnough,
    pickMimeType: pickMimeType,
    recordingFilename: recordingFilename,
    sampleTimes: sampleTimes,
    adaptiveGap: adaptiveGap,
    recommendedTarget: recommendedTarget,
    planImportTargets: planImportTargets
  };

  global.BP = global.BP || {};
  global.BP.videoSampler = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
