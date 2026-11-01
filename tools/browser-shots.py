"""生成 PC/手机布局截图，供视觉验收。"""

from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:8099"
OUT = Path(__file__).resolve().parent.parent / "output"


def main():
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        pc = browser.new_page(viewport={"width": 1440, "height": 1000})
        pc.goto(BASE + "/index.html", wait_until="networkidle")
        pc.click('.tab[data-tab="wavelength"]')
        pc.screenshot(path=str(OUT / "pc-session-ui.png"), full_page=True)

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(BASE + "/mobile.html", wait_until="networkidle")
        mobile.evaluate("""
          async () => {
            const s = BP.sessions.getActiveSession() ||
              BP.sessions.createSession({ method: 'ratio', title: '比值法现场采集' });
            BP.sessions.setActiveSession(s.id);
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
        mobile.reload(wait_until="networkidle")
        mobile.screenshot(path=str(OUT / "mobile-session-ui.png"), full_page=True)
        browser.close()
    print(OUT / "pc-session-ui.png")
    print(OUT / "mobile-session-ui.png")


if __name__ == "__main__":
    main()
