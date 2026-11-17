"""AI 实验数据报告页的桌面端与手机端浏览器回归。

检查默认数据、无效导入、bp.record/2 导入确认、bp.report/1 导出往返、
追迹图交互、来源审计、打印样式和精选图片加载。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
DOWNLOADS = OUTPUT / "playwright-report-downloads"
sys.stdout.reconfigure(encoding="utf-8")


def check(condition: bool, message: str) -> None:
    """统一断言入口，失败时保留可读原因。"""
    if not condition:
        raise AssertionError(message)
    print("PASS  " + message)


def wait_report_ready(page: Page) -> None:
    """等待报告数据内核与默认视图完成渲染。"""
    page.wait_for_function(
        """
        () => window.BP && BP.pages && BP.pages.report &&
          document.querySelector('#heroValue') &&
          document.querySelector('#heroValue').textContent.trim() !== '—'
        """,
        timeout=30000,
    )


def open_import_file(page: Page, name: str, payload: str) -> None:
    """通过文件输入打开导入预览，不直接修改报告。"""
    page.set_input_files(
        "#importInput",
        {
            "name": name,
            "mimeType": "application/json",
            "buffer": payload.encode("utf-8"),
        },
    )
    page.wait_for_function(
        "() => document.querySelector('#importDialog')?.open === true",
        timeout=10000,
    )


def close_import_dialog(page: Page) -> None:
    """关闭预览并确认当前报告仍然存在。"""
    page.click("#dialogCancel")
    page.wait_for_function(
        "() => document.querySelector('#importDialog')?.open === false",
        timeout=5000,
    )
    check(
        page.locator("#heroValue").inner_text().strip() != "—",
        "关闭导入预览后保留当前报告",
    )


def attach_error_capture(page: Page, errors: list[str]) -> None:
    """记录脚本错误、控制台错误与资源加载失败。"""
    page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
    page.on(
        "console",
        lambda message: errors.append("console: " + message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "requestfailed",
        lambda request: errors.append(
            "requestfailed: " + request.url + " / " + str(request.failure)
        ),
    )


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    result: dict[str, object] = {}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--ignore-certificate-errors"],
        )
        context = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1440, "height": 1000},
            accept_downloads=True,
        )
        page = context.new_page()
        attach_error_capture(page, errors)
        page.goto(BASE + "/report.html", wait_until="networkidle")
        page.evaluate("() => localStorage.removeItem('bp.report.snapshot.v2')")
        page.reload(wait_until="networkidle")
        wait_report_ready(page)

        # 默认数据必须同时体现真实识别值与“红光仅参考”警告。
        hero_value = page.locator("#heroValue").inner_text()
        summary_text = page.locator("#summaryLead").inner_text()
        metrics_text = page.locator("#metricGrid").inner_text()
        check("597.10" in hero_value, "比值法条件结果复现为 597.10 nm")
        check("104.954" in summary_text and "114.763" in summary_text,
              "摘要显示钠光与红光真实 Δx")
        check("20" in metrics_text and "5" in metrics_text,
              "摘要显示钠光 20 帧与红光 5 帧")
        geometry_text = page.locator("#geometryGrid").inner_text()
        check("0.91805" in geometry_text and "628.37" in geometry_text,
              "实测几何区显示 d 与二次成像距离 D")
        check("0.53009" in geometry_text, "实测几何区显示反算等效角 A_eff")
        check("报告预设" in geometry_text,
              "A_eff 明确标记含报告预设折射率")
        check(
            "referenceOnly" in page.locator("#summaryWarnings").inner_text(),
            "红光有限帧数警告显式出现",
        )
        desktop_overflow = page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        check(not desktop_overflow, "桌面报告页无横向溢出")

        # 无效 JSON 只显示字段错误，不替换当前报告。
        before_invalid = page.locator("#heroValue").inner_text()
        open_import_file(page, "invalid-report.json", '{"schema":"bp.report/999"}')
        check(page.locator("#dialogConfirm").is_disabled(), "无效 JSON 禁用确认按钮")
        preview_text = page.locator("#importPreview").inner_text()
        check("schema" in preview_text and "bp.report/999" in preview_text,
              "无效 JSON 显示字段级版本错误")
        close_import_dialog(page)
        check(page.locator("#heroValue").inner_text() == before_invalid,
              "无效导入不清空当前报告")

        # bp.record/2 必须先预览，确认后按角色聚合真实帧。
        record = page.evaluate("() => BP.reportData.exampleRecord()")
        open_import_file(
            page,
            "record-example.json",
            json.dumps(record, ensure_ascii=False),
        )
        record_preview = page.locator("#importPreview").inner_text()
        check("bp.record/2" in record_preview and "4 帧" in record_preview,
              "bp.record/2 预览显示会话与真实帧数")
        check(not page.locator("#dialogConfirm").is_disabled(),
              "有效 bp.record/2 允许确认导入")
        page.click("#dialogConfirm")
        page.wait_for_function(
            "() => document.querySelector('#importDialog')?.open === false",
            timeout=10000,
        )
        imported_roles = page.evaluate(
            """
            () => {
              const data = BP.pages.report.getDataset();
              return {
                sodium: data.roleStats.sodium.n,
                reference: data.roleStats.reference.n,
                referenceOnly: data.roleStats.reference.referenceOnly,
                sessions: data.sessions.length
              };
            }
            """
        )
        check(imported_roles["sodium"] == 2 and imported_roles["reference"] == 2,
              "导入记录按 sodium/reference 角色聚合")
        check(imported_roles["referenceOnly"] is True,
              "导入记录保留红光仅参考标记")

        # 无二次成像记录时不得沿用默认实测几何量或预设参数补值。
        imported_methods = page.evaluate(
            """
            () => {
              const data = BP.pages.report.getDataset();
              return {
                magnification: data.methods.magnification.valueNm,
                traceSameSource: data.rayTrace.sameSource,
                geometry: data.actualGeometry
              };
            }
            """
        )
        check(imported_methods["magnification"] is None,
              "缺少二次成像记录时放大率法不伪造结果")
        check(imported_methods["traceSameSource"] is False,
              "导入记录不伪造本轮二次成像同源关系")

        # 导出 bp.report/1 后再导入，数值与角色帧数必须一致。
        with page.expect_download(timeout=15000) as download_info:
            page.click("#exportButton")
        download = download_info.value
        export_path = DOWNLOADS / (download.suggested_filename or "fresnel-report.json")
        download.save_as(str(export_path))
        snapshot = json.loads(export_path.read_text(encoding="utf-8"))
        check(snapshot.get("version") == "bp.report/1",
              "导出文件声明 bp.report/1")
        exported_ratio = float(snapshot["dataset"]["methods"]["ratio"]["valueNm"])
        page.set_input_files("#importInput", str(export_path))
        page.wait_for_function(
            "() => document.querySelector('#importDialog')?.open === true",
            timeout=10000,
        )
        page.click("#dialogConfirm")
        page.wait_for_function(
            "() => document.querySelector('#importDialog')?.open === false",
            timeout=10000,
        )
        roundtrip_ratio = page.evaluate(
            "() => BP.pages.report.getDataset().methods.ratio.valueNm"
        )
        check(abs(float(roundtrip_ratio) - exported_ratio) < 1e-9,
              "bp.report/1 导出导入往返保持数值")

        # 追迹图：悬停、残差切换与傍轴曲线显隐。
        canvas = page.locator("#traceChart")
        canvas.scroll_into_view_if_needed()
        box = canvas.bounding_box()
        check(box is not None and box["width"] > 280 and box["height"] > 260,
              "交互追迹画布尺寸有效")
        page.mouse.move(
            box["x"] + box["width"] * 0.62,
            box["y"] + box["height"] * 0.45,
        )
        page.wait_for_function(
            "() => document.querySelector('#traceReadout').textContent.includes('d_trace=')",
            timeout=5000,
        )
        check("残差=" in page.locator("#traceReadout").inner_text(),
              "追迹图悬停显示 d 与残差读数")
        page.click("#traceResidualView")
        check("残差" in page.locator("#traceLegend").inner_text(),
              "追迹图可切换到相对残差视图")
        page.click("#traceMainView")
        initial_legend = page.locator("#traceLegend").inner_text()
        page.click("#traceParaxialToggle")
        hidden_pressed = page.locator("#traceParaxialToggle").get_attribute("aria-pressed")
        hidden_legend = page.locator("#traceLegend").inner_text()
        check("傍轴近似" in initial_legend and "傍轴近似" not in hidden_legend,
              "傍轴曲线可显隐")
        check(hidden_pressed == "false", "傍轴按钮同步 aria-pressed 状态")

        # 来源筛选只显示对应类型，缺失值保持为空。
        page.click('.audit-filter[data-filter="modelTrace"]')
        sources = page.locator("#auditBody .source-chip").evaluate_all(
            "els => els.map(el => el.dataset.source)"
        )
        check(bool(sources) and all(source == "modelTrace" for source in sources),
              "来源审计筛选只保留模型追迹字段")
        page.click('.audit-filter[data-filter="missing"]')
        missing_text = page.locator("#auditBody").inner_text()
        check("光线追迹法" in missing_text or "横向放大率法" in missing_text,
              "来源审计明确列出缺失方法角色")

        # 精选图片墙应加载 manifest 中的全部优化副本。
        gallery = page.locator("#galleryGrid")
        gallery.scroll_into_view_if_needed()
        page.wait_for_function(
            "() => document.querySelectorAll('.gallery-card img').length >= 8",
            timeout=15000,
        )
        images = page.locator(".gallery-card img")
        image_count = images.count()
        for index in range(image_count):
            images.nth(index).scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        broken_images = images.evaluate_all(
            "els => els.filter(img => img.complete && img.naturalWidth === 0).length"
        )
        check(image_count >= 8, "精选图片墙加载至少 8 张图片")
        check(broken_images == 0, "精选图片墙没有损坏图片")
        result["galleryCount"] = image_count

        # 打印媒体隐藏交互控件，但保留报告正文。
        page.emulate_media(media="print")
        check(
            page.locator(".report-topbar").evaluate(
                "el => getComputedStyle(el).display"
            ) == "none",
            "打印样式隐藏顶部操作栏",
        )
        check(
            page.locator(".trace-toolbar").evaluate(
                "el => getComputedStyle(el).display"
            ) == "none",
            "打印样式隐藏追迹图按钮",
        )
        page.emulate_media(media="screen")
        page.screenshot(path=str(OUTPUT / "report-desktop.png"), full_page=True)

        # 手机视口复跑核心渲染与响应式布局。
        mobile_context = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
        )
        mobile = mobile_context.new_page()
        attach_error_capture(mobile, errors)
        mobile.goto(BASE + "/report.html", wait_until="networkidle")
        mobile.evaluate("() => localStorage.removeItem('bp.report.snapshot.v2')")
        mobile.reload(wait_until="networkidle")
        wait_report_ready(mobile)
        mobile_overflow = mobile.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        check(not mobile_overflow, "手机报告页无横向溢出")
        check("597.10" in mobile.locator("#heroValue").inner_text(),
              "手机报告页显示同一条件结果")
        check(mobile.locator("#methodCards .method-card").count() == 3,
              "手机报告页保留三种方法卡片")
        mobile_geometry = mobile.locator("#geometryGrid").inner_text()
        check("0.91805" in mobile_geometry and "0.53009" in mobile_geometry,
              "手机报告页显示同一组实测几何量")
        mobile.locator("#galleryGrid").scroll_into_view_if_needed()
        mobile.wait_for_function(
            "() => document.querySelectorAll('.gallery-card img').length >= 8",
            timeout=15000,
        )
        mobile.screenshot(path=str(OUTPUT / "report-mobile.png"), full_page=True)
        result["desktopHero"] = hero_value
        result["mobileHero"] = mobile.locator("#heroValue").inner_text()

        mobile_context.close()
        context.close()
        browser.close()

    if errors:
        raise AssertionError("浏览器错误：\n" + "\n".join(errors))
    print("\n报告浏览器回归通过：" + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
