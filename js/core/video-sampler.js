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
    maxCv: 0.005
  };

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

  // 先按质量排序，再剔除时间上过近的帧；返回顺序也按质量从高到低。
  function selectCandidates(items, overrides) {
    var o = options(overrides);
    var max = isFinite(o.maxCandidates) && Number(o.maxCandidates) > 0
      ? Math.floor(Number(o.maxCandidates))
      : 60;
    return (items || [])
      .filter(function (item) { return isValid(item, o) && !item.excluded; })
      .map(function (item) {
        return Object.assign({}, item, { score: isFinite(item.score) ? Number(item.score) : score(item) });
      })
      .sort(function (a, b) {
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
    return {
      n: values.length,
      meanPx: mean,
      sdPx: sd,
      cv: isFinite(mean) && mean ? sd / mean : NaN
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

  var API = {
    DEFAULTS: DEFAULTS,
    isValid: isValid,
    score: score,
    selectCandidates: selectCandidates,
    summary: summary,
    isEnough: isEnough,
    pickMimeType: pickMimeType,
    recordingFilename: recordingFilename,
    sampleTimes: sampleTimes
  };

  global.BP = global.BP || {};
  global.BP.videoSampler = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
