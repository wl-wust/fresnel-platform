/* =========================================================================
 * core/fringe.js —— 图像 → 一维剖面 → 条纹间距（P5）
 *
 * 设计要点：
 *   ① 纯函数优先：synthesizeProfile / profileFromImageData / analyzeProfile 都不碰 DOM，
 *      因此 Node 里可以直接跑门禁（tools/check-fringe.js），不依赖浏览器和真照片。
 *   ② 方向判定：横竖两个方向各跑一次，取"峰更锐、周期与交叉检查更一致"的那个，
 *      避免"投影方向错 → 周期无穷大"（审查报告 §6.3 的注）。
 *   ③ 合成条纹图自带真值：没有实验仪器时也能验证整条链路 ——
 *      这也正是报告表 6.1 的方法（已知真值下检验提取偏差）。
 * ========================================================================= */
(function (global) {
  'use strict';

  var BP = global.BP = global.BP || {};

  // physics.js 的导出名是 BiprismPhysics；BP.physics 是 core/fmt.js 建的命名桥。
  // 这里自己兜一层，避免本模块依赖脚本加载顺序（Node 门禁里就没加载 fmt.js）。
  function phys() { return BP.physics || global.BiprismPhysics; }

  function finiteNumber(value) {
    return value !== null && value !== undefined && value !== '' && isFinite(value)
      ? Number(value)
      : null;
  }

  /* ---------------- 合成一维条纹剖面（带真值，用于自检） ----------------
   * I(x) = 0.5·[1 + V·cos(2πx/P + φ)] + noise + 线性漂移
   * 随机数用固定种子的 LCG，保证同参数结果可复现（报告 表 6.1 的可复现性要求）。
   */
  function synthesizeProfile(opts) {
    opts = opts || {};
    var n = opts.n || 1200;
    var P = opts.periodPx || 163.3;
    var V = opts.visibility == null ? 0.6 : opts.visibility;
    var noise = opts.noise == null ? 0.02 : opts.noise;
    var phi = opts.phi == null ? 0.7 : opts.phi;
    var drift = opts.drift == null ? 0.03 : opts.drift;
    var seed = opts.seed == null ? 1 : opts.seed;

    var s = seed;
    function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }

    var out = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var env = 1;
      if (opts.gaussEnvelope) env = Math.exp(-Math.pow((i - n / 2) / (n / 3), 2));
      out[i] = 0.5 * (1 + V * env * Math.cos(2 * Math.PI * i / P + phi))
               + noise * rnd() + drift * (i / n);
    }
    return out;
  }

  /* ---------------- RGBA → 一维剖面（纯函数） ----------------
   * axis='x'：按列求平均，得到随 x 变化的剖面（条纹竖直时用这个）
   * axis='y'：按行求平均，得到随 y 变化的剖面（条纹水平时用这个）
   * 亮度用 ITU-R BT.601 加权，与 Canvas 灰度化一致。
   */
  function profileFromImageData(data, width, height, axis) {
    var i, x, y, p, acc;
    if (axis === 'y') {
      var rows = new Float64Array(height);
      for (y = 0; y < height; y++) {
        acc = 0;
        for (x = 0; x < width; x++) {
          p = (y * width + x) * 4;
          acc += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        }
        rows[y] = acc / width;
      }
      return rows;
    }
    var cols = new Float64Array(width);
    for (x = 0; x < width; x++) {
      acc = 0;
      for (y = 0; y < height; y++) {
        p = (y * width + x) * 4;
        acc += 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      }
      cols[x] = acc / height;
    }
    return cols;
  }

  /* ---------------- 真实照片：信号、ROI 与方向投影 ----------------
   * 钠黄光在 R/G 通道最亮，蓝色反光在 B 通道更明显。这里不再把整图直接
   * 投影成一条线，而是：
   *   ① 用 max(R,G) 压制蓝斑；
   *   ② 用 Otsu 阈值找发光圆视场，排除大面积黑背景；
   *   ③ 在中心 ROI 内扫描投影方向，避免条纹倾斜把频谱峰抹平。
   */
  function signalFromImageData(data, width, height) {
    var n = width * height, out = new Float32Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var r = data[p], g = data[p + 1];
      out[i] = r > g ? r : g;
    }
    return out;
  }

  function otsuThreshold(signal) {
    var hist = new Uint32Array(256), total = signal.length, i;
    for (i = 0; i < total; i++) {
      var v = Math.max(0, Math.min(255, Math.round(signal[i])));
      hist[v]++;
    }
    var sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, threshold = 0;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = i; }
    }
    return threshold;
  }

  function activeBounds(signal, width, height, threshold) {
    var xCount = new Uint32Array(width), yCount = new Uint32Array(height);
    var xMax = 0, yMax = 0, total = 0, x, y;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (signal[y * width + x] > threshold) {
          xCount[x]++; yCount[y]++; total++;
        }
      }
    }
    if (!total) return null;
    for (x = 0; x < width; x++) if (xCount[x] > xMax) xMax = xCount[x];
    for (y = 0; y < height; y++) if (yCount[y] > yMax) yMax = yCount[y];
    var xNeed = Math.max(1, Math.floor(xMax * 0.01));
    var yNeed = Math.max(1, Math.floor(yMax * 0.01));
    var x0 = 0, x1 = width - 1, y0 = 0, y1 = height - 1;
    while (x0 < x1 && xCount[x0] < xNeed) x0++;
    while (x1 > x0 && xCount[x1] < xNeed) x1--;
    while (y0 < y1 && yCount[y0] < yNeed) y0++;
    while (y1 > y0 && yCount[y1] < yNeed) y1--;
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function centerRoi(signal, width, height, scale) {
    var threshold = otsuThreshold(signal);
    var bounds = activeBounds(signal, width, height, Math.max(4, threshold));
    if (!bounds) throw new Error('图像中没有明显发光区域');
    var bw = bounds.x1 - bounds.x0 + 1, bh = bounds.y1 - bounds.y0 + 1;
    var x0, y0, rw, rh;
    if (bw >= width * 0.9 && bh >= height * 0.9) {
      rw = width * Math.min(0.96, scale); rh = height * Math.min(0.96, scale);
    } else {
      rw = bw * scale; rh = bh * scale;
    }
    var cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
    x0 = Math.max(0, Math.round(cx - rw / 2));
    y0 = Math.max(0, Math.round(cy - rh / 2));
    var x1 = Math.min(width, Math.round(cx + rw / 2));
    var y1 = Math.min(height, Math.round(cy + rh / 2));
    if (x1 - x0 < 32 || y1 - y0 < 32) throw new Error('有效条纹区域太小');
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, threshold: threshold };
  }

  function sampleRoi(signal, imageWidth, roi, stride) {
    var cx = roi.x + roi.width / 2, cy = roi.y + roi.height / 2;
    var xs = [], ys = [], vs = [];
    for (var y = roi.y; y < roi.y + roi.height; y += stride) {
      for (var x = roi.x; x < roi.x + roi.width; x += stride) {
        xs.push(x - cx); ys.push(y - cy); vs.push(signal[y * imageWidth + x]);
      }
    }
    return { xs: xs, ys: ys, vs: vs, stride: stride };
  }

  function projectSamples(samples, angle) {
    var c = Math.cos(angle), s = Math.sin(angle), i;
    var minT = Infinity, maxT = -Infinity;
    for (i = 0; i < samples.xs.length; i++) {
      var t = samples.xs[i] * c + samples.ys[i] * s;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    var bins = Math.max(48, Math.min(2400, Math.round(maxT - minT)));
    var sums = new Float64Array(bins), counts = new Uint32Array(bins);
    var span = maxT - minT || 1;
    for (i = 0; i < samples.xs.length; i++) {
      var tt = samples.xs[i] * c + samples.ys[i] * s;
      var b = Math.max(0, Math.min(bins - 1, Math.floor((tt - minT) / span * bins)));
      sums[b] += samples.vs[i]; counts[b]++;
    }
    // 扫描方向接近 0°/90° 时，隔点采样会留下空箱；
    // 空箱按相邻有效投影值线性补齐，不能当作零亮度，否则会产生虚假短周期。
    var filled = new Float64Array(bins), nextValid = new Int32Array(bins), next = -1;
    for (i = 0; i < bins; i++) {
      if (counts[i]) { filled[i] = sums[i] / counts[i]; next = i; }
    }
    next = -1;
    for (i = bins - 1; i >= 0; i--) {
      if (counts[i]) next = i;
      nextValid[i] = next;
    }
    var prev = -1, prevValue = 0;
    for (i = 0; i < bins; i++) {
      if (counts[i]) {
        prev = i; prevValue = filled[i];
      } else if (prev >= 0 && nextValid[i] >= 0) {
        var t0 = prev, t1 = nextValid[i];
        filled[i] = prevValue + (filled[t1] - prevValue) * (i - t0) / (t1 - t0);
      } else if (nextValid[i] >= 0) {
        filled[i] = filled[nextValid[i]];
      } else {
        filled[i] = prevValue;
      }
    }
    var first = 0, last = bins - 1;
    while (first < last && !counts[first]) first++;
    while (last > first && !counts[last]) last--;
    var trim = Math.floor((last - first + 1) * 0.03);
    first += trim; last -= trim;
    var profile = [];
    for (i = first; i <= last; i++) {
      profile.push(filled[i]);
    }
    return profile;
  }

  function angleDistance(a, b) {
    var d = Math.abs(a - b) % 180;
    return d > 90 ? 180 - d : d;
  }

  // 用中心区域的亮度梯度估计条纹法线。条纹方向扫描只在此角度附近细化，
  // 可避免规则条纹在斜向投影、插值时产生周期更短但虚假的高分峰。
  function gradientOrientation(signal, width, roi) {
    var stride = Math.max(1, Math.floor(Math.max(roi.width, roi.height) / 500));
    var x0 = roi.x + Math.floor(roi.width * 0.1), x1 = roi.x + Math.ceil(roi.width * 0.9);
    var y0 = roi.y + Math.floor(roi.height * 0.1), y1 = roi.y + Math.ceil(roi.height * 0.9);
    var xx = 0, yy = 0, xy = 0, count = 0;
    for (var y = y0; y < y1; y += stride) {
      for (var x = x0; x < x1; x += stride) {
        var p = y * width + x;
        if (signal[p] < Math.max(8, roi.threshold * 0.6)) continue;
        var dx = signal[p + 1] - signal[p - 1];
        var dy = signal[p + width] - signal[p - width];
        xx += dx * dx; yy += dy * dy; xy += dx * dy; count++;
      }
    }
    if (count < 32 || xx + yy < 1e-9) return { angle: 0, coherence: 0 };
    var angle = 0.5 * Math.atan2(2 * xy, xx - yy) * 180 / Math.PI;
    angle = (angle + 180) % 180;
    var trace = xx + yy, delta = Math.sqrt((xx - yy) * (xx - yy) + 4 * xy * xy);
    return { angle: angle, coherence: trace > 0 ? delta / trace : 0 };
  }

  function searchOrientation(signal, width, height, roi) {
    var P = phys();
    var guide = gradientOrientation(signal, width, roi);
    var area = roi.width * roi.height;
    var stride = Math.max(1, Math.ceil(Math.sqrt(area / 160000)));
    var samples = sampleRoi(signal, width, roi, stride);
    var best = { score: -1, angle: 0, period: NaN };
    function testAngle(deg) {
      var angle = ((deg % 180) + 180) % 180;
      var profile = projectSamples(samples, angle * Math.PI / 180);
      try {
        var r = P.fringePeriod(profile);
        if (!isFinite(r.periodPx) || r.periodPx < 8 || r.periodPx > profile.length / 2) return;
        // 条纹对比度在真实法线方向最高；自相关只作质量门限，避免斜向
        // 插值得到的“更锐利”谱峰压过真实条纹方向。
        var contrast = isFinite(r.visibility) ? r.visibility : 0;
        var score = contrast * (0.5 + 0.5 * (r.acfPeak || 0)) +
                    Math.min(0.01, Math.log(Math.max(1, r.spectralSnr || 1)) / 2000);
        if (score > best.score) best = { score: score, angle: angle, period: r.periodPx };
      } catch (e) { /* 该方向没有稳定峰，继续扫描 */ }
    }
    if (guide.coherence >= 0.15) {
      for (var gd = -10; gd <= 10; gd += 2) testAngle(guide.angle + gd);
    } else {
      for (var deg = 0; deg < 180; deg += 5) testAngle(deg);
    }
    if (!(best.score > 0)) throw new Error('横竖及斜向投影都没有找到周期性条纹');
    var center = best.angle, coarse = best.score;
    best = { score: -1, angle: center, period: NaN };
    for (var delta = -2; delta <= 2; delta += 0.5) testAngle(center + delta);
    if (!(best.score > 0)) best = { score: coarse, angle: center, period: NaN };
    return best;
  }

  /* ---------------- 单条剖面 → Δx（纯函数） ---------------- */
  function analyzeProfile(profile, opts) {
    opts = opts || {};
    var P = phys();
    if (!P || typeof P.fringePeriod !== 'function') {
      throw new Error('core/fringe.js 需要先加载 physics.js');
    }
    var arr = Array.prototype.slice.call(profile);

    // 前置判定：纯平场 / 过曝 / 没对准视场时，fringePeriod 会返回 pow/2 这样的假周期，
    // 必须在这里拦掉，否则用户会拿到一个"看起来合理"的错数。
    var mn = Infinity, mx = -Infinity, i;
    for (i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) throw new Error('剖面里有非数字像素，请重新导出图片');
      if (arr[i] < mn) mn = arr[i];
      if (arr[i] > mx) mx = arr[i];
    }
    if (!(mx - mn > 1e-9)) throw new Error('图像没有明暗变化，未找到周期性条纹');
    var contrast = (mx - mn) / (mx + mn > 0 ? (mx + mn) : 1);
    if (contrast < 0.005) throw new Error('条纹对比度太低（' + (contrast * 100).toFixed(2) + '%），请检查是否过曝或未对准视场');

    var r = P.fringePeriod(arr, { k: opts.k });
    if (!isFinite(r.periodPx) || r.periodPx < 4 || r.periodPx > arr.length / 2) {
      throw new Error('未找到可靠的条纹周期（测得 ' + (isFinite(r.periodPx) ? r.periodPx.toFixed(1) : '—') +
                      ' px），请确认条纹等间距且周期 ≥ 8 像素');
    }
    r.score = scoreOf(r);
    return r;
  }

  // 峰越锐、两种算法越一致，分数越高（用于横竖方向择取）
  function scoreOf(r) {
    if (!r || !isFinite(r.periodPx) || r.periodPx <= 0) return -1;
    var cross = isFinite(r.periodPxCross) ? Math.abs(r.periodPx - r.periodPxCross) / r.periodPx : 1;
    var v = isFinite(r.visibility) ? r.visibility : 0;
    return v / (1 + 10 * cross);
  }

  /* ---------------- 二维图像 → 选方向 → Δx ---------------- */
  function analyzeImageData(data, width, height, opts) {
    opts = opts || {};
    var signal = signalFromImageData(data, width, height);
    // 由外向内尝试四个同心 ROI。视场边缘、暗角和局部反光会污染大 ROI，
    // 但只要中央清晰区域仍满足原有门限，就可以在不放宽标准的前提下提取条纹。
    var scales = [0.78, 0.58, 0.46, 0.36], candidates = [], lastError = null;
    for (var si = 0; si < scales.length; si++) {
      var roi, direction, prof;
      try {
        roi = centerRoi(signal, width, height, scales[si]);
        direction = searchOrientation(signal, width, height, roi);
        var samples = sampleRoi(signal, width, roi, 1);
        prof = projectSamples(samples, direction.angle * Math.PI / 180);
        var candidate = analyzeProfile(prof, opts);
        if ((candidate.acfPeak || 0) < (opts.minAcf || 0.2)) {
          throw new Error('条纹周期性不足（自相关 ' +
                          ((candidate.acfPeak || 0) * 100).toFixed(1) + '%）');
        }
        if ((candidate.spectralSnr || 0) < (opts.minSnr || 3)) {
          throw new Error('条纹频谱峰不够明显（信噪比 ' +
                          (candidate.spectralSnr || 0).toFixed(1) + '）');
        }
        // 至少覆盖三个完整周期，避免过小 ROI 把半周期或边界起伏当成基频。
        if (prof.length / candidate.periodPx < 3) {
          throw new Error('有效条纹区域不足三个周期');
        }
        candidate.direction = direction;
        candidate.profile = prof;
        candidate.roi = roi;
        candidate.roiScale = scales[si];
        candidate.score = scoreOf(candidate);
        candidates.push(candidate);
      } catch (e) {
        lastError = e;
      }
    }
    // 先按周期把同心 ROI 的结果聚类，再优先采用“更多 ROI 支持”的周期。
    // 这样外围单独给出的 77px 低频结构不会压过中外两层共同给出的 35px 真条纹。
    var best = null, bestSupport = 0;
    for (var ci = 0; ci < candidates.length; ci++) {
      if (candidates[ci].used) continue;
      var cluster = [candidates[ci]], totalScore = candidates[ci].score;
      candidates[ci].used = true;
      for (var cj = ci + 1; cj < candidates.length; cj++) {
        if (candidates[cj].used) continue;
        var relativePeriod = Math.abs(candidates[ci].periodPx - candidates[cj].periodPx) /
                             candidates[ci].periodPx;
        if (relativePeriod <= 0.10) {
          candidates[cj].used = true;
          cluster.push(candidates[cj]);
          totalScore += candidates[cj].score;
        }
      }
      var member = cluster.reduce(function (a, b) {
        return !a || b.score > a.score ? b : a;
      }, null);
      var support = cluster.length;
      if (support > bestSupport ||
          (support === bestSupport && totalScore > best.totalSupportScore)) {
        best = member;
        bestSupport = support;
        best.totalSupportScore = totalScore;
      }
    }
    // 中央最内层若独立给出且通过原有质量门限，说明外围周期来自视场边缘；
    // 该结论必须在至少五个完整周期下才生效，防止小块纹理制造短周期。
    if (best && candidates.length > 1) {
      var innermost = candidates.reduce(function (a, b) {
        return b.roiScale < a.roiScale ? b : a;
      }, candidates[0]);
      var innerCross = isFinite(innermost.periodPxCross)
        ? Math.abs(innermost.periodPx - innermost.periodPxCross) / innermost.periodPx
        : 1;
      var innerRelative = Math.abs(innermost.periodPx - best.periodPx) / best.periodPx;
      if (innermost !== best && innerCross <= 0.02 && innerRelative > 0.10 &&
          innermost.profile.length / innermost.periodPx >= 5) {
        best = innermost;
      }
    }
    if (!best) {
      var detail = lastError && /周期性|频谱|条纹/.test(lastError.message)
        ? '；最近原因：' + lastError.message
        : '';
      throw new Error('横竖及斜向都没有找到稳定周期性条纹。请裁到中央黄色视场，并避开蓝斑' + detail);
    }
    var result = best;
    var stripeAngle = (result.direction.angle + 90) % 180;
    result.axis = angleDistance(stripeAngle, 90) <= 12 ? 'x' :
                  (angleDistance(stripeAngle, 0) <= 12 ? 'y' : 'oblique');
    result.directionDeg = result.direction.angle;
    result.stripeAngleDeg = stripeAngle;
    result.roi = best.roi;
    result.signal = 'R/G';
    result.profile = best.profile;
    result.width = width; result.height = height;
    // 可见条纹数只用于数据摘要，不参与 Δx 或波长公式。
    result.stripeCount = Math.max(1, Math.floor(result.profile.length / result.periodPx) + 1);
    result.roiCandidates = candidates.map(function (item) {
      return {
        scale: item.roiScale,
        periodPx: item.periodPx,
        periodPxCross: item.periodPxCross,
        crossDiff: isFinite(item.periodPxCross)
          ? Math.abs(item.periodPx - item.periodPxCross) / item.periodPx
          : 1,
        score: item.score
      };
    });
    return result;
  }

  /* ---------------- 浏览器：文件 → 像素 → Δx ---------------- */
  function canvasOf(w, h) {
    var d = global.document;
    if (d && d.createElement) {
      var c = d.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    if (typeof global.OffscreenCanvas === 'function') return new global.OffscreenCanvas(w, h);
    return null;
  }

  // opts: {k, maxSide}  maxSide 默认 1600，超大图先等比缩小（只影响像素口径，k 需按原图算）
  function pixelDataOf(source, width, height, maxSide) {
    var m = maxSide || 1600;
    var sc = Math.min(1, m / Math.max(width, height));
    var w = Math.max(32, Math.round(width * sc)), h = Math.max(32, Math.round(height * sc));
    var c = canvasOf(w, h);
    if (!c) throw new Error('当前环境不支持 canvas');
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, w, h);
    var img = g.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h, scale: sc };
  }

  function analyzeFile(file, opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      if (typeof global.createImageBitmap === 'function') return global.createImageBitmap(file);
      return new Promise(function (res, rej) {
        var img = new global.Image();
        img.onload = function () { res(img); };
        img.onerror = function () { rej(new Error('图片解码失败')); };
        img.src = global.URL.createObjectURL(file);
      });
    }).then(function (src) {
      var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      var px = pixelDataOf(src, w, h, opts.maxSide);
      // 缩小过的话，像素当量要按缩小比例折算，才能得到原图的 mm
      var kEff = (opts.k && px.scale !== 1) ? opts.k / px.scale : opts.k;
      var r = analyzeImageData(px.data, px.width, px.height, { k: kEff });
      r.scale = px.scale;
      r.sourceSize = { width: w, height: h };
      return r;
    });
  }

  /* ---------------- 多帧统计（表 6.1 的口径） ----------------
   * ⚠ 单帧必须能走通：typeA 要求 ≥2 个值，若直接调它，
   *   一条只有 1 帧的 record.json 就会以"至少需要 2 个测量值"整条导入失败。
   *   n=1 时返回 mean 与 single=true，sd/uA 留 NaN，由页面显示"—"。
   */
  function framesStats(values) {
    // 不能先把 null 转成 0，否则未标定帧会污染多帧均值。
    var v = (values || []).filter(function (x) {
      return finiteNumber(x) !== null;
    }).map(Number);
    if (!v.length) throw new Error('没有可用的帧');
    if (v.length === 1) {
      return { n: 1, mean: v[0], sd: NaN, uA: NaN, relSd: NaN, single: true };
    }
    var P = phys();
    if (!P || typeof P.typeA !== 'function') throw new Error('core/fringe.js 需要先加载 physics.js');
    var a = P.typeA(v);
    return { n: a.n, mean: a.mean, sd: a.sd, uA: a.uA,
             relSd: isFinite(a.relUA) ? a.relUA : (a.mean ? a.sd / a.mean : NaN), single: false };
  }
  /* ---------------- 多帧统计（表 6.1 的口径） ---------------- */
  function analyzeFrames(files, opts) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.reject(new Error('没有选择图片'));
    var per = [];
    return list.reduce(function (p, f) {
      return p.then(function () {
        return analyzeFile(f, opts).then(function (r) {
          per.push({ name: f.name, periodPx: r.periodPx, deltaXmm: r.deltaXmm,
                     visibility: r.visibility, periodPxCross: r.periodPxCross, axis: r.axis });
        }, function (e) { per.push({ name: f.name, error: e.message }); });
      });
    }, Promise.resolve()).then(function () {
      var ok = per.filter(function (x) { return finiteNumber(x.deltaXmm) !== null; });
      if (!ok.length) throw new Error('所有帧都没提取成功');
      var st = framesStats(ok.map(function (x) { return x.deltaXmm; }));
      return { n: st.n, failed: per.length - st.n, meanMm: st.mean, sdMm: st.sd,
               relSd: st.relSd, single: st.single, perFrame: per };
    });
  }

  /* ---------------- 自检：合成已知真值的条纹图并当场提取 ---------------- */
  // opts: {periodPx, visibility, noise, k, axisTest?}
  function selfTest(opts) {
    opts = opts || {};
    var P = opts.periodPx == null ? 163.3 : opts.periodPx;
    var k = opts.k == null ? 0.004 : opts.k;
    var prof = synthesizeProfile({
      n: opts.n || 1600, periodPx: P,
      visibility: opts.visibility == null ? 0.6 : opts.visibility,
      noise: opts.noise == null ? 0.02 : opts.noise,
      seed: opts.seed || 1, gaussEnvelope: true
    });
    var r = analyzeProfile(prof, { k: k });
    var truth = P * k;                       // mm
    r.truth = { periodPx: P, deltaXmm: truth, visibility: opts.visibility == null ? 0.6 : opts.visibility };
    r.relErr = r.deltaXmm ? (r.deltaXmm - truth) / truth : NaN;
    return r;
  }

  BP.fringe = {
    synthesizeProfile: synthesizeProfile,
    profileFromImageData: profileFromImageData,
    analyzeProfile: analyzeProfile,
    analyzeImageData: analyzeImageData,
    analyzeFile: analyzeFile,
    analyzeFrames: analyzeFrames,
    framesStats: framesStats,
    selfTest: selfTest,
    scoreOf: scoreOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BP.fringe;
})(typeof window !== 'undefined' ? window : globalThis);
