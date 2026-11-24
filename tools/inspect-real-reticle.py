"""用真实分划板照片复核同框刻线算法，只输出诊断，不改会话数据。"""

import json
import os
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
def find_chrome() -> Path:
    """按 CHROME_PATH → PATH 查找 → Program Files 的顺序定位 Chrome。"""
    override = os.environ.get("CHROME_PATH")
    if override:
        return Path(override)
    for name in ("chrome", "chrome.exe", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            return Path(found)
    for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        root = os.environ.get(env)
        if not root:
            continue
        candidate = Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"
        if candidate.exists():
            return candidate
    raise SystemExit("未找到 Chrome：请设置 CHROME_PATH 环境变量指向 chrome 可执行文件")


CHROME = find_chrome()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=str(CHROME),
            args=["--ignore-certificate-errors"],
        )
        page = browser.new_page(ignore_https_errors=True)
        page.goto(BASE + "/", wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              const url = '/assets/report-images/reticle-01.jpg';
              const blob = await (await fetch(url)).blob();
              const image = await createImageBitmap(blob);
              const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
              const width = Math.round(image.width * scale);
              const height = Math.round(image.height * scale);
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext('2d', { willReadFrequently: true });
              context.drawImage(image, 0, 0, width, height);
              const imageData = context.getImageData(0, 0, width, height);
              const geometry = BP.frameCalibration.detectReticleGeometry(
                imageData.data,
                width,
                height,
                { analysisScale: scale }
              );
              return {
                source: { width: image.width, height: image.height },
                analysis: { width, height, scale },
                geometry
              };
            }
            """
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        browser.close()


if __name__ == "__main__":
    main()
