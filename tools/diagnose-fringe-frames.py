"""诊断真实条纹帧的 ROI、投影周期与质量指标。

本脚本只读取已抽出的诊断帧，不修改实验数据或平台门限。
"""

import base64
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROOT = Path(__file__).resolve().parent.parent
# 允许从环境变量指定诊断帧目录，便于对每轮真实视频做只读复核。
FRAME_DIR = Path(os.environ.get(
    "FRAME_DIR",
    str(ROOT / "output" / "video-diagnostics-11.17"),
))


def frame_as_data_url(path: Path) -> str:
    """把本地诊断帧转为浏览器可直接解码的 data URL。"""
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return "data:image/jpeg;base64," + payload


def diagnose_frame(page, path: Path) -> dict:
    """在浏览器内复用平台函数，比较多种 ROI 裁切。"""
    return page.evaluate(
        """
        async ({ name, dataUrl }) => {
          const image = new Image();
          await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = reject;
            image.src = dataUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const signal = new Float32Array(canvas.width * canvas.height);
          for (let i = 0, p = 0; i < signal.length; i++, p += 4) {
            signal[i] = Math.max(pixels.data[p], pixels.data[p + 1]);
          }

          function otsu(values) {
            const histogram = new Uint32Array(256);
            for (const value of values) {
              histogram[Math.max(0, Math.min(255, Math.round(value)))]++;
            }
            let sum = 0;
            for (let i = 0; i < 256; i++) sum += i * histogram[i];
            let sumB = 0;
            let weightB = 0;
            let best = -1;
            let threshold = 0;
            for (let i = 0; i < 256; i++) {
              weightB += histogram[i];
              if (!weightB) continue;
              const weightF = values.length - weightB;
              if (!weightF) break;
              sumB += i * histogram[i];
              const meanB = sumB / weightB;
              const meanF = (sum - sumB) / weightF;
              const between = weightB * weightF * (meanB - meanF) ** 2;
              if (between > best) {
                best = between;
                threshold = i;
              }
            }
            return threshold;
          }

          function activeBounds(values, width, height, threshold) {
            const xCount = new Uint32Array(width);
            const yCount = new Uint32Array(height);
            let xMax = 0;
            let yMax = 0;
            let total = 0;
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                if (values[y * width + x] > threshold) {
                  xCount[x]++;
                  yCount[y]++;
                  total++;
                }
              }
            }
            if (!total) return null;
            for (const value of xCount) xMax = Math.max(xMax, value);
            for (const value of yCount) yMax = Math.max(yMax, value);
            const xNeed = Math.max(1, Math.floor(xMax * 0.01));
            const yNeed = Math.max(1, Math.floor(yMax * 0.01));
            let x0 = 0;
            let x1 = width - 1;
            let y0 = 0;
            let y1 = height - 1;
            while (x0 < x1 && xCount[x0] < xNeed) x0++;
            while (x1 > x0 && xCount[x1] < xNeed) x1--;
            while (y0 < y1 && yCount[y0] < yNeed) y0++;
            while (y1 > y0 && yCount[y1] < yNeed) y1--;
            return { x0, y0, x1, y1 };
          }

          function crop(scale, useMinSide) {
            const width = canvas.width;
            const height = canvas.height;
            const bounds = activeBounds(
              signal,
              width,
              height,
              Math.max(4, otsu(signal)),
            );
            if (!bounds) throw new Error("没有发光区域");
            const boundsWidth = bounds.x1 - bounds.x0 + 1;
            const boundsHeight = bounds.y1 - bounds.y0 + 1;
            const centerX = (bounds.x0 + bounds.x1) / 2;
            const centerY = (bounds.y0 + bounds.y1) / 2;
            let roiWidth = boundsWidth * scale;
            let roiHeight = boundsHeight * scale;
            if (useMinSide) {
              const side = Math.min(roiWidth, roiHeight);
              roiWidth = side;
              roiHeight = side;
            }
            const x = Math.max(0, Math.round(centerX - roiWidth / 2));
            const y = Math.max(0, Math.round(centerY - roiHeight / 2));
            return {
              x,
              y,
              width: Math.min(width - x, Math.round(roiWidth)),
              height: Math.min(height - y, Math.round(roiHeight)),
              bounds,
            };
          }

          function extractRoi(roi) {
            const data = new Uint8ClampedArray(roi.width * roi.height * 4);
            for (let y = 0; y < roi.height; y++) {
              const sourceStart = ((roi.y + y) * canvas.width + roi.x) * 4;
              const sourceEnd = sourceStart + roi.width * 4;
              data.set(pixels.data.subarray(sourceStart, sourceEnd), y * roi.width * 4);
            }
            return data;
          }

          function profileStats(roi, axis) {
            try {
              const profile = BP.fringe.profileFromImageData(
                extractRoi(roi),
                roi.width,
                roi.height,
                axis,
              );
              let minimum = Infinity;
              let maximum = -Infinity;
              for (const value of profile) {
                minimum = Math.min(minimum, value);
                maximum = Math.max(maximum, value);
              }
              try {
                const result = BP.physics.fringePeriod(Array.from(profile), {});
                return {
                  ok: true,
                  periodPx: result.periodPx,
                  periodPxCross: result.periodPxCross,
                  crossDiff: Math.abs(result.periodPx - result.periodPxCross) / result.periodPx,
                  visibility: result.visibility,
                  acfPeak: result.acfPeak,
                  spectralSnr: result.spectralSnr,
                  profileMin: minimum,
                  profileMax: maximum,
                };
              } catch (error) {
                return {
                  ok: false,
                  error: error.message,
                  profileMin: minimum,
                  profileMax: maximum,
                };
              }
            } catch (error) {
              return { ok: false, error: error.message };
            }
          }

          function fullAnalysis(roi) {
            try {
              const result = BP.fringe.analyzeImageData(
                extractRoi(roi),
                roi.width,
                roi.height,
                { minAcf: 0.2, minSnr: 3 },
              );
              return {
                ok: true,
                periodPx: result.periodPx,
                periodPxCross: result.periodPxCross,
                periodPxCoarse: result.periodPxCoarse,
                crossDiff: Math.abs(result.periodPx - result.periodPxCross) / result.periodPx,
                visibility: result.visibility,
                acfPeak: result.acfPeak,
                spectralSnr: result.spectralSnr,
                directionDeg: result.directionDeg,
                stripeAngleDeg: result.stripeAngleDeg,
                roi: result.roi,
              };
            } catch (error) {
              return { ok: false, error: error.message };
            }
          }

          function fullFrameCalibration() {
            try {
              const result = BP.fringe.analyzeImageData(
                pixels.data,
                canvas.width,
                canvas.height,
                {},
              );
              const calibrated = BP.frameCalibration.calibrateSameFrame(
                pixels.data,
                canvas.width,
                canvas.height,
                result,
                { analysisScale: 1, tickSpacingMm: 1 },
              );
              const geometry = calibrated.geometry || {};
              return {
                ok: true,
                fringe: {
                  periodPx: result.periodPx,
                  periodPxCross: result.periodPxCross,
                  visibility: result.visibility,
                  acfPeak: result.acfPeak,
                  spectralSnr: result.spectralSnr,
                  directionDeg: result.directionDeg,
                  stripeAngleDeg: result.stripeAngleDeg,
                  axis: result.axis,
                  stripeCount: result.stripeCount,
                  roi: result.roi,
                },
                geometry: {
                  method: geometry.method || "",
                  error: geometry.error || null,
                  count: geometry.count || 0,
                  spacingPx: geometry.spacingPx,
                  relativeRms: geometry.relativeRms,
                  baselineY: geometry.baselineY,
                  warnings: geometry.warnings || [],
                  lines: (geometry.lines || []).map((line) => ({
                    index: line.index,
                    x: line.x,
                    measuredX: line.measuredX,
                    slopePxPerPx: line.slopePxPerPx,
                    y0: line.y0,
                    y1: line.y1,
                  })),
                  debugPeaks: (geometry.debug && geometry.debug.peaks) || [],
                },
                calibration: {
                  status: calibrated.calibration.status,
                  tickSpacingPx: calibrated.calibration.tickSpacingPx,
                  kMmPx: calibrated.calibration.kMmPx,
                  relativeRms: calibrated.calibration.relativeRms,
                  confidence: calibrated.calibration.confidence,
                  warnings: calibrated.calibration.warnings || [],
                },
              };
            } catch (error) {
              return { ok: false, error: error.message };
            }
          }

          const variants = {};
          for (const scale of [0.78, 0.7, 0.6, 0.5, 0.4]) {
            const roi = crop(scale, false);
            variants["roi" + Math.round(scale * 100)] = {
              roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
              x: profileStats(roi, "x"),
              y: profileStats(roi, "y"),
              analysis: fullAnalysis(roi),
            };
          }
          for (const scale of [0.6, 0.5, 0.4]) {
            const roi = crop(scale, true);
            variants["square" + Math.round(scale * 100)] = {
              roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
              x: profileStats(roi, "x"),
              y: profileStats(roi, "y"),
              analysis: fullAnalysis(roi),
            };
          }
          return {
            name,
            size: { width: canvas.width, height: canvas.height },
            threshold: otsu(signal),
            fullFrameCalibration: fullFrameCalibration(),
            variants,
          };
        }
        """,
        {"name": path.name, "dataUrl": frame_as_data_url(path)},
    )


def main() -> None:
    """逐帧输出多 ROI 诊断结果。"""
    pattern = os.environ.get("FRAME_GLOB", "*-mid.jpg")
    frames = sorted(
        path for path in FRAME_DIR.glob(pattern)
        if path.name != "contact-mid.jpg"
    )
    if not frames:
        raise SystemExit("缺少诊断帧，请先抽取视频中间帧")

    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--ignore-certificate-errors"],
        )
        page = browser.new_page(ignore_https_errors=True)
        page.goto(BASE + "/", wait_until="networkidle")
        for frame in frames:
            results.append(diagnose_frame(page, frame))
        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
