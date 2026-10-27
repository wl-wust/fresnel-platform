// === 菲涅耳双棱镜条纹分析器 - 纯前端FFT实现 ===
// 支持三种方法: FFT基频法、相位斜率法、零交叉法
// @see 研究报告 表6.1

/**
 * 将图像元素转换为灰度数组
 */
function imageToGrayscale(canvasOrImg) {
    const canvas = canvasOrImg.getContext ? canvasOrImg : (() => {
        const c = document.createElement('canvas');
        c.width = canvasOrImg.naturalWidth || canvasOrImg.width;
        c.height = canvasOrImg.naturalHeight || canvasOrImg.height;
        c.getContext('2d').drawImage(canvasOrImg, 0, 0);
        return c;
    })();
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const gray = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return { gray, width: canvas.width, height: canvas.height };
}

/**
 * 沿条纹方向投影（自动检测水平/垂直条纹）
 */
function projectAlongFringes(gray, w, h) {
    const projX = new Float32Array(w);
    const projY = new Float32Array(h);
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = gray[y * w + x];
            projX[x] += v;
            projY[y] += v;
        }
    }
    for (let x = 0; x < w; x++) projX[x] /= h;
    for (let y = 0; y < h; y++) projY[y] /= w;
    
    const varX = variance(projX);
    const varY = variance(projY);
    
    if (varY > varX * 1.5) {
        return { projection: projX, direction: 'v', w, h };
    } else {
        return { projection: projY, direction: 'h', w, h };
    }
}

function variance(arr) {
    const n = arr.length;
    if (n === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
}

function gaussianSmooth(arr, sigma = 2) {
    const n = arr.length;
    const result = new Float32Array(n);
    const kSize = Math.ceil(6 * sigma);
    const kernel = new Float32Array(kSize * 2 + 1);
    const s2 = 2 * sigma * sigma;
    
    for (let i = -kSize; i <= kSize; i++) {
        kernel[i + kSize] = Math.exp(-(i * i) / s2);
    }
    const kSum = kernel.reduce((a, b) => a + b, 0);
    for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;
    
    for (let i = 0; i < n; i++) {
        let sum = 0, wSum = 0;
        for (let j = -kSize; j <= kSize; j++) {
            const idx = i + j;
            if (idx >= 0 && idx < n) {
                sum += arr[idx] * kernel[j + kSize];
                wSum += kernel[j + kSize];
            }
        }
        result[i] = wSum > 0 ? sum / wSum : arr[i];
    }
    return result;
}

function removeTrend(arr) {
    const n = arr.length;
    const result = new Float32Array(n);
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const slope = arr.reduce((sum, v, i) => sum + (i - n/2) * (v - mean), 0) / 
                  arr.reduce((sum, _, i) => sum + (i - n/2) ** 2, 0);
    for (let i = 0; i < n; i++) {
        result[i] = arr[i] - (mean + slope * (i - n/2));
    }
    return result;
}

function fft(real, imag = null) {
    let n = real.length;
    let m = 1;
    while (m < n) m <<= 1;
    const N = m;
    
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < n; i++) {
        re[i] = real[i];
        im[i] = imag ? imag[i] : 0;
    }
    
    for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    
    for (let len = 2; len <= N; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -2 * Math.PI / len;
        const wLenRe = Math.cos(angle);
        const wLenIm = Math.sin(angle);
        
        for (let i = 0; i < N; i += len) {
            let wRe = 1, wIm = 0;
            for (let j = 0; j < halfLen; j++) {
                const uRe = re[i + j], uIm = im[i + j];
                const vRe = re[i + j + halfLen] * wRe - im[i + j + halfLen] * wIm;
                const vIm = re[i + j + halfLen] * wIm + im[i + j + halfLen] * wRe;
                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + halfLen] = uRe - vRe;
                im[i + j + halfLen] = uIm - vIm;
                
                const nextWRe = wRe * wLenRe - wIm * wLenIm;
                wIm = wRe * wLenIm + wIm * wLenRe;
                wRe = nextWRe;
            }
        }
    }
    
    return re;
}

function argmax(arr) {
    let maxIdx = 0;
    let maxVal = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > maxVal) {
            maxVal = arr[i];
            maxIdx = i;
        }
    }
    return maxIdx;
}

function fftMethod(projection) {
    const N = projection.length;
    const mean = projection.reduce((a, b) => a + b, 0) / N;
    const signal = new Float64Array(N);
    for (let i = 0; i < N; i++) signal[i] = projection[i] - mean;
    
    const magnitudes = fft(signal);
    const posMag = magnitudes.slice(1, N / 2);
    const maxIdx = argmax(posMag);
    const freq = (maxIdx + 1) / N;
    const periodPx = 1 / freq;
    
    const peakMag = posMag[maxIdx];
    const avgMag = posMag.reduce((a, b) => a + b, 0) / posMag.length;
    const confidence = avgMag > 0 ? peakMag / avgMag : 0;
    
    return { period_px: periodPx, freq_hz: freq, confidence: confidence, method: 'FFT' };
}

function peakMethod(projection, minDistance = 5) {
    const N = projection.length;
    const peaks = [];
    const smoothed = gaussianSmooth(projection, 1.5);
    
    for (let i = 1; i < N - 1; i++) {
        if (smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1]) {
            if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= minDistance) {
                peaks.push(i);
            }
        }
    }
    
    let intervals = [];
    for (let i = 1; i < peaks.length; i++) {
        intervals.push(peaks[i] - peaks[i - 1]);
    }
    
    if (intervals.length === 0) return { period_px: null, peak_count: 0 };
    
    intervals.sort((a, b) => a - b);
    const medianIdx = Math.floor(intervals.length / 2);
    const periodPx = intervals[medianIdx];
    
    return { period_px: periodPx, peak_count: peaks.length, peaks: peaks, method: 'Peak' };
}

function phaseSlopeMethod(projection) {
    const N = projection.length;
    const mean = projection.reduce((a, b) => a + b, 0) / N;
    const signal = new Float64Array(N);
    for (let i = 0; i < N; i++) signal[i] = projection[i] - mean;
    
    const real = new Float64Array(N);
    const imag = new Float64Array(N);
    for (let i = 0; i < N; i++) real[i] = signal[i];
    
    const mag = fft(real);
    for (let i = 0; i < N; i++) {
        if (i > 0 && i < N / 2) imag[i] = -real[i];
        else if (i > N / 2) imag[i] = real[i];
        else imag[i] = 0;
    }
    
    const analytic = fft(real, imag);
    const envelope = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        envelope[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    
    const envMag = fft(envelope);
    const posMag = envMag.slice(1, N / 2);
    const maxIdx = argmax(posMag);
    const periodPx = N / (maxIdx + 1);
    
    return { period_px: periodPx, method: 'Phase' };
}

function analyzeFringes(img) {
    const { gray, width: w, height: h } = imageToGrayscale(img);
    const { projection } = projectAlongFringes(gray, w, h);
    
    const processed = removeTrend(projection);
    const maxVal = Math.max(...processed);
    const minVal = Math.min(...processed);
    const range = maxVal - minVal || 1;
    const normProj = new Float32Array(projection.length);
    for (let i = 0; i < projection.length; i++) {
        normProj[i] = (projection[i] - minVal) / range;
    }
    
    const fftResult = fftMethod(normProj);
    const peakResult = peakMethod(normProj);
    const phaseResult = phaseSlopeMethod(normProj);
    
    const validResults = [
        { ...fftResult, weight: 1.0 },
        { ...peakResult, weight: 0.8 },
        { ...phaseResult, weight: 0.6 }
    ].filter(r => r.period_px && r.period_px > 2 && r.period_px < w * 0.8);
    
    let weightedSum = 0, weightSum = 0;
    validResults.forEach(r => {
        weightedSum += r.period_px * r.weight;
        weightSum += r.weight;
    });
    const combinedPeriod = weightSum > 0 ? weightedSum / weightSum : null;
    
    return {
        width: w,
        height: h,
        direction: projectAlongFringes(gray, w, h).direction,
        fft: fftResult,
        peak: peakResult,
        phase: phaseResult,
        combined_period_px: combinedPeriod,
        quality: validResults.length > 0 ? 'good' : 'poor'
    };
}

window.fringeAnalyzer = { analyzeFringes };