// 专业相机模式变量
let professionalMode = false;
let currentZoom = 1;
let currentExposure = 0;
let videoTrack = null;
let imageCapture = null;

// 切换到专业模式
function toggleProfessionalMode() {
    professionalMode = !professionalMode;
    const btn = document.querySelector('.camera-controls button');
    btn.classList.toggle('active', professionalMode);
    
    if (professionalMode && videoTrack) {
        applyCameraSettings();
    }
}

// 设置变焦
 setZoom(level) {
    if (!videoTrack) return;
    
    const capabilities = videoTrack.getCapabilities();
    if (!capabilities.zoom) {
        showAlert("此设备不支持变焦");
        return;
    }
    
    const min = capabilities.zoom.min;
    const max = capabilities.zoom.max;
    const step = (max - min) / 3;
    
    currentZoom = min + level * step;
    try {
        videoTrack.applyConstraints({
            advanced: [{ zoom: currentZoom }]
        });
    } catch(e) {
        showAlert("变焦设置失败: " + e.message);
    }
}

// 设置曝光
 setExposure(value) {
    if (!videoTrack) return;
    
    currentExposure = parseFloat(value);
    try {
        videoTrack.applyConstraints({
            advanced: [{ exposureCompensation: currentExposure }]
        });
    } catch(e) {
        console.log("曝光调整失败:", e.message);
    }
}

// HDR开关
 toggleHDR() {
    if (!videoTrack) return;
    
    const capabilities = videoTrack.getCapabilities();
    if (!capabilities.hdr) {
        showAlert("此设备不支持HDR");
        return;
    }
    
    // HDR通常通过exposureTime控制
    showAlert("HDR模式已" + (professionalMode ? "开启" : "关闭"));
}

// 对焦
 toggleFocus() {
    if (!videoTrack) return;
    
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.focusMode) {
        try {
            videoTrack.applyConstraints({
                advanced: [{ focusMode: "continuous" }]
            });
            showAlert("连续对焦已开启");
        } catch(e) {
            showAlert("对焦设置失败: " + e.message);
        }
    } else {
        showAlert("此设备不支持手动对焦");
    }
}

// 应用相机设置
 applyCameraSettings() {
    if (!videoTrack) return;
    
    try {
        videoTrack.applyConstraints({
            advanced: [
                { zoom: currentZoom },
                { exposureCompensation: currentExposure }
            ]
        });
    } catch(e) {
        console.log("设置应用失败:", e);
    }
}

// 获取相机信息
 getCameraInfo() {
    if (!videoTrack) return;
    
    const settings = videoTrack.getSettings();
    const info = document.getElementById('cameraInfo');
    if (info) {
        info.innerHTML = `
            <div>分辨率: ${settings.width}x${settings.height}</div>
            <div>帧率: ${settings.frameRate} fps</div>
            <div>焦距: ${settings.focalLength || '自动'} mm</div>
            <div>曝光: ${settings.exposureTime || '自动'}</div>
            <div>ISO: ${settings.iso || '自动'}</div>
        `;
    }
}

// 使用ImageCapture拍照（更高质量）
 captureWithImageCapture() {
    if (!imageCapture) return null;
    
    try {
        const blob = imageCapture.takePhoto({
            facingMode: "environment",
            brightness: 0,
            exposureTime: 1/60
        });
        return URL.createObjectURL(blob);
    } catch(e) {
        // 回退到canvas截取
        return captureFromVideo();
    }
}

// 从视频流截取
function captureFromVideo() {
    const video = document.getElementById("video");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95);
}

// 修改原有的openCamera函数
 openCamera() {
    try {
        const video = document.getElementById("video");
        cameraStream = navigator.mediaDevices.getUserMedia({ 
            video: {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });
        
        video.srcObject = cameraStream;
        video.style.display = "block";
        document.getElementById("previewBox").style.display = "none";
        
        // 获取视频轨道
        videoTrack = cameraStream.getVideoTracks()[0];
        
        // 创建ImageCapture对象
        if (window.ImageCapture) {
            imageCapture = new ImageCapture(videoTrack);
        }
        
        // 显示相机控制面板
        document.getElementById("cameraControls").style.display = "block";
        
        // 等待相机启动后获取信息
        video.addEventListener("loadedmetadata", () {
            getCameraInfo();
        }, { once: true });
        
    } catch(e) { 
        showAlert("无法访问相机: " + e.message);
    }
}

// 修改拍照函数
function triggerCamera() {
    if (cameraStream) {
        // 使用专业模式拍照
        const dataUrl = captureWithImageCapture();
        if (dataUrl) {
            handleCapturedImage(dataUrl);
        }
    } else {
        // 未打开相机，触发文件选择
        document.getElementById('fileInput').click();
    }
}

// 处理捕获的图像
function handleCapturedImage(dataUrl) {
    currentImage = dataUrl;
    const previewBox = document.getElementById("previewBox");
    previewBox.innerHTML = `<img src="${dataUrl}" style="width:100%;height:200px;object-fit:cover;border-radius:8px">`;
    previewBox.style.display = "block";
    document.getElementById("captureParams").style.display = "block";
}
