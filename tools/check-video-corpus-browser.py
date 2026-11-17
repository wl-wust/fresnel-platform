"""批量导入真实视频，输出候选帧与拒绝摘要。

仅用于浏览器实测，不会确认写入会话。
"""

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROLE = os.environ.get("VIDEO_ROLE", "sodium")


def import_one(page, video: Path) -> dict:
    """导入一段视频并返回页面显示的结果。"""
    page.select_option("#videoMethodSelect", "ratio")
    page.select_option("#videoRoleSelect", ROLE)
    page.set_input_files("#videoImportInput", str(video))
    page.wait_for_function(
        """
        () => {
          const button = document.querySelector('#videoImportButton');
          return button && !button.disabled && /导入视频分析/.test(button.textContent);
        }
        """,
        timeout=600000,
    )
    return {
        "video": video.name,
        "status": page.locator("#videoLiveStatus").inner_text(),
        "stats": page.locator("#videoCandidateStats").inner_text(),
        "target": page.locator("#videoTargetSelect").input_value(),
        "cards": page.locator(".video-candidate").count(),
        "cardTexts": page.locator(".video-candidate").all_inner_texts(),
    }


def main() -> None:
    """按命令行顺序逐个导入视频。"""
    videos = [Path(argument).resolve() for argument in sys.argv[1:]]
    missing = [str(video) for video in videos if not video.is_file()]
    if not videos or missing:
        raise SystemExit("请提供视频路径；缺失文件：" + "；".join(missing))

    errors = []
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--ignore-certificate-errors"],
        )
        page = browser.new_page(ignore_https_errors=True, viewport={"width": 1440, "height": 1100})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/", wait_until="networkidle")
        for video in videos:
            try:
                results.append(import_one(page, video))
            except Exception as error:
                results.append({"video": video.name, "fatal": str(error)})
        browser.close()

    print(json.dumps({"results": results, "pageErrors": errors}, ensure_ascii=False, indent=2))
    if errors or any("fatal" in result for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
