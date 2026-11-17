"""用真实实验照片验证手机端角色写入与分划板自动标定。"""

import json
import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
PHOTO = Path(os.environ.get(
    "PHOTO",
    r"D:\物理实验\第二次自主设计\11.17实验\钠光灯\比值法"
    r"\4d416170a0ab99512eb66657d01a82e9_720.jpg",
))


def wait_role_count(page, role, expected):
    """等待指定角色累计到目标照片数。"""
    page.wait_for_function(
        """
        ({ role, expected }) => {
          const session = BP.sessions.getActiveSession();
          return session && BP.sessions.roleStats(session.id, role).n >= expected;
        }
        """,
        arg={"role": role, "expected": expected},
        timeout=60000,
    )


def upload_photo(page, role, expected):
    """切换角色后上传照片，并返回持久化帧摘要。"""
    page.select_option("#roleSelect", role)
    # 连续选择同一文件时清空 input，确保 change 事件仍会触发。
    page.evaluate("() => { document.querySelector('#fileInput').value = ''; }")
    page.set_input_files("#fileInput", str(PHOTO))
    wait_role_count(page, role, expected)
    return page.evaluate(
        """
        (role) => {
          const session = BP.sessions.getActiveSession();
          const stat = BP.sessions.roleStats(session.id, role);
          const frames = BP.sessions.listFrames(session.id, role);
          return {
            n: stat.n,
            meanPx: stat.meanPx,
            meanStripeCount: stat.meanStripeCount,
            frames: frames.map((frame) => ({
              role: frame.role,
              deltaXPx: frame.deltaXPx,
              stripeCount: frame.stripeCount,
              source: frame.source,
              sourceName: frame.sourceName,
            })),
          };
        }
        """,
        role,
    )


def main():
    """执行照片角色与目镜刻线标定实测。"""
    if not PHOTO.is_file():
        raise SystemExit("缺少实测照片：" + str(PHOTO))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--ignore-certificate-errors"],
        )
        context = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 430, "height": 932},
            is_mobile=True,
            has_touch=True,
        )
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/mobile.html", wait_until="networkidle")

        page.select_option("#methodSelect", "ratio")
        page.get_by_role("button", name="新建会话").click()
        sodium = upload_photo(page, "sodium", 1)
        reference = upload_photo(page, "reference", 1)

        session_data = page.evaluate(
            """
            () => {
              BP.pages.mobile.applySessionData({ force: true, silent: true });
              const session = BP.sessions.getActiveSession();
              const data = BP.sessionData.build(session);
              return {
                method: data.method,
                dxNaPx: data.values.dxNaPx,
                dxRefPx: data.values.dxRefPx,
                dxNaSource: data.sources.dxNaPx,
                dxRefSource: data.sources.dxRefPx,
                dxNaDetail: data.sourceDetails.dxNaPx,
                dxRefDetail: data.sourceDetails.dxRefPx,
                summary: document.querySelector("#sessionDataSummary").innerText,
              };
            }
            """
        )
        page.screenshot(path=str(OUTPUT / "mobile-photo-import.png"), full_page=True)

        page.get_by_role("tab", name="标定").click()
        page.set_input_files("#reticleFile", str(PHOTO))
        page.wait_for_function(
            """
            () => {
              const text = document.querySelector('#retPix').textContent;
              return text && !/正在自动识别/.test(text);
            }
            """,
            timeout=60000,
        )
        reticle_text = page.locator("#retPix").inner_text()
        count_match = re.search(r"自动识别\s+(\d+)\s+条", reticle_text)
        spacing_match = re.search(r"相邻\s+([0-9.]+)\s*px", reticle_text)
        if not count_match:
            raise AssertionError("自动刻线识别未给出刻线条数：" + reticle_text)
        if not spacing_match:
            raise AssertionError("自动刻线识别未给出像素间距：" + reticle_text)
        line_count = int(count_match.group(1))
        spacing_px = float(spacing_match.group(1))
        page.get_by_role("button", name="计算并保存 k").click()
        reticle = page.evaluate(
            """
            () => {
              const saved = BP.store.loadK();
              const session = BP.sessions.getActiveSession();
              return {
                text: document.querySelector('#retPix').textContent,
                currentK: document.querySelector('#currentK').textContent,
                retResult: document.querySelector('#retResult').innerText,
                saved,
                calibration: session && session.calibration,
              };
            }
            """
        )
        page.screenshot(path=str(OUTPUT / "mobile-reticle-actual.png"), full_page=True)

        # 用户把 L 改成实际尺寸后，来源必须从报告预设切换为“手动输入”。
        page.fill("#retL", "4.9")
        page.get_by_role("button", name="计算并保存 k").click()
        manual_l = page.evaluate(
            """
            () => {
              const saved = BP.store.loadK();
              const session = BP.sessions.getActiveSession();
              return {
                retResult: document.querySelector('#retResult').innerText,
                saved,
                calibration: session && session.calibration,
              };
            }
            """
        )
        page.screenshot(path=str(OUTPUT / "mobile-reticle-manual-l.png"), full_page=True)

        # PC 端复用同一会话，验证照片角色、来源、条纹数与自动填入保持一致。
        pc_page = context.new_page()
        pc_page.on("pageerror", lambda error: errors.append("PC: " + str(error)))
        pc_page.goto(BASE + "/", wait_until="networkidle")
        pc_page.select_option("#pcRoleSelect", "reference")
        pc_page.set_input_files("#imageInput", str(PHOTO))
        pc_page.get_by_role("button", name="开始分析").click()
        pc_page.wait_for_function(
            """
            () => {
              const session = BP.sessions.getActiveSession();
              if (!session || BP.sessions.roleStats(session.id, 'reference').n < 2) {
                return false;
              }
              return document.querySelector('#fringe_laser').dataset.sessionAuto === '1';
            }
            """,
            timeout=60000,
        )
        pc_photo = pc_page.evaluate(
            """
            () => {
              const session = BP.sessions.getActiveSession();
              const frames = BP.sessions.listFrames(session.id, 'reference');
              const latest = frames.find((frame) => frame.source === 'photo');
              return {
                n: BP.sessions.roleStats(session.id, 'reference').n,
                deltaXPx: latest.deltaXPx,
                stripeCount: latest.stripeCount,
                source: latest.source,
                sourceName: latest.sourceName,
                formValue: document.querySelector('#fringe_laser').value,
                formAuto: document.querySelector('#fringe_laser').dataset.sessionAuto,
              };
            }
            """
        )
        pc_page.screenshot(path=str(OUTPUT / "pc-photo-import.png"), full_page=True)
        browser.close()

    saved_n = reticle["saved"]["N"]
    expected_k = 5 / saved_n
    result = {
        "photo": str(PHOTO),
        "sodium": sodium,
        "reference": reference,
        "pcPhoto": pc_photo,
        "sessionData": session_data,
        "reticle": {
            **reticle,
            "lineCount": line_count,
            "displaySpacingPx": spacing_px,
            "savedNPx": saved_n,
            "expectedK": expected_k,
        },
        "manualL": manual_l,
        "pageErrors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    assert not errors, errors
    assert sodium["n"] == 1 and reference["n"] == 1, "两种角色应各写入 1 张照片"
    assert sodium["meanPx"] > 0 and reference["meanPx"] > 0, "照片应写入真实 Δx"
    assert sodium["meanStripeCount"] > 0 and reference["meanStripeCount"] > 0, \
        "照片应写入真实条纹数"
    assert sodium["frames"][0]["role"] == "sodium", "钠光角色必须隔离保存"
    assert reference["frames"][0]["role"] == "reference", "参考角色必须隔离保存"
    assert all(frame["source"] == "photo" for frame in sodium["frames"] + reference["frames"]), \
        "照片来源必须标为 photo"
    assert pc_photo["n"] == 2, "PC 导入应追加到同一参考角色"
    assert pc_photo["deltaXPx"] > 0 and pc_photo["stripeCount"] > 0, \
        "PC 照片应保留真实 Δx 与条纹数"
    assert pc_photo["source"] == "photo" and pc_photo["sourceName"] == PHOTO.name, \
        "PC 照片应保留文件来源"
    assert pc_photo["formAuto"] == "1", "PC 参考光 Δx 应自动填入且标记来源"
    assert abs(float(pc_photo["formValue"]) - pc_photo["deltaXPx"]) < 1e-9, \
        "PC 自动填入值应与持久化 Δx 一致"
    assert session_data["dxNaSource"] == "自动识别", "钠光 Δx 应来自照片识别"
    assert session_data["dxRefSource"] == "自动识别", "参考 Δx 应来自照片识别"
    assert "平均" in session_data["dxNaDetail"] and "条条纹" in session_data["dxNaDetail"], \
        "自动填入来源摘要应包含真实条纹数"
    assert reticle["calibration"]["source"] == "自动刻线标定", "k 应记录自动刻线来源"
    assert reticle["calibration"]["L_source"] == "报告预设，待核实", \
        "默认 L=5 mm 必须明确标为待核实预设"
    assert "L 来源" in reticle["retResult"] and "报告预设，待核实" in reticle["retResult"], \
        "标定结果页应显示 L 的真实来源"
    assert 3 <= line_count <= 7, "应识别真实刻线，而不是把 8 条周期条纹当成刻线"
    assert abs(saved_n - spacing_px) <= 0.5, "保存的 N 应与界面显示值一致"
    assert 95 <= saved_n <= 125, "实测刻线间距应落在原图像素尺度范围内"
    assert abs(reticle["calibration"]["N_px"] - saved_n) < 1e-9, \
        "会话应保存精确的标定像素间距 N"
    assert abs(reticle["saved"]["value"] - expected_k) < 1e-9, "保存的 k 与识别间距不一致"
    assert manual_l["calibration"]["L_mm"] == 4.9, "手动输入的 L 应写入会话"
    assert manual_l["calibration"]["L_source"] == "手动输入", "修改 L 后必须标为手动输入"
    assert "L 来源" in manual_l["retResult"] and "手动输入" in manual_l["retResult"], \
        "标定结果页应显示手动 L 来源"


if __name__ == "__main__":
    main()
