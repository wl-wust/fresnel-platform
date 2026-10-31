/* check-html-structure.js —— 标签配对检查（这轮我用手工字符串手术改 HTML，最怕嵌套失衡）
 *
 * 检查：build/*.html 与部署侧的同名页面里，容器标签是否成对。
 * 只跟踪"可能被我改坏"的块级标签；p/span/a/button 这类允许隐式闭合的不参与，
 * 避免误报。
 *
 * 用法：node tools/check-html-structure.js
 */
const fs = require('fs');
const path = require('path');

function findRepo(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'plat_review', 'MANIFEST.sha256'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
const REPO = findRepo(__dirname);
if (!REPO) { console.log('FAIL  找不到仓库根（缺 plat_review/MANIFEST.sha256）'); process.exit(1); }

const TRACK = new Set(['div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
                       'ul', 'ol', 'li', 'section', 'nav', 'header', 'footer',
                       'form', 'select', 'textarea', 'video', 'canvas', 'main', 'figure']);

const FILES = [
  'index.html', 'mobile.html', 'optical.html',
  'plat_review/build/index.html', 'plat_review/build/mobile.html', 'plat_review/build/optical.html'
];

function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, '$1$3')
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, '$1$3');
}

function lineAt(src, idx) { return src.slice(0, idx).split('\n').length; }

let bad = 0, checked = 0;
for (const rel of FILES) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) continue;
  checked++;
  const src = strip(fs.readFileSync(p, 'utf8'));
  const stack = [];
  const errs = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = m[4] === '/';
    if (!TRACK.has(tag)) continue;
    if (selfClose) continue;
    if (!closing) { stack.push({ tag: tag, line: lineAt(src, m.index) }); continue; }
    const top = stack.pop();
    if (!top) { errs.push('多余的 </' + tag + '> 在第 ' + lineAt(src, m.index) + ' 行'); continue; }
    if (top.tag !== tag) {
      errs.push('第 ' + top.line + ' 行 <' + top.tag + '> 被第 ' + lineAt(src, m.index) + ' 行的 </' + tag + '> 关闭');
    }
  }
  stack.forEach(s => errs.push('第 ' + s.line + ' 行 <' + s.tag + '> 没有闭合'));

  if (errs.length) {
    bad++;
    console.log('FAIL  ' + rel);
    errs.slice(0, 6).forEach(e => console.log('      ' + e));
    if (errs.length > 6) console.log('      …共 ' + errs.length + ' 处');
  } else {
    console.log('PASS  ' + rel + '（标签配对正常）');
  }
}

console.log('\n' + (bad === 0 ? 'HTML 结构检查通过' : bad + ' 个文件结构失衡') + '（检查 ' + checked + ' 个页面）');
process.exit(bad === 0 && checked > 0 ? 0 : 1);
