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
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")

        assert page.locator("#comsolView").count() == 0
        assert page.locator('[data-optical-mode]').count() == 0

        initial_d = page.locator("#result_d").inner_text()
        page.select_option("#sourceMode", "laser")
        assert page.input_value("#lambda") == "650"
        assert page.evaluate("BP.pages.opticalVisual.getSourceMode()") == "laser"
        page.fill("#beta", "1.5")
        page.dispatch_event("#beta", "change")
        assert page.input_value("#betaRange") == "1.5"
        assert page.evaluate("BP.pages.opticalVisual.getBeta()") == 1.5
        assert page.locator("#result_d").inner_text() != initial_d

        page.check("#horizontalLock")
        canvas_box = page.locator("#opticalCanvas").bounding_box()
        before = page.evaluate(
            """
            () => {
              const d = devices.find(item => item.type === 'screen');
              return { x: d.x, y: d.y, w: d.width, h: d.height };
            }
            """
        )
        start_x = canvas_box["x"] + before["x"] + before["w"] / 2
        start_y = canvas_box["y"] + before["y"] + before["h"] / 2
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x + 70, start_y + 60, steps=8)
        page.mouse.up()
        locked = page.evaluate(
            """
            () => {
              const d = devices.find(item => item.type === 'screen');
              return { x: d.x, y: d.y };
            }
            """
        )
        assert abs(locked["x"] - before["x"]) > 20
        assert abs(locked["y"] - before["y"]) < 0.01

        page.uncheck("#horizontalLock")
        free_start_x = canvas_box["x"] + locked["x"] + before["w"] / 2
        free_start_y = canvas_box["y"] + locked["y"] + before["h"] / 2
        page.mouse.move(free_start_x, free_start_y)
        page.mouse.down()
        page.mouse.move(free_start_x + 30, free_start_y + 50, steps=8)
        page.mouse.up()
        free = page.evaluate(
            """
            () => {
              const d = devices.find(item => item.type === 'screen');
              return { x: d.x, y: d.y };
            }
            """
        )
        assert abs(free["y"] - locked["y"]) > 20

        reduced_page = browser.new_page(viewport={"width": 1024, "height": 820})
        reduced_page.emulate_media(reduced_motion="reduce")
        reduced_page.goto(BASE + "/optical.html", wait_until="networkidle")
        reduced_page.wait_for_timeout(400)
        reduced_state = reduced_page.evaluate(
            "BP.pages.opticalVisual.getAnimationState()"
        )
        reduced_pixels = reduced_page.evaluate(
            """
            () => {
              const cv = document.getElementById('opticalCanvas');
              const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
              let colored = 0;
              for (let i = 0; i < data.length; i += 200) {
                if (data[i] + data[i + 1] + data[i + 2] > 80) colored += 1;
              }
              return colored;
            }
            """
        )
        assert reduced_state["reducedMotion"] is True
        assert reduced_state["running"] is False
        assert reduced_pixels > 100
        reduced_page.close()

        # 手机端保持纯教学画布，页面不得横向溢出。
        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.on("pageerror", lambda exc: errors.append("mobile: " + str(exc)))
        mobile.on(
            "console",
            lambda msg: errors.append("mobile console: " + msg.text)
            if msg.type == "error"
            else None,
        )
        mobile.goto(BASE + "/optical.html", wait_until="networkidle")
        mobile.wait_for_function("window.BP?.pages?.opticalVisual")
        mobile_state = mobile.evaluate(
            """
            () => {
              const canvas = document.getElementById('opticalCanvas');
              return {
                pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
                canvasWidth: canvas.getBoundingClientRect().width,
                canvasVisible: canvas.getBoundingClientRect().height > 0,
                comsolScriptLoaded: !!(window.BP?.pages?.opticalComsol)
              };
            }
            """
        )
        assert mobile_state["pageOverflow"] is False, mobile_state
        assert mobile_state["canvasWidth"] > 300, mobile_state
        assert mobile_state["canvasVisible"] is True, mobile_state
        assert mobile_state["comsolScriptLoaded"] is False, mobile_state
        mobile.close()

        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    main()
