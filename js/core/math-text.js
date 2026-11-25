/* 将页面中的数学变量名渲染为原生下角标，例如 Δx_Na -> Δx<sub>Na</sub>。 */
(function () {
  'use strict';

  var SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'title',
    'input', 'textarea', 'select', 'option',
    'pre', 'code', 'sub', 'sup',
    '[contenteditable="true"]'
  ].join(',');

  /* 只匹配数学变量，不触碰文件名、字段名或其他带下划线的代码标识。 */
  var MATH_PATTERN = /(^|[^A-Za-z0-9])(Δx|Δw|[ΔλnAdUuEνk])_([A-Za-z0-9,-]+|预设)/g;

  function shouldSkip(node) {
    var element = node.parentElement;
    while (element) {
      if (element.matches && element.matches(SKIP_SELECTOR)) return true;
      element = element.parentElement;
    }
    return false;
  }

  function subscript(text) {
    var node = document.createElement('sub');
    node.className = 'math-sub';
    node.textContent = text;
    return node;
  }

  function transformTextNode(textNode) {
    var text = textNode.nodeValue;
    if (!text || text.indexOf('_') === -1 || shouldSkip(textNode)) return;

    MATH_PATTERN.lastIndex = 0;
    var fragment = document.createDocumentFragment();
    var match;
    var cursor = 0;
    var changed = false;

    while ((match = MATH_PATTERN.exec(text)) !== null) {
      var tokenStart = match.index + match[1].length;
      if (tokenStart > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, tokenStart)));
      }
      fragment.appendChild(document.createTextNode(match[2]));
      fragment.appendChild(subscript(match[3]));
      cursor = match.index + match[0].length;
      changed = true;
    }

    if (!changed) return;
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function transformTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      transformTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (root.nodeType === Node.ELEMENT_NODE &&
        root.matches &&
        root.matches(SKIP_SELECTOR)) {
      return;
    }

    var walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(transformTextNode);
  }

  function observe() {
    transformTree(document.body);

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') {
          transformTextNode(mutation.target);
          return;
        }
        mutation.addedNodes.forEach(transformTree);
      });
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  if (document.body) {
    observe();
  } else {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  }
})();
