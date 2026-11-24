"""只读诊断真实视频帧的同框刻线检测，不写入会话或报告数据。"""

from __future__ import annotations

import json
import os
import shutil
import sys
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
_video_env = os.environ.get("VIDEO_PATH")
if not _video_env:
    raise SystemExit("缺少 VIDEO_PATH：请指定要分析的视频文件路径")
VIDEO = Path(_video_env)
ROLE = os.environ.get("VIDEO_ROLE", "reference")
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
OUTPUT = Path(__file__).resolve().parent.parent / "output" / "video-calibration-diagnostic.json"
IMAGE = Path(os.environ["IMAGE_PATH"]) if os.environ.get("IMAGE_PATH") else None


def main() -> None:
    """记录检测器输入尺寸、几何状态和候选峰值，供定位拒绝原因。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not VIDEO.is_file():
        raise SystemExit("视频不存在：" + str(VIDEO))
    if not CHROME.is_file():
        raise SystemExit("Chrome 不存在：" + str(CHROME))

    errors: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=str(CHROME),
            args=["--ignore-certificate-errors"],
        )
        context = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1440, "height": 1100},
        )
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/", wait_until="networkidle")

        if IMAGE is not None:
            if not IMAGE.is_file():
                raise SystemExit("图像不存在：" + str(IMAGE))
            encoded = base64.b64encode(IMAGE.read_bytes()).decode("ascii")
            result = page.evaluate(
                """
                async ({ encoded, name }) => {
                  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
                  const file = new File([bytes], name, { type: 'image/png' });
                  const fringe = await BP.fringe.analyzeFile(file, { maxSide: 1600 });
                  const bitmap = await createImageBitmap(file);
                  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
                  const width = Math.round(bitmap.width * scale);
                  const height = Math.round(bitmap.height * scale);
                  const canvas = document.createElement('canvas');
                  canvas.width = width;
                  canvas.height = height;
                  const context = canvas.getContext('2d', { willReadFrequently: true });
                  context.drawImage(bitmap, 0, 0, width, height);
                  const imageData = context.getImageData(0, 0, width, height);
                  const diagnostic = {};
                  const local = BP.frameCalibration.calibrateSameFrame(
                    imageData.data,
                    width,
                    height,
                    fringe,
                    {
                      analysisScale: scale,
                      tickSpacingMm: 1,
                      minVisibility: 0.03,
                      diagnostic
                    }
                  );
                  return {
                    image: name,
                    source: { width: bitmap.width, height: bitmap.height },
                    analysis: { width, height, scale },
                    fringe: {
                      periodPx: fringe.periodPx,
                      periodPxCross: fringe.periodPxCross,
                      stripeCount: fringe.stripeCount,
                      visibility: fringe.visibility,
                      roi: fringe.roi,
                      stripeAngleDeg: fringe.stripeAngleDeg
                    },
                    calibration: local.calibration,
                    geometry: local.geometry,
                    diagnostic
                  };
                }
                """,
                {"encoded": encoded, "name": IMAGE.name},
            )
            OUTPUT.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(json.dumps({
                "output": str(OUTPUT),
                "image": str(IMAGE),
                "fringe": result["fringe"],
                "calibration": result["calibration"],
                "geometryError": result["geometry"] and result["geometry"].get("error"),
                "candidateCount": len(
                    (result.get("diagnostic") or {}).get("candidates") or []
                ),
                "pageErrors": errors,
            }, ensure_ascii=False, indent=2))
            browser.close()
            return

        # 只在本次诊断中强制打开核心诊断对象，生产调用参数保持不变。
        page.evaluate(
            """
            () => {
              window.__calibrationDiagnostics = [];
              const original = BP.frameCalibration.detectReticleGeometry;
              BP.frameCalibration.detectReticleGeometry = function (
                data, width, height, options
              ) {
                const diagnostic = {};
                const result = original.call(
                  this,
                  data,
                  width,
                  height,
                  Object.assign({}, options || {}, { diagnostic })
                );
                if (window.__calibrationDiagnostics.length < 120) {
                  window.__calibrationDiagnostics.push({
                    width,
                    height,
                    result: {
                      count: result && result.count,
                      method: result && result.method,
                      error: result && result.error,
                      spacingPx: result && result.spacingPx,
                      relativeRms: result && result.relativeRms,
                      warnings: result && result.warnings
                    },
                    diagnostic: {
                      rawCandidateCount: diagnostic.rawCandidateCount,
                      candidates: (diagnostic.candidates || []).slice(0, 40),
                      sequencePeaks: (diagnostic.sequencePeaks || []).slice(0, 40),
                      bestIndices: diagnostic.bestIndices,
                      bestXs: diagnostic.bestXs,
                      step: diagnostic.step,
                      relativeRms: diagnostic.relativeRms
                    }
                  });
                }
                return result;
              };
            }
            """
        )

        page.select_option("#videoMethodSelect", "ratio")
        page.select_option("#videoRoleSelect", ROLE)
        page.select_option("#videoTargetSelect", "20")
        page.set_input_files("#videoImportInput", str(VIDEO))
        page.wait_for_function(
            """
            () => {
              const button = document.querySelector('#videoImportButton');
              return button && !button.disabled && /导入视频分析/.test(button.textContent);
            }
            """,
            timeout=360000,
        )

        result = {
            "video": str(VIDEO),
            "role": ROLE,
            "status": page.locator("#videoLiveStatus").inner_text(),
            "stats": page.locator("#videoCandidateStats").inner_text(),
            "cards": page.locator(".video-candidate-meta").all_inner_texts(),
            "calibrations": page.evaluate("window.__calibrationDiagnostics"),
            "pageErrors": errors,
        }
        browser.close()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "output": str(OUTPUT),
        "status": result["status"],
        "stats": result["stats"],
        "calls": len(result["calibrations"]),
        "accepted": sum(
            1 for item in result["calibrations"]
            if item["result"]["count"] and item["result"]["count"] >= 3
        ),
        "reasons": {},
        "pageErrors": errors,
    }
    for item in result["calibrations"]:
        reason = item["result"].get("error") or "accepted"
        summary["reasons"][reason] = summary["reasons"].get(reason, 0) + 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
