// 主页面 JavaScript - 稳定性优化版
function switchTab(tabName) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    event.target.classList.add("active");
    document.getElementById(tabName).classList.add("active");
}
document.querySelectorAll(".tab").forEach(tab => { 
    tab.addEventListener("click", (e) => switchTab(e.target.dataset.tab)); 
});

// 网络请求重试
async function throwError(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

function showAlert(msg) {
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff5050;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;";
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// 图像分析
async function analyzeImage() {
    const input = document.getElementById("imageInput");
    if (!input.files.length) { 
        showAlert("请先选择图像文件"); 
        return; 
    }
    const formData = new FormData();
    formData.append("file", input.files[0]);
    try {
        const result = await throwError("/analyze", { method: "POST", body: formData });
        let html = '<div class="result-box"><h3>分析结果</h3><pre>' + JSON.stringify(result.data, null, 2) + '</pre></div>';
        document.getElementById('analysisResult').innerHTML = html;
    } catch (error) { 
        showAlert("分析失败: " + error.message); 
    }
}

// 波长计算
async function calcWavelength() {
    const d = parseFloat(document.getElementById("d_value").value);
    const D = parseFloat(document.getElementById("D_value").value);
    const fringe_px = parseFloat(document.getElementById("fringe_period_px")?.value || 10);
    const pixel_size = parseFloat(document.getElementById("pixel_size").value);
    try {
        const result = await throwError("/wavelength", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({d, D, fringe_period_px: fringe_px, pixel_size_mm: pixel_size})
        });
        document.getElementById('wavelengthResult').innerHTML = '<div class="result-box"><h3>波长计算结果</h3><pre>' + JSON.stringify(result, null, 2) + '</pre></div>';
    } catch (error) { 
        showAlert("计算失败: " + error.message); 
    }
}

// 比值法
async function calcRatioMethod() {
    const fringe_laser = parseFloat(document.getElementById("fringe_laser").value);
    const fringe_sodium = parseFloat(document.getElementById("fringe_sodium").value);
    const lambda_laser = parseFloat(document.getElementById("lambda_laser").value);
    try {
        const result = await throwError("/ratio_method", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({fringe_period_laser: fringe_laser, fringe_period_sodium: fringe_sodium, lambda_laser})
        });
        document.getElementById('ratioResult').innerHTML = '<div class="result-box"><h3>比值法结果</h3><pre>' + JSON.stringify(result, null, 2) + '</pre></div>';
    } catch (error) { 
        showAlert("计算失败: " + error.message); 
    }
}

// 最小二乘拟合
async function performFitTable() {
    const rows = document.querySelectorAll("#fitTable tbody tr");
    const x = [], y = [];
    rows.forEach(row => {
        const xi = parseFloat(row.querySelector(".fit-x")?.value);
        const yi = parseFloat(row.querySelector(".fit-y")?.value);
        if (!isNaN(xi) && !isNaN(yi)) { x.push(xi); y.push(yi); }
    });
    if (x.length < 2) { 
        showAlert("至少需要2个数据点"); 
        return; 
    }
    try {
        const result = await throwError("/fit", { 
            method: "POST", 
            headers: {"Content-Type": "application/json"}, 
            body: JSON.stringify({x, y}) 
        });
        document.getElementById('fitResult').innerHTML = '<div class="result-box"><h3>拟合结果</h3><pre>' + JSON.stringify(result, null, 2) + '</pre></div>';
    } catch (error) { 
        showAlert("拟合失败: " + error.message); 
    }
}

// 不确定度评定
async function calcUncertaintyTable() {
    const inputs = document.querySelectorAll("#uncTable .unc-value");
    const values = Array.from(inputs).map(i => parseFloat(i.value)).filter(v => !isNaN(v));
    if (values.length < 2) { 
        showAlert("至少需要2个测量值"); 
        return; 
    }
    try {
        const result = await throwError("/uncertainty", { 
            method: "POST", 
            headers: {"Content-Type": "application/json"}, 
            body: JSON.stringify({values}) 
        });
        document.getElementById('uncertaintyResult').innerHTML = '<div class="result-box"><h3>不确定度评定</h3><pre>' + JSON.stringify(result, null, 2) + '</pre></div>';
    } catch (error) { 
        showAlert("计算失败: " + error.message); 
    }
}

// 多路径加权合成
async function comparePathsTable() {
    const nameInputs = document.querySelectorAll("#pathTable .path-name");
    const valueInputs = document.querySelectorAll("#pathTable .path-value");
    const uncInputs = document.querySelectorAll("#pathTable .path-unc");
    const paths = Array.from(valueInputs).map((v, i) => ({
        value: parseFloat(v.value),
        uncertainty: parseFloat(uncInputs[i]?.value || 0.5)
    })).filter(p => !isNaN(p.value));
    
    const standard_value = parseFloat(document.getElementById("standard_value").value) || 589.3;
    
    if (paths.length === 0) { 
        showAlert("请添加测量数据"); 
        return; 
    }
    try {
        const result = await throwError("/compare", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({paths, standard_value})
        });
        document.getElementById('compareResult').innerHTML = '<div class="result-box"><h3>多路径合成结果</h3><pre>' + JSON.stringify(result, null, 2) + '</pre></div>';
    } catch (error) { 
        showAlert("合成失败: " + error.message); 
    }
}

// UI切换函数
function switchToMobile() {
    window.location.href = "/mobile";
}

// 表格操作
function addFitRow() {
    const tbody = document.querySelector("#fitTable tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = '<td><input type="number" step="any" class="fit-x"></td><td><input type="number" step="any" class="fit-y"></td><td><button onclick="removeFitRow(this)">删除</button></td>';
    tbody.appendChild(tr);
}

function removeFitRow(btn) {
    btn.closest("tr").remove();
}

function addUncRow() {
    const tbody = document.querySelector("#uncTable tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = '<td><input type="number" step="any" class="unc-value" placeholder="测量值"></td><td><button onclick="removeUncRow(this)">删除</button></td>';
    tbody.appendChild(tr);
}

function removeUncRow(btn) {
    btn.closest("tr").remove();
}

function addPathRow() {
    const tbody = document.querySelector("#pathTable tbody");
    const tr = document.createElement("tr");
    tr.innerHTML = '<td><input type="text" class="path-name" placeholder="路径名称"></td><td><input type="number" step="any" class="path-value" placeholder="测量值"></td><td><input type="number" step="any" class="path-unc" placeholder="不确定度"></td><td><button onclick="removePathRow(this)">删除</button></td>';
    tbody.appendChild(tr);
}

function removePathRow(btn) {
    btn.closest("tr").remove();
}

// 历史记录管理
function saveToHistory(type, data) {
    let history = JSON.parse(localStorage.getItem('exp_history') || '[]');
    history.unshift({ time: new Date().toLocaleString(), type: type, data: data });
    if (history.length > 50) history = history.slice(0, 50);
    localStorage.setItem('exp_history', JSON.stringify(history));
}
function renderHistory() {
    const history = JSON.parse(localStorage.getItem('exp_history') || '[]');
    const container = document.getElementById('historyList');
    if (history.length === 0) { container.innerHTML = '<p style="color:#888">暂无历史记录</p>'; return; }
    container.innerHTML = history.map(h => '<div class="history-item"><div class="time">' + h.time + ' - ' + h.type + '</div><div class="data">' + JSON.stringify(h.data).substring(0, 200) + '</div></div>').join('');
}
function clearHistory() { if (confirm('确定清空所有历史记录？')) { localStorage.removeItem('exp_history'); renderHistory(); } }
function exportHistory() {
    const history = JSON.parse(localStorage.getItem('exp_history') || '[]');
    if (history.length === 0) { showAlert('暂无历史记录'); return; }
    let csv = '时间,类型,数据\n';
    history.forEach(h => { csv += '"' + h.time + '","' + h.type + '","' + JSON.stringify(h.data) + '"\n'; });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '实验历史_' + new Date().toLocaleDateString() + '.csv';
    link.click();
}
document.addEventListener('DOMContentLoaded', function() { renderHistory(); });
