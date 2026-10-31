/* =========================================================================
 * core/store.js —— localStorage（历史/标定/参数）+ record.json 导入导出
 * 依赖：无
 * 铁律：
 *   1) record 只存原始量（Δx、k、a、A、n、D…），不存 589.31 nm 这类结论；
 *   2) 所有 localStorage 访问包 try/catch —— Safari 无痕会抛 SecurityError，
 *      旧版 mobile_merged.js:745 就是在 DOMContentLoaded 里裸调导致整页初始化中断；
 *   3) CSV 必须转义（含逗号/引号/换行的字段整体加引号，内部引号翻倍）。
 * ========================================================================= */
(function (global) {
  'use strict';

  var K = {
    history: 'bp.history.v1',
    k: 'bp.k.v1',
    params: 'bp.params.v1',
    records: 'bp.records.v1'
  };
  var RECORD_SCHEMA = 'bp.record/1';

  function LS() { try { return global.localStorage || null; } catch (e) { return null; } }

  function get(key, dflt) {
    var ls = LS(); if (!ls) return dflt;
    try { var s = ls.getItem(key); return s == null ? dflt : JSON.parse(s); } catch (e) { return dflt; }
  }

  function set(key, val) {
    var ls = LS(); if (!ls) return false;
    try { ls.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  function del(key) {
    var ls = LS(); if (!ls) return false;
    try { ls.removeItem(key); return true; } catch (e) { return false; }
  }

  /* ---------------- CSV ---------------- */
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(head, rows) {
    var out = [(head || []).map(csvCell).join(',')];
    (rows || []).forEach(function (r) { out.push((r || []).map(csvCell).join(',')); });
    return out.join('\r\n') + '\r\n';
  }

  // 触发下载（浏览器外安全退出）
  function download(filename, text, mime) {
    var d = global.document;
    if (!d || !global.Blob || !global.URL || !global.URL.createObjectURL) return false;
    var blob = new global.Blob(['\ufeff' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = global.URL.createObjectURL(blob);
    var a = d.createElement('a');
    a.href = url; a.download = filename;
    d.body.appendChild(a); a.click();
    d.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
    return true;
  }

  /* ---------------- 历史记录 ---------------- */
  function saveHistory(type, payload) {
    var list = get(K.history, []) || [];
    list.unshift({ at: new Date().toISOString(), type: String(type || ''), data: payload || {} });
    if (list.length > 200) list = list.slice(0, 200);
    return set(K.history, list);
  }

  function listHistory() { return get(K.history, []) || []; }
  function clearHistory() { return del(K.history); }

  function historyCSV() {
    var list = listHistory();
    var rows = list.map(function (it, i) {
      return [i + 1, it.at, it.type, JSON.stringify(it.data)];
    });
    return toCSV(['序号', '时间', '类型', '内容(JSON)'], rows);
  }

  function exportHistory() {
    return download('fresnel-history-' + stamp() + '.csv', historyCSV(), 'text/csv');
  }

  /* ---------------- 像素当量标定（式 24：k = L/N） ---------------- */
  function loadK() { return get(K.k, null); }
  function saveK(value, meta) {
    return set(K.k, { value: value, L: meta && meta.L, N: meta && meta.N,
                      source: (meta && meta.source) || 'manual', at: new Date().toISOString() });
  }
  function clearK() { return del(K.k); }

  /* ---------------- 测量记录 record.json ---------------- */
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function listRecords() { return get(K.records, []) || []; }
  function removeRecord(id) {
    return set(K.records, listRecords().filter(function (r) { return r && r.id !== id; }));
  }
  function getRecord(id) {
    var found = listRecords().filter(function (r) { return r && r.id === id; });
    return found.length ? found[0] : null;
  }

  // 存一条记录；缺 id 时用时间戳补
  function saveRecord(rec) {
    if (!rec || rec.schema !== RECORD_SCHEMA) throw new Error('record 版本不符：需要 schema = ' + RECORD_SCHEMA);
    var r = JSON.parse(JSON.stringify(rec));
    if (!r.id) r.id = 'rec-' + Date.now();
    var list = listRecords().filter(function (x) { return x && x.id !== r.id; });
    list.unshift(r);
    set(K.records, list.slice(0, 20));
    return r.id;
  }

  function exportRecord(id) {
    var r = id ? getRecord(id) : listRecords()[0];
    if (!r) return false;
    return download('record-' + stamp() + '.json', JSON.stringify(r, null, 2), 'application/json');
  }

  // File → Promise<record>，含 schema 校验
  function importRecord(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('没有选择文件')); return; }
      var FR = global.FileReader;
      if (!FR) { reject(new Error('当前环境不支持读取文件')); return; }
      var fr = new FR();
      fr.onload = function () {
        try {
          var rec = JSON.parse(String(fr.result));
          if (!rec || rec.schema !== RECORD_SCHEMA) {
            throw new Error('不是本平台的记录文件（需要 schema = ' + RECORD_SCHEMA + '）');
          }
          resolve(rec);
        } catch (e) { reject(e); }
      };
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.readAsText(file, 'utf-8');
    });
  }

  /* ---------------- 参数预设（表 5.1） ---------------- */
  function loadParams() { return get(K.params, null); }
  function saveParams(p) { return set(K.params, p); }

  global.BP = global.BP || {};
  global.BP.store = {
    K: K, RECORD_SCHEMA: RECORD_SCHEMA,
    get: get, set: set, del: del,
    toCSV: toCSV, csvCell: csvCell, download: download,
    saveHistory: saveHistory, listHistory: listHistory,
    clearHistory: clearHistory, historyCSV: historyCSV, exportHistory: exportHistory,
    loadK: loadK, saveK: saveK, clearK: clearK,
    listRecords: listRecords, getRecord: getRecord, saveRecord: saveRecord,
    removeRecord: removeRecord, exportRecord: exportRecord, importRecord: importRecord,
    loadParams: loadParams, saveParams: saveParams
  };
})(typeof window !== 'undefined' ? window : globalThis);
