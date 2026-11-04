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

        result["mobile"] = {
            "tabs": mobile_results,
            "frames_after_reload": frame_count,
            "role_status": role_text,
            "auto_fill": mobile_auto_fill,
            "aeff": mobile_aeff,
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


if __name__ == "__main__":
    main()
