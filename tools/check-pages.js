/* check-pages.js —— 部署侧页面接线检查（删文件忘清引用 = Pages 上 404）
 *
 * ① 所有 HTML 里的本地 href/src 必须解析到真实文件
 * ② 光学页 P3b 的三项接线（响应式 CSS / 删除选中按钮 / Pointer 交互层）
 * ③ 不得再引用已删除的旧光学页（optical_v2.html / optical2d.js / simulation_data.js）
 *
 * 用法：node tools/check-pages.js     （在仓库内任意 tools/ 层级都能定位仓库根）
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

let ok = 0, bad = 0;
function check(name, cond, detail) {
  if (cond) { ok++; console.log('PASS  ' + name + (detail ? '  ' + detail : '')); }
  else { bad++; console.log('FAIL  ' + name + (detail ? '  ← ' + detail : '')); }
}

const PAGES = ['index.html', 'mobile.html', 'optical.html'];
const GONE = ['optical_v2.html', 'js/optical2d.js', 'js/simulation_data.js', 'js/main.js', 'lib/chart.umd.min.js', 'js/main_pure.js', 'js/mobile_merged.js'];

let refs = 0;
for (const page of PAGES) {
  const p = path.join(REPO, page);
  if (!fs.existsSync(p)) { check('存在 ' + page, false, '文件不存在'); continue; }
  const html = fs.readFileSync(p, 'utf8');
  const dir = path.dirname(p);
  const missing = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|data:|mailto:|#)/.test(raw)) continue;
    const rel = raw.split('?')[0].split('#')[0];
    if (!rel) continue;
    refs++;
    if (!fs.existsSync(path.resolve(dir, rel))) missing.push(raw);
  }
  check(page + ' 的本地引用全部可解析', missing.length === 0, missing.join(', ') || refs + ' 个引用');
}

// 已删除的旧文件不得再被任何页面引用
for (const gone of GONE) {
  const hit = PAGES.filter(pg => {
    const p = path.join(REPO, pg);
    return fs.existsSync(p) && fs.readFileSync(p, 'utf8').indexOf(gone) >= 0;
  });
  check('不再引用已废弃的 ' + gone, hit.length === 0, hit.join(', '));
}

// 光学页 P3b 接线
const optPath = path.join(REPO, 'optical.html');
if (fs.existsSync(optPath)) {
  const opt = fs.readFileSync(optPath, 'utf8');
  check('光学页加载响应式 CSS', /optical-responsive\.css/.test(opt));
  check('光学页有"删除选中元件"按钮', /onclick="deleteSelected\(\)"/.test(opt));
  const i1 = opt.indexOf('optical-fix.js'), i2 = opt.indexOf('optical-interact.js');
  check('光学页加载 Pointer 交互层且在 fix 之后', i2 > i1 && i1 >= 0, 'fix@' + i1 + ' interact@' + i2);
} else {
  check('存在 optical.html', false);
}

console.log('\n仓库根: ' + REPO);
console.log((bad === 0 ? '页面接线检查通过' : bad + ' 项不通过') + '（' + ok + ' pass / ' + bad + ' fail）');
process.exit(bad === 0 ? 0 : 1);
