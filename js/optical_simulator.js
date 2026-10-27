// 菲涅耳双棱镜光学模拟器 - 完整版
const canvas = document.getElementById("opticalCanvas");
const ctx = canvas.getContext("2d");

// 画布配置
let CONFIG = { railY: 300, railHeight: 10, scale: 0.5, offsetX: 50 };
let devices = [], selectedDevice = null, isDragging = false, dragOffset = { x: 0, y: 0 };
let showLight = true, showLabels = true, showGridFlag = false;
let nextId = 1;

// 设备类型定义
const DEVICE_TYPES = {
    source: { name: "钠光灯", icon: "💡", color: "#ffaa00", width: 60, height: 80 },
    slit: { name: "单缝", icon: "🔲", color: "#00d4ff", width: 30, height: 50 },
    prism: { name: "双棱镜", icon: "🔺", color: "#7b2cbf", width: 70, height: 70 },
    lens: { name: "凸透镜", icon: "🔍", color: "#00ff88", width: 40, height: 90 },
    screen: { name: "观察屏", icon: "📍", color: "#ffd93d", width: 60, height: 100 }
};

function init() { resizeCanvas(); window.addEventListener("resize", resizeCanvas); setupEvents(); resetLayout(); }
function resizeCanvas() { 
    const c = canvas.parentElement; 
    canvas.width = c.clientWidth; 
    canvas.height = c.clientHeight; 
    CONFIG.railY = Math.floor(canvas.height / 2); 
    render(); 
}
function setupEvents() {
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    canvas.addEventListener("contextmenu", e => { e.preventDefault(); if (selectedDevice) deleteDevice(selectedDevice); });
}

function getEventPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitTest(x, y) { for (let i = devices.length - 1; i >= 0; i--) { const d = devices[i]; if (x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height) return d; } return null; }

function onMouseDown(e) { e.preventDefault(); const p = getEventPos(e); const dev = hitTest(p.x, p.y); if (dev) { selectedDevice = dev; isDragging = true; dragOffset.x = p.x - dev.x; dragOffset.y = p.y - dev.y; document.getElementById("selected").textContent = dev.name; render(); } else { selectedDevice = null; document.getElementById("selected").textContent = "无"; render(); } }
function onMouseMove(e) { e.preventDefault(); const p = getEventPos(e); document.getElementById("coords").textContent = "(" + Math.round(p.x) + ", " + Math.round(p.y) + ")"; if (isDragging && selectedDevice) { selectedDevice.x = Math.max(0, Math.min(canvas.width - selectedDevice.width, p.x - dragOffset.x)); selectedDevice.y = Math.max(0, Math.min(canvas.height - selectedDevice.height, p.y - dragOffset.y)); render(); updateParams(); } }
function onMouseUp() { isDragging = false; }

function addDevice(type) { 
    const def = DEVICE_TYPES[type]; 
    if (!def) return; 
    // 自动对齐到光轴
    const y = CONFIG.railY - def.height / 2;
    devices.push({ id: nextId++, type, x: 100 + devices.length * 100, y: y, width: def.width, height: def.height, name: def.name }); 
    render(); 
    updateParams(); 
}

function deleteDevice(device) { const i = devices.indexOf(device); if (i >= 0) devices.splice(i, 1); selectedDevice = null; render(); updateParams(); }

function alignToAxis() {
    // 将所有元件水平对齐到光轴中心
    devices.forEach(d => {
        d.y = CONFIG.railY - d.height / 2;
    });
    render();
}

function render() { 
    ctx.clearRect(0, 0, canvas.width, canvas.height); 
    drawRail(); 
    devices.forEach(d => drawDevice(d, d === selectedDevice)); 
    if (showLight) drawLightPath(); 
    if (showLabels) drawLabels(); 
    updateParams(); 
}

function drawRail() { 
    ctx.fillStyle = "#445"; 
    ctx.fillRect(0, CONFIG.railY, canvas.width, CONFIG.railHeight); 
    for (let x = 0; x < canvas.width; x += CONFIG.scale * 50) { 
        const isMajor = (x / CONFIG.scale) % 100 === 0; 
        ctx.beginPath(); 
        ctx.moveTo(x, CONFIG.railY + 10); 
        ctx.lineTo(x, CONFIG.railY + 10 + (isMajor ? 15 : 8)); 
        ctx.strokeStyle = isMajor ? "#00d4ff" : "#4488aa"; 
        ctx.lineWidth = isMajor ? 2 : 1; 
        ctx.stroke(); 
        if (isMajor) ctx.fillText(Math.round(x / CONFIG.scale) + "mm", x, CONFIG.railY + 35); 
    } 
}

function drawDevice(device, isSelected) { 
    const def = DEVICE_TYPES[device.type]; 
    ctx.fillStyle = "rgba(0,0,0,0.3)"; 
    ctx.fillRect(device.x + 3, device.y + 3, device.width, device.height); 
    ctx.fillStyle = def.color; 
    ctx.fillRect(device.x, device.y, device.width, device.height); 
    ctx.strokeStyle = isSelected ? "#ff0000" : "#333"; 
    ctx.lineWidth = isSelected ? 3 : 1; 
    ctx.strokeRect(device.x, device.y, device.width, device.height); 
    ctx.font = "24px Arial"; 
    ctx.textAlign = "center"; 
    ctx.textBaseline = "middle"; 
    ctx.fillText(def.icon, device.x + device.width / 2, device.y + device.height / 2 - 8); 
    if (showLabels) { 
        ctx.font = "11px Microsoft YaHei"; 
        ctx.fillStyle = "#333"; 
        ctx.fillText(def.name, device.x + device.width / 2, device.y + device.height - 6); 
    } 
    if (isSelected) { 
        ctx.fillStyle = "#ff4444"; 
        ctx.beginPath(); 
        ctx.arc(device.x + device.width - 12, device.y + 12, 10, 0, Math.PI * 2); 
        ctx.fill(); 
        ctx.fillStyle = "#fff"; 
        ctx.font = "12px Arial"; 
        ctx.fillText("×", device.x + device.width - 12, device.y + 15); 
    } 
}

// 绘制完整光路（包括双棱镜分光）
function drawLightPath() { 
    const source = devices.find(d => d.type === "source");
    const prism = devices.find(d => d.type === "prism");
    const screen = devices.find(d => d.type === "screen");
    
    if (!source || !prism) return;
    
    const sourceCX = source.x + source.width / 2;
    const sourceCY = source.y + source.height / 2;
    const prismCX = prism.x + prism.width / 2;
    const prismCY = prism.y + prism.height / 2;
    
    // 绘制光轴（中心线）
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(0, CONFIG.railY);
    ctx.lineTo(canvas.width, CONFIG.railY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 绘制从光源到棱镜的主光线
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sourceCX, sourceCY);
    ctx.lineTo(prismCX, prismCY);
    ctx.stroke();
    
    // 如果有棱镜，绘制分光后的两条虚光源路径
    if (prism) {
        const prismLeft = prism.x;
        const prismRight = prism.x + prism.width;
        
        // 上偏折光线（虚光源S1）
        ctx.strokeStyle = "#ff6b6b";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(prismCX, prismCY);
        ctx.lineTo(prismLeft - 30, prismCY - 60);
        ctx.stroke();
        
        // 下偏折光线（虚光源S2）
        ctx.beginPath();
        ctx.moveTo(prismCX, prismCY);
        ctx.lineTo(prismRight + 30, prismCY + 60);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 绘制虚光源标记
        ctx.fillStyle = "#ff6b6b";
        ctx.font = "12px Arial";
        ctx.fillText("S₁", prismLeft - 25, prismCY - 65);
        ctx.fillText("S₂", prismRight + 20, prismCY + 70);
        
        // 绘制到屏幕的干涉光线（如果有屏幕）
        if (screen) {
            const screenCX = screen.x + screen.width / 2;
            const screenCY = screen.y + screen.height / 2;
            
            // 从S1到屏幕的光线
            ctx.strokeStyle = "rgba(255,107,107,0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(prismLeft - 30, prismCY - 60);
            ctx.lineTo(screenCX, screenCY);
            ctx.stroke();
            
            // 从S2到屏幕的光线
            ctx.strokeStyle = "rgba(100,181,246,0.5)";
            ctx.beginPath();
            ctx.moveTo(prismRight + 30, prismCY + 60);
            ctx.lineTo(screenCX, screenCY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

function drawLabels() { 
    devices.forEach(d => { 
        ctx.font = "10px Arial"; 
        ctx.fillStyle = "#fff"; 
        ctx.fillText(d.name + "#" + d.id, d.x, d.y - 5); 
    }); 
}

function updateParams() { 
    const z1El = document.getElementById("z1"), 
          bEl = document.getElementById("b"), 
          z2El = document.getElementById("z2"), 
          lambdaEl = document.getElementById("lambda"), 
          nEl = document.getElementById("n"), 
          betaEl = document.getElementById("beta"); 
    
    const lambda = parseFloat(lambdaEl.value) * 1e-6, 
          n = parseFloat(nEl.value), 
          beta = parseFloat(betaEl.value) * Math.PI / 180, 
          b = parseFloat(bEl.value), 
          z1 = parseFloat(z1El.value), 
          z2 = parseFloat(z2El.value); 
    
    const d = 2 * z1 * (n - 1) * beta * 1000; 
    const D = z1 + z2; 
    const dx = lambda * D / d * 1000; 
    
    document.getElementById("result_d").textContent = d.toFixed(3) + " mm"; 
    document.getElementById("result_dx").textContent = dx.toFixed(3) + " mm"; 
    document.getElementById("result_D").textContent = D.toFixed(0) + " mm"; 
    document.getElementById("result_M").textContent = "-"; 
}

function loadPreset(name) { 
    const presets = { 
        "fig2a": { z1: 10, b: 0.02 }, 
        "fig2b": { z1: 10, b: 0.04 }, 
        "fig2c": { z1: 10, b: 0.10 }, 
        "fig3a": { z1: 10, b: 0.02 }, 
        "fig3b": { z1: 20, b: 0.02 }, 
        "fig3c": { z1: 30, b: 0.02 }, 
        "exp_a": { z1: 80, b: 0.02 }, 
        "exp_b": { z1: 80, b: 0.04 }, 
        "exp_c": { z1: 80, b: 0.10 }, 
        "fig6a": { z1: 80, b: 0.02 }, 
        "fig6b": { z1: 120, b: 0.02 } 
    }; 
    const p = presets[name]; 
    if (p) { 
        document.getElementById("z1").value = p.z1; 
        document.getElementById("b").value = p.b; 
        updateParams(); 
    } 
}

function toggleLight() { showLight = document.getElementById("showLight").checked; render(); }
function toggleLabels() { showLabels = document.getElementById("showLabels").checked; render(); }
function toggleGrid() { showGridFlag = document.getElementById("showGrid").checked; render(); }

function resetLayout() { 
    devices = []; 
    nextId = 1; 
    selectedDevice = null; 
    document.getElementById("selected").textContent = "无"; 
    render(); 
}

// 模拟干涉条纹
function simulateInterference() { 
    const lambda = parseFloat(document.getElementById("lambda").value) * 1e-6, 
          n = parseFloat(document.getElementById("n").value), 
          beta = parseFloat(document.getElementById("beta").value) * Math.PI / 180, 
          b = parseFloat(document.getElementById("b").value), 
          z1 = parseFloat(document.getElementById("z1").value), 
          z2 = parseFloat(document.getElementById("z2").value); 
    
    const d = 2 * z1 * (n - 1) * beta * 1000; 
    const D = z1 + z2; 
    const dx = lambda * D / d * 1000; 
    
    const fringeCanvas = document.getElementById("fringeCanvas"); 
    const fctx = fringeCanvas.getContext("2d"); 
    const W = fringeCanvas.width, H = fringeCanvas.height; 
    
    // 清空画布
    fctx.fillStyle = "#000"; 
    fctx.fillRect(0, 0, W, H); 
    
    // 计算干涉强度分布
    const x = Array.from({ length: W }, (_, i) => (i - W / 2) * 0.05); 
    const a1 = x.map(xi => Math.PI * b * xi / (lambda * D * 1000)); 
    const envelope = a1.map(a => a === 0 ? 1 : (Math.sin(a) / a) ** 2); 
    const a2 = x.map(xi => Math.PI * z1 * (n - 1) * beta * xi / (lambda * D * 1000)); 
    const I = envelope.map((env, i) => env * (Math.cos(a2[i]) ** 2)); 
    
    const Imax = Math.max(...I);
    
    // 绘制干涉条纹（水平条带）
    for (let px = 0; px < W; px++) {
        const intensity = I[px] / Imax;
        const brightness = Math.floor(intensity * 255);
        
        // 从上到下填充整个高度
        fctx.fillStyle = `rgb(${brightness}, ${brightness}, ${Math.min(255, brightness + 50)})`;
        fctx.fillRect(px, 0, 1, H);
    }
    
    document.getElementById("theoretical_dx").textContent = dx.toFixed(3) + " mm"; 
    const visibility = ((Math.max(...I) - Math.min(...I)) / (Math.max(...I) + Math.min(...I))) * 100; 
    document.getElementById("visibility").textContent = visibility.toFixed(1) + "%"; 
    document.getElementById("fringeResult").style.display = "block"; 
}

window.onload = init;
window.addDevice = addDevice;
window.deleteDevice = deleteDevice;
window.loadPreset = loadPreset;
window.toggleLight = toggleLight;
window.toggleLabels = toggleLabels;
window.toggleGrid = toggleGrid;
window.resetLayout = resetLayout;
window.simulateInterference = simulateInterference;
window.updateParams = updateParams;
window.alignToAxis = alignToAxis;

