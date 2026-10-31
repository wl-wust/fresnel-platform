/* =========================================================================
 * core/api.js —— 唯一的后端出口（永久为空）
 * 决策（任务书 §1 第 4 条）：平台是纯前端，不接 Flask、不加 CORS。
 * 这个文件存在的意义：将来真有后端时，只需改 API_BASE 一处；
 * 业务代码里禁止出现裸 fetch。
 * ========================================================================= */
(function (global) {
  'use strict';

  global.API_BASE = global.API_BASE || '';

  function ready() { return !!global.API_BASE; }

  function fetchJSON(path, opts) {
    if (!global.API_BASE) {
      return Promise.reject(new Error('本平台为纯前端版本，' + path + ' 已停用，请使用页面内的计算按钮'));
    }
    opts = opts || {};
    var ctrl = global.AbortController ? new global.AbortController() : null;
    var timer = ctrl ? global.setTimeout(function () { ctrl.abort(); }, 15000) : null;
    var init = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) init[k] = opts[k];
    if (ctrl) init.signal = ctrl.signal;

    return global.fetch(global.API_BASE + path, init).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) throw new Error('HTTP ' + res.status + '：' + text.slice(0, 120));
        return JSON.parse(text);
      });
    }).then(function (data) {
      if (timer) global.clearTimeout(timer);
      return data;
    }, function (err) {
      if (timer) global.clearTimeout(timer);
      throw err;
    });
  }

  global.fetchJSON = fetchJSON;

  global.BP = global.BP || {};
  global.BP.api = { ready: ready, fetchJSON: fetchJSON, get base() { return global.API_BASE || ''; } };
})(typeof window !== 'undefined' ? window : globalThis);
