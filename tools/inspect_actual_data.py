"""临时读取研究报告中的公式与二次成像数据，供本轮实测重算核对。"""

from __future__ import annotations

import html
import json
import re
import sys
import zipfile
from pathlib import Path


TERMS = (
    "二次成像",
    "像间距",
    "放大率",
    "0.004",
    "16.51",
    "31.22",
    "53.2",
    "9.60",
    "d1",
    "d2",
    "d₁",
    "d₂",
)


def docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    text = re.sub(r"</w:(?:p|tr)>", "\n", xml)
    text = re.sub(r"</w:tc>", "\t", text)
    text = re.sub(r"<w:tab[^>]*/>", "\t", text)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("项目内 DOCX 文件：")
    for candidate in Path(".").glob("*.docx"):
        print(f"  {candidate.name}: {candidate.stat().st_size}")
    for name in (
        "研究报告_完整版.docx",
        "研究报告_测试.docx",
        "研究报告_菲涅耳双棱镜_v3.docx",
    ):
        path = Path(name)
        print(f"\n===== {name} =====")
        if not path.exists():
            print("文件不存在")
            continue
        with zipfile.ZipFile(path) as archive:
            print("关键压缩包条目：")
            for item in archive.infolist():
                if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                    print(f"  {item.filename}: {item.file_size}")
        text = docx_text(path)
        print(f"提取字符数：{len(text)}")
        print("正文开头：")
        print(re.sub(r"\n{3,}", "\n\n", text[:2500]))
        shown: list[tuple[int, int]] = []
        for term in TERMS:
            for match in re.finditer(re.escape(term), text):
                start = max(0, match.start() - 300)
                end = min(len(text), match.end() + 500)
                if any(start < existing_end and end > existing_start for existing_start, existing_end in shown):
                    continue
                shown.append((start, end))
                snippet = re.sub(r"\n{3,}", "\n\n", text[start:end])
                print(f"\n--- 命中：{term} ---\n{snippet}")

    print("\n===== 视频识别 JSON 摘要 =====")
    for path in (
        Path("output/video-diagnostics-11.17/corpus-all-final.json"),
        Path("output/video-diagnostics-11.17/official-videos-final.json"),
        Path("output/video-diagnostics-11.3/corpus-final.json"),
    ):
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        print(f"\n--- {path} ---")
        print(f"顶层类型：{type(data).__name__}")
        if isinstance(data, dict):
            print(f"顶层键：{list(data.keys())}")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:12000])


if __name__ == "__main__":
    main()
