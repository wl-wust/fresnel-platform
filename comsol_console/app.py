"""菲涅耳双棱镜 COMSOL 参数控制台。

拖动参数时只刷新本地预览；COMSOL 更新和求解均由按钮显式触发。
"""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from typing import Callable


BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))

from comsol_backend import runtime_status  # noqa: E402
from scene_model import (  # noqa: E402
    PARAMETER_SPECS,
    ParameterSpec,
    build_scene,
    clamp_parameter,
    load_scene,
    save_scene,
    standard_scene_path,
)


COLORS = {
    "ink": "#17212b",
    "muted": "#667078",
    "paper": "#f7f4ec",
    "panel": "#fffdf8",
    "line": "#cfd4d3",
    "blue": "#256b84",
    "orange": "#c27b23",
    "green": "#5a8b57",
    "red": "#b6463f",
}


def format_value(value: float, spec: ParameterSpec) -> str:
    return f"{value:.{spec.precision}f}"


class ParameterControl(ttk.Frame):
    """同一个参数的滑块与数字框，双向同步。"""

    def __init__(
        self,
        master: tk.Misc,
        spec: ParameterSpec,
        value: float,
        on_change: Callable[[str, float], None],
    ) -> None:
        super().__init__(master)
        self.spec = spec
        self.on_change = on_change
        self._syncing = False
        self.scale_var = tk.DoubleVar(value=value)
        self.entry_var = tk.StringVar(value=format_value(value, spec))

        self.columnconfigure(0, weight=1)
        title = ttk.Label(
            self,
            text=f"{spec.label}  [{spec.unit}]" if spec.unit else spec.label,
            style="Param.TLabel",
        )
        title.grid(row=0, column=0, sticky="w")

        self.entry = ttk.Entry(self, textvariable=self.entry_var, width=9, justify="right")
        self.entry.grid(row=0, column=1, sticky="e", padx=(8, 0))
        self.entry.bind("<Return>", self._commit_entry)
        self.entry.bind("<FocusOut>", self._commit_entry)

        self.scale = ttk.Scale(
            self,
            from_=spec.minimum,
            to=spec.maximum,
            variable=self.scale_var,
            command=self._scale_changed,
        )
        self.scale.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(5, 0))

    def _scale_changed(self, _raw: str) -> None:
        if self._syncing:
            return
        value = clamp_parameter(self.spec.key, self.scale_var.get())
        self._syncing = True
        self.entry_var.set(format_value(value, self.spec))
        self._syncing = False
        self.on_change(self.spec.key, value)

    def _commit_entry(self, _event: tk.Event | None = None) -> None:
        if self._syncing:
            return
        try:
            value = clamp_parameter(self.spec.key, self.entry_var.get())
        except ValueError:
            value = self.scale_var.get()
        self._syncing = True
        self.scale_var.set(value)
        self.entry_var.set(format_value(value, self.spec))
        self._syncing = False
        self.on_change(self.spec.key, value)

    def set_value(self, value: float) -> None:
        value = clamp_parameter(self.spec.key, value)
        self._syncing = True
        self.scale_var.set(value)
        self.entry_var.set(format_value(value, self.spec))
        self._syncing = False

    def value(self) -> float:
        return clamp_parameter(self.spec.key, self.scale_var.get())


class ComsolConsole(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("菲涅耳双棱镜 · COMSOL 参数控制台")
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        window_width = min(1320, max(1000, screen_width - 80))
        window_height = min(840, max(680, screen_height - 90))
        x = max(0, (screen_width - window_width) // 2)
        y = max(0, (screen_height - window_height) // 2)
        self.geometry(f"{window_width}x{window_height}+{x}+{y}")
        self.minsize(980, 680)
        self.configure(background=COLORS["paper"])

        self.config_path = standard_scene_path()
        self.scene = load_scene(self.config_path)
        self.controls: dict[str, ParameterControl] = {}
        self.busy = False
        self.action_buttons: list[ttk.Button] = []
        self._draw_after_id: str | None = None

        self._configure_style()
        self._build_layout()
        self._set_scene(self.scene)
        self._refresh_local_preview("基准场景已加载，尚未启动 COMSOL")

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(".", font=("Microsoft YaHei UI", 9))
        style.configure("TFrame", background=COLORS["paper"])
        style.configure("Panel.TFrame", background=COLORS["panel"])
        style.configure("TLabel", background=COLORS["paper"], foreground=COLORS["ink"])
        style.configure("Param.TLabel", font=("Microsoft YaHei UI", 9))
        style.configure(
            "Section.TLabel",
            font=("Microsoft YaHei UI", 10, "bold"),
            foreground=COLORS["blue"],
        )
        style.configure("Muted.TLabel", foreground=COLORS["muted"], font=("Microsoft YaHei UI", 8))
        style.configure("ResultValue.TLabel", foreground=COLORS["blue"], font=("Consolas", 11, "bold"))
        style.configure("Primary.TButton", padding=(12, 7), font=("Microsoft YaHei UI", 9, "bold"))
        style.configure("Action.TButton", padding=(10, 7))
        style.configure("TEntry", padding=3)

    def _build_layout(self) -> None:
        header = tk.Frame(self, bg=COLORS["ink"], height=74)
        header.pack(side="top", fill="x")
        header.pack_propagate(False)
        tk.Label(
            header,
            text="COMSOL 光路参数台",
            bg=COLORS["ink"],
            fg="#ffffff",
            font=("Microsoft YaHei UI", 17, "bold"),
        ).pack(anchor="w", padx=22, pady=(13, 0))
        tk.Label(
            header,
            text="本地拖动预览 → 显式更新模型 → 求解后导出一次基准数据",
            bg=COLORS["ink"],
            fg="#b9c5ca",
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", padx=22, pady=(2, 0))

        status = runtime_status()
        if status["available"] and status["model_exists"]:
            runtime_text = f"mph {status['mph_version']} · 基准模型已找到"
            runtime_color = "#9ed39b"
        else:
            runtime_text = "mph 或基准模型不可用，本地预览仍可使用"
            runtime_color = "#ffb1a8"
        tk.Label(
            header,
            text=runtime_text,
            bg=COLORS["ink"],
            fg=runtime_color,
            font=("Microsoft YaHei UI", 8),
        ).place(relx=1.0, x=-22, y=25, anchor="e")

        content = ttk.Frame(self, padding=14)
        content.pack(fill="both", expand=True)
        content.columnconfigure(0, weight=0, minsize=320)
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)

        left_shell = ttk.Frame(content, style="Panel.TFrame")
        left_shell.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        left_shell.columnconfigure(0, weight=1)
        left_shell.rowconfigure(0, weight=1)
        left_canvas = tk.Canvas(
            left_shell,
            background=COLORS["panel"],
            highlightthickness=0,
            width=300,
        )
        left_scroll = ttk.Scrollbar(left_shell, orient="vertical", command=left_canvas.yview)
        left_canvas.configure(yscrollcommand=left_scroll.set)
        left_canvas.grid(row=0, column=0, sticky="nsew")
        left_scroll.grid(row=0, column=1, sticky="ns")

        left = ttk.Frame(left_canvas, style="Panel.TFrame", padding=14)
        left_window = left_canvas.create_window((0, 0), window=left, anchor="nw")
        left.columnconfigure(0, weight=1)
        left.bind(
            "<Configure>",
            lambda _event: left_canvas.configure(scrollregion=left_canvas.bbox("all")),
        )
        left_canvas.bind(
            "<Configure>",
            lambda event: left_canvas.itemconfigure(left_window, width=event.width),
        )
        left_canvas.bind(
            "<MouseWheel>",
            lambda event: left_canvas.yview_scroll(int(-event.delta / 120), "units"),
        )

        ttk.Label(left, text="已映射到当前 COMSOL 模型", style="Section.TLabel").grid(
            row=0, column=0, sticky="w", pady=(0, 8)
        )
        row = 1
        current_group = ""
        for spec in PARAMETER_SPECS:
            if spec.group != current_group:
                current_group = spec.group
                ttk.Label(left, text=current_group, style="Muted.TLabel").grid(
                    row=row, column=0, sticky="w", pady=(8, 2)
                )
                row += 1
            control = ParameterControl(
                left,
                spec,
                self.scene["parameters"][spec.key],
                self._on_parameter_changed,
            )
            control.grid(row=row, column=0, sticky="ew", pady=5)
            self.controls[spec.key] = control
            row += 1

        ttk.Separator(left).grid(row=row, column=0, sticky="ew", pady=(12, 8))
        row += 1
        ttk.Label(
            left,
            text="透镜 L′、45° 镜、光阑、测微目镜和完整机械支架尚未进入当前求解模型。",
            style="Muted.TLabel",
            wraplength=292,
            justify="left",
        ).grid(row=row, column=0, sticky="w")

        right = ttk.Frame(content)
        right.grid(row=0, column=1, sticky="nsew")
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)

        toolbar = ttk.Frame(right)
        toolbar.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        toolbar.columnconfigure(0, weight=1)
        self.config_label = ttk.Label(toolbar, text="", style="Muted.TLabel")
        self.config_label.grid(row=0, column=0, sticky="w")
        load_btn = ttk.Button(toolbar, text="读取配置", command=self._load_config)
        load_btn.grid(row=0, column=1, padx=(8, 0))
        save_btn = ttk.Button(toolbar, text="保存配置", command=self._save_config)
        save_btn.grid(row=0, column=2, padx=(8, 0))

        preview = ttk.Frame(right, style="Panel.TFrame", padding=10)
        preview.grid(row=1, column=0, sticky="nsew")
        preview.columnconfigure(0, weight=1)
        preview.rowconfigure(0, weight=1)
        self.preview_canvas = tk.Canvas(
            preview,
            background="#fbfaf6",
            highlightthickness=1,
            highlightbackground="#d9d7cf",
            height=300,
        )
        self.preview_canvas.grid(row=0, column=0, sticky="nsew")
        self.preview_canvas.bind("<Configure>", lambda _event: self._schedule_draw())

        results = ttk.Frame(right)
        results.grid(row=2, column=0, sticky="ew", pady=10)
        for column in range(4):
            results.columnconfigure(column, weight=1)
        self.result_vars = {
            "d": tk.StringVar(),
            "dx": tk.StringVar(),
            "px": tk.StringVar(),
            "D": tk.StringVar(),
        }
        cards = (
            ("虚光源间距 d", "d", "mm"),
            ("条纹间距 Δx", "dx", "mm"),
            ("条纹间距", "px", "px"),
            ("总距离 D", "D", "mm"),
        )
        for column, (title, key, unit) in enumerate(cards):
            card = ttk.Frame(results, style="Panel.TFrame", padding=(10, 8))
            card.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 6, 0))
            ttk.Label(card, text=title, style="Muted.TLabel", background=COLORS["panel"]).pack(anchor="w")
            ttk.Label(
                card,
                textvariable=self.result_vars[key],
                style="ResultValue.TLabel",
                background=COLORS["panel"],
            ).pack(anchor="w", pady=(2, 0))
            ttk.Label(card, text=unit, style="Muted.TLabel", background=COLORS["panel"]).pack(anchor="w")

        log_frame = ttk.Frame(right, style="Panel.TFrame", padding=8)
        log_frame.grid(row=3, column=0, sticky="ew")
        log_frame.columnconfigure(0, weight=1)
        ttk.Label(log_frame, text="运行记录", style="Section.TLabel").grid(row=0, column=0, sticky="w")
        self.log_text = tk.Text(
            log_frame,
            height=4,
            wrap="word",
            relief="flat",
            background="#f3f1ea",
            foreground="#354047",
            font=("Consolas", 9),
        )
        self.log_text.grid(row=1, column=0, sticky="ew", pady=(5, 0))
        self._append_log("控制台已就绪。拖动参数只更新本地预览。")

        footer = ttk.Frame(self, padding=(14, 0, 14, 14))
        footer.pack(fill="x")
        footer.columnconfigure(0, weight=1)
        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(footer, textvariable=self.status_var).grid(row=0, column=0, sticky="w")

        reset_btn = ttk.Button(footer, text="恢复基准", command=self._reset_scene)
        reset_btn.grid(row=0, column=1, padx=(8, 0))
        preview_btn = ttk.Button(footer, text="仅预览", command=self._preview_only)
        preview_btn.grid(row=0, column=2, padx=(8, 0))
        update_btn = ttk.Button(
            footer,
            text="更新 COMSOL",
            style="Action.TButton",
            command=lambda: self._run_backend("update"),
        )
        update_btn.grid(row=0, column=3, padx=(8, 0))
        solve_btn = ttk.Button(
            footer,
            text="求解并导出",
            style="Primary.TButton",
            command=lambda: self._run_backend("solve"),
        )
        solve_btn.grid(row=0, column=4, padx=(8, 0))
        self.action_buttons.extend((load_btn, save_btn, reset_btn, preview_btn, update_btn, solve_btn))

    def _set_scene(self, scene: dict) -> None:
        self.scene = scene
        for key, control in self.controls.items():
            control.set_value(scene["parameters"][key])
        self.config_label.configure(text=f"配置：{self.config_path}")

    def _collect_parameters(self) -> dict[str, float]:
        return {key: control.value() for key, control in self.controls.items()}

    def _on_parameter_changed(self, _key: str, _value: float) -> None:
        self._refresh_local_preview("本地预览已更新；COMSOL 模型尚未同步")

    def _refresh_local_preview(self, status: str) -> None:
        try:
            self.scene = build_scene(self._collect_parameters())
        except ValueError as exc:
            self.status_var.set(str(exc))
            return
        derived = self.scene["derived"]
        self.result_vars["d"].set(f"{derived['d_paraxial_mm']:.6f}")
        self.result_vars["dx"].set(f"{derived['delta_x_mm']:.6f}")
        self.result_vars["px"].set(f"{derived['delta_x_px']:.1f}")
        self.result_vars["D"].set(f"{derived['total_distance_mm']:.1f}")
        self.status_var.set(status)
        self._schedule_draw()

    def _schedule_draw(self) -> None:
        if self._draw_after_id is not None:
            self.after_cancel(self._draw_after_id)
        self._draw_after_id = self.after(30, self._draw_preview)

    def _draw_preview(self) -> None:
        self._draw_after_id = None
        canvas = self.preview_canvas
        canvas.delete("all")
        width = max(580, canvas.winfo_width())
        height = max(340, canvas.winfo_height())
        params = self.scene["parameters"]
        derived = self.scene["derived"]

        canvas.create_text(
            22,
            18,
            text="报告装置链路",
            anchor="nw",
            fill=COLORS["ink"],
            font=("Microsoft YaHei UI", 11, "bold"),
        )
        canvas.create_text(
            width - 22,
            20,
            text="实线：当前已映射　虚线：待扩展",
            anchor="ne",
            fill=COLORS["muted"],
            font=("Microsoft YaHei UI", 8),
        )
        self._draw_report_chain(canvas, width)
        self._draw_local_geometry(canvas, width, height, params, derived)

    def _draw_report_chain(self, canvas: tk.Canvas, width: int) -> None:
        chain = (
            ("钠灯", True),
            ("滤光/衰减", False),
            ("45° 镜", False),
            ("单缝", True),
            ("双棱镜", True),
            ("透镜 L′", False),
            ("光阑", False),
            ("测微目镜", False),
            ("手机", False),
        )
        left = 24
        right = width - 24
        gap = 7
        box_width = (right - left - gap * (len(chain) - 1)) / len(chain)
        y0, y1 = 48, 88
        for index, (label, mapped) in enumerate(chain):
            x0 = left + index * (box_width + gap)
            x1 = x0 + box_width
            canvas.create_rectangle(
                x0,
                y0,
                x1,
                y1,
                fill="#eef4f5" if mapped else "#f2f0eb",
                outline=COLORS["blue"] if mapped else "#aaa9a4",
                width=1.5 if mapped else 1,
                dash=() if mapped else (4, 3),
            )
            canvas.create_text(
                (x0 + x1) / 2,
                (y0 + y1) / 2,
                text=label,
                fill=COLORS["ink"] if mapped else COLORS["muted"],
                font=("Microsoft YaHei UI", 8, "bold" if mapped else "normal"),
            )
            if index < len(chain) - 1:
                canvas.create_line(
                    x1 + 1,
                    (y0 + y1) / 2,
                    x1 + gap - 1,
                    (y0 + y1) / 2,
                    fill="#9ba6a8",
                    arrow="last",
                )

    def _draw_local_geometry(
        self,
        canvas: tk.Canvas,
        width: int,
        height: int,
        params: dict,
        derived: dict,
    ) -> None:
        left, right = 54, width - 54
        axis_y = int(height * 0.55)
        rail_y = min(axis_y + 82, height - 74)
        source_x = left
        screen_x = right
        ratio = params["a_mm"] / derived["total_distance_mm"]
        prism_x = left + (right - left) * ratio

        canvas.create_text(
            left,
            112,
            text="参数化光路预览（本地示意，不是 COMSOL 求解结果）",
            anchor="w",
            fill=COLORS["ink"],
            font=("Microsoft YaHei UI", 10, "bold"),
        )
        canvas.create_line(left, rail_y, right, rail_y, fill=COLORS["ink"], width=4)
        canvas.create_line(left, rail_y + 8, right, rail_y + 8, fill=COLORS["ink"], width=1)
        for fraction in range(11):
            x = left + (right - left) * fraction / 10
            canvas.create_line(x, rail_y + 8, x, rail_y + 16, fill=COLORS["ink"])

        half_height_px = 28 + 2.6 * params["prism_half_height_mm"]
        cross_ratio = max(0.35, min(0.72, 0.56 - (params["beta_deg"] - 1.0) * 0.12))
        cross_x = prism_x + (screen_x - prism_x) * cross_ratio
        upper_screen_y = axis_y - 6
        lower_screen_y = axis_y + 6

        canvas.create_polygon(
            cross_x,
            axis_y - 12,
            screen_x,
            upper_screen_y,
            screen_x,
            lower_screen_y,
            cross_x,
            axis_y + 12,
            fill="#dcebcf",
            outline="",
            stipple="gray25",
        )

        rays = (0.18, 0.34, 0.50, 0.66, 0.82, 1.0)
        for fraction in rays:
            offset = half_height_px * fraction
            for sign, color, target_y in (
                (1, COLORS["orange"], upper_screen_y),
                (-1, COLORS["blue"], lower_screen_y),
            ):
                prism_y = axis_y - sign * offset
                canvas.create_line(
                    source_x,
                    axis_y,
                    prism_x,
                    prism_y,
                    fill="#c9a62e",
                    width=1,
                )
                canvas.create_line(
                    prism_x,
                    prism_y,
                    screen_x,
                    target_y,
                    fill=color,
                    width=1,
                )

        # 点光源与单缝
        canvas.create_oval(
            source_x - 8,
            axis_y - 8,
            source_x + 8,
            axis_y + 8,
            fill="#f0ca49",
            outline=COLORS["ink"],
            width=2,
        )
        canvas.create_line(source_x + 20, axis_y - 31, source_x + 20, axis_y + 31, fill=COLORS["ink"], width=3)
        canvas.create_line(source_x + 27, axis_y - 31, source_x + 27, axis_y + 31, fill=COLORS["ink"], width=1)
        canvas.create_text(
            source_x,
            rail_y + 30,
            text="光源 + 单缝",
            anchor="w",
            fill=COLORS["muted"],
        )

        # 双棱镜截面
        prism_w = max(22, min(50, 13 * params["beta_deg"] + 15))
        canvas.create_polygon(
            prism_x,
            axis_y,
            prism_x + prism_w,
            axis_y - half_height_px,
            prism_x + prism_w,
            axis_y + half_height_px,
            fill="#dce9ed",
            outline=COLORS["ink"],
            width=2,
        )
        canvas.create_text(
            prism_x + prism_w + 8,
            axis_y - half_height_px - 10,
            text=f"双棱镜 β={params['beta_deg']:.2f}°",
            anchor="w",
            fill=COLORS["ink"],
            font=("Microsoft YaHei UI", 9, "bold"),
        )
        canvas.create_text(
            prism_x,
            rail_y - 14,
            text=f"棱镜位置 · a={params['a_mm']:.1f} mm",
            anchor="w",
            fill=COLORS["muted"],
        )

        # 光屏
        canvas.create_line(screen_x, axis_y - 76, screen_x, axis_y + 76, fill=COLORS["ink"], width=3)
        canvas.create_text(
            screen_x,
            rail_y + 28,
            text=f"屏距 z₂={params['z2_mm']:.1f} mm",
            anchor="e",
            fill=COLORS["muted"],
        )

        canvas.create_text(
            (cross_x + screen_x) / 2,
            axis_y - 58,
            text="两束光交叠区（示意）",
            fill=COLORS["green"],
            font=("Microsoft YaHei UI", 8, "bold"),
        )
        canvas.create_text(
            left,
            height - 16,
            text=(
                f"d = {derived['d_paraxial_mm']:.6f} mm   "
                f"Δx = {derived['delta_x_mm']:.6f} mm   "
                f"屏面位置 x = {derived['screen_x_mm']:.1f} mm"
            ),
            anchor="sw",
            fill=COLORS["muted"],
            font=("Consolas", 9),
        )

    def _append_log(self, text: str) -> None:
        if not text:
            return
        self.log_text.insert("end", text.rstrip() + "\n")
        self.log_text.see("end")

    def _reset_scene(self) -> None:
        self.config_path = standard_scene_path()
        self._set_scene(load_scene(self.config_path))
        self._refresh_local_preview("已恢复报告表 5.1 基准参数")
        self._append_log("恢复基准参数。")

    def _load_config(self) -> None:
        path = filedialog.askopenfilename(
            title="读取 COMSOL 场景配置",
            initialdir=str(BASE / "scenes"),
            filetypes=(("JSON 配置", "*.json"), ("所有文件", "*.*")),
        )
        if not path:
            return
        try:
            scene = load_scene(path)
        except Exception as exc:
            messagebox.showerror("读取失败", str(exc), parent=self)
            return
        self.config_path = Path(path)
        self._set_scene(scene)
        self._refresh_local_preview(f"已读取 {self.config_path.name}")
        self._append_log(f"读取配置：{self.config_path}")

    def _save_config(self) -> None:
        path = filedialog.asksaveasfilename(
            title="保存 COMSOL 场景配置",
            initialdir=str(BASE / "scenes"),
            initialfile="custom_scene.json",
            defaultextension=".json",
            filetypes=(("JSON 配置", "*.json"),),
        )
        if not path:
            return
        try:
            save_scene(path, self.scene)
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc), parent=self)
            return
        self.config_path = Path(path)
        self.config_label.configure(text=f"配置：{self.config_path}")
        self._append_log(f"保存配置：{self.config_path}")
        self.status_var.set("配置已保存")

    def _preview_only(self) -> None:
        output = BASE / "outputs" / "preview_scene.json"
        save_scene(output, self.scene)
        self._append_log(f"仅预览：{output}")
        self.status_var.set("本地预览已保存；未启动 COMSOL")

    def _run_backend(self, mode: str) -> None:
        if self.busy:
            return
        pending = BASE / "outputs" / "pending_scene.json"
        save_scene(pending, self.scene)
        command = [
            sys.executable,
            str(BASE / "apply_scene.py"),
            "--mode",
            mode,
            "--config",
            str(pending),
            "--output-dir",
            str(BASE / "outputs"),
        ]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        creationflags = 0
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        self.busy = True
        self._set_busy(True)
        action = "更新 COMSOL 模型" if mode == "update" else "求解 COMSOL 并导出"
        self.status_var.set(action + "中，请等待……")
        self._append_log("开始" + action + "。")

        try:
            process = subprocess.Popen(
                command,
                cwd=str(BASE),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                creationflags=creationflags,
            )
        except Exception as exc:
            self.busy = False
            self._set_busy(False)
            messagebox.showerror("启动失败", str(exc), parent=self)
            return

        thread = threading.Thread(
            target=self._watch_backend,
            args=(process, action),
            daemon=True,
        )
        thread.start()

    def _watch_backend(self, process: subprocess.Popen, action: str) -> None:
        assert process.stdout is not None
        for line in process.stdout:
            self.after(0, self._append_log, line)
        code = process.wait()
        self.after(0, self._backend_finished, code, action)

    def _backend_finished(self, code: int, action: str) -> None:
        self.busy = False
        self._set_busy(False)
        if code == 0:
            self.status_var.set(action + "完成")
            self._append_log(action + "完成。")
            if action.startswith("求解"):
                self._append_log("输出目录：" + str(BASE / "outputs"))
        else:
            self.status_var.set(action + "失败")
            self._append_log(action + f"失败，退出码 {code}。")
            messagebox.showerror("COMSOL 运行失败", "请查看控制台运行记录和输出目录。", parent=self)

    def _set_busy(self, busy: bool) -> None:
        state = "disabled" if busy else "normal"
        for button in self.action_buttons:
            button.configure(state=state)


def main() -> None:
    app = ComsolConsole()
    app.mainloop()


if __name__ == "__main__":
    main()
