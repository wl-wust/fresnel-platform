/* check-deploy.js —— 部署侧对齐检查：仓库里的文件是否就是设计侧那一份
 *
 * 为什么需要：check-ids.js 有两种解析结果 ——
 *   在 <仓库>/tools/ 跑 → 检查 js/pages/pc.js（真部署文件）✅
 *   在 <仓库>/plat_review/tools/ 跑 → 检查 plat_review/pages/pc.js（设计副本）❌
 * 两种都会 PASS，但只有前者证明"部署的就是设计的"。这个脚本把这件事变成确定的：
 * 直接按映射表逐对比 SHA256，不一致就报出来。
 *
 * 用法（在仓库根）：node plat_review/tools/check-deploy.js
 *      全一致 → 退出码 0
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '../..');
const PR = path.join(REPO, 'plat_review');

// 设计侧 → 部署侧
const PAIRS = [
  // P0 内核与口径
  ['physics.js',            'tools/physics.snapshot.js'],
  ['physics-v2.js',         'js/physics.js'],
  ['selftest-v19.js',       'tools/selftest.js'],
  ['golden.json',           'tools/golden.json'],
  ['params.default.json',   'data/params.default.json'],
  // P1 core 层
  ['core/fmt.js',           'js/core/fmt.js'],
  ['core/ui.js',            'js/core/ui.js'],
  ['core/store.js',         'js/core/store.js'],
  ['core/fit.js',           'js/core/fit.js'],
  ['core/api.js',           'js/core/api.js'],
  ['core/plot.js',          'js/core/plot.js'],
  // 页面
  ['pages/pc.js',           'js/pages/pc.js'],
  ['pages/pc-unc.js',       'js/pages/pc-unc.js'],
  ['build/index.html',      'index.html'],
  // 工具（缺一个就等于少一道防线）
  ['tools/check-ids.js',    'tools/check-ids.js'],
  ['tools/check-p1-html.js','tools/check-p1-html.js'],
  ['tools/check-p2-html.js','tools/check-p2-html.js'],
  ['tools/check-deploy.js', 'tools/check-deploy.js']
];

const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const size = p => fs.statSync(p).size;

let ok = 0, bad = 0;
for (const [src, dst] of PAIRS) {
  const a = path.join(PR, src), b = path.join(REPO, dst);
  if (!fs.existsSync(a)) { console.log('SKIP  设计侧缺 ' + src); continue; }
  if (!fs.existsSync(b)) { console.log('MISSING  ' + dst + '   ← 部署侧没有这个文件（没 cp 过去？）'); bad++; continue; }
  const ha = sha(a), hb = sha(b);
  if (ha !== hb) {
    console.log('DIFF     ' + dst + '   ' + size(a) + 'B/' + ha.slice(0, 8) +
                '  ≠  ' + size(b) + 'B/' + hb.slice(0, 8) + '  (设计侧 ' + src + ')');
    const bom = fs.readFileSync(b);
    if (bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF) console.log('         ⚠ 部署侧带 BOM');
    bad++;
  } else ok++;
}

console.log('\n' + ok + ' 一致 / ' + bad + ' 不一致  （映射 ' + PAIRS.length + ' 对）');
if (bad) console.log('提示：以设计侧为准，逐条 cp 覆盖；不要手工编辑这些文件。');
process.exit(bad ? 1 : 0);
