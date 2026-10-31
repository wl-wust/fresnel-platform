/* check-globals.js —— 拦一类隐蔽 bug：把 `let`/`const` 顶层绑定当成 window 属性
 *
 * 背景（真实踩过）：optical_simulator.js 里是
 *     let CONFIG = {...};  let devices = [];  let selectedDevice = null;
 * 经典脚本里 `let`/`const` 在顶层创建的是**全局词法绑定**，不会成为 window 的属性。
 * 于是 `global.devices` / `window.selectedDevice` 永远是 undefined，
 * 代码不报错、只是静默什么都不做（拖拽反填 z₁/z₂ 整个失效、删除按钮永远说"请先点选"）。
 * `node --check` 看不出来，浏览器也不报错 —— 只能用静态检查拦。
 *
 * 判定：页面模块里出现 `global.X` 或 `window.X`，而 X 是 base 脚本用 let/const 声明的 → 违规。
 *       正确写法是先 typeof 判存在：typeof X !== 'undefined' ? X : undefined
 *
 * 用法：node tools/check-globals.js
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

function pick(rels) {
  const bases = [REPO, path.join(REPO, 'plat_review'), path.dirname(__dirname)];
  for (const b of bases) for (const r of rels) {
    const p = path.join(b, r);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 被 let/const 声明、因此不在 window 上的名字，来自 base 脚本
const BASE = pick(['js/optical_simulator.js', 'plat_review/site/js_optical_simulator.js']);
if (!BASE) { console.log('SKIP  找不到 optical_simulator.js'); process.exit(0); }

const bindings = new Set();
for (const m of fs.readFileSync(BASE, 'utf8').matchAll(/^\s*(?:let|const)\s+([^;=\n]+)/gm)) {
  for (const name of m[1].split(',')) {
    const id = name.trim().split(/\s*=\s*/)[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(id)) bindings.add(id);
  }
}

// 检查我们自己的页面模块
const MODULES = ['js/pages/optical-fix.js', 'js/pages/optical-interact.js', 'js/pages/optical-dpr.js', 'js/pages/optical-rail.js',
                 'plat_review/pages/optical-fix.js', 'plat_review/pages/optical-interact.js', 'plat_review/pages/optical-dpr.js', 'plat_review/pages/optical-rail.js'];

let bad = 0, files = 0;
for (const rel of MODULES) {
  const p = pick([rel]);
  if (!p) continue;
  files++;
  const src = fs.readFileSync(p, 'utf8');
  const hits = [];
  for (const name of bindings) {
    const re = new RegExp('(?:global|window)\\.' + name.replace(/\$/g, '\\$') + '\\b');
    if (re.test(src)) hits.push(name);
  }
  const short = path.relative(REPO, p);
  if (hits.length) {
    bad++;
    console.log('FAIL  ' + short + '  把 let/const 绑定当成了 window 属性: ' + hits.join(', '));
    console.log('      → 改成 typeof ' + hits[0] + " !== 'undefined' ? " + hits[0] + ' : undefined');
  } else {
    console.log('PASS  ' + short + '（' + bindings.size + ' 个 let/const 绑定，无 window 误引用）');
  }
}

console.log('\n' + (bad === 0 ? '全局绑定检查通过' : bad + ' 个文件有问题') + '（检查 ' + files + ' 个模块）');
process.exit(bad === 0 && files > 0 ? 0 : 1);
