/* check-deploy.js —— 部署侧对齐检查：仓库里的文件是否就是设计侧那一份
 *
 * 为什么需要：check-ids.js 有两种解析结果（设计副本 / 部署文件），两种都会 PASS，
 * 但只有后者证明"部署的就是设计的"。这个脚本按映射表逐对比 SHA256，把这件事变成确定的。
 *
 * 用法：node tools/check-deploy.js   （在 <仓库>/tools/ 或 <仓库>/plat_review/tools/ 都可以）
 *      全一致 → 退出码 0；任何不一致 / 缺失 / 一对都没比对上 → 退出码 1
 *
 * ⚠ 历史教训：早期版本用 resolve(__dirname,'../..') 当仓库根。放到 <仓库>/tools/ 时
 *   那指向仓库的**上一级**，于是找不到 plat_review，然后 "0 一致 / 0 不一致" 地假通过。
 *   现在改成向上查找，并且"一对都没比对上"直接判失败 —— 什么都没做的检查不许算通过。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 向上查找仓库根：以 plat_review/MANIFEST.sha256 为标志
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
if (!REPO) {
  console.log('FAIL  找不到仓库根：向上 6 层内没有 plat_review/MANIFEST.sha256');
  console.log('      请先把 plat_review/ 同步到仓库根，再从仓库内运行本脚本。');
  process.exit(1);
}
const PR = path.join(REPO, 'plat_review');

// 设计侧 → 部署侧
const PAIRS = [
  // P0 内核与口径
  ['physics.js',             'tools/physics.snapshot.js'],
  ['physics-v2.js',          'js/physics.js'],
  ['selftest-v19.js',        'tools/selftest.js'],
  ['golden.json',            'tools/golden.json'],
  ['params.default.json',    'data/params.default.json'],
  // P1 core 层
  ['core/fmt.js',            'js/core/fmt.js'],
  ['core/ui.js',             'js/core/ui.js'],
  ['core/store.js',          'js/core/store.js'],
  ['core/fit.js',            'js/core/fit.js'],
  ['core/api.js',            'js/core/api.js'],
  ['core/plot.js',           'js/core/plot.js'],
  // 页面
  ['pages/pc.js',            'js/pages/pc.js'],
  ['pages/pc-unc.js',        'js/pages/pc-unc.js'],
  ['build/index.html',       'index.html'],
  ['pages/optical-fix.js',      'js/pages/optical-fix.js'],
  ['build/optical.html',       'optical.html'],
  ['tools/check-optical-numbers.js', 'tools/check-optical-numbers.js'],
  ['pages/optical-interact.js',  'js/pages/optical-interact.js'],
  ['css/optical-responsive.css', 'css/optical-responsive.css'],
  ['tools/check-pages.js',    'tools/check-pages.js'],
  ['tools/check-globals.js',  'tools/check-globals.js'],
  ['pages/mobile.js',        'js/pages/mobile.js'],
  ['build/mobile.html',      'mobile.html'],
  ['tools/check-p4-html.js', 'tools/check-p4-html.js'],
  // 工具（缺一个就等于少一道防线）
  ['tools/check-ids.js',     'tools/check-ids.js'],
  ['tools/check-p1-html.js', 'tools/check-p1-html.js'],
  ['tools/check-p2-html.js', 'tools/check-p2-html.js'],
  ['tools/check-deploy.js',  'tools/check-deploy.js']
];

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const size = p => fs.statSync(p).size;

let ok = 0, bad = 0;
console.log('仓库根: ' + REPO);
for (const [src, dst] of PAIRS) {
  const a = path.join(PR, src), b = path.join(REPO, dst);
  if (!fs.existsSync(a)) { console.log('MISSING  plat_review/' + src + '   ← 设计侧没同步全'); bad++; continue; }
  if (!fs.existsSync(b)) { console.log('MISSING  ' + dst + '   ← 部署侧没有这个文件（没 cp 过去？）'); bad++; continue; }
  const ha = sha(a), hb = sha(b);
  if (ha !== hb) {
    console.log('DIFF     ' + dst + '   ' + size(a) + 'B/' + ha.slice(0, 8) +
                '  ≠  ' + size(b) + 'B/' + hb.slice(0, 8) + '  (设计侧 ' + src + ')');
    const buf = fs.readFileSync(b);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) console.log('         ⚠ 部署侧带 BOM');
    bad++;
  } else ok++;
}

console.log('\n' + ok + ' 一致 / ' + bad + ' 不一致  （映射 ' + PAIRS.length + ' 对）');
if (ok + bad === 0) {
  console.log('FAIL  一对都没比对上 —— 这不是通过');
  process.exit(1);
}
if (bad) console.log('提示：以设计侧为准，逐条 cp 覆盖；不要手工编辑这些文件。');
process.exit(bad ? 1 : 0);
