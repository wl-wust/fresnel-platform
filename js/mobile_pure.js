// Mobile JavaScript - 稳定性优化版
let currentImage = null;
let cameraStream = null;
let isLoading = false;

// 网络请求重试机制
function throwError(url, options, maxRetries = 3, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (i === maxRetries - 1) throw error;
            new Promise(r => setTimeout(r, 1000 * (i + 1))); // 指数退避
        }
    }
}

function switchTab(tabId, btn) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(tabId).classList.add("active");
    if (tabId !== "capture" && cameraStream) stopCamera();
}

function openCamera() { try { const video = document.getElementById("video"); if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showAlert("浏览器不支持相机，请使用Chrome/Safari或选择相册图片"); return; } cameraStream = navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } }); video.srcObject = cameraStream; video.style.display = "block"; document.getElementById("previewBox").style.display = "none"; } catch(e) { showAlert("无法访问相机: " + e.message); } }
}

function stopCamera() {
    const video = document.getElementById("video");
    if (cameraStream) { 
        cameraStream.getTracks().forEach(t => t.stop()); 
        cameraStream = null; 
    }
    video.style.display = "none";
    document.getElementById("previewBox").style.display = "flex";
}

function triggerCamera() {
    document.getElementById("fileInput").click();
}

function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    currentImage = file;
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById("previewBox").innerHTML = "<img src=\"" + e.target.result + "\" style=\"width:100%;height:200px;object-fit:cover;border-radius:8px\">";
        document.getElementById("previewBox").style.display = "block";
        document.getElementById("captureParams").style.display = "block";
    };
    reader.readAsDataURL(file);
}

function analyzeImage() {
    if (isLoading) return; // 防止重复点击
    if (!currentImage) { 
        showAlert("请先选择或拍摄图片"); 
        return; 
    }
    
    isLoading = true;
    showLoading(true);
    
    const formData = new FormData();
    formData.append("file", currentImage);
    
    try {
        const result = throwError("/analyze", {method:"POST", body:formData});
        if (result.status === "success") {
            const d = result.data;
            let html = "<h4>分析结果</h4>";
            html += rItem("条纹间距", d.fringe_period_px ? d.fringe_period_px.toFixed(2) + " px" : "未检测到");
            html += rItem("FFT周期", d.fft_period_px ? d.fft_period_px.toFixed(2) + " px" : "-");
            html += rItem("峰值法", d.peak_period_px ? d.peak_period_px.toFixed(2) + " px" : "-");
            html += rItem("峰数量", d.num_peaks || 0);
            document.getElementById("captureResult").innerHTML = html;
            // 自动填充条纹间距
            if (d.fringe_period_px) {
                const dxInput = document.querySelector("#dataTableBody input[id=\"dx1\"]");
                if (dxInput) dxInput.value = d.fringe_period_px.toFixed(2);
            }
        } else { 
            showAlert("分析失败: " + (result.error || "未知错误")); 
        }
    } catch(err) { 
        showAlert("请求失败: " + err.message); 
    } finally { 
        isLoading = false;
        showLoading(false);
    }
}

function showAlert(msg) {
    // 显示提示框
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ff5050;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000;animation:fadeIn 0.3s;";
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function showLoading(show) {
    const el = document.getElementById("loading");
    if (el) el.style.display = show ? "flex" : "none";
}

function rItem(label, value) {
    return "<div class=\"result-item\"><span class=\"result-label\">" + label + "</span><span class=\"result-value\">" + value + "</span></div>";
}
// 波长计算
function calcWavelength(n) {
    const row = document.querySelectorAll("#dataTableBody tr")[n-1];
    if (!row) return;
    const inputs = row.querySelectorAll("input");
    const d = parseFloat(inputs[0]?.value || 0.5);
    const D = parseFloat(inputs[1]?.value || 500);
    const dx = parseFloat(inputs[2]?.value);
    const k = parseFloat(document.getElementById("param_k")?.value || localStorage.getItem("pixel_k") || 0.008);
    
    if (isNaN(dx) || dx <= 0) { 
        showAlert("请输入有效的条纹间距"); 
        return; 
    }
    
    const wl = d * dx * k * 1e6 / D;
    const wlEl = document.getElementById("wl" + n);
    if (wlEl) wlEl.textContent = wl.toFixed(2);
}

function calcAll() {
    const rows = document.querySelectorAll("#dataTableBody tr");
    rows.forEach((row, i) => calcWavelength(i + 1));
}

// 不确定度
function addUncInput() {
    const div = document.getElementById("uncInputs");
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.1";
    input.placeholder = "测量值";
    div.appendChild(input);
}

function calcUncertainty() {
    const inputs = document.querySelectorAll("#uncInputs input");
    const values = Array.from(inputs).map(i => parseFloat(i.value)).filter(v => !isNaN(v));
    if (values.length < 2) { 
        showAlert("至少需要2个测量值"); 
        return; 
    }
    
    try {
        const result = throwError("/uncertainty", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({values})
        });
        document.getElementById("uncResult").innerHTML = `
            <div class="result-box">
                <h4>不确定度评定</h4>
                ${rItem("平均值", result.mean.toFixed(3) + " nm")}
                ${rItem("标准差", result.std.toFixed(3) + " nm")}
                ${rItem("A类不确定度", result.uA.toFixed(3) + " nm")}
                ${rItem("相对不确定度", result.relative_uA.toFixed(2) + "%")}
            </div>`;
    } catch(err) { 
        showAlert("计算失败: " + err.message); 
    }
}

// 多路径合成
function addPathInput() {
    const div = document.getElementById("pathInputs");
    const row = document.createElement("div");
    row.className = "param-row";
    row.innerHTML = `<input type="number" class="path-value" placeholder="测量值" step="0.1">
                     <input type="number" class="path-unc" placeholder="不确定度" step="0.01">
                     <button onclick="this.parentElement.remove()" style="background:rgba(255,80,80,0.3);color:#ff5050;">删除</button>`;
    div.appendChild(row);
}

function comparePaths() {
    const valueInputs = document.querySelectorAll(".path-value");
    const uncInputs = document.querySelectorAll(".path-unc");
    const paths = Array.from(valueInputs).map((v, i) => ({
        value: parseFloat(v.value),
        uncertainty: parseFloat(uncInputs[i]?.value || 0.5)
    })).filter(p => !isNaN(p.value));
    
    if (paths.length === 0) { 
        showAlert("请添加测量数据"); 
        return; 
    }
    
    try {
        const result = throwError("/compare", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({paths, standard_value:589.3})
        });
        document.getElementById("compareResult").innerHTML = `
            <div class="result-box">
                <h4>加权合成结果</h4>
                ${rItem("加权平均值", result.weighted_mean.toFixed(3) + " nm")}
                ${rItem("合成不确定度", result.combined_uncertainty.toFixed(3) + " nm")}
            </div>`;
    } catch(err) { 
        showAlert("合成失败: " + err.message); 
    }
}

// 添加表格行

function addCombineRow() {
    const tbody = document.querySelector('#combineTable tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="text" class="combine-name" placeholder="路径名称" style="width:80px"></td><td><input type="number" class="combine-value" step="0.1"></td><td><input type="number" class="combine-unc" step="0.01"></td><td><button onclick="this.closest("tr").remove()">删除</button></td>';
    tbody.appendChild(tr);
}

function addRow() {
    const tbody = document.getElementById("dataTableBody");
    const n = tbody.children.length + 1;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${n}</td>
        <td><input type="number" value="0.5" step="0.01"></td>
        <td><input type="number" value="500" step="1"></td>
        <td><input type="number" id="dx${n}" step="0.1"></td>
        <td id="wl${n}" readonly></td>
        <td><button onclick="calcWavelength(${n})">计算</button>
            <button onclick="deleteRow(this)" style="background:rgba(255,80,80,0.3);color:#ff5050;margin-left:5px;">删除</button></td>`;
    tbody.appendChild(tr);
}


// ======== 多帧平均分析 ========
let frameResults = [];
let maxFrames = 20;

function analyzeMultipleFrames() {
    const files = document.getElementById('multiframeFile').files;
    if (files.length < 2) { showAlert('请至少选择2张图片进行多帧分析'); return; }
    if (files.length > maxFrames) { showAlert('最多支持' + maxFrames + '帧'); return; }
    isLoading = true;
    showLoading(true);
    frameResults = [];
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }
    try {
        const result = throwError('/analyze_multiframe', {method:'POST', body:formData});
        if (result.status === 'success') {
            const d = result.data;
            let html = '<h4>多帧分析结果</h4>';
            html += rItem('有效帧数', d.n_frames + ' / ' + files.length);
            html += rItem('平均条纹间距', d.mean_period.toFixed(2) + ' px');
            html += rItem('标准差', d.std_dev.toFixed(3) + ' px');
            html += rItem('标准误差', d.se_mean.toFixed(3) + ' px');
            html += rItem('变异系数', d.cv_percent.toFixed(2) + '%');
            html += '<details style="margin-top:10px"><summary style="color:#00d4ff;cursor:pointer">查看详细数据</summary><ul style="font-size:11px;color:#aaa;margin-top:5px">';
            d.individual_values.forEach((v, i) => { html += '<li>帧' + (i+1) + ': ' + v.toFixed(2) + ' px</li>'; });
            html += '</ul></details>';
            document.getElementById('multiframeResult').innerHTML = html;
            document.getElementById('multiframeResult').style.display = 'block';
            frameResults.push({mean: d.mean_period, std: d.std_dev, se: d.se_mean});
            const dxInput = document.querySelector('#dataTableBody input[id="dx1"]');
            if (dxInput) dxInput.value = d.mean_period.toFixed(2);
        } else { showAlert('分析失败: ' + (result.error || '未知错误')); }
    } catch(err) { showAlert('请求失败: ' + err.message); }
    finally { isLoading = false; showLoading(false); }
}

function clearFrameResults() {
    frameResults = [];
    document.getElementById('multiframeResult').innerHTML = '';
    document.getElementById('multiframeResult').style.display = 'none';
}

// ======== 增强不确定度评定 ========
function calcUncertaintyEnhanced() {
    const d = parseFloat(document.getElementById('unc_d').value || 0.5);
    const D = parseFloat(document.getElementById('unc_D').value || 500);
    const fringe_px = parseFloat(document.getElementById('unc_fringe').value);
    const pixel_k = parseFloat(document.getElementById('unc_pixel_k').value || localStorage.getItem('pixel_k') || 0.008);
    const u_d = document.getElementById('unc_u_d').value ? parseFloat(document.getElementById('unc_u_d').value) : null;
    const u_D = document.getElementById('unc_u_D').value ? parseFloat(document.getElementById('unc_u_D').value) : null;
    const u_fringe = document.getElementById('unc_u_fringe').value ? parseFloat(document.getElementById('unc_u_fringe').value) : null;
    if (isNaN(fringe_px) || fringe_px <= 0) { showAlert('请输入有效的条纹间距'); return; }
    try {
        const result = throwError('/uncertainty_enhanced', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({d, D, fringe_period_px: fringe_px, pixel_k, u_d, u_D, u_fringe})
        });
        let html = '<h4>不确定度评定</h4>';
        html += rItem('波长', result.wavelength_nm + ' nm');
        html += rItem('A类不确定度(u_A)', result.u_A_fringe + ' nm');
        html += rItem('B类不确定度u(d)', result.u_B_d + ' mm');
        html += rItem('B类不确定度u(D)', result.u_B_D + ' mm');
        html += '<div style="margin-top:10px;padding:8px;background:rgba(0,255,136,0.1);border-radius:5px">';
        html += '<strong style="color:#00ff88">合成不确定度 u_c = ' + result.u_c + ' nm</strong><br>';
        html += '<span style="font-size:12px;color:#aaa">扩展不确定度 U(k=2) = ' + result.U_k2 + ' nm</span><br>';
        html += '<span style="font-size:12px;color:#aaa">相对不确定度 ' + result.relative_u_c_percent + '%</span>';
        html += '</div>';
        html += '<details style="margin-top:10px"><summary style="color:#00d4ff;cursor:pointer;font-size:12px">各项相对不确定度分量</summary><div style="font-size:11px;color:#aaa;margin-top:5px">';
        html += 'u(d)/d = ' + result.components.rel_u_d + '%<br>';
        html += 'u(D)/D = ' + result.components.rel_u_D + '%<br>';
        html += 'u(fringe)/fringe = ' + result.components.rel_u_f + '%<br>';
        html += '</div></details>';
        document.getElementById('enhancedUncResult').innerHTML = html;
        document.getElementById('enhancedUncResult').style.display = 'block';
    } catch(err) { showAlert('计算失败: ' + err.message); }
}

// ======== 多路径加权合成 ========
function calcWeightedCombine() {
    const results = [];
    const rows = document.querySelectorAll('#combineTable tbody tr');
    rows.forEach((row, i) => {
        const name = row.querySelector('.combine-name')?.value || '路径' + (i+1);
        const value = parseFloat(row.querySelector('.combine-value')?.value);
        const unc = parseFloat(row.querySelector('.combine-unc')?.value);
        if (!isNaN(value) && unc > 0) { results.push({name, value, uncertainty: unc}); }
    });
    if (results.length < 2) { showAlert('请至少添加2条路径数据'); return; }
    try {
        const result = throwError('/weighted_combine', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({results, standard_value: 589.3})
        });
        let html = '<h4>多路径加权合成结果</h4>';
        html += rItem('加权平均值', result.weighted_mean + ' nm');
        html += rItem('合成不确定度 u_c', result.combined_u_c + ' nm');
        html += rItem('路径数', result.n_paths);
        const statusColor = result.consistent ? '#00ff88' : '#ffaa00';
        const statusText = result.consistent ? '✓ 一致' : '⚠ 需检查';
        html += '<div style="margin-top:10px;padding:8px;background:rgba(0,212,255,0.1);border-radius:5px">';
        html += '<strong style="color:' + statusColor + '">与标准值(589.3nm)偏差: ' + result.bias_vs_standard + ' nm (' + result.rel_bias_percent + '%)</strong><br>';
        html += '<span style="font-size:12px;color:' + statusColor + '">' + statusText + '</span>';
        html += '</div>';
        html += '<details style="margin-top:10px"><summary style="color:#00d4ff;cursor:pointer;font-size:12px">各路径详细结果</summary><table style="font-size:11px;width:100%;margin-top:5px">';
        html += '<tr style="background:rgba(0,212,255,0.2)"><th style="padding:5px">路径</th><th style="padding:5px">波长(nm)</th><th style="padding:5px">u_c</th><th style="padding:5px">权重</th></tr>';
        result.individual_results.forEach(r => {
            html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.1)"><td style="padding:5px">' + r.name + '</td><td style="padding:5px">' + r.value + '</td><td style="padding:5px">' + r.u_c + '</td><td style="padding:5px">' + r.weight + '</td></tr>';
        });
        html += '</table></details>';
        document.getElementById('combineResult').innerHTML = html;
        document.getElementById('combineResult').style.display = 'block';
    } catch(err) { showAlert('合成失败: ' + err.message); }
}



function saveK() {
    const k = parseFloat(document.getElementById('cal_k').value);
    if (isNaN(k) || k <= 0) { showAlert('请输入有效的像素当量'); return; }
    localStorage.setItem('pixel_k', k);
    document.getElementById('currentK').textContent = k.toFixed(4) + ' mm/px';
    document.getElementById('param_k').value = k.toFixed(4);
    document.getElementById('calResult').innerHTML = '<div class="result-box"><h4>已保存</h4><p>k = ' + k.toFixed(4) + ' mm/px</p></div>';
}

function calcK() {
    const L = parseFloat(document.getElementById('cal_L').value);
    const N = parseFloat(document.getElementById('cal_N').value);
    if (isNaN(L) || isNaN(N) || N <= 0) { showAlert('请输入有效数值'); return; }
    const k = L / N;
    localStorage.setItem('pixel_k', k);
    document.getElementById('currentK').textContent = k.toFixed(4) + ' mm/px';
    document.getElementById('param_k').value = k.toFixed(4);
    document.getElementById('calResult').innerHTML = '<div class="result-box"><h4>标定结果</h4><p>k = L/N = ' + L + '/' + N + ' = ' + k.toFixed(4) + ' mm/px</p></div>';
}

function clearK() {
    localStorage.removeItem('pixel_k');
    document.getElementById('currentK').textContent = '未标定';
    document.getElementById('param_k').value = '';
    document.getElementById('calResult').innerHTML = '';
}

function loadSavedK() {
    const savedK = localStorage.getItem('pixel_k');
    if (savedK) {
        document.getElementById('currentK').textContent = parseFloat(savedK).toFixed(4) + ' mm/px';
        document.getElementById('param_k').value = savedK;
        document.getElementById('cal_k').value = savedK;
    }
}

function analyzeReticle() {
    const input = document.getElementById('reticleFile');
    if (!input || !input.files.length) { showAlert('请先选择分划板图像'); return; }
    isLoading = true;
    showLoading(true);
    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('scale_division', document.getElementById('scale_division').value || 0.01);
    try {
        const result = throwError('/reticle', {method:'POST', body:formData});
        if (result.status === 'success') {
            const d = result.data;
            let html = '<h4>分划板识别结果</h4>';
            html += rItem('竖线数', d.vertical_lines || 0);
            html += rItem('横线数', d.horizontal_lines || 0);
            if (d.k_horizontal) {
                html += rItem('k（水平）', d.k_horizontal.toFixed(4) + ' mm/px');
                html += '<p style="color:#00ff88;font-size:16px;margin-top:10px">已自动保存像素当量</p>';
                localStorage.setItem('pixel_k', d.k_horizontal);
                document.getElementById('currentK').textContent = d.k_horizontal.toFixed(4) + ' mm/px';
                document.getElementById('param_k').value = d.k_horizontal.toFixed(4);
            } else {
                html += rItem('结果', '未检测到有效刻度');
            }
            document.getElementById('reticleResult').innerHTML = html;
            document.getElementById('reticleResult').style.display = 'block';
        } else { showAlert('分析失败: ' + (result.error || '未知错误')); }
    } catch(err) { showAlert('请求失败: ' + err.message); }
    finally { isLoading = false; showLoading(false); }
}

function uploadData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        let data = [];
        try {
            if (file.name.endsWith('.json')) {
                data = JSON.parse(text);
            } else if (file.name.endsWith('.csv')) {
                const lines = text.split('\n');
                const headers = lines[0].split(',');
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim()) {
                        const vals = lines[i].split(',');
                        const row = {};
                        headers.forEach((h, idx) => row[h.trim()] = vals[idx] ? vals[idx].trim() : '');
                        data.push(row);
                    }
                }
            }
            addUploadedData(data);
        } catch(err) { showAlert('文件格式错误: ' + err.message); }
    };
    reader.readAsText(file);
}

function addUploadedData(data) {
    const tbody = document.getElementById('dataTableBody');
    const startIdx = tbody.children.length + 1;
    for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const d = item.d || item['d(mm)'] || 0.5;
        const D = item.D || item['D(mm)'] || 500;
        const dx = item.dx || item['条纹间距(px)'] || '';
        const n = startIdx + i;
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + n + '</td><td><input type="number" value="' + d + '" step="0.01"></td><td><input type="number" value="' + D + '" step="1"></td><td><input type="number" id="dx' + n + '" value="' + dx + '" step="0.1"></td><td id="wl' + n + '" readonly></td><td><button onclick="calcWavelength(' + n + ')">计算</button> <button onclick="deleteRow(this)" style="background:rgba(255,80,80,0.3);color:#ff5050;margin-left:5px;">删除</button></td>';
        tbody.appendChild(tr);
    }
    const resultDiv = document.getElementById('uploadResult');
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<h4>上传成功</h4><p>已添加 ' + data.length + ' 条数据</p>';
    }
}

function deleteRow(btn) {
    if (confirm('确定删除这行数据？')) {
        btn.closest("tr").remove();
        renumberRows();
    }
}

function deleteAllData() {
    if (confirm('确定清空所有数据？')) {
        document.getElementById('dataTableBody').innerHTML = '';
        addRow();
    }
}

function renumberRows() {
    const rows = document.querySelectorAll('#dataTableBody tr');
    rows.forEach((row, i) => {
        row.querySelector('td').textContent = i + 1;
    });
}

function exportData() {
    const rows = document.querySelectorAll('#dataTableBody tr');
    let csv = '序号,d(mm),D(mm),条纹间距(px),波长(nm)\n';
    rows.forEach((row, i) => {
        const inputs = row.querySelectorAll('input');
        const wl = row.querySelector('td:nth-child(5)') ? row.querySelector('td:nth-child(5)').textContent : '';
        csv += (i+1) + ',' + (inputs[0] ? inputs[0].value : '') + ',' + (inputs[1] ? inputs[1].value : '') + ',' + (inputs[2] ? inputs[2].value : '') + ',' + wl + '\n';
    });
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '干涉实验数据_' + new Date().toLocaleDateString() + '.csv';
    link.click();
}

function calcUncertainty() {
    const inputs = document.querySelectorAll('#uncInputs input');
    const values = Array.from(inputs).map(i => parseFloat(i.value)).filter(v => !isNaN(v));
    if (values.length < 2) { showAlert('至少需要2个测量值'); return; }
    try {
        const result = throwError('/uncertainty', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({values})
        });
        document.getElementById('uncResult').innerHTML = '<div class="result-box"><h4>不确定度评定</h4>' +
            rItem('平均值', result.mean.toFixed(3) + ' nm') +
            rItem('标准差', result.std.toFixed(3) + ' nm') +
            rItem('A类不确定度', result.uA.toFixed(3) + ' nm') +
            rItem('相对不确定度', result.relative_uA.toFixed(2) + '%') +
            '</div>';
        document.getElementById('uncResult').style.display = 'block';
    } catch(err) { showAlert('计算失败: ' + err.message); }
}

function comparePaths() {
    const valueInputs = document.querySelectorAll('.path-value');
    const uncInputs = document.querySelectorAll('.path-unc');
    const paths = Array.from(valueInputs).map((v, i) => ({
        value: parseFloat(v.value),
        uncertainty: parseFloat(uncInputs[i] ? uncInputs[i].value : 0.5)
    })).filter(p => !isNaN(p.value));
    if (paths.length === 0) { showAlert('请添加测量数据'); return; }
    try {
        const result = throwError('/compare', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({paths, standard_value: 589.3})
        });
        document.getElementById('compareResult').innerHTML = '<div class="result-box"><h4>加权合成结果</h4>' +
            rItem('加权平均值', result.weighted_mean.toFixed(3) + ' nm') +
            rItem('合成不确定度', result.combined_uncertainty.toFixed(3) + ' nm') +
            '</div>';
        document.getElementById('compareResult').style.display = 'block';
    } catch(err) { showAlert('合成失败: ' + err.message); }
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadSavedK();
});


function switchUI() {
    var path = window.location.pathname;
    if (path.includes("/mobile")) {
        window.location.href = "/";
    } else {
        window.location.href = "/mobile";
    }
}


