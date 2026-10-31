/* check-ids.js —— 静态检查：JS 里引用的 DOM id 是否都存在于对应 HTML
 *
 * 为什么需要：审查报告 P2-5 记录的就是这一类缺陷——main_pure/mobile_merged 引用了
 * cameraInfo / compareResult / pathInputs / unc_pixel_k / wl 五个不存在的元素，
 * 一执行就 TypeError，而 node --check 完全看不出来（语法是对的）。
 *
 * 用法：node plat_review/tools/check-ids.js       （单侧/双侧布局都能跑，缺文件只告警）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');          // 仓库根（plat_review/tools → ../..）
const ALT = path.resolve(__dirname, '..');              // 设计侧布局（plat_review/）
// 任何相对路径在这些目录下找：仓库根、设计侧、审查快照、本地基线树
const BASES = [ROOT, ALT, path.join(ALT, 'site'), path.join(ROOT, 'fresnel-platform'),
               path.join(ROOT, 'fresnel-platform', 'js'), path.join(ROOT, 'js')];

// 页面 → 参与检查的 JS（core 里只有真正查 DOM 的文件才算）
const MAP = [
  { html: 'index.html',  js: ['pages/pc.js', 'core/ui.js'] },
  { html: 'mobile.html', js: ['pages/mobile.js', 'core/ui.js'] },
  { html: 'optical.html', js: ['pages/optical.js'] }
];

// 动态创建 / 可选容器，允许不存在（缺了只是功能降级，不是错误）
const ALLOW = new Set(['bpToastHost', 'bpLoading', 'video', 'cameraControls', 'previewBox', 'fileInput']);

function find(rel) {
  for (const b of BASES) { const p = path.join(b, rel); if (fs.existsSync(p)) return p; }
  return null;
}

function idsInHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

// $('x') / getElementById('x') / #x 选择器；若文件里有显式 IDS 清单则优先用它
// （pc.js 通过 num(id) 间接取元素，正则看不穿，必须靠清单，否则会假阴性）
function idsInJs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ids = new Set();
  const block = /IDS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (block) {
    for (const m of block[1].matchAll(/'([A-Za-z_][\w-]*)'/g)) ids.add(m[1]);
  }
  for (const m of src.matchAll(/(?:\$\(|getElementById\(\s*)'([A-Za-z_][\w-]*)'/g)) ids.add(m[1]);
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*'#([A-Za-z_][\w-]*)/g)) ids.add(m[1]);
  return ids;
}

let problems = 0, checkedFiles = 0;
for (const row of MAP) {
  const htmlFile = find(row.html);
  if (!htmlFile) { console.log('SKIP  ' + row.html + '（未找到，可能还没生成）'); continue; }
  const have = idsInHtml(htmlFile);
  for (const jsRel of row.js) {
    const jsFile = find(jsRel);
    if (!jsFile) { console.log('SKIP  ' + jsRel + '（未找到）'); continue; }
    checkedFiles++;
    const want = idsInJs(jsFile);
    const missing = [...want].filter(id => !have.has(id) && !ALLOW.has(id));
    if (missing.length) {
      problems++;
      console.log('FAIL  ' + row.html + ' ← ' + jsRel + ' 缺少 id: ' + missing.join(', '));
    } else {
      console.log('PASS  ' + row.html + ' ← ' + jsRel + '（引用 ' + want.size + ' 个 id，全部存在）');
    }
  }
}

console.log('\n检查 ' + checkedFiles + ' 个 JS 文件，' + problems + ' 处缺 id');
process.exit(problems ? 1 : 0);
