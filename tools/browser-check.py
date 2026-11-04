"""使用 Playwright 检查 PC/手机页签、会话和 A_eff 交互。"""

import json
import sys

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:8099"
sys.stdout.reconfigure(encoding="utf-8")


def main():
    result = {}
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda exc: errors.append("pageerror: " + str(exc)))
        page.on("console", lambda msg: errors.append("console: " + msg.text) if msg.type == "error" else None)

        page.goto(BASE + "/index.html", wait_until="networkidle")
        pc_tabs = page.locator(".tab").evaluate_all("els => els.map(e => e.dataset.tab)")
        pc_results = []
        for tab in pc_tabs:
            page.click(f'.tab[data-tab="{tab}"]')
            pc_results.append({
                "tab": tab,
                "active": page.evaluate("t => document.getElementById(t)?.classList.contains('active')", tab),
            })

        page.click('.tab[data-tab="wavelength"]')
        auto_fill = page.evaluate("""
          async () => {
            const cases = [
              {
                method: 'basic',
                params: { d: 0.90213, D: 1000 },
                roles: { sodium: [163.2, 163.4] }
              },
              {
                method: 'ratio',
                params: { lamRef: 650, nNa: 1.5168, nRef: 1.5145 },
                roles: { sodium: [163.3, 163.4], reference: [180.8, 181.0] }
              },
              {
                method: 'magnification',
                params: { dPrime: 3.969, beta: 4.4, D: 1000 },
                roles: { no_lens: [0.65332, 0.6535], with_lens: [2.8746, 2.8750] }
              },
              {
                method: 'trace',
                params: { D: 1000 },
                roles: { sodium: [163.2, 163.4] }
              }
            ];
            const out = [];
            for (const item of cases) {
              const session = BP.sessions.createSession({
                method: item.method,
                title: 'auto-fill-' + item.method,
                calibration: { k_mm_px: 0.004, source: 'L/N' },
                params: item.params
              });
              for (const [role, values] of Object.entries(item.roles)) {
                for (const value of values) {
                  await BP.sessions.addFrame(session.id, {
                    role,
                    deltaXPx: value <= 5 ? value / 0.004 : value,
                    deltaXmm: value <= 5 ? value : value * 0.004
                  });
                }
              }
              BP.sessions.setActiveSession(session.id);
              const data = fillSessionData();
              out.push({
                method: item.method,
                complete: data.complete,
                lambdaNm: data.values.lambdaNm,
                summary: document.getElementById('sessionDataSummary').innerText
              });
            }
            return out;
          }
        """)
        page.click('.tab[data-tab="wavelength"]')
        page.click('button[onclick="fillTracePreset()"]')
        page.click('button[onclick="calcTraceMethod()"]')
        trace_calc = page.locator("#traceResult").inner_text()
        page.click('button[onclick="calcMagnificationMethod()"]')
        mag_calc = page.locator("#magResult").inner_text()
        trace_text = page.locator("#tracePresetResult").inner_text()
        page.fill("#aeff_dx_pc", "0.5")
        page.fill("#aeff_dw_pc", "-25")
        page.click('button[onclick="calcAeffPC()"]')
        aeff_text = page.locator("#aeffResultPC").inner_text()
        result["pc"] = {
            "tabs": pc_results,
            "auto_fill": auto_fill,
            "trace": trace_text,
            "trace_calc": trace_calc,
            "magnification": mag_calc,
            "aeff": aeff_text,
        }

        # 未标定 k 时只允许提取像素间距，不能显示伪造的毫米值。
        page.evaluate("localStorage.clear()")
        page.reload(wait_until="networkidle")
        page.evaluate("""
          async () => {
            const W = 900, H = 320;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');
            const prof = BP.fringe.synthesizeProfile({
              n: W, periodPx: 160, visibility: 0.6, noise: 0.01, seed: 11
            });
            for (let y = 0; y < H; y += 1) {
              for (let x = 0; x < W; x += 1) {
                const v = Math.round(255 * Math.max(0, Math.min(1, prof[x])));
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], 'pc-uncalibrated.png', { type: 'image/png' });
            const dt = new DataTransfer(); dt.items.add(file);
            const input = document.querySelector('#imageInput');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        """)
        page.click('button[onclick="analyzeImage()"]')
        page.wait_for_function(
            "document.querySelector('#analysisResult').innerText.includes('像素当量 k')",
            timeout=30000,
        )
        pc_uncalibrated = page.locator("#analysisResult").inner_text()
        result["pc"]["uncalibrated"] = pc_uncalibrated

        # 缺少 d/D 的 record/2 必须标明未计算，不能用报告预设代算。
        page.evaluate("localStorage.clear()")
        page.reload(wait_until="networkidle")
        record = page.evaluate("""
          async () => {
            const session = BP.sessions.createSession({
              method: 'basic', title: 'missing-params',
              calibration: { k_mm_px: 0.004, source: 'L/N' }, params: {}
            });
            await BP.sessions.addFrame(session.id, { role: 'sodium', deltaXPx: 163.3 });
            BP.sessions.setActiveSession(session.id);
            return BP.sessions.exportRecord();
          }
        """)
        page.set_input_files("#phoneRecordFile", {
            "name": "missing-params.json",
            "mimeType": "application/json",
            "buffer": json.dumps(record, ensure_ascii=False).encode("utf-8"),
        })
        page.wait_for_function(
            "document.querySelector('#phoneRecordResult').innerText.includes('λ 均值')",
            timeout=10000,
        )
        pc_import_missing = page.locator("#phoneRecordResult").inner_text()
        result["pc"]["import_missing_params"] = pc_import_missing

        page.goto(BASE + "/optical.html", wait_until="networkidle")
        page.wait_for_function("window.BP && window.BP.pages && window.BP.pages.opticalRail")
        page.wait_for_timeout(400)
        optical_desktop = page.evaluate("""
          () => {
            const canvas = document.querySelector('#opticalCanvas');
            const rect = canvas.getBoundingClientRect();
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let nonBlack = 0;
            for (let i = 0; i < pixels.length; i += 160) {
              if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 40) nonBlack += 1;
            }
            const buttons = [...document.querySelectorAll('.btn-group .btn')];
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              canvasWidth: rect.width,
              canvasHeight: rect.height,
              nonBlack: nonBlack,
              buttonMinWidth: Math.min(...buttons.map(button => button.getBoundingClientRect().width)),
              buttonMaxHeight: Math.max(...buttons.map(button => button.getBoundingClientRect().height)),
              buttonClipped: buttons.some(button =>
                button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight),
              resultD: document.querySelector('#result_d').innerText,
              resultDx: document.querySelector('#result_dx').innerText,
              sourceMode: document.querySelector('#sourceMode').value,
              betaRange: document.querySelector('#betaRange').value,
              horizontalLock: document.querySelector('#horizontalLock').checked,
              visualApi: !!(window.BP && BP.pages && BP.pages.opticalVisual)
            };
          }
        """)
        page.fill("#z2", "400")
        page.evaluate("document.querySelector('#z2').dispatchEvent(new Event('change', { bubbles: true }))")
        page.click('button[onclick="simulateInterference()"]')
        optical_desktop["resultDxAfterZ2"] = page.locator("#result_dx").inner_text()

        mobile_optical = browser.new_page(viewport={"width": 390, "height": 844})
        mobile_optical.on("pageerror", lambda exc: errors.append("optical mobile pageerror: " + str(exc)))
        mobile_optical.on(
            "console",
            lambda msg: errors.append("optical mobile console: " + msg.text) if msg.type == "error" else None,
        )
        mobile_optical.goto(BASE + "/optical.html", wait_until="networkidle")
        mobile_optical.wait_for_function("window.BP && window.BP.pages && window.BP.pages.opticalRail")
        mobile_optical.wait_for_timeout(400)
        optical_mobile = mobile_optical.evaluate("""
          () => {
            const canvas = document.querySelector('#opticalCanvas');
            const rect = canvas.getBoundingClientRect();
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let nonBlack = 0;
            for (let i = 0; i < pixels.length; i += 160) {
              if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 40) nonBlack += 1;
            }
            const buttons = [...document.querySelectorAll('.btn-group .btn')];
            return {
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              canvasWidth: rect.width,
              canvasHeight: rect.height,
              nonBlack: nonBlack,
              buttonMinWidth: Math.min(...buttons.map(button => button.getBoundingClientRect().width)),
              buttonMaxHeight: Math.max(...buttons.map(button => button.getBoundingClientRect().height)),
              buttonClipped: buttons.some(button =>
                button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight),
              headerHeight: document.querySelector('.header').getBoundingClientRect().height,
              controlsFit: [...document.querySelectorAll('.angle-control, .param-select')].every(el => {
                const r = el.getBoundingClientRect();
                return r.left >= 0 && r.right <= window.innerWidth && r.height > 0;
              })
            };
          }
        """)
        mobile_optical.close()
        result["optical"] = {
            "desktop": optical_desktop,
            "mobile": optical_mobile,
        }

        page.goto(BASE + "/mobile.html", wait_until="networkidle")
        mobile_tabs = page.locator(".tab-btn").evaluate_all("els => els.map(e => e.dataset.tab)")
        mobile_results = []
        for tab in mobile_tabs:
            page.click(f'.tab-btn[data-tab="{tab}"]')
            mobile_results.append({
                "tab": tab,
                "active": page.evaluate("t => document.getElementById(t)?.classList.contains('active')", tab),
            })

        page.click('.tab-btn[data-tab="capture"]')
        page.select_option("#methodSelect", "ratio")
        page.click('button[onclick="createSessionFromUI()"]')
        page.select_option("#roleSelect", "sodium")
        session_id = page.evaluate("""
          async () => {
            const s = BP.sessions.getActiveSession();
            for (let i = 0; i < 3; i += 1) {
              await BP.sessions.addFrame(s.id, {
                role: 'sodium',
                blob: new Blob(['frame-' + i], { type: 'image/jpeg' }),
                name: 'frame-' + i + '.jpg',
                deltaXPx: 163.3 + i * 0.1
              });
            }
            return s.id;
          }
        """)
        page.reload(wait_until="networkidle")
        frame_count = page.evaluate("""
          id => BP.sessions.listFrames(id, 'sodium').length
        """, session_id)
        role_text = page.locator("#roleStatus").inner_text()

        page.click('.tab-btn[data-tab="analysis"]')
        mobile_auto_fill = page.evaluate("""
          async () => {
            const session = BP.sessions.createSession({
              method: 'basic',
              title: 'mobile-auto-fill',
              calibration: { k_mm_px: 0.004, source: 'L/N' },
              params: { d: 0.90213, D: 1000 },
              paramsSources: { d: '报告预设', D: '报告预设' }
            });
            for (let i = 0; i < 2; i += 1) {
              await BP.sessions.addFrame(session.id, {
                role: 'sodium',
                deltaXPx: 163.3 + i * 0.2,
                deltaXmm: (163.3 + i * 0.2) * 0.004
              });
            }
            BP.sessions.setActiveSession(session.id);
            const data = fillSessionData();
            return {
              complete: data.complete,
              lambdaNm: data.values.lambdaNm,
              dxInput: document.querySelector('#dataTableBody .m-dx').value,
              summary: document.getElementById('sessionDataSummary').innerText
            };
          }
        """)
        page.fill("#aeff_dx", "0.5")
        page.fill("#aeff_dw", "-25")
        page.click('button[onclick="calcAeff()"]')
        mobile_aeff = page.locator("#aeffResult").inner_text()

        # 未标定 k 的真实识别路径不能因 null.toFixed 中断；低对比度要提示复核。
        page.evaluate("localStorage.clear()")
        page.reload(wait_until="networkidle")
        page.evaluate("""
          async () => {
            const W = 900, H = 320;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');
            const prof = BP.fringe.synthesizeProfile({
              n: W, periodPx: 160, visibility: 0.12, noise: 0.01, seed: 12
            });
            for (let y = 0; y < H; y += 1) {
              for (let x = 0; x < W; x += 1) {
                const v = Math.round(255 * Math.max(0, Math.min(1, prof[x])));
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], 'mobile-uncalibrated.png', { type: 'image/png' });
            const dt = new DataTransfer(); dt.items.add(file);
            const input = document.querySelector('#fileInput');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        """)
        page.wait_for_function(
            "document.querySelector('#captureResult') && "
            "getComputedStyle(document.querySelector('#captureResult')).display !== 'none'",
            timeout=30000,
        )
        mobile_uncalibrated = page.locator("#captureResult").inner_text()
        clear_k = page.evaluate("""
          () => {
            const session = BP.sessions.getActiveSession();
            BP.store.saveK(0.004, { source: 'manual' });
            BP.sessions.updateSession(session.id, {
              calibration: { k_mm_px: 0.004, source: 'manual' }
            });
            clearK();
            const after = BP.sessions.getActiveSession();
            return {
              globalK: BP.store.loadK(),
              sessionK: after.calibration === undefined ? null : after.calibration
            };
          }
        """)

        result["mobile"] = {
            "tabs": mobile_results,
            "frames_after_reload": frame_count,
            "role_status": role_text,
            "auto_fill": mobile_auto_fill,
            "aeff": mobile_aeff,
            "uncalibrated": mobile_uncalibrated,
            "clear_k": clear_k,
        }
        result["errors"] = errors
        browser.close()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)
    if not all(item["active"] for item in result["pc"]["tabs"]):
        raise SystemExit(2)
    if not all(item["active"] for item in result["mobile"]["tabs"]):
        raise SystemExit(3)
    if result["mobile"]["frames_after_reload"] != 3:
        raise SystemExit(4)
    if not all(item["complete"] for item in result["pc"]["auto_fill"]):
        raise SystemExit(5)
    if not result["mobile"]["auto_fill"]["complete"]:
        raise SystemExit(6)
    if abs(float(result["mobile"]["auto_fill"]["dxInput"]) - 163.4) > 0.01:
        raise SystemExit(7)
    if "—（未标定 k）" not in result["pc"]["uncalibrated"]:
        raise SystemExit(8)
    if "未计算" not in result["pc"]["import_missing_params"]:
        raise SystemExit(9)
    if "未标定 k" not in result["mobile"]["uncalibrated"]:
        raise SystemExit(10)
    if "对比度偏低" not in result["mobile"]["uncalibrated"]:
        raise SystemExit(11)
    if result["mobile"]["clear_k"]["globalK"] is not None:
        raise SystemExit(12)
    if result["mobile"]["clear_k"]["sessionK"] is not None:
        raise SystemExit(13)
    if result["optical"]["desktop"]["scrollWidth"] > result["optical"]["desktop"]["innerWidth"]:
        raise SystemExit(14)
    if result["optical"]["desktop"]["canvasWidth"] < 400 or result["optical"]["desktop"]["nonBlack"] < 100:
        raise SystemExit(15)
    if "0.2940 mm" not in result["optical"]["desktop"]["resultDxAfterZ2"]:
        raise SystemExit(16)
    if result["optical"]["desktop"]["buttonMinWidth"] < 80 or result["optical"]["desktop"]["buttonClipped"]:
        raise SystemExit(17)
    if result["optical"]["desktop"]["buttonMaxHeight"] > 48:
        raise SystemExit(18)
    if result["optical"]["mobile"]["scrollWidth"] > result["optical"]["mobile"]["innerWidth"]:
        raise SystemExit(19)
    if result["optical"]["mobile"]["canvasWidth"] < 300 or result["optical"]["mobile"]["nonBlack"] < 50:
        raise SystemExit(20)
    if result["optical"]["mobile"]["buttonMinWidth"] < 80 or result["optical"]["mobile"]["buttonClipped"]:
        raise SystemExit(21)
    if result["optical"]["mobile"]["buttonMaxHeight"] > 48:
        raise SystemExit(22)
    if not result["optical"]["desktop"]["visualApi"]:
        raise SystemExit(23)
    if not result["optical"]["mobile"]["controlsFit"]:
        raise SystemExit(24)


if __name__ == "__main__":
    main()
