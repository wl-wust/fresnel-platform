// 菲涅耳双棱镜实验 - 2D光路模拟器
const canvas = document.getElementById("opticalCanvas");
const ctx = canvas.getContext("2d");

// 画布配置
const CONFIG = {
    railY: 300,
    railHeight: 10,
    scale: 0.5
};

// 设备类型定义
const DEVICE_TYPES = {
    source: { name: "钠光灯", icon: "💡", color: "#ffaa00", width: 60, height: 80, draggable: true },
    slit: { name: "单缝S", icon: "🔲", color: "#00d4ff", width: 30, height: 50, draggable: true },
    prism: { name: "双棱镜", icon: "🔺", color: "#7b2cbf", width: 70, height: 70, draggable: true },
    lens: { name: "凸透镜", icon: "🔍", color: "#00ff88", width: 40, height: 90, draggable: true },
    aperture: { name: "光阑", icon: "⭕", color: "#ff6b6b", width: 40, height: 40, draggable: true },
    micrometer: { name: "测微目镜", icon: "🔬", color: "#ff4444", width: 80, height: 100, draggable: true },
    screen: { name: "观察屏", icon: "📍", color: "#ffd93d", width: 60, height: 100, draggable: true },
    ruler: { name: "刻度尺", icon: "📏", color: "#6c757d", width: 200, height: 30, draggable: false },
    phone: { name: "手机", icon: "📱", color: "#495057", width: 70, height: 120, draggable: true }
};

// 状态
let devices = [];
let selectedDevice = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let touchStart = { x: 0, y: 0 };
let showLight = true;
let showLabels = true;
let nextId = 1;

// 初始化
function init() {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    setupEvents();
    resetLayout();
}

function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = Math.max(400, window.innerHeight * 0.5);
    render();
}

function setupEvents() {
    // 鼠标事件
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    canvas.addEventListener("contextmenu", onRightClick);
    
    // 触摸事件
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
}

function getEventPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top;
    return { x, y };
}

function hitTest(x, y) {
    for (let i = devices.length - 1; i >= 0; i--) {
        const d = devices[i];
        if (x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height) {
            return d;
        }
    }
    return null;
}

function onMouseDown(e) {
    e.preventDefault();
    const pos = getEventPos(e);
    const device = hitTest(pos.x, pos.y);
    
    if (device && device.draggable) {
        selectedDevice = device;
        isDragging = true;
        dragOffset.x = pos.x - device.x;
        dragOffset.y = pos.y - device.y;
        document.getElementById("selected").textContent = "已选择: " + device.name;
        render();
    } else {
        selectedDevice = null;
        document.getElementById("selected").textContent = "未选择";
        render();
    }
}

function onMouseMove(e) {
    e.preventDefault();
    const pos = getEventPos(e);
    document.getElementById("coords").textContent = "坐标: (" + Math.round(pos.x) + ", " + Math.round(pos.y) + ")";
    
    if (isDragging && selectedDevice) {
        selectedDevice.x = pos.x - dragOffset.x;
        selectedDevice.y = pos.y - dragOffset.y;
        selectedDevice.x = Math.max(0, Math.min(canvas.width - selectedDevice.width, selectedDevice.x));
        selectedDevice.y = Math.max(0, Math.min(canvas.height - selectedDevice.height, selectedDevice.y));
        render();
    }
}

function onMouseUp(e) {
    isDragging = false;
}

function onRightClick(e) {
    e.preventDefault();
    if (selectedDevice) {
        deleteDevice(selectedDevice);
    }
}

function onTouchStart(e) {
    e.preventDefault();
    const pos = getEventPos(e);
    touchStart = { ...pos };
    const device = hitTest(pos.x, pos.y);
    
    if (device && device.draggable) {
        selectedDevice = device;
        isDragging = true;
        dragOffset.x = pos.x - device.x;
        dragOffset.y = pos.y - device.y;
        document.getElementById("selected").textContent = "已选择: " + device.name;
        render();
    }
}

function onTouchMove(e) {
    e.preventDefault();
    if (isDragging && selectedDevice) {
        const pos = getEventPos(e);
        selectedDevice.x = pos.x - dragOffset.x;
        selectedDevice.y = pos.y - dragOffset.y;
        selectedDevice.x = Math.max(0, Math.min(canvas.width - selectedDevice.width, selectedDevice.x));
        selectedDevice.y = Math.max(0, Math.min(canvas.height - selectedDevice.height, selectedDevice.y));
        render();
    }
}

function onTouchEnd(e) {
    isDragging = false;
}

function addDevice(type) {
    const def = DEVICE_TYPES[type];
    if (!def) return;
    
    const device = {
        id: nextId++,
        type: type,
        x: 80 + devices.length * 90,
        y: CONFIG.railY - def.height / 2,
        width: def.width,
        height: def.height,
        name: def.name,
        icon: def.icon,
        color: def.color
    };
    
    devices.push(device);
    render();
}

function deleteDevice(device) {
    const idx = devices.indexOf(device);
    if (idx > -1) devices.splice(idx, 1);
    if (selectedDevice === device) selectedDevice = null;
    render();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawOpticalAxis();
    drawRail();
    if (showLight) drawLightPath();
    devices.forEach(d => drawDevice(d, d === selectedDevice));
    if (showLabels) drawLabels();
    updateParams();
}

function drawGrid() {
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
}

function drawOpticalAxis() {
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, CONFIG.railY);
    ctx.lineTo(canvas.width, CONFIG.railY);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawRail() {
    ctx.fillStyle = "#5a5a6e";
    ctx.fillRect(0, CONFIG.railY + 10, canvas.width, CONFIG.railHeight);
    ctx.strokeStyle = "#3a3a4e";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, CONFIG.railY + 10, canvas.width, CONFIG.railHeight);
    
    ctx.fillStyle = "#00d4ff";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    for (let x = 50; x < canvas.width; x += 50) {
        const isMajor = (x / CONFIG.scale) % 100 === 0;
        ctx.beginPath();
        ctx.moveTo(x, CONFIG.railY + 10);
        ctx.lineTo(x, CONFIG.railY + 10 + (isMajor ? 15 : 8));
        ctx.strokeStyle = isMajor ? "#00d4ff" : "#4488aa";
        ctx.lineWidth = isMajor ? 2 : 1;
        ctx.stroke();
        if (isMajor) ctx.fillText(Math.round(x / CONFIG.scale) + "", x, CONFIG.railY + 35);
    }
}

function drawLightPath() {
    const source = devices.find(d => d.type === "source");
    const screen = devices.find(d => d.type === "micrometer" || d.type === "screen");
    if (!source || !screen) return;
    
    const sx = source.x + source.width / 2;
    const sy = source.y + source.height / 2;
    const ex = screen.x + screen.width / 2;
    const ey = screen.y + screen.height / 2;
    
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
}

function drawDevice(device, isSelected) {
    const def = DEVICE_TYPES[device.type];
    
    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(device.x + 3, device.y + 3, device.width, device.height);
    
    // 主体
    ctx.fillStyle = def.color;
    ctx.fillRect(device.x, device.y, device.width, device.height);
    
    // 边框
    ctx.strokeStyle = isSelected ? "#ff0000" : "#333";
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.strokeRect(device.x, device.y, device.width, device.height);
    
    // 图标
    ctx.font = "24px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.icon, device.x + device.width / 2, device.y + device.height / 2 - 8);
    
    // 名称
    if (showLabels) {
        ctx.font = "11px Microsoft YaHei";
        ctx.fillStyle = "#333";
        ctx.fillText(def.name, device.x + device.width / 2, device.y + device.height - 6);
    }
    
    // 删除按钮
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

function drawLabels() {
    ctx.font = "11px Microsoft YaHei";
    ctx.fillStyle = "#666";
    devices.forEach(d => {
        ctx.fillText(d.name + ": " + Math.round(d.x / CONFIG.scale) + "mm", d.x + d.width / 2, d.y - 12);
    });
}

function updateParams() {
    const source = devices.find(d => d.type === "source");
    const prism = devices.find(d => d.type === "prism");
    const screen = devices.find(d => d.type === "micrometer" || d.type === "screen");
    
    if (source && prism && screen) {
        const S = Math.round((prism.x - source.x) / CONFIG.scale);
        const L = Math.round((screen.x - prism.x) / CONFIG.scale);
        const D = Math.round((screen.x - source.x) / CONFIG.scale);
        document.getElementById("param_S").textContent = S + " mm";
        document.getElementById("param_L").textContent = L + " mm";
        document.getElementById("param_D").textContent = D + " mm";
    } else {
        document.getElementById("param_S").textContent = "-";
        document.getElementById("param_L").textContent = "-";
        document.getElementById("param_D").textContent = "-";
    }
}

function toggleLight() { showLight = document.getElementById("showLight").checked; render(); }
function toggleLabels() { showLabels = document.getElementById("showLabels").checked; render(); }
function simulateInterference() {
    const panel = document.getElementById("interferencePanel");
    panel.style.display = "block";
    const c = document.getElementById("fringeCanvas");
    const cx = c.getContext("2d");
    const w = c.width, h = c.height;
    cx.fillStyle = "#000"; cx.fillRect(0, 0, w, h);
    const source = devices.find(d => d.type === "source");
    const screen = devices.find(d => d.type === "micrometer" || d.type === "screen");
    if (source && screen) {
        const D = (screen.x - source.x) / CONFIG.scale;
        for (let x = 0; x < w; x++) {
            const b = 0.5 * (1 + Math.cos((2 * Math.PI * 2 * 0.5 * x) / (589.3 * 1e-6 * D * 1000)));
            cx.fillStyle = "rgb(" + Math.floor(b*255) + "," + Math.floor(b*255) + "," + Math.floor(b*200+55) + ")";
            cx.fillRect(x, 0, 1, h);
        }
    }
}
function resetLayout() {
    devices = [];
    selectedDevice = null;
    ["source", "slit", "prism", "lens", "micrometer"].forEach(t => addDevice(t));
}
function clearAll() {
    if (confirm("确定清空所有设备？")) { devices = []; selectedDevice = null; render(); }
}

document.addEventListener("keydown", e => { if (e.key === "Delete" || e.key === "Backspace") { if (selectedDevice) deleteDevice(selectedDevice); } });

window.addEventListener("load", init);
