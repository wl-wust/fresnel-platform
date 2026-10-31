/* check-ids.js —— 静态检查：JS 里引用的 DOM id 是否都存在于对应 HTML
 *
 * 为什么需要：审查报告 P2-5 记录的就是这一类缺陷——main_pure/mobile_merged 引用了
 * cameraInfo / compareResult / pathInputs / unc_pixel_k / wl 五个不存在的元素，
 * 一执行就 TypeError，而 node --check 完全看不出来（语法是对的）。
 *
 * 用法：node tools/check-ids.js            （<仓库>/tools/ 或 <仓库>/plat_review/tools/ 都可以）
 *       node tools/check-ids.js <index.html> <js 根目录>   （本机自验时指定路径）
 */
const fs = require('fs');
const path = require('path');

// 向上查找仓库根：以 plat_review/MANIFEST.sha256 为标志（放在 tools/ 或 plat_review/tools/ 都能定位）
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

const REPO = findRepo(__dirname) || path.resolve(__dirname, '..');   // 找不到就退回"上两级结构"
const ROOT = REPO;
const ALT = path.resolve(__dirname, '..');

// 顺序要紧：仓库根的 js/ 优先（部署文件优先于设计副本），其余是兜底布局
const BASES = [path.join(ROOT, 'js'), ROOT, ALT, path.join(ALT, 'site'),
               path.join(ROOT, 'fresnel-platform'), path.join(ROOT, 'fresnel-platform', 'js')];

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

// 报告里始终打印"实际检查的是哪个文件"，避免"检查了设计副本却当成部署文件"的假通过
function report(htmlFile, jsRel, jsFile, have) {
  checkedFiles++;
  const want = idsInJs(jsFile);
  const missing = [...want].filter(id => !have.has(id) && !ALLOW.has(id));
  const rel = path.relative(REPO, jsFile) || jsFile;
  if (missing.length) {
    problems++;
    console.log('FAIL  ' + path.basename(htmlFile) + ' ← ' + rel + '  缺少 id: ' + missing.join(', '));
  } else {
    console.log('PASS  ' + path.basename(htmlFile) + ' ← ' + rel +
                '（引用 ' + want.size + ' 个 id，全部存在）');
  }
}

const argv = process.argv.slice(2);
if (argv[0]) {
  // 指定模式：node check-ids.js <html> [js 根目录]
  const htmlFile = path.resolve(argv[0]);
  const jsRoot = path.resolve(argv[1] || path.dirname(htmlFile));
  if (!fs.existsSync(htmlFile)) { console.log('FAIL  ' + htmlFile + ' 不存在'); process.exit(1); }
  const have = idsInHtml(htmlFile);
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.js$/.test(e.name) && !/[\\/]physics/.test(p)) report(htmlFile, p, p, have);
    }
  };
  walk(jsRoot, 0);
} else {
  for (const row of MAP) {
    const htmlFile = find(row.html);
    if (!htmlFile) { console.log('SKIP  ' + row.html + '（未找到，可能还没生成）'); continue; }
    const have = idsInHtml(htmlFile);
    for (const jsRel of row.js) {
      const jsFile = find(jsRel);
      if (!jsFile) { console.log('SKIP  ' + jsRel + '（未找到）'); continue; }
      report(htmlFile, jsRel, jsFile, have);
    }
  }
}

console.log('\n检查 ' + checkedFiles + ' 个 JS 文件，' + problems + ' 处缺 id');
if (checkedFiles === 0) { console.log('FAIL  一个文件都没检查到 —— 这不是通过'); process.exit(1); }
process.exit(problems ? 1 : 0);
