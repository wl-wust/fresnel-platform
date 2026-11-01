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
        page.fill("#aeff_dx", "0.5")
        page.fill("#aeff_dw", "-25")
        page.click('button[onclick="calcAeff()"]')
        mobile_aeff = page.locator("#aeffResult").inner_text()

        result["mobile"] = {
            "tabs": mobile_results,
            "frames_after_reload": frame_count,
            "role_status": role_text,
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


if __name__ == "__main__":
    main()
