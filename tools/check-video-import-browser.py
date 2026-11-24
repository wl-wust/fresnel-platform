"""视频导入、短片段采样与角色写入的浏览器实测。"""

import json
import os
import shutil
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE = os.environ.get("LAN_BASE", "https://localhost:52224")
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "output"
sys.stdout.reconfigure(encoding="utf-8")

VIDEOS = {
    "sodium": Path(os.environ.get("SODIUM_VIDEO", r"E:\qq\VID_20261103_152203.mp4")),
    "reference": Path(os.environ.get("REFERENCE_VIDEO", r"E:\qq\VID_20261117_144210.mp4")),
}
RECOVERY_VIDEOS = {
    "short": Path(os.environ.get(
        "RECOVERY_SHORT_VIDEO",
        r"D:\物理实验\第二次自主设计\11.3实验\5c020b82caec580d892c85a5ac5bb680.mp4",
    )),
    "long": Path(os.environ.get(
        "RECOVERY_LONG_VIDEO",
        r"D:\物理实验\第二次自主设计\11.3实验\690313045ed50c1f1fcf059e741056e5.mp4",
    )),
}
REFERENCE_GAP = float(os.environ.get("REFERENCE_GAP", "0"))
EXPECTED_REFERENCE_TARGET = int(os.environ.get("EXPECTED_REFERENCE_TARGET", "5"))
EXPECTED_REFERENCE_EVIDENCE = int(os.environ.get(
    "EXPECTED_REFERENCE_EVIDENCE",
    str(EXPECTED_REFERENCE_TARGET),
))
CHROME = find_chrome()


def find_chrome() -> Path:
    """按 CHROME_PATH → PATH → 默认安装目录顺序定位 Chrome。"""
    override = os.environ.get("CHROME_PATH")
    if override:
        return Path(override).expanduser()
    for name in ("chrome", "chrome.exe", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            return Path(found)
    for env_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        root = os.environ.get(env_name)
        if root:
            candidate = Path(root) / "Google/Chrome/Application/chrome.exe"
            if candidate.exists():
                return candidate
    raise SystemExit("未找到 Chrome：请设置 CHROME_PATH 环境变量")


def wait_import_done(page):
    """等待导入完成，并返回页面状态文本。"""
    page.wait_for_function(
        """
        () => {
          const button = document.querySelector('#videoImportButton');
          return button && !button.disabled && /导入视频分析/.test(button.textContent);
        }
        """,
        timeout=180000,
    )
    return page.locator("#videoLiveStatus").inner_text()


def import_as(page, role, video):
    """切换到指定角色并导入视频，返回候选卡片的实测摘要。"""
    page.select_option("#videoMethodSelect", "ratio")
    page.select_option("#videoRoleSelect", role)
    page.set_input_files("#videoImportInput", str(video))
    status = wait_import_done(page)
    cards = page.locator(".video-candidate").all_inner_texts()
    stats = page.locator("#videoCandidateStats").inner_text()
    target = page.locator("#videoTargetSelect").input_value()
    return {
        "role": role,
        "video": str(video),
        "status": status,
        "stats": stats,
        "target": target,
        "cards": cards,
    }


def confirm_and_read_session(page, role):
    """确认候选帧写入当前角色，并读取持久化会话统计。"""
    button = page.locator("#videoConfirmButton")
    if not button.is_enabled():
        # 保留现场信息，避免只看到超时却不知道缺几帧、缺哪一类证据。
        diagnostic = {
            "role": role,
            "stats": page.locator("#videoCandidateStats").inner_text(),
            "status": page.locator("#videoLiveStatus").inner_text(),
            "cards": page.locator(".video-candidate").all_inner_texts(),
        }
        page.screenshot(path=str(OUTPUT / ("video-import-" + role + "-insufficient.png")),
                        full_page=True)
        print(json.dumps(diagnostic, ensure_ascii=False, indent=2))
        raise AssertionError("候选帧不足或未达到确认条件：" + json.dumps(
            diagnostic, ensure_ascii=False))
    page.click("#videoConfirmButton")
    page.wait_for_function(
        "() => document.querySelector('#videoLiveStatus').textContent.includes('已将')",
        timeout=30000,
    )
    return page.evaluate(
        """
        (role) => {
          const session = BP.sessions.getActiveSession();
          const stat = BP.sessions.roleStats(session.id, role);
          const frames = BP.sessions.listFrames(session.id, role);
          return {
            sessionId: session.id,
            method: session.method,
            role,
            n: stat.n,
            nEvidence: stat.nEvidence,
            nPx: stat.nPx,
            nMm: stat.nMm,
            meanPx: stat.meanPx,
            meanStripeCount: stat.meanStripeCount,
            frames: frames.map((frame) => ({
              deltaXPx: frame.deltaXPx,
              deltaXmm: frame.deltaXmm,
              stripeCount: frame.stripeCount,
              source: frame.source,
              capturedAt: frame.capturedAt,
              target: frame.selection && frame.selection.target,
              qualityGate: frame.selection && frame.selection.qualityGate,
              stabilityOk: frame.selection && frame.selection.stabilityOk,
              referenceOnly: frame.selection && frame.selection.referenceOnly,
              wavelengthRole: frame.selection && frame.selection.wavelengthRole,
              periodCluster: frame.selection && frame.selection.periodCluster,
              calibrationStatus: frame.calibrationStatus,
              localCalibration: frame.localCalibration,
            })),
          };
        }
        """,
        role,
    )


def main():
    missing = [str(path) for path in VIDEOS.values() if not path.exists()]
    if missing:
        raise SystemExit("缺少实测视频：" + "；".join(missing))

    OUTPUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as playwright:
        if not CHROME.exists():
            raise SystemExit("缺少本机 Chrome：" + str(CHROME))
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

        if REFERENCE_GAP > 0:
            # 诊断模式：固定间隔覆盖采样，仅用于区分采样不足与素材质量不足。
            page.evaluate(
                """
                (gap) => {
                  BP.videoSampler.sampleTimes = (duration) => {
                    const out = [];
                    for (let t = 0; t < duration; t += gap) out.push(Number(t.toFixed(3)));
                    return out;
                  };
                }
                """,
                REFERENCE_GAP,
            )
        reference = import_as(page, "reference", VIDEOS["reference"])
        reference_session = confirm_and_read_session(page, "reference")
        page.screenshot(path=str(OUTPUT / "video-import-reference.png"), full_page=True)

        page.reload(wait_until="networkidle")
        sodium = import_as(page, "sodium", VIDEOS["sodium"])
        sodium_session = confirm_and_read_session(page, "sodium")
        page.get_by_role("button", name="从当前会话填入").click()
        form = page.evaluate(
            """
            () => ({
              sodium: document.querySelector('#fringe_sodium').value,
              reference: document.querySelector('#fringe_laser').value,
              sodiumAuto: document.querySelector('#fringe_sodium').dataset.sessionAuto,
              referenceAuto: document.querySelector('#fringe_laser').dataset.sessionAuto,
              summary: document.querySelector('#sessionDataSummary').innerText,
            })
            """
        )
        page.screenshot(path=str(OUTPUT / "video-import-sodium.png"), full_page=True)

        # 同一页面先导入短片，再导入长片，验证 5 帧参考目标不会被下一段继承。
        page.reload(wait_until="networkidle")
        recovery_short = import_as(page, "sodium", RECOVERY_VIDEOS["short"])
        recovery_long = import_as(page, "sodium", RECOVERY_VIDEOS["long"])

        result = {
            "reference": reference,
            "referenceSession": reference_session,
            "sodium": sodium,
            "sodiumSession": sodium_session,
            "form": form,
            "targetRecovery": {
                "short": recovery_short,
                "long": recovery_long,
            },
            "pageErrors": errors,
        }
        # 保留完整实测摘要，便于定位失败帧；该文件只用于验证，不进入报告数据。
        (OUTPUT / "video-import-browser-result.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        assert not errors, errors
        assert reference["cards"], "红光参考视频没有产生有效候选帧"
        assert sodium["cards"], "钠光视频没有产生有效候选帧"
        assert int(reference["target"]) == EXPECTED_REFERENCE_TARGET, \
            "红光目标帧数与预期不一致"
        assert "稳定周期候选" in reference["stats"], "候选摘要应显示稳健周期簇"
        assert reference_session["nEvidence"] == EXPECTED_REFERENCE_EVIDENCE, \
            "红光参考应按预期帧数写入"
        assert sodium_session["nEvidence"] == 20, "钠光应写入 20 帧"
        assert reference_session["nMm"] == 0 and sodium_session["nMm"] == 0, \
            "未确认同帧刻线时不得生成正式毫米值"
        assert reference_session["meanStripeCount"] > 0, "红光应记录可见条纹数"
        assert sodium_session["meanStripeCount"] > 0, "钠光应记录可见条纹数"
        assert all(frame["qualityGate"] == "standard" for frame in reference_session["frames"]), \
            "短片不得降低单帧质量门限"
        # 长片段与短片段可能得到不同稳定性结论；断言必须跟随页面真实状态，
        # 不能把某一轮“红光仅参考”的旧结论写死。
        reference_stable = (
            "主频稳定" in reference["status"]
            and "波动偏大" not in reference["stats"]
        )
        assert all(
            frame["stabilityOk"] is reference_stable
            for frame in reference_session["frames"]
        ), "红光帧稳定性判定应与本轮页面状态一致"
        assert all(frame["referenceOnly"] is False for frame in reference_session["frames"]), \
            "新导入红光应作为待测目标，旧 referenceOnly 记录才保持原语义"
        assert all(frame["wavelengthRole"] == "target" for frame in reference_session["frames"]), \
            "红光帧应明确标记为 wavelengthRole=target"
        assert all(
            frame["periodCluster"]
            and frame["periodCluster"]["method"] == "median-mad"
            for frame in reference_session["frames"]
        ), "红光帧应保存中位数-MAD 稳健簇来源"
        assert form["sodiumAuto"] == "1" and form["referenceAuto"] == "1", \
            "两种角色应自动填入对应方法"
        assert "证据帧" in form["summary"] and "平均" in form["summary"], \
            "来源摘要应显示证据帧与条纹数"
        assert recovery_short["target"] == "5", "短片应自动采用 5 帧参考目标"
        assert recovery_long["target"] == "20", "长片应恢复上一次显式 20 帧目标"
        assert "/ 目标 20" in recovery_long["stats"], \
            "长片摘要应保留恢复后的 20 帧目标"
        browser.close()


if __name__ == "__main__":
    main()
