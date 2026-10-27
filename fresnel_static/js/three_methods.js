// === 菲涅耳双棱镜三方法解算模块 ===
// 比值法、放大率法、追迹法三种路径的波长计算与加权合成
// @see 研究报告 式(9)(13)(17)(19)

/**
 * 基本公式法: λ = d·Δx/D
 * @param {number} d - 虚光源间距 (mm)
 * @param {number} D - 观察距离 (mm)  
 * @param {number} dx_px - 条纹间距 (像素)
 * @param {number} k - 像素当量 (mm/px)
 * @returns {number} 波长 (nm)
 */
function calcWavelength(d, D, dx_px, k) {
    const dx_mm = dx_px * k;  // 条纹间距转mm
    return d * dx_mm / D * 1e6;  // 结果转nm
}

/**
 * 比值法: λ_Na = λ_laser · (Δx_Na/Δx_laser) · 1.004
 * 含BK7色散修正因子1.004
 * @param {number} dx_laser - 激光条纹间距 (px)
 * @param {number} dx_sodium - 钠光条纹间距 (px)
 * @param {number} lambda_laser - 激光波长 (nm)，默认650nm
 * @returns {object} {wavelength_nm, ratio, dispersion_correction}
 */
function ratioMethod(dx_laser, dx_sodium, lambda_laser = 650) {
    if (dx_laser <= 0 || dx_sodium <= 0) {
        return { error: "条纹间距必须为正数" };
    }
    const ratio = dx_sodium / dx_laser;
    const dispersion_correction = 1.004;  // BK7色散修正
    const wavelength_nm = lambda_laser * ratio * dispersion_correction;
    return {
        wavelength_nm: wavelength_nm,
        ratio: ratio,
        dispersion_correction: dispersion_correction
    };
}

/**
 * 放大率法: d = d' / |M|
 * 通过凸透镜成像测量虚光源间距
 * @param {number} d_prime - 透镜成像测得的虚光源间距 (mm)
 * @param {number} u - 物距 (mm)
 * @param {number} v - 像距 (mm)
 * @returns {number} 虚光源真实间距 d (mm)
 */
function magnificationMethod(d_prime, u, v) {
    if (u <= 0 || v <= 0) {
        return { error: "物距像距必须为正" };
    }
    const magnification = Math.abs(v / u);  // 横向放大率
    const d = d_prime / magnification;
    return { d: d, magnification: magnification, d_prime: d_prime };
}

/**
 * 追迹法: 通过双棱镜几何参数计算虚光源间距
 * d = 2·z₁·(n-1)·β
 * @param {number} z1 - 狭缝到双棱镜距离 (mm)
 * @param {number} n - 棱镜折射率
 * @param {number} beta - 棱镜顶角 (rad)
 * @returns {object} {d, z1, n, beta}
 */
function rayTraceMethod(z1, n, beta) {
    if (z1 <= 0 || n <= 1 || beta <= 0) {
        return { error: "参数必须为正" };
    }
    const d = 2 * z1 * (n - 1) * beta;
    return { d: d, z1: z1, n: n, beta: beta };
}

/**
 * 不确定度传播计算
 * 对于 λ = d·Δx/D，合成相对不确定度:
 * (u_λ/λ)² = (u_d/d)² + (u_Δx/Δx)² + (u_D/D)²
 * @param {object} params - {d, u_d, D, u_D, dx, u_dx}
 * @returns {object} 波长、不确定度、相对不确定度
 */
function uncertaintyPropagation(params) {
    const { d, u_d, D, u_D, dx, u_dx } = params;
    
    if (!d || !D || !dx) {
        return { error: "缺少必要参数" };
    }
    
    // 默认不确定度（如果没有提供）
    const _u_d = u_d || d * 0.002;  // 默认0.2%
    const _u_D = u_D || D * 0.003;  // 默认0.3%
    const _u_dx = u_dx || dx * 0.01; // 默认1%
    
    // 计算波长
    const wavelength = calcWavelength(d, D, dx, 1);  // 这里假设k=1，实际使用需要传入
    
    // 相对不确定度分量
    const rel_u_d = _u_d / d;
    const rel_u_D = _u_D / D;
    const rel_u_dx = _u_dx / dx;
    
    // 合成相对不确定度
    const rel_u_c = Math.sqrt(rel_u_d**2 + rel_u_D**2 + rel_u_dx**2);
    
    // 绝对不确定度
    const u_c = wavelength * rel_u_c;
    
    // 扩展不确定度 (k=2)
    const U = 2 * u_c;
    
    return {
        wavelength_nm: wavelength,
        u_c: u_c,
        U_k2: U,
        relative_u_c: rel_u_c * 100,
        components: {
            rel_u_d: rel_u_d * 100,
            rel_u_D: rel_u_D * 100,
            rel_u_dx: rel_u_dx * 100
        }
    };
}

/**
 * 多路径加权合成
 * 权重 w_i = 1/σ_i²
 * @param {Array} paths - [{value, uncertainty, name}]
 * @param {number} standard_value - 标准值 (nm)
 * @returns {object} 加权平均值、合成不确定度、一致性检验
 */
function weightedCombine(paths, standard_value = 589.3) {
    if (!paths || paths.length === 0) {
        return { error: "没有路径数据" };
    }
    
    let totalWeight = 0;
    let weightedSum = 0;
    const results = [];
    
    for (const path of paths) {
        const { value, uncertainty, name } = path;
        if (uncertainty > 0 && !isNaN(value)) {
            const weight = 1 / (uncertainty ** 2);
            totalWeight += weight;
            weightedSum += value * weight;
            results.push({
                name: name || '路径' + (results.length + 1),
                value: value,
                uncertainty: uncertainty,
                weight: weight,
                bias: value - standard_value
            });
        }
    }
    
    if (totalWeight === 0) {
        return { error: "没有有效路径" };
    }
    
    const weightedMean = weightedSum / totalWeight;
    const combinedUncertainty = 1 / Math.sqrt(totalWeight);
    const biasVsStandard = weightedMean - standard_value;
    const relBias = Math.abs(biasVsStandard) / standard_value * 100;
    
    // χ² 一致性检验
    let chi2 = 0;
    for (const r of results) {
        chi2 += (r.bias ** 2) / (r.uncertainty ** 2);
    }
    
    // 自由度
    const dof = results.length - 1;
    
    // 判断一致性 (α=0.05 临界值)
    const chi2_critical = dof > 0 ? (dof === 1 ? 3.84 : dof === 2 ? 5.99 : 7.81) : 0;
    const consistent = chi2 < chi2_critical;
    
    return {
        weighted_mean: weightedMean,
        combined_uncertainty: combinedUncertainty,
        bias_vs_standard: biasVsStandard,
        rel_bias_percent: relBias,
        chi2: chi2,
        chi2_critical: chi2_critical,
        dof: dof,
        consistent: consistent,
        individual_results: results
    };
}

/**
 * A类不确定度评定（统计方法）
 * @param {Array<number>} values - 测量列
 * @returns {object} 平均值、标准差、A类不确定度
 */
function typeAUncertainty(values) {
    if (!values || values.length < 2) {
        return { error: "至少需要2个测量值" };
    }
    
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1));
    const se = std / Math.sqrt(n);  // 标准误差
    
    return {
        mean: mean,
        std: std,
        se: se,
        n: n,
        uA: se,
        relative_uA: se / mean * 100
    };
}

// 导出到全局
window.threeMethods = {
    calcWavelength,
    ratioMethod,
    magnificationMethod,
    rayTraceMethod,
    uncertaintyPropagation,
    weightedCombine,
    typeAUncertainty
};