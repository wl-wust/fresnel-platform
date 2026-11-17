"""局域网 HTTPS 页面、二维码和 WebRTC 视频链路浏览器实测。"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROOT = Path(__file__).resolve().parent.parent
SHOT = ROOT / "plat_review" / "lan_video_e2e.png"


def main():
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=[
                "--ignore-certificate-errors",
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
            ],
        )
        context = browser.new_context(
            ignore_https_errors=True,
            permissions=["camera"],
            viewport={"width": 1440, "height": 1000},
        )
        pc_page = context.new_page()
        pc_page.on("pageerror", lambda error: errors.append("PC: " + str(error)))
        pc_page.goto(BASE + "/", wait_until="networkidle")
        assert pc_page.evaluate("window.BP?.lanSignal?.isLanEnabled(window)") is True

        pc_page.click("#videoPairButton")
        pc_page.wait_for_function(
            "document.querySelector('#videoQrBox').dataset.streamUrl",
            timeout=15000,
        )
        mobile_url = pc_page.locator("#videoQrBox").get_attribute("data-stream-url")
        assert mobile_url.startswith("https://")
        assert "localhost" not in mobile_url

        mobile_page = context.new_page()
        mobile_page.on("pageerror", lambda error: errors.append("Mobile: " + str(error)))
        mobile_page.set_viewport_size({"width": 390, "height": 844})
        mobile_page.goto(mobile_url, wait_until="networkidle")
        mobile_page.click("#streamStart")

        pc_page.wait_for_function(
            """
            () => {
              const video = document.querySelector('#pcRemoteVideo');
              return video && video.srcObject && video.videoWidth > 0;
            }
            """,
            timeout=30000,
        )
        mobile_page.wait_for_function(
            "document.querySelector('#streamConnection').textContent.includes('已连接')",
            timeout=30000,
        )
        assert pc_page.evaluate(
            "document.querySelector('#pcRemoteVideo').srcObject.getVideoTracks().length"
        ) >= 1
        assert not errors, errors
        SHOT.parent.mkdir(parents=True, exist_ok=True)
        pc_page.screenshot(path=str(SHOT), full_page=True)
        print("全部通过（局域网 HTTPS + 二维码 + WebRTC 实测）")
        browser.close()


if __name__ == "__main__":
    main()
