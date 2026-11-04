"""检查光学页新增控件、绘制与拖动行为。"""

from playwright.sync_api import sync_playwright


BASE = "http://127.0.0.1:8099"


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on(
            "console",
            lambda msg: errors.append("console: " + msg.text)
            if msg.type == "error"
            else None,
        )

        page.goto(BASE + "/optical.html", wait_until="networkidle")
        page.wait_for_function("window.BP?.pages?.opticalVisual?.renderEngineeringScene")
        page.wait_for_timeout(300)
        style_sample = page.evaluate(
            """
            () => {
              const cv = document.getElementById('opticalCanvas');
              const data = cv.getContext('2d').getImageData(8, 8, 1, 1).data;
              return { r: data[0], g: data[1], b: data[2] };
            }
            """
        )
        assert (
            style_sample["r"] > 220
            and style_sample["g"] > 215
            and style_sample["b"] > 200
        ), style_sample
        page.uncheck("#showLight")
        state0 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
        page.check("#showLight")
        page.wait_for_timeout(250)
        state1 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
        page.uncheck("#showLight")
        page.wait_for_timeout(100)
        state2 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
        page.wait_for_timeout(250)
        state3 = page.evaluate("BP.pages.opticalVisual.getAnimationState()")
        assert state1["running"] is True and state1["frames"] > state0["frames"]
        assert state2["running"] is False and state3["frames"] == state2["frames"]
        assert page.locator("#sourceMode").count() == 1
        assert page.locator("#betaRange").count() == 1
        assert page.locator("#horizontalLock").count() == 1

        page.select_option("#sourceMode", "laser")
        assert page.input_value("#lambda") == "650"
        page.fill("#beta", "1.5")
        page.dispatch_event("#beta", "change")
        assert page.input_value("#betaRange") == "1.5"

        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
