"""用 2026-11-17 手写记录重算 d、D、A 与三种方法的实测偏差。"""

from __future__ import annotations

import math
import statistics
import sys


def mean(values: list[float]) -> float:
    return statistics.fmean(values)


def sample_sd(values: list[float]) -> float:
    return statistics.stdev(values)


def ua(values: list[float]) -> float:
    return sample_sd(values) / math.sqrt(len(values))


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    a_cm = [9.60, 9.60, 9.60]
    z2_cm = [53.22, 53.25, 53.24]
    magnified_positions = [(3.595, 5.095), (3.597, 5.087), (3.538, 5.055)]
    reduced_positions = [(2.756, 3.350), (2.217, 2.754), (2.190, 2.742)]
    u1_cm = [16.51]
    u2_cm = [31.22, 31.21, 31.23]

    d1_values = [abs(right - left) for left, right in magnified_positions]
    d2_values = [abs(right - left) for left, right in reduced_positions]
    d1 = mean(d1_values)
    d2 = mean(d2_values)
    d_geom = math.sqrt(d1 * d2)
    beta = math.sqrt(d1 / d2)
    d_rel_u = 0.5 * math.sqrt((ua(d1_values) / d1) ** 2 + (ua(d2_values) / d2) ** 2)

    a_mm = mean(a_cm) * 10
    z2_mm = mean(z2_cm) * 10
    D_mm = a_mm + z2_mm
    D_ua_mm = math.sqrt((ua(a_cm) * 10) ** 2 + (ua(z2_cm) * 10) ** 2) if len(a_cm) > 1 else ua(z2_cm) * 10

    n_glass = 1.5168
    A_rad = math.atan(d_geom / (2 * a_mm * (n_glass - 1)))
    A_deg = math.degrees(A_rad)

    sodium_dx_px = 104.9543787227124
    sodium_dx_ua_px = 0.1677835503 / math.sqrt(20)
    reference_dx_px = 114.76325484473463
    reference_dx_ua_px = 1.8032065225 / math.sqrt(5)
    lambda_ref_nm = 650.0
    n_ref = 1.5145
    standard_nm = 589.3

    ratio_nm = (
        lambda_ref_nm
        * (sodium_dx_px / reference_dx_px)
        * ((n_glass - 1) / (n_ref - 1))
    )
    ratio_rel_u = math.sqrt(
        (sodium_dx_ua_px / sodium_dx_px) ** 2
        + (reference_dx_ua_px / reference_dx_px) ** 2
    )
    ratio_u_nm = ratio_nm * ratio_rel_u

    print("d1/mm:", [round(value, 6) for value in d1_values])
    print("d2/mm:", [round(value, 6) for value in d2_values])
    print(f"d1={d1:.9f} mm, s={sample_sd(d1_values):.9f}, uA={ua(d1_values):.9f}")
    print(f"d2={d2:.9f} mm, s={sample_sd(d2_values):.9f}, uA={ua(d2_values):.9f}")
    print(f"d=sqrt(d1*d2)={d_geom:.9f} mm, uA≈{d_geom*d_rel_u:.9f} mm, rel={d_rel_u:.8%}")
    print(f"beta=sqrt(d1/d2)={beta:.9f}")
    print(f"a={a_mm:.6f} mm; z2={z2_mm:.6f} mm; D={D_mm:.6f} mm; uA(D)≈{D_ua_mm:.6f} mm")
    print(f"u1={u1_cm[0]:.2f} cm; u2={mean(u2_cm):.6f} cm")
    print(f"A=atan[d/(2a(n-1))]={A_deg:.9f}° = {A_rad:.9f} rad")
    print(f"ratio λ={ratio_nm:.6f} ± {ratio_u_nm:.6f} nm; bias={ratio_nm-standard_nm:+.6f} nm ({(ratio_nm/standard_nm-1):+.6%})")

    print("\nk 情景：")
    for k_mm_px, label in (
        (0.004, "报告预设 k=0.0040 mm/px"),
        (1 / 107.578, "若自动刻线相邻间距=1 mm"),
        (5 / (107.578 * 4), "若自动5条线覆盖4个间隔且总长=5 mm"),
        (5 / (107.578 * 5), "若自动5条线覆盖5个间隔且总长=5 mm"),
    ):
        dx_mm = sodium_dx_px * k_mm_px
        lambda_nm = d_geom * dx_mm / D_mm * 1e6
        print(
            f"{label}: k={k_mm_px:.9f}, Δx={dx_mm:.9f} mm, "
            f"λ={lambda_nm:.6f} nm, bias={lambda_nm-standard_nm:+.6f} nm "
            f"({lambda_nm/standard_nm-1:+.6%})"
        )


if __name__ == "__main__":
    main()
