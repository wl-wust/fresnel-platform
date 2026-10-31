/* check-release.js —— 发布前审计：多余文件 + 首屏体积台账
 *
 * 为什么需要：现有 13 条自检都只查"该有的在不在"，没有一条查"多了什么"。
 *   `js/index.html` 就是早期 cp 位置写错留下的孤儿文件，一直躺在仓库里没人发现
 *   （审查报告 §8 发布清单第 5 条：删掉未用的文件、首屏体积下降）。
 *
 * 做三件事：
 *   ① 孤儿检测：js/ 与 css/ 下没有被任何页面引用的文件（= 该删的残留）
 *   ② 首屏台账：每页实际加载的 css + js 字节数（给报告用的数字）
 *   ③ 大文件预警：任何被引用的单个 js/css 超过 100 KB
 *
 * 用法：node tools/check-release.js
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

const PAGES = ['index.html', 'mobile.html', 'optical.html', '404.html'];
const KEEP_UNREFERENCED = new Set([
  // 有意保留、不被页面直接引用：
  // data/params.default.json —— 报告表 5.1 的机器可读副本（文档性），也让将来接后端时有一个数据源
]);

function refsOf(page) {
  const src = fs.readFileSync(path.join(REPO, page), 'utf8');
  const out = [];
  for (const m of src.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|data:|mailto:|#)/.test(raw)) continue;
    const rel = raw.split('?')[0].split('#')[0];
    if (rel && /\.(js|css)$/.test(rel)) out.push(rel);
  }
  return [...new Set(out)];
}

// ① 收集引用
const used = new Set();
const budget = {};
for (const page of PAGES) {
  const p = path.join(REPO, page);
  if (!fs.existsSync(p)) continue;
  const list = refsOf(page);
  list.forEach(r => used.add(path.normalize(r)));
  let bytes = fs.statSync(p).size;
  const parts = [];
  for (const r of list) {
    const fp = path.join(REPO, r);
    if (fs.existsSync(fp)) { const b = fs.statSync(fp).size; bytes += b; parts.push(r + ' ' + (b / 1024).toFixed(1) + 'K'); }
  }
  budget[page] = { bytes: bytes, assets: list.length, parts: parts };
}

// ② 孤儿检测（只查 js/ 与 css/）
let orphans = 0;
for (const dir of ['js', 'css']) {
  const base = path.join(REPO, dir);
  if (!fs.existsSync(base)) continue;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(js|css|html)$/.test(e.name)) continue;   // 也查 .html：js/index.html 就是这么混进来的
      const rel = path.relative(REPO, abs).split(path.sep).join('/');
      if (KEEP_UNREFERENCED.has(rel)) continue;
      if (!used.has(path.normalize(rel))) {
        console.log('ORPHAN  ' + rel + '  (' + (fs.statSync(abs).size / 1024).toFixed(1) + 'K，没有任何页面引用)');
        orphans++;
      }
    }
  };
  walk(base);
}

// ③ 台账 + 大文件
console.log('\n首屏台账（html + 其引用的 css/js，未压缩字节）');
console.log('页面            资源数      合计');
let totalAll = 0;
for (const page of Object.keys(budget)) {
  const b = budget[page];
  totalAll += b.bytes;
  console.log('  ' + page.padEnd(14) + String(b.assets).padStart(3) + ' 个   ' +
              (b.bytes / 1024).toFixed(1).padStart(8) + ' KB');
}
console.log('  ' + '四页合计'.padEnd(14) + '        ' + (totalAll / 1024).toFixed(1).padStart(8) + ' KB');

let big = 0;
for (const r of used) {
  const fp = path.join(REPO, r);
  if (!fs.existsSync(fp)) continue;
  const kb = fs.statSync(fp).size / 1024;
  if (kb > 100) { console.log('BIG     ' + r + '  ' + kb.toFixed(1) + ' KB（单个资源超 100 KB）'); big++; }
}

console.log('\n' + (orphans === 0 ? '无孤儿文件' : orphans + ' 个孤儿文件（该删）') +
            '｜' + (big === 0 ? '无超大资源' : big + ' 个超大资源') +
            '｜单页首屏最大 ' + (Math.max(...Object.values(budget).map(b => b.bytes)) / 1024).toFixed(1) + ' KB');
if (orphans || big) process.exit(1);
process.exit(0);
