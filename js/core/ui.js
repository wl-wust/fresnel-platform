/* =========================================================================
 * core/ui.js —— 结果块 / 表格 / 提示 / 无障碍
 * 依赖：无（只用 DOM API；在 Node 下 require 不报错，但函数退化为 no-op）
 * 铁律：一切用户可见文本走 textContent 或 esc()，禁止 innerHTML 拼接。
 * ========================================================================= */
(function (global) {
  'use strict';

  function doc() { return global.document || null; }

  function $(id) { var d = doc(); return d ? d.getElementById(id) : null; }

  function $$(sel, root) {
    var d = doc(); if (!d) return [];
    var scope = root || d;
    return Array.prototype.slice.call(scope.querySelectorAll(sel));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function css(el, map) {
    if (!el || !map) return el;
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) el.style[k] = map[k];
    return el;
  }

  function el(tag, cls, text) {
    var d = doc(); if (!d) return null;
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function clear(node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); }

  function toastHost() {
    var d = doc(); if (!d || !d.body) return null;
    var h = d.getElementById('bpToastHost');
    if (!h) {
      h = el('div', 'bp-toast-host');
      h.id = 'bpToastHost';
      h.setAttribute('role', 'status');
      h.setAttribute('aria-live', 'polite');
      d.body.appendChild(h);
    }
    return h;
  }

  // 全平台唯一的错误/提示出口，替代旧 showAlert（禁止静默失败）
  function alert(msg, type) {
    type = (type === 'ok' || type === 'info') ? type : 'error';
    var host = toastHost();
    if (!host) { if (global.console) global.console.log('[' + type + '] ' + msg); return; }
    var it = el('div', 'bp-toast bp-toast--' + type, msg);
    it.addEventListener('click', function () { if (it.parentNode) it.parentNode.removeChild(it); });
    host.appendChild(it);
    global.setTimeout(function () { if (it.parentNode) it.parentNode.removeChild(it); }, type === 'error' ? 7000 : 4000);
  }

  function loading(on) {
    var b = $('bpLoading');
    if (!b) return;
    b.style.display = on ? 'flex' : 'none';
    b.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // rows: [{ label, value, cls, note }]，value 可以是字符串或 DOM 节点（如 badge）
  function result(target, rows, opts) {
    var d = doc(); if (!target || !d) return;
    clear(target);
    var box = el('div', 'bp-result');
    (rows || []).forEach(function (r) {
      if (!r) return;
      var row = el('div', 'bp-result__row' + (r.cls ? ' ' + r.cls : ''));
      row.appendChild(el('span', 'bp-result__label', r.label == null ? '' : r.label));
      var v = el('span', 'bp-result__value');
      if (r.value && r.value.nodeType === 1) v.appendChild(r.value);
      else v.textContent = r.value == null ? '' : String(r.value);
      row.appendChild(v);
      box.appendChild(row);
      if (r.note) box.appendChild(el('div', 'bp-result__note', r.note));
    });
    if (opts && opts.caption) {
      var cap = el('div', 'bp-result__caption', opts.caption);
      box.insertBefore(cap, box.firstChild);
    }
    target.appendChild(box);
  }

  function row(cells, tag) {
    var tr = el('tr', null);
    (cells || []).forEach(function (c) {
      var td = el(tag || 'td');
      if (c && c.nodeType === 1) td.appendChild(c); else td.textContent = c == null ? '' : String(c);
      tr.appendChild(td);
    });
    return tr;
  }

  // table(target, thead[], rows[][], opts)
  function table(target, thead, rows, opts) {
    var d = doc(); if (!target || !d) return;
    clear(target);
    var t = el('table', 'bp-table');
    if (opts && opts.caption) {
      var cap = el('caption', null, opts.caption);
      t.appendChild(cap);
    }
    if (thead && thead.length) {
      var th = el('thead'), tr = el('tr');
      thead.forEach(function (h) { tr.appendChild(el('th', null, h)); });
      th.appendChild(tr); t.appendChild(th);
    }
    var tb = el('tbody');
    (rows || []).forEach(function (r) {
      if (!r) return;
      var cls = r.cls;
      var tr = row(r.cells || r, 'td');
      if (cls) tr.className = cls;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var wrap = el('div', 'bp-table-wrap');
    wrap.appendChild(t);
    target.appendChild(wrap);
  }

  // 一致性结论徽标：'一致' / '需复核'
  function badge(ok, textOk, textBad) {
    var b = el('span', 'bp-badge bp-badge--' + (ok ? 'ok' : 'bad'), ok ? (textOk || '一致') : (textBad || '需复核'));
    if (b) b.setAttribute('role', 'note');
    return b;
  }

  global.BP = global.BP || {};
  global.BP.ui = {
    $: $, $$: $$, esc: esc, css: css, el: el, clear: clear,
    alert: alert, loading: loading, result: result, table: table, badge: badge
  };
})(typeof window !== 'undefined' ? window : globalThis);
