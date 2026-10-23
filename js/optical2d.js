// 菲涅耳双棱镜实验 - 基于论文MATLAB公式的光学模拟器
// 核心公式(10): I(x) = sinc²[πbx/(λ(z₁+z₂))] · cos²[πz₁(n-1)βx/(λ(z₁+z₂))]]
const canvas = document.getElementById("opticalCanvas");
const ctx = canvas.getContext("2d");

// 画布配置
const CONFIG = { railY: 300, railHeight: 10, scale: 0.5 };

// 论文参数 (张颖涛, 李洪国, 2019)
const PAPER_PARAMS = { lambda_nm: 589.3, n: 1.52, beta: 0.0131 };

// 设备类型定义
const DEVICE_TYPES = {
    source: { name: "钠光灯", icon: "💡", color: "#ffaa00", width: 60, height: 80, draggable: true },
    slit: { name: "单缝S", icon: "🔲", color: "#00d4ff", width: 30, height: 50, draggable: true },
    prism: { name: "双棱镜", icon: "🔺", color: "#7b2cbf", width: 70, height: 70, draggable: true },
    lens: { name: "凸透镜", icon: "🔍", color: "#00ff88", width: 40, height: 90, draggable: true },
    aperture: { name: "光阑", icon: "⭕", color: "#ff6b6b", width: 40, height: 40, draggable: true },
    micrometer: { name: "测微目镜", icon: "🔬", color: "#ff4444", width: 80, height: 100, draggable: true },
    screen: { name: "观察屏", icon: "📍", color: "#ffd93d", width: 60, height: 100, draggable: true },
    ruler: { name: "刻度尺", icon: "📏", color: "#6c757d", width: 200, height: 30, draggable: false }
};

let devices = [], selectedDevice = null, isDragging = false, dragOffset = { x: 0, y: 0 };
let showLight = true, showLabels = true, nextId = 1;

function init() { resizeCanvas(); window.addEventListener("resize", resizeCanvas); setupEvents(); resetLayout(); }
function resizeCanvas() { const c = canvas.parentElement; canvas.width = c.clientWidth; canvas.height = Math.max(400, window.innerHeight * 0.5); render(); }
function setupEvents() {
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    canvas.addEventListener("contextmenu", e => { e.preventDefault(); if (selectedDevice) deleteDevice(selectedDevice); });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", () => { isDragging = false; });
}
function getEventPos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX || e.touches[0].clientX) - r.left, y: (e.clientY || e.touches[0].clientY) - r.top }; }
function hitTest(x, y) { for (let i = devices.length - 1; i >= 0; i--) { const d = devices[i]; if (x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height) return d; } return null; }
function onMouseDown(e) {
    e.preventDefault(); const p = getEventPos(e); const dev = hitTest(p.x, p.y);
    if (dev && dev.draggable) { selectedDevice = dev; isDragging = true; dragOffset.x = p.x - dev.x; dragOffset.y = p.y - dev.y; document.getElementById("selected").textContent = "已选择: " + dev.name; render(); }
    else { selectedDevice = null; document.getElementById("selected").textContent = "未选择"; render(); }
}
function onMouseMove(e) {
    e.preventDefault(); const p = getEventPos(e);
    document.getElementById("coords").textContent = "坐标: (" + Math.round(p.x) + ", " + Math.round(p.y) + ")";
    if (isDragging && selectedDevice) { selectedDevice.x = Math.max(0, Math.min(canvas.width - selectedDevice.width, p.x - dragOffset.x)); selectedDevice.y = Math.max(0, Math.min(canvas.height - selectedDevice.height, p.y - dragOffset.y)); render(); updateParams(); }
}
function onMouseUp() { isDragging = false; }
function onTouchStart(e) {
    e.preventDefault(); const p = getEventPos(e); const dev = hitTest(p.x, p.y);
    if (dev && dev.draggable) { selectedDevice = dev; isDragging = true; dragOffset.x = p.x - dev.x; dragOffset.y = p.y - dev.y; document.getElementById("selected").textContent = "已选择: " + dev.name; render(); }
}
function onTouchMove(e) {
    e.preventDefault(); if (isDragging && selectedDevice) { const p = getEventPos(e); selectedDevice.x = Math.max(0, Math.min(canvas.width - selectedDevice.width, p.x - dragOffset.x)); selectedDevice.y = Math.max(0, Math.min(canvas.height - selectedDevice.height, p.y - dragOffset.y)); render(); updateParams(); }
}
function addDevice(type) {
    const def = DEVICE_TYPES[type]; if (!def) return;
    devices.push({ id: nextId++, type, x: 100 + devices.length * 100, y: CONFIG.railY - def.height / 2, width: def.width, height: def.height, draggable: def.draggable, name: def.name });
    render(); updateParams();
}
function deleteDevice(device) { const i = devices.indexOf(device); if (i >= 0) devices.splice(i, 1); selectedDevice = null; render(); updateParams(); }
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); drawRail();
    devices.forEach(d => drawDevice(d, d === selectedDevice));
    if (showLight) drawLightPath();
    if (showLabels) drawLabels();
    updateParams();
}
function drawRail() {
    ctx.fillStyle = "#445"; ctx.fillRect(0, CONFIG.railY, canvas.width, CONFIG.railHeight);
    for (let x = 0; x < canvas.width; x += CONFIG.scale * 50) {
        const isMajor = (x / CONFIG.scale) % 100 === 0;
        ctx.beginPath(); ctx.moveTo(x, CONFIG.railY + 10); ctx.lineTo(x, CONFIG.railY + 10 + (isMajor ? 15 : 8));
        ctx.strokeStyle = isMajor ? "#00d4ff" : "#4488aa"; ctx.lineWidth = isMajor ? 2 : 1; ctx.stroke();
        if (isMajor) ctx.fillText(Math.round(x / CONFIG.scale) + "", x, CONFIG.railY + 35);
    }
}
function drawLightPath() {
    const s = devices.find(d => d.type === "source"), sc = devices.find(d => d.type === "micrometer" || d.type === "screen");
    if (!s || !sc) return;
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(s.x + s.width / 2, s.y + s.height / 2); ctx.lineTo(sc.x + sc.width / 2, sc.y + sc.height / 2); ctx.stroke();
}
function drawDevice(device, isSelected) {
    const def = DEVICE_TYPES[device.type];
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(device.x + 3, device.y + 3, device.width, device.height);
    ctx.fillStyle = def.color; ctx.fillRect(device.x, device.y, device.width, device.height);
    ctx.strokeStyle = isSelected ? "#ff0000" : "#333"; ctx.lineWidth = isSelected ? 3 : 1;
    ctx.strokeRect(device.x, device.y, device.width, device.height);
    ctx.font = "24px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(def.icon, device.x + device.width / 2, device.y + device.height / 2 - 8);
    if (showLabels) { ctx.font = "11px Microsoft YaHei"; ctx.fillStyle = "#333"; ctx.fillText(def.name, device.x + device.width / 2, device.y + device.height - 6); }
    if (isSelected) {
        ctx.fillStyle = "#ff4444"; ctx.beginPath(); ctx.arc(device.x + device.width - 12, device.y + 12, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "12px Arial"; ctx.fillText("×", device.x + device.width - 12, device.y + 15);
    }
}
function drawLabels() {
    ctx.font = "11px Microsoft YaHei"; ctx.fillStyle = "#666";
    devices.forEach(d => { ctx.fillText(d.name + ": " + Math.round(d.x / CONFIG.scale) + "mm", d.x + d.width / 2, d.y - 12); });
}
function updateParams() {
    const s = devices.find(d => d.type === "source"), p = devices.find(d => d.type === "prism"), sc = devices.find(d => d.type === "micrometer" || d.type === "screen");
    if (s && p && sc) {
        document.getElementById("param_S").textContent = Math.round((p.x - s.x) / CONFIG.scale) + " mm";
        document.getElementById("param_L").textContent = Math.round((sc.x - p.x) / CONFIG.scale) + " mm";
        document.getElementById("param_D").textContent = Math.round((sc.x - s.x) / CONFIG.scale) + " mm";
    } else { document.getElementById("param_S").textContent = "-"; document.getElementById("param_L").textContent = "-"; document.getElementById("param_D").textContent = "-"; }
}
function toggleLight() { showLight = document.getElementById("showLight").checked; render(); }
function toggleLabels() { showLabels = document.getElementById("showLabels").checked; render(); }

// ===== 核心：基于论文公式的干涉条纹模拟 =====
function simulateInterference() {
    const panel = document.getElementById("simPanel");
    if (!panel) { console.error("simPanel not found"); return; }
    panel.style.display = "block";
    const slit = devices.find(d => d.type === "slit"), prism = devices.find(d => d.type === "prism");
    const screen = devices.find(d => d.type === "micrometer" || d.type === "screen");
    if (!slit || !prism || !screen) { alert("请先添加单缝、双棱镜和观察屏！"); return; }
    
    const z1 = (prism.x - slit.x) / CONFIG.scale;  // 狭缝到双棱镜距离(mm)
    const z2 = (screen.x - prism.x) / CONFIG.scale; // 双棱镜到观察屏距离(mm)
    const b = 0.02;  // 狭缝宽度(mm)
    const lambda = PAPER_PARAMS.lambda_nm * 1e-6;  // 波长转为mm
    const n = PAPER_PARAMS.n, beta = PAPER_PARAMS.beta;
    
    // 计算等效双缝间距 d = 2*z1*(n-1)*beta
    const d = 2 * z1 * (n - 1) * beta;
    // 计算条纹间距 Δx = λ*(z1+z2)/d
    const delta_x = lambda * (z1 + z2) / d;
    
    // 显示计算结果
    document.getElementById("param_d").textContent = d.toFixed(4) + " mm";
    document.getElementById("param_dx").textContent = delta_x.toFixed(4) + " mm";
    
    // 在canvas上绘制干涉条纹 (论文公式10)
    const c = document.getElementById("fringeCanvas"), cx = c.getContext("2d");
    const w = c.width, h = c.height;
    cx.fillStyle = "#000"; cx.fillRect(0, 0, w, h);
    
    const xMax = 20, ppm = w / (2 * xMax);  // pixels per mm
    
    for (let px = 0; px < w; px++) {
        const x = px / ppm - xMax;  // mm坐标
        
        // 论文公式(10): I(x) = sinc²[πbx/(λ(z₁+z₂))] · cos²[πz₁(n-1)βx/(λ(z₁+z₂))]
        const arg_sinc = Math.PI * b * x / (lambda * (z1 + z2));
        const arg_cos = Math.PI * z1 * (n - 1) * beta * x / (lambda * (z1 + z2));
        
        let envelope;
        if (Math.abs(arg_sinc) < 1e-10) envelope = 1;
        else envelope = Math.pow(Math.sin(arg_sinc) / arg_sinc, 2);
        
        const interference = Math.pow(Math.cos(arg_cos), 2);
        const I = envelope * interference;
        const brightness = Math.floor(I * 255);
        
        cx.fillStyle = `rgb(${brightness}, ${Math.floor(brightness * 0.9)}, ${Math.floor(brightness * 0.5)})`;
        cx.fillRect(px, 0, 1, h);
    }
    
    document.querySelector("#simPanel h3").textContent = 
        `干涉条纹模拟 (b=${b}mm, z₁=${z1.toFixed(0)}mm, z₂=${z2.toFixed(0)}mm, Δx=${delta_x.toFixed(3)}mm)`;
}

function resetLayout() { devices = []; selectedDevice = null; ["source", "slit", "prism", "screen"].forEach(t => addDevice(t)); }
function clearAll() { if (confirm("确定清空所有设备？")) { devices = []; selectedDevice = null; render(); } }
document.addEventListener("keydown", e => { if (e.key === "Delete" || e.key === "Backspace") { if (selectedDevice) deleteDevice(selectedDevice); } });
window.addEventListener("load", init);