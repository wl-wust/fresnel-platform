// === 菲涅耳双棱镜平台主控制器 ===
// 整合图像分析、三方法解算、不确定度评定

document.addEventListener('DOMContentLoaded', function() {
    initTabs();
    initHistory();
    loadSavedK();
});

// ===== Tab切换 =====
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById(tabName).classList.add('active');
}

// ===== 图像分析 =====
async function analyzeImage() {
    const input = document.getElementById('imageInput');
    if (!input.files.length) {
        showAlert('请先选择图像文件');
        return;
    }
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const result = window.fringeAnalyzer.analyzeFringes(img);
            displayAnalysisResult(result);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function displayAnalysisResult(result) {
    const html = `
        <div class="result-box">
            <h3>分析结果</h3>
            <p>图像尺寸: ${result.width} x ${result.height} px</p>
            <p>条纹方向: ${result.direction === 'v' ? '垂直' : '水平'}</p>
            <p>数据质量: ${result.quality}</p>
            <hr style="margin:10px 0">
            <h4>三种方法结果对比</h4>
            <table>
                <tr><th>方法</th><th>条纹间距(px)</th><th>置信度</th></tr>
                <tr><td>FFT基频法</td><td>${result.fft.period_px ? result.fft.period_px.toFixed(2) : '-'}</td><td>${result.fft.confidence ? result.fft.confidence.toFixed(2) : '-'}</td></tr>
                <tr><td>峰值检测法</td><td>${result.peak.period_px ? result.peak.period_px.toFixed(2) : '-'}</td><td>-</td></tr>
                <tr><td>相位斜率法</td><td>${result.phase.period_px ? result.phase.period_px.toFixed(2) : '-'}</td><td>-</td></tr>
                <tr style="background:rgba(0,212,255,0.2)"><td><strong>加权综合</strong></td><td><strong>${result.combined_period_px ? result.combined_period_px.toFixed(2) : '-'}</strong></td><td>-</td></tr>
            </table>
        </div>
    `;
    document.getElementById('analysisResult').innerHTML = html;
}

// ===== 波长计算 =====
function calcWavelength() {
    const d = parseFloat(document.getElementById('d_value').value);
    const D = parseFloat(document.getElementById('D_value').value);
    const k = parseFloat(document.getElementById('pixel_size').value);
    const dx_px = parseFloat(document.getElementById('fringe_period_px').value);
    
    if ([d, D, k, dx_px].some(isNaN) || d <= 0 || D <= 0 || k <= 0 || dx_px <= 0) {
        showAlert('请输入有效的参数值');
        return;
    }
    
    const wl = window.threeMethods.calcWavelength(d, D, dx_px, k);
    document.getElementById('wavelengthResult').innerHTML = `
        <div class="result-box">
            <h3>基本公式法结果</h3>
            <p>λ = d·Δx/D = ${d} × ${(dx_px*k).toFixed(4)} / ${D} = <strong>${wl.toFixed(2)} nm</strong></p>
        </div>
    `;
}

// ===== 比值法 =====
function calcRatioMethod() {
    const dx_laser = parseFloat(document.getElementById('fringe_laser').value);
    const dx_sodium = parseFloat(document.getElementById('fringe_sodium').value);
    const lambda_laser = parseFloat(document.getElementById('lambda_laser').value) || 650;
    
    const result = window.threeMethods.ratioMethod(dx_laser, dx_sodium, lambda_laser);
    document.getElementById('ratioResult').innerHTML = `
        <div class="result-box">
            <h3>比值法结果</h3>
            <p>λ_Na = λ_laser × (Δx_Na/Δx_laser) × 1.004</p>
            <p>= ${lambda_laser} × ${result.ratio.toFixed(4)} × 1.004</p>
            <p>= <strong>${result.wavelength_nm.toFixed(2)} nm</strong></p>
        </div>
    `;
}

// ===== 增强不确定度 =====
function calcUncertaintyPC() {
    const d = parseFloat(document.getElementById('unc_d_pc').value);
    const u_d = parseFloat(document.getElementById('unc_u_d_pc').value) || d * 0.002;
    const D = parseFloat(document.getElementById('unc_D_pc').value);
    const u_D = parseFloat(document.getElementById('unc_u_D_pc').value) || D * 0.003;
    const dx_px = parseFloat(document.getElementById('unc_fringe_pc').value);
    const k = parseFloat(document.getElementById('pixel_size').value) || 0.008;
    
    if (!dx_px || dx_px <= 0) {
        showAlert('请输入条纹间距');
        return;
    }
    
    const dx_mm = dx_px * k;
    const result = window.threeMethods.uncertaintyPropagation({ d, u_d, D, u_D, dx: dx_mm, u_dx: 0.01 });
    
    document.getElementById('enhancedUncResultPC').innerHTML = `
        <div class="result-box">
            <h3>不确定度评定</h3>
            <p>波长: <strong>${result.wavelength_nm.toFixed(2)} nm</strong></p>
            <p>合成不确定度 u_c: ${result.u_c.toFixed(3)} nm</p>
            <p>扩展不确定度 U(k=2): ${result.U_k2.toFixed(3)} nm</p>
            <p>相对不确定度: ${result.relative_u_c.toFixed(2)}%</p>
            <details>
                <summary style="cursor:pointer;color:#00d4ff">查看分量</summary>
                <p>u(d)/d = ${result.components.rel_u_d.toFixed(2)}%</p>
                <p>u(D)/D = ${result.components.rel_u_D.toFixed(2)}%</p>
                <p>u(Δx)/Δx = ${result.components.rel_u_dx.toFixed(2)}%</p>
            </details>
        </div>
    `;
}

// ===== 最小二乘拟合 =====
function performFitTable() {
    const xVals = Array.from(document.querySelectorAll('.fit-x')).map(el => parseFloat(el.value));
    const yVals = Array.from(document.querySelectorAll('.fit-y')).map(el => parseFloat(el.value));
    
    const valid = xVals.filter(v => !isNaN(v)).length >= 2;
    if (!valid) { showAlert('至少需要2个有效数据点'); return; }
    
    const n = xVals.length;
    const sumX = xVals.reduce((a,b) => a+b, 0);
    const sumY = yVals.reduce((a,b) => a+b, 0);
    const sumXY = xVals.reduce((sum, x, i) => sum + x * yVals[i], 0);
    const sumX2 = xVals.reduce((sum, x) => sum + x*x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const rSquared = Math.pow(corrCoeff(xVals, yVals, n), 2);
    
    document.getElementById('fitResult').innerHTML = `
        <div class="result-box">
            <h3>最小二乘拟合结果</h3>
            <p>y = ${slope.toFixed(4)}x + ${intercept.toFixed(4)}</p>
            <p>R² = ${rSquared.toFixed(4)}</p>
        </div>
    `;
}

function corrCoeff(x, y, n) {
    const meanX = x.reduce((a,b) => a+b, 0) / n;
    const meanY = y.reduce((a,b) => a+b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        num += (x[i] - meanX) * (y[i] - meanY);
        denX += (x[i] - meanX) ** 2;
        denY += (y[i] - meanY) ** 2;
    }
    return num / Math.sqrt(denX * denY);
}

// ===== 不确定度评定 =====
function calcUncertaintyTable() {
    const values = Array.from(document.querySelectorAll('.unc-value')).map(el => parseFloat(el.value)).filter(v => !isNaN(v));
    if (values.length < 2) { showAlert('至少需要2个测量值'); return; }
    
    const result = window.threeMethods.typeAUncertainty(values);
    document.getElementById('uncertaintyResult').innerHTML = `
        <div class="result-box">
            <h3>A类不确定度评定</h3>
            <p>测量次数 n = ${result.n}</p>
            <p>平均值 = ${result.mean.toFixed(3)} nm</p>
            <p>标准差 s = ${result.std.toFixed(3)} nm</p>
            <p>A类不确定度 u_A = ${result.uA.toFixed(3)} nm</p>
            <p>相对A类不确定度 = ${result.relative_uA.toFixed(2)}%</p>
        </div>
    `;
}

// ===== 多路径加权合成 =====
function comparePathsTable() {
    const rows = document.querySelectorAll('#pathTable tbody tr');
    const paths = [];
    
    rows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const name = inputs[0]?.value || '路径' + (paths.length + 1);
        const value = parseFloat(inputs[1]?.value);
        const unc = parseFloat(inputs[2]?.value);
        if (!isNaN(value) && unc > 0) {
            paths.push({ name, value, uncertainty: unc });
        }
    });
    
    if (paths.length < 2) { showAlert('请至少添加2条有效路径'); return; }
    
    const standardValue = parseFloat(document.getElementById('standard_value').value) || 589.3;
    const result = window.threeMethods.weightedCombine(paths, standardValue);
    
    let html = `
        <div class="result-box">
            <h3>多路径加权合成结果</h3>
            <p>加权平均值 = <strong>${result.weighted_mean.toFixed(3)} nm</strong></p>
            <p>合成不确定度 u_c = ${result.combined_uncertainty.toFixed(3)} nm</p>
            <p>与标准值偏差 = ${result.bias_vs_standard.toFixed(3)} nm (${result.rel_bias_percent.toFixed(2)}%)</p>
            <p>χ² = ${result.chi2.toFixed(3)} < χ²_临界(${result.dof}) = ${result.chi2_critical}</p>
            <p style="color:${result.consistent ? '#00ff88' : '#ffaa00'}">${result.consistent ? '✓ 结果一致' : '⚠ 需检查一致性'}</p>
        </div>
    `;
    
    // 添加详细表格
    html += '<table style="margin-top:10px"><tr><th>路径</th><th>波长(nm)</th><th>不确定度</th><th>权重</th><th>偏差</th></tr>';
    result.individual_results.forEach(r => {
        html += `<tr><td>${r.name}</td><td>${r.value.toFixed(2)}</td><td>${r.uncertainty.toFixed(3)}</td><td>${r.weight.toFixed(2)}</td><td>${r.bias.toFixed(3)}</td></tr>`;
    });
    html += '</table>';
    
    document.getElementById('compareResult').innerHTML = html;
}

// ===== 历史记录 =====
function initHistory() {
    renderHistory();
}

function saveToHistory(type, data) {
    const history = JSON.parse(localStorage.getItem('fresnel_history') || '[]');
    history.unshift({ type, data, time: new Date().toISOString() });
    if (history.length > 50) history.pop();
    localStorage.setItem('fresnel_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('fresnel_history') || '[]');
    const container = document.getElementById('historyList');
    if (!container) return;
    
    if (history.length === 0) {
        container.innerHTML = '<p style="color:#888">暂无历史记录</p>';
        return;
    }
    
    container.innerHTML = history.map(item => `
        <div class="history-item">
            <div class="time">${new Date(item.time).toLocaleString()}</div>
            <div class="data">${item.type}: ${JSON.stringify(item.data)}</div>
        </div>
    `).join('');
}

function clearHistory() {
    if (confirm('确定清空所有历史记录？')) {
        localStorage.removeItem('fresnel_history');
        renderHistory();
    }
}

function exportHistory() {
    const history = JSON.parse(localStorage.getItem('fresnel_history') || '[]');
    const csv = '时间,类型,数据\n' + history.map(h => `${h.time},${h.type},${JSON.stringify(h.data)}\n`).join('');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '实验记录_' + new Date().toLocaleDateString() + '.csv';
    link.click();
}

// ===== 像素当量 =====
function loadSavedK() {
    const savedK = localStorage.getItem('pixel_k');
    if (savedK) {
        const el = document.getElementById('pixel_size');
        if (el) el.value = savedK;
    }
}

// ===== 工具函数 =====
function showAlert(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff5050;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function addFitRow() {
    const tbody = document.querySelector('#fitTable tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="number" step="any" class="fit-x"></td><td><input type="number" step="any" class="fit-y"></td><td><button onclick="this.closest(\'tr\').remove()">删除</button></td>';
    tbody.appendChild(tr);
}

function removeFitRow(btn) { btn.closest('tr').remove(); }

function addUncRow() {
    const tbody = document.querySelector('#uncTable tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="number" step="0.1" class="unc-value" placeholder="589.1"></td><td><button onclick="this.closest(\'tr\').remove()">删除</button></td>';
    tbody.appendChild(tr);
}

function removeUncRow(btn) { btn.closest('tr').remove(); }

function addPathRow() {
    const tbody = document.querySelector('#pathTable tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="text" class="path-name" placeholder="路径名称"></td><td><input type="number" step="0.1" class="path-value" placeholder="测量值"></td><td><input type="number" step="0.01" class="path-unc" placeholder="不确定度"></td><td><button onclick="this.closest(\'tr\').remove()">删除</button></td>';
    tbody.appendChild(tr);
}

function removePathRow(btn) { btn.closest('tr').remove(); }

function switchToMobile() {
    window.location.href = 'mobile.html';
}