/* =========================================================================
 * core/frame-calibration.js —— 同框逐帧分划板标定
 * 依赖：无
 * 说明：刻线间距与条纹周期必须来自同一帧、同一纵向分析带。
 *       为兼容旧脚本，计算仍使用 ES5；所有持久化坐标统一为源图像素。
 * ========================================================================= */
(function (global) {
  'use strict';

  var SCHEMA = 'bp.frame-calibration/1';
  var GEOMETRY_SCHEMA = 'bp.reticle-geometry/1';
  var TICK_SPACING_MM = 1;
  var ACCEPTED = {
    autoAccepted: true,
    manualAccepted: true
  };
  var KNOWN_STATUS = {
    autoAccepted: true,
    manualAccepted: true,
    pending: true,
    rejected: true,
    legacyGlobalK: true
  };

  function finite(value) {
    return value !== null && value !== undefined && value !== '' && isFinite(value);
  }

  function numberOrNull(value) {
    return finite(value) ? Number(value) : null;
  }

  function mean(values) {
    var list = values || [];
    if (!list.length) return null;
    return list.reduce(function (sum, value) { return sum + value; }, 0) / list.length;
  }

  function sampleSd(values, avg) {
    if (!values || values.length < 2 || !finite(avg)) return null;
    var variance = values.reduce(function (sum, value) {
      return sum + (value - avg) * (value - avg);
    }, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function percentileOfGray(gray, sampleStep) {
    var hist = new Uint32Array(256);
    var total = 0;
    for (var i = 0; i < gray.length; i += sampleStep) {
      var value = gray[i];
      value = value < 0 ? 0 : (value > 255 ? 255 : Math.round(value));
      hist[value] += 1;
      total += 1;
    }
    function at(q) {
      var wanted = Math.max(1, Math.round(total * q));
      var acc = 0;
      for (var k = 0; k < hist.length; k++) {
        acc += hist[k];
        if (acc >= wanted) return k;
      }
      return 255;
    }
    return { p40: at(0.40), p95: at(0.95), at: at };
  }

  function boundsOf(counts, minCount) {
    var first = -1;
    var last = -1;
    for (var i = 0; i < counts.length; i++) {
      if (counts[i] >= minCount) {
        if (first < 0) first = i;
        last = i;
      }
    }
    return first < 0 ? null : { start: first, end: last };
  }

  function failure(message, detail) {
    return {
      schema: GEOMETRY_SCHEMA,
      lines: [],
      count: 0,
      spacingPx: null,
      rmsPx: null,
      relativeRms: null,
      warnings: [],
      error: message,
      debug: detail || null
    };
  }

  function lineXAtY(line, y) {
    return line.x + Number(line.slopePxPerPx || 0) * (y - line.referenceY);
  }

  function verticalOverlapRatio(line, band) {
    if (!line || !band || !(band.y1 > band.y0)) return 0;
    var overlap = Math.min(line.y1, band.y1) - Math.max(line.y0, band.y0);
    // 短交叉刻线本身只覆盖局部高度，应以刻线自身高度判断是否与条纹带同框。
    return Math.max(0, overlap) / Math.max(1, line.y1 - line.y0);
  }

  function sameVerticalBand(a, b, fieldHeight) {
    var overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    var shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
    if (overlap < Math.max(4, shorter * 0.55)) return false;
    var centerA = (a.y0 + a.y1) / 2;
    var centerB = (b.y0 + b.y1) / 2;
    return Math.abs(centerA - centerB) <=
      Math.max(fieldHeight * 0.12, shorter * 0.7);
  }

  /* 真实照片常见“水平基线 + 短竖刻线”。短刻线与竖直条纹方向交叉，
   * 因此先在基线上找窄而深的交叉点；贯穿画面的宽条纹在左右邻域中对比弱，会被排除。
   */
  function detectCrossedReticle(data, width, height, options) {
    var n = width * height;
    var gray = new Float32Array(n);
    var x;
    var y;
    var i;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    var rowMean = new Float32Array(height);
    for (y = 0; y < height; y++) {
      var rowSum = 0;
      for (x = 0; x < width; x++) rowSum += gray[y * width + x];
      rowMean[y] = rowSum / width;
    }

    var baselineY = -1;
    var baselineDepth = 0;
    var yStart = Math.max(6, Math.round(height * 0.20));
    var yEnd = Math.min(height - 7, Math.round(height * 0.85));
    for (y = yStart; y <= yEnd; y++) {
      var sideMean = (rowMean[y - 5] + rowMean[y + 5] +
        rowMean[y - 3] + rowMean[y + 3]) / 4;
      var depth = sideMean - rowMean[y];
      if (depth > baselineDepth) {
        baselineDepth = depth;
        baselineY = y;
      }
    }
    if (!(baselineDepth >= 10) || baselineY < 0) return null;

    var verticalRadius = Math.max(18, Math.min(54, Math.round(height * 0.055)));
    var xGap = Math.max(3, Math.round(width / 260));
    var colMean = new Float32Array(width);
    var crossScore = new Float32Array(width);
    for (x = 0; x < width; x++) {
      var sum = 0;
      var count = 0;
      for (y = Math.max(2, baselineY - verticalRadius);
           y <= Math.min(height - 3, baselineY + verticalRadius); y++) {
        sum += gray[y * width + x];
        count += 1;
      }
      colMean[x] = count ? sum / count : 0;
    }
    var maxScore = 0;
    for (x = Math.max(5, Math.round(width * 0.05));
         x <= Math.min(width - 6, Math.round(width * 0.95)); x++) {
      var left = colMean[Math.max(0, x - xGap)];
      var right = colMean[Math.min(width - 1, x + xGap)];
      var score = Math.max(0, (left + right) / 2 - colMean[x]);
      crossScore[x] = score;
      if (score > maxScore) maxScore = score;
    }
    if (!(maxScore >= 5)) return null;

    var threshold = Math.max(3.5, maxScore * 0.30);
    var rawPeaks = [];
    for (x = Math.max(5, Math.round(width * 0.05));
         x <= Math.min(width - 6, Math.round(width * 0.95)); x++) {
      var current = crossScore[x];
      if (current < threshold) continue;
      var localMax = true;
      for (var dx = -2; dx <= 2; dx++) {
        if (crossScore[x + dx] > current) {
          localMax = false;
          break;
        }
      }
      if (!localMax) continue;
      rawPeaks.push({
        x: x,
        referenceY: baselineY,
        slopePxPerPx: 0,
        score: current * verticalRadius * 2,
        area: verticalRadius * 2,
        y0: Math.max(0, baselineY - verticalRadius),
        y1: Math.min(height - 1, baselineY + verticalRadius),
        widthPx: 3,
        heightPx: verticalRadius * 2,
        xAtReferenceY: x
      });
    }
    rawPeaks.sort(function (a, b) { return a.x - b.x; });
    var peaks = [];
    rawPeaks.forEach(function (peak) {
      var last = peaks[peaks.length - 1];
      if (last && peak.x - last.x <= 4) {
        if (peak.score > last.score) peaks[peaks.length - 1] = peak;
      } else {
        peaks.push(peak);
      }
    });
    if (peaks.length < 3) return null;

    /* 密集干涉场会在基线上形成很多间距很小的暗峰；
     * 这种纹理是条纹，不是分划刻线梳，不能继续参与等距拟合。
     */
    var gaps = [];
    for (i = 1; i < peaks.length; i++) gaps.push(peaks[i].x - peaks[i - 1].x);
    gaps.sort(function (a, b) { return a - b; });
    var medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity;
    if (peaks.length >= 8 && medianGap < width * 0.04) return null;

    var minStep = Math.max(14, width * 0.035);
    var maxStep = width * 0.30;
    var best = null;
    for (i = 0; i < peaks.length; i++) {
      for (var j = i + 1; j < peaks.length; j++) {
        for (var gap = 1; gap <= 4; gap++) {
          var stepGuess = (peaks[j].x - peaks[i].x) / gap;
          if (!(stepGuess >= minStep && stepGuess <= maxStep)) continue;
          var tolerance = Math.max(3, stepGuess * 0.10);
          var assigned = [];
          var used = {};
          for (var index = -8; index <= 8; index++) {
            var wanted = peaks[i].x + index * stepGuess;
            if (wanted < 0 || wanted >= width) continue;
            var nearestIndex = -1;
            var nearestError = Infinity;
            for (var candidateIndex = 0; candidateIndex < peaks.length;
                 candidateIndex++) {
              if (used[candidateIndex]) continue;
              var error = Math.abs(peaks[candidateIndex].x - wanted);
              if (error < nearestError) {
                nearestError = error;
                nearestIndex = candidateIndex;
              }
            }
            if (nearestIndex >= 0 && nearestError <= tolerance) {
              used[nearestIndex] = true;
              assigned.push({
                line: peaks[nearestIndex],
                index: index,
                error: nearestError
              });
            }
          }
          if (assigned.length < 3 || assigned.length > 8) continue;
          assigned.sort(function (a, b) { return a.index - b.index; });
          var quality = assigned.reduce(function (sumValue, entry) {
            return sumValue + entry.line.score;
          }, 0) - assigned.reduce(function (sumValue, entry) {
            return sumValue + entry.error;
          }, 0) * 2;
          if (!best || quality > best.quality) {
            best = {
              assigned: assigned,
              quality: quality,
              initialStep: stepGuess
            };
          }
        }
      }
    }
    if (!best) return null;

    var assignedLines = best.assigned;
    var meanIndex = mean(assignedLines.map(function (entry) { return entry.index; }));
    var meanPosition = mean(assignedLines.map(function (entry) {
      return entry.line.x;
    }));
    var numerator = 0;
    var denominator = 0;
    assignedLines.forEach(function (entry) {
      numerator += (entry.index - meanIndex) * (entry.line.x - meanPosition);
      denominator += (entry.index - meanIndex) * (entry.index - meanIndex);
    });
    var step = denominator > 0 ? numerator / denominator : best.initialStep;
    var residualSum = 0;
    var lines = assignedLines.map(function (entry) {
      var fitted = meanPosition + step * (entry.index - meanIndex);
      var error = entry.line.x - fitted;
      residualSum += error * error;
      return {
        index: entry.index,
        x: fitted,
        measuredX: entry.line.x,
        referenceY: baselineY,
        meanY: baselineY,
        slopePxPerPx: 0,
        y0: entry.line.y0,
        y1: entry.line.y1,
        widthPx: entry.line.widthPx,
        heightPx: entry.line.heightPx,
        score: entry.line.score
      };
    });
    var rms = Math.sqrt(residualSum / lines.length);
    var relativeRms = rms / Math.max(1, step);
    if (relativeRms > 0.035) return null;
    var scale = finite(options && options.analysisScale)
      ? Number(options.analysisScale)
      : 1;
    return {
      schema: GEOMETRY_SCHEMA,
      coordinateSpace: 'analysisPixels',
      analysisScale: scale,
      method: 'crossing-ticks',
      lines: lines,
      count: lines.length,
      spacingPx: step,
      rmsPx: rms,
      relativeRms: relativeRms,
      slopeSpread: 0,
      y0: Math.max(0, baselineY - verticalRadius),
      y1: Math.min(height - 1, baselineY + verticalRadius),
      x0: Math.round(width * 0.05),
      x1: Math.round(width * 0.95),
      width: width,
      height: height,
      baselineY: baselineY,
      baselineDepth: baselineDepth,
      warnings: [],
      debug: {
        peaks: peaks.map(function (peak) {
          return {
            x: peak.x,
            y0: peak.y0,
            y1: peak.y1,
            widthPx: peak.widthPx
          };
        })
      }
    };
  }

  /* 识别与条纹带分离的上部短刻线梳。
   * 真实手机照片中，分划线与干涉条纹经常不在同一纵向区域；
   * 这里只收集同帧短竖线，再由局部标定把各线投影到条纹带中心。
   */
  function detectSeparatedReticle(data, width, height, options) {
    var diagnostic = options && options.diagnostic;
    var n = width * height;
    var gray = new Float32Array(n);
    var i;
    var x;
    var y;
    for (i = 0; i < n; i++) {
      var p = i * 4;
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    var regionY0 = Math.max(2, Math.round(height * 0.045));
    var regionY1 = Math.min(height - 3, Math.round(height * 0.40));
    var x0 = 2;
    var x1 = width - 3;
    if (regionY1 - regionY0 < 30 || x1 - x0 < 80) return null;

    var radius = Math.max(9, Math.min(30, Math.round(width * 0.018)));
    var yStep = Math.max(1, Math.round(height / 700));
    var rowIds = [];
    for (y = regionY0; y <= regionY1; y += yStep) rowIds.push(y);
    var rows = rowIds.length;
    var residual = new Float32Array(width * rows);
    var prefix = new Float32Array(width + 1);
    var residualMax = 0;

    for (var ri = 0; ri < rows; ri++) {
      y = rowIds[ri];
      var base = y * width;
      prefix[0] = 0;
      for (x = 0; x < width; x++) prefix[x + 1] = prefix[x] + gray[base + x];
      for (x = x0; x <= x1; x++) {
        var left = Math.max(0, x - radius);
        var right = Math.min(width - 1, x + radius);
        var localMean = (prefix[right + 1] - prefix[left]) / (right - left + 1);
        var dark = localMean - gray[base + x];
        var index = ri * width + x;
        residual[index] = dark > 0 ? dark : 0;
        if (residual[index] > residualMax) residualMax = residual[index];
      }
    }
    if (residualMax < 2.5) return null;

    // 绝对阈值保持对淡刻线的灵敏度；阈值只在很小范围内随图像对比度变化。
    var threshold = Math.max(2.2, Math.min(4.5, residualMax * 0.035));
    var binary = new Uint8Array(width * rows);
    var visited = new Uint8Array(width * rows);
    for (var by = 0; by < rows; by++) {
      for (x = x0; x <= x1; x++) {
        if (residual[by * width + x] >= threshold) binary[by * width + x] = 1;
      }
    }

    var stack = new Int32Array(binary.length);
    var rawCandidates = [];
    for (var seedRow = 0; seedRow < rows; seedRow++) {
      for (x = x0; x <= x1; x++) {
        var seedIndex = seedRow * width + x;
        if (!binary[seedIndex] || visited[seedIndex]) continue;
        var stackSize = 0;
        var area = 0;
        var sumX = 0;
        var sumY = 0;
        var sumXX = 0;
        var sumYY = 0;
        var sumXY = 0;
        var sumScore = 0;
        var minX = x;
        var maxX = x;
        var minRow = seedRow;
        var maxRow = seedRow;
        stack[stackSize++] = seedIndex;
        visited[seedIndex] = 1;
        while (stackSize) {
          var current = stack[--stackSize];
          var cy = Math.floor(current / width);
          var cx = current - cy * width;
          var actualY = rowIds[cy];
          area += 1;
          sumX += cx;
          sumY += actualY;
          sumXX += cx * cx;
          sumYY += actualY * actualY;
          sumXY += cx * actualY;
          sumScore += residual[current];
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minRow = Math.min(minRow, cy);
          maxRow = Math.max(maxRow, cy);
          for (var ndy = -1; ndy <= 1; ndy++) {
            for (var ndx = -1; ndx <= 1; ndx++) {
              if (ndy !== 0 && ndx !== 0) continue;
              var ny = cy + ndy;
              var nx = cx + ndx;
              if (ny < 0 || ny >= rows || nx < x0 || nx > x1) continue;
              var nextIndex = ny * width + nx;
              if (!binary[nextIndex] || visited[nextIndex]) continue;
              visited[nextIndex] = 1;
              stack[stackSize++] = nextIndex;
            }
          }
        }

        var lineWidth = maxX - minX + 1;
        var lineRows = maxRow - minRow + 1;
        var fill = area / (lineWidth * lineRows);
        var rejectedByWidth = lineWidth > Math.max(8, Math.round(width * 0.006));
        var rejectedByRows = lineRows < Math.max(12, Math.round(height * 0.018));
        var rejectedByLongFringe = lineRows > Math.round(height * 0.13);
        var rejectedByAspect = lineRows / lineWidth < 2.2;
        var rejectedByFill = fill < 0.16;
        if (rejectedByWidth || rejectedByRows || rejectedByLongFringe ||
            rejectedByAspect || rejectedByFill) continue;
        var denominator = area * sumYY - sumY * sumY;
        var slope = Math.abs(denominator) > 1e-9
          ? (area * sumXY - sumX * sumY) / denominator
          : 0;
        rawCandidates.push({
          x: sumX / area,
          referenceY: sumY / area,
          slopePxPerPx: slope,
          score: sumScore / area * Math.sqrt(area),
          area: area,
          y0: rowIds[minRow],
          y1: rowIds[maxRow],
          widthPx: lineWidth,
          heightPx: rowIds[maxRow] - rowIds[minRow] + yStep
        });
      }
    }

    rawCandidates.sort(function (a, b) { return a.x - b.x; });
    var peaks = [];
    rawCandidates.forEach(function (item) {
      var last = peaks[peaks.length - 1];
      if (last && item.x - last.x <= 4) {
        var totalArea = last.area + item.area;
        last.x = (last.x * last.area + item.x * item.area) / totalArea;
        last.referenceY =
          (last.referenceY * last.area + item.referenceY * item.area) / totalArea;
        last.slopePxPerPx =
          (last.slopePxPerPx * last.area + item.slopePxPerPx * item.area) / totalArea;
        last.score = Math.max(last.score, item.score);
        last.area = totalArea;
        last.y0 = Math.min(last.y0, item.y0);
        last.y1 = Math.max(last.y1, item.y1);
        last.widthPx = Math.max(last.widthPx, item.widthPx);
        last.heightPx = Math.max(last.heightPx, item.heightPx);
      } else {
        peaks.push(item);
      }
    });
    if (diagnostic) {
      diagnostic.rawCandidateCount = rawCandidates.length;
      diagnostic.candidates = peaks.map(function (line) {
        return {
          x: line.x,
          y0: line.y0,
          y1: line.y1,
          widthPx: line.widthPx,
          score: line.score
        };
      });
    }
    if (peaks.length < 3) return null;

    peaks.forEach(function (line) {
      line.localDensity = peaks.filter(function (other) {
        if (other === line) return false;
        var xGap = Math.abs(other.x - line.x);
        var overlap = Math.min(other.y1, line.y1) - Math.max(other.y0, line.y0);
        var shorter = Math.min(other.y1 - other.y0, line.y1 - line.y0);
        return xGap <= Math.max(24, width * 0.025) &&
          overlap >= Math.max(4, shorter * 0.25);
      }).length;
    });
    var sequencePeaks = peaks.filter(function (line) {
      return line.localDensity < 2;
    });
    if (diagnostic) {
      diagnostic.sequencePeaks = sequencePeaks.map(function (line) {
        return {
          x: line.xAtReferenceY,
          y0: line.y0,
          y1: line.y1,
          widthPx: line.widthPx,
          localDensity: line.localDensity
        };
      });
    }
    if (sequencePeaks.length < 3) return null;

    var referenceY = (regionY0 + regionY1) / 2;
    sequencePeaks.forEach(function (line) {
      line.xAtReferenceY = lineXAtY(line, referenceY);
    });
    sequencePeaks.sort(function (a, b) {
      return a.xAtReferenceY - b.xAtReferenceY;
    });

    var minStep = Math.max(24, width * 0.035);
    var maxStep = width * 0.18;
    var best = null;
    function consider(a, b, gap) {
      if (!(b.xAtReferenceY > a.xAtReferenceY)) return;
      var initialStep = (b.xAtReferenceY - a.xAtReferenceY) / gap;
      if (!(initialStep >= minStep && initialStep <= maxStep)) return;
      var tolerance = Math.max(4, initialStep * 0.08);
      var assigned = [];
      var used = {};
      for (var k = -10; k <= 10; k++) {
        var wanted = a.xAtReferenceY + k * initialStep;
        if (wanted < x0 || wanted > x1) continue;
        var nearest = null;
        var nearestError = Infinity;
        for (var j = 0; j < sequencePeaks.length; j++) {
          if (used[j]) continue;
          var error = Math.abs(sequencePeaks[j].xAtReferenceY - wanted);
          if (error < nearestError) {
            nearestError = error;
            nearest = sequencePeaks[j];
          }
        }
        if (nearest && nearestError <= tolerance) {
          used[sequencePeaks.indexOf(nearest)] = 1;
          assigned.push({ line: nearest, index: k, error: nearestError });
        }
      }
      if (assigned.length < 3 || assigned.length > 8) return;
      assigned.sort(function (u, v) { return u.index - v.index; });
      // 刻线梳必须连续，不能隔几条刻线只取其中几条来凑间距。
      if (assigned[assigned.length - 1].index - assigned[0].index + 1 !==
          assigned.length) return;
      var quality = 0;
      var errorSum = 0;
      var densitySum = 0;
      assigned.forEach(function (entry) {
        quality += Math.pow(entry.line.score, 1.35);
        errorSum += entry.error;
        densitySum += entry.line.localDensity;
      });
      var score = quality * (1 + 0.10 * (assigned.length - 3)) -
        errorSum * 2 - densitySum * 80;
      if (!best || score > best.score) {
        best = {
          score: score,
          initialStep: initialStep,
          assigned: assigned
        };
      }
    }
    for (i = 0; i < sequencePeaks.length; i++) {
      for (var j2 = i + 1; j2 < sequencePeaks.length; j2++) {
        for (var gap = 1; gap <= 4; gap++) {
          consider(sequencePeaks[i], sequencePeaks[j2], gap);
        }
      }
    }
    if (!best) return null;
    if (diagnostic) {
      diagnostic.bestIndices = best.assigned.map(function (entry) {
        return entry.index;
      });
      diagnostic.bestXs = best.assigned.map(function (entry) {
        return entry.line.xAtReferenceY;
      });
    }

    var assigned = best.assigned;
    /* 短刻线各自拟合斜率时噪声较大；用同一帧内刻线梳的稳健中位斜率
     * 统一投影，既保留逐线像素位置，又避免放大高度差误差。
     */
    var rawSlopes = assigned.map(function (entry) {
      return Number(entry.line.slopePxPerPx || 0);
    });
    var sortedSlopes = rawSlopes.slice().sort(function (a, b) { return a - b; });
    var projectionSlope = sortedSlopes[Math.floor(sortedSlopes.length / 2)];
    assigned.forEach(function (entry) {
      entry.line.xAtReferenceY =
        entry.line.x + projectionSlope * (referenceY - entry.line.referenceY);
    });
    var meanIndex = mean(assigned.map(function (entry) { return entry.index; }));
    var meanX = mean(assigned.map(function (entry) {
      return entry.line.xAtReferenceY;
    }));
    var numerator = 0;
    var denominatorK = 0;
    assigned.forEach(function (entry) {
      numerator +=
        (entry.index - meanIndex) * (entry.line.xAtReferenceY - meanX);
      denominatorK +=
        (entry.index - meanIndex) * (entry.index - meanIndex);
    });
    var step = denominatorK > 0 ? numerator / denominatorK : best.initialStep;
    var rms = 0;
    var lines = assigned.map(function (entry) {
      var fitted = meanX + step * (entry.index - meanIndex);
      var error = entry.line.xAtReferenceY - fitted;
      rms += error * error;
      return {
        index: entry.index,
        x: fitted,
        measuredX: entry.line.xAtReferenceY,
        referenceY: referenceY,
        meanY: entry.line.referenceY,
        slopePxPerPx: projectionSlope,
        y0: entry.line.y0,
        y1: entry.line.y1,
        widthPx: entry.line.widthPx,
        heightPx: entry.line.heightPx,
        score: entry.line.score
      };
    });
    rms = Math.sqrt(rms / Math.max(1, lines.length));
    var relativeRms = rms / Math.max(1, step);
    if (diagnostic) {
      diagnostic.step = step;
      diagnostic.relativeRms = relativeRms;
    }
    if (relativeRms > 0.035) return null;
    var slopeSpread =
      Math.max.apply(null, rawSlopes) - Math.min.apply(null, rawSlopes);
    var warnings = ['reticle-band-separated'];
    if (Math.abs(slopeSpread) > 0.025) warnings.push('strong-perspective');
    var scale = finite(options && options.analysisScale)
      ? Number(options.analysisScale)
      : 1;
    return {
      schema: GEOMETRY_SCHEMA,
      coordinateSpace: 'analysisPixels',
      analysisScale: scale,
      method: 'separated-comb',
      lines: lines,
      count: lines.length,
      spacingPx: step,
      rmsPx: rms,
      relativeRms: relativeRms,
      slopeSpread: slopeSpread,
      y0: regionY0,
      y1: regionY1,
      x0: x0,
      x1: x1,
      width: width,
      height: height,
      warnings: warnings,
      debug: {
        peaks: peaks.slice(0, 200).map(function (line) {
          return {
            x: line.xAtReferenceY,
            y0: line.y0,
            y1: line.y1,
            widthPx: line.widthPx,
            localDensity: line.localDensity
          };
        })
      }
    };
  }

  /* 比较两套刻线几何，避免强透视伪交叉线压过更可靠的独立刻线梳。
   * 真实“横基线 + 交叉刻线”仍优先保留，只有在交叉线呈强透视且
   * 分离刻线证据更多、残差更好时才改选后者。
   */
  function chooseReticleGeometry(crossed, separated) {
    if (!crossed) return separated || null;
    if (!separated) return crossed;

    var crossedStrong = Math.abs(Number(crossed.slopeSpread) || 0) > 0.025 ||
      (crossed.warnings || []).indexOf('strong-perspective') >= 0;
    var separatedStrong = Math.abs(Number(separated.slopeSpread) || 0) > 0.025 ||
      (separated.warnings || []).indexOf('strong-perspective') >= 0;
    var crossedRms = finite(crossed.relativeRms)
      ? Number(crossed.relativeRms)
      : Infinity;
    var separatedRms = finite(separated.relativeRms)
      ? Number(separated.relativeRms)
      : Infinity;
    var separatedMoreEvidence = Number(separated.count) >= Number(crossed.count);
    var separatedResidualBetter = separatedRms <= crossedRms * 1.25;

    if (crossedStrong && !separatedStrong &&
        separatedMoreEvidence && separatedResidualBetter) {
      return separated;
    }
    // 三条交叉线本身只够待确认，若同时残差更差，应让四条可靠刻线接管。
    if (Number(crossed.count) === 3 &&
        Number(separated.count) >= 4 &&
        separatedRms <= crossedRms) {
      return separated;
    }
    return crossed;
  }

  /* 纯函数：RGBA 图像 → 分划刻线几何。
   * 先保留窄而连续的暗竖线，再拟合等距序列；算法不读取 DOM 或页面状态。
   */
  function detectReticleGeometry(data, width, height, options) {
    options = options || {};
    if (!data || !(width > 20) || !(height > 20) || data.length < width * height * 4) {
      return failure('图像数据无效');
    }

    var crossed = detectCrossedReticle(data, width, height, options);
    var separated = detectSeparatedReticle(data, width, height, options);
    var chosen = chooseReticleGeometry(
      crossed && crossed.count >= 3 ? crossed : null,
      separated && separated.count >= 3 ? separated : null
    );
    if (chosen) return chosen;

    var n = width * height;
    var gray = new Float32Array(n);
    var i;
    var x;
    var y;
    var p;
    for (i = 0; i < n; i++) {
      p = i * 4;
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    var pct = percentileOfGray(gray, Math.max(1, Math.floor(n / 50000)));
    var fieldThreshold = pct.p40 + 0.35 * Math.max(1, pct.p95 - pct.p40);
    var rowCount = new Uint32Array(height);
    var colCount = new Uint32Array(width);
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        if (gray[y * width + x] > fieldThreshold) {
          rowCount[y] += 1;
          colCount[x] += 1;
        }
      }
    }
    var rb = boundsOf(rowCount, Math.max(6, width * 0.08));
    var cb = boundsOf(colCount, Math.max(6, height * 0.08));
    var fx0 = cb ? cb.start : Math.round(width * 0.05);
    var fx1 = cb ? cb.end : Math.round(width * 0.95);
    var fy0 = rb ? rb.start : Math.round(height * 0.08);
    var fy1 = rb ? rb.end : Math.round(height * 0.62);
    var fieldH = Math.max(1, fy1 - fy0);
    var y0 = Math.max(1, Math.round(fy0 + fieldH * 0.08));
    var y1 = Math.min(height - 2, Math.round(fy0 + fieldH * 0.58));
    var x0 = Math.max(2, fx0);
    var x1 = Math.min(width - 3, fx1);
    if (y1 - y0 < 30 || x1 - x0 < 60) return failure('有效视场过小');

    var radius = Math.max(6, Math.min(20, Math.round(width * 0.012)));
    var yStep = Math.max(1, Math.round(height / 700));
    var rowIds = [];
    for (y = y0; y <= y1; y += yStep) rowIds.push(y);
    var rows = rowIds.length;
    var residual = new Float32Array(width * rows);
    var prefix = new Float32Array(width + 1);
    var rowDark = new Float32Array(width);
    var residualMax = 0;

    for (var ri = 0; ri < rows; ri++) {
      y = rowIds[ri];
      var base = y * width;
      rowDark.fill(0);
      prefix[0] = 0;
      for (x = 0; x < width; x++) prefix[x + 1] = prefix[x] + gray[base + x];
      for (x = x0; x <= x1; x++) {
        var left = Math.max(0, x - radius);
        var right = Math.min(width - 1, x + radius);
        var localMean = (prefix[right + 1] - prefix[left]) / (right - left + 1);
        var dark = localMean - gray[base + x];
        rowDark[x] = dark > 0 ? dark : 0;
      }
      for (x = x0; x <= x1; x++) {
        var q = ri * width + x;
        var ql = x > 0 ? rowDark[x - 1] : 0;
        var qr = x + 1 < width ? rowDark[x + 1] : 0;
        residual[q] = Math.max(rowDark[x], ql, qr);
        if (residual[q] > residualMax) residualMax = residual[q];
      }
      /* 抑制暗线两侧的亮响应晕带，避免刻线与相邻条纹在连通域中粘连。 */
      var rowSnapshot = residual.slice(ri * width, (ri + 1) * width);
      for (x = x0; x <= x1; x++) {
        var isPeak = true;
        for (var nx = Math.max(x0, x - 2); nx <= Math.min(x1, x + 2); nx++) {
          if (rowSnapshot[nx] > rowSnapshot[x]) {
            isPeak = false;
            break;
          }
        }
        if (!isPeak) residual[ri * width + x] = 0;
      }
    }
    if (residualMax < 3.5) return failure('刻线对比度不足');

    var binary = new Uint8Array(width * rows);
    var visited = new Uint8Array(width * rows);
    for (var rbi = 0; rbi < rows; rbi++) {
      var rowMax = 0;
      for (x = x0; x <= x1; x++) {
        rowMax = Math.max(rowMax, residual[rbi * width + x]);
      }
      /* 刻线通常明显暗于条纹；提高相对阈值可避免刻线与相邻条纹粘连。 */
      var rowThreshold = Math.max(1.2, rowMax * 0.58);
      for (x = x0; x <= x1; x++) {
        if (residual[rbi * width + x] >= rowThreshold) {
          binary[rbi * width + x] = 1;
        }
      }
    }

    var stack = new Int32Array(binary.length);
    var rawCandidates = [];
    for (var by = 0; by < rows; by++) {
      for (var bx = x0; bx <= x1; bx++) {
        var seedIndex = by * width + bx;
        if (!binary[seedIndex] || visited[seedIndex]) continue;
        var stackSize = 0;
        var area = 0;
        var sumX = 0;
        var sumY = 0;
        var sumXX = 0;
        var sumYY = 0;
        var sumXY = 0;
        var sumScore = 0;
        var minX = bx;
        var maxX = bx;
        var minRow = by;
        var maxRow = by;
        stack[stackSize++] = seedIndex;
        visited[seedIndex] = 1;
        while (stackSize) {
          var curIndex = stack[--stackSize];
          var cy = Math.floor(curIndex / width);
          var cx = curIndex - cy * width;
          var actualY = rowIds[cy];
          area += 1;
          sumX += cx;
          sumY += actualY;
          sumXX += cx * cx;
          sumYY += actualY * actualY;
          sumXY += cx * actualY;
          sumScore += residual[curIndex];
          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minRow = Math.min(minRow, cy);
          maxRow = Math.max(maxRow, cy);
          for (var ndy = -1; ndy <= 1; ndy++) {
            for (var ndx = -1; ndx <= 1; ndx++) {
              if (ndy !== 0 && ndx !== 0) continue;
              var ny = cy + ndy;
              var nx = cx + ndx;
              if (ny < 0 || ny >= rows || nx < x0 || nx > x1) continue;
              var nextIndex = ny * width + nx;
              if (!binary[nextIndex] || visited[nextIndex]) continue;
              visited[nextIndex] = 1;
              stack[stackSize++] = nextIndex;
            }
          }
        }
        var lineWidth = maxX - minX + 1;
        var lineRows = maxRow - minRow + 1;
        var fill = area / (lineWidth * lineRows);
        var rejectedByWidth = lineWidth > Math.max(8, Math.round(width * 0.012));
        var rejectedByRows = lineRows < Math.max(6, Math.round(rows * 0.04));
        var rejectedByAspect = lineRows / lineWidth < 3;
        var rejectedByFill = fill < 0.22;
        if (rejectedByWidth || rejectedByRows || rejectedByAspect || rejectedByFill) continue;
        var denominator = area * sumYY - sumY * sumY;
        var slope = Math.abs(denominator) > 1e-9
          ? (area * sumXY - sumX * sumY) / denominator
          : 0;
        var refY = sumY / area;
        var refX = sumX / area;
        rawCandidates.push({
          x: refX,
          referenceY: refY,
          slopePxPerPx: slope,
          score: sumScore / area * Math.sqrt(area),
          area: area,
          y0: rowIds[minRow],
          y1: rowIds[maxRow],
          widthPx: lineWidth,
          heightPx: rowIds[maxRow] - rowIds[minRow] + yStep
        });
      }
    }

    rawCandidates.sort(function (a, b) { return a.x - b.x; });
    var peaks = [];
    rawCandidates.forEach(function (item) {
      var last = peaks[peaks.length - 1];
      var overlap = last
        ? Math.min(last.y1, item.y1) - Math.max(last.y0, item.y0)
        : 0;
      var shorter = last ? Math.min(last.y1 - last.y0, item.y1 - item.y0) : 0;
      var verticalGap = last
        ? Math.max(0, Math.max(last.y0, item.y0) - Math.min(last.y1, item.y1))
        : Infinity;
      /* 邻近且上下相接的碎片属于同一刻线；阈值远小于最小刻线间距。 */
      var sameTickFragment = last &&
        item.x - last.x <= 6 &&
        (overlap >= shorter * 0.35 || verticalGap <= yStep * 4);
      if (sameTickFragment) {
        var totalArea = last.area + item.area;
        last.referenceY = (last.referenceY * last.area + item.referenceY * item.area) / totalArea;
        last.x = (last.x * last.area + item.x * item.area) / totalArea;
        last.slopePxPerPx =
          (last.slopePxPerPx * last.area + item.slopePxPerPx * item.area) / totalArea;
        last.score = Math.max(last.score, item.score);
        last.area = totalArea;
        last.y0 = Math.min(last.y0, item.y0);
        last.y1 = Math.max(last.y1, item.y1);
        last.widthPx = Math.max(last.widthPx, item.widthPx);
        last.heightPx = Math.max(last.heightPx, item.heightPx);
      } else {
        peaks.push(item);
      }
    });
    peaks.sort(function (a, b) { return a.x - b.x; });
    if (peaks.length < 3) {
      return failure('候选刻线不足', {
        peakCount: peaks.length,
        maxMean: residualMax,
        peaks: peaks.slice(0, 20).map(function (item) {
          return { x: item.x, y0: item.y0, y1: item.y1, widthPx: item.widthPx };
        })
      });
    }

    /* 干涉暗纹会在很小范围内形成多条竖向候选；真实分划刻线之间则更稀疏。
     * 用横向邻近候选密度排除“条纹碎片拼成的等距梳”，同时保留单独刻线。
     */
    peaks.forEach(function (line) {
      line.localDensity = peaks.filter(function (other) {
        if (other === line) return false;
        var xGap = Math.abs(other.x - line.x);
        var verticalOverlap =
          Math.min(other.y1, line.y1) - Math.max(other.y0, line.y0);
        var shorter = Math.min(other.y1 - other.y0, line.y1 - line.y0);
        return xGap <= Math.max(30, width * 0.035) &&
          verticalOverlap >= Math.max(6, shorter * 0.30);
      }).length;
    });

    var minS = Math.max(12, width * 0.04);
    var maxS = width * 0.30;
    var fieldHeight = Math.max(1, y1 - y0);
    var referenceY = (y0 + y1) / 2;
    peaks.forEach(function (line) {
      line.xAtReferenceY = lineXAtY(line, referenceY);
    });
    peaks.sort(function (a, b) { return a.xAtReferenceY - b.xAtReferenceY; });
    var sequencePeaks = peaks.filter(function (line) {
      return line.localDensity < 2;
    });

    var best = null;
    function consider(a, b, gap) {
      if (!(b.xAtReferenceY > a.xAtReferenceY)) return;
      var initialStep = (b.xAtReferenceY - a.xAtReferenceY) / gap;
      if (!(initialStep >= minS && initialStep <= maxS)) return;
      var tolerance = Math.max(3, initialStep * 0.12);
      var assigned = [];
      var used = {};
      for (var k = -8; k <= 8; k++) {
        var wanted = a.xAtReferenceY + k * initialStep;
        if (wanted < x0 || wanted > x1) continue;
        var nearest = null;
        var nearestError = Infinity;
        for (var j = 0; j < sequencePeaks.length; j++) {
          if (used[j] ||
              !sameVerticalBand(a, sequencePeaks[j], fieldHeight) ||
              !sameVerticalBand(b, sequencePeaks[j], fieldHeight)) continue;
          var error = Math.abs(sequencePeaks[j].xAtReferenceY - wanted);
          if (error < nearestError) {
            nearestError = error;
            nearest = sequencePeaks[j];
          }
        }
        if (nearest && nearestError <= tolerance) {
          used[sequencePeaks.indexOf(nearest)] = 1;
          assigned.push({ line: nearest, index: k, error: nearestError });
        }
      }
      if (assigned.length < 3 || assigned.length > 8) return;
      assigned.sort(function (u, v) { return u.index - v.index; });
      var qualityScore = 0;
      var errorSum = 0;
      assigned.forEach(function (entry) {
        qualityScore += Math.pow(entry.line.score, 1.5);
        errorSum += entry.error;
      });
      var sequenceScore =
        qualityScore * (1 + 0.12 * (assigned.length - 3)) - errorSum * 0.35;
      if (!best || sequenceScore > best.sequenceScore) {
        best = {
          sequenceScore: sequenceScore,
          initialStep: initialStep,
          assigned: assigned
        };
      }
    }
    for (i = 0; i < sequencePeaks.length; i++) {
      for (var j2 = i + 1; j2 < sequencePeaks.length; j2++) {
        for (var gap = 1; gap <= 4; gap++) consider(sequencePeaks[i], sequencePeaks[j2], gap);
      }
    }
    if (!best) {
      return failure('未找到等距刻线', {
        peaks: peaks.slice(0, 200).map(function (line) {
          return {
            x: line.xAtReferenceY,
            y0: line.y0,
            y1: line.y1,
            widthPx: line.widthPx,
            localDensity: line.localDensity
          };
        })
      });
    }

    var assigned = best.assigned;
    var meanIndex = 0;
    var meanX = 0;
    assigned.forEach(function (entry) {
      meanIndex += entry.index;
      meanX += entry.line.xAtReferenceY;
    });
    meanIndex /= assigned.length;
    meanX /= assigned.length;
    var numerator = 0;
    var denominatorK = 0;
    assigned.forEach(function (entry) {
      numerator +=
        (entry.index - meanIndex) * (entry.line.xAtReferenceY - meanX);
      denominatorK +=
        (entry.index - meanIndex) * (entry.index - meanIndex);
    });
    var step = denominatorK > 0 ? numerator / denominatorK : best.initialStep;
    var rms = 0;
    var lines = assigned.map(function (entry) {
      var fitted = meanX + step * (entry.index - meanIndex);
      var error = entry.line.xAtReferenceY - fitted;
      rms += error * error;
      return {
        index: entry.index,
        x: fitted,
        measuredX: entry.line.xAtReferenceY,
        referenceY: referenceY,
        meanY: entry.line.referenceY,
        slopePxPerPx: entry.line.slopePxPerPx,
        y0: entry.line.y0,
        y1: entry.line.y1,
        widthPx: entry.line.widthPx,
        heightPx: entry.line.heightPx,
        score: entry.line.score
      };
    });
    rms = Math.sqrt(rms / Math.max(1, lines.length));
    var relativeRms = rms / Math.max(1, step);
    if (relativeRms > 0.035) {
      return failure('刻线间距一致性不足', {
        spacingPx: step,
        rmsPx: rms,
        relativeRms: relativeRms,
        peaks: peaks.slice(0, 200).map(function (line) {
          return {
            x: line.xAtReferenceY,
            y0: line.y0,
            y1: line.y1,
            widthPx: line.widthPx,
            localDensity: line.localDensity
          };
        })
      });
    }
    var slopes = lines.map(function (line) { return line.slopePxPerPx; });
    var slopeSpread = Math.max.apply(null, slopes) - Math.min.apply(null, slopes);
    var warnings = [];
    if (Math.abs(slopeSpread) > 0.025) warnings.push('strong-perspective');
    return {
      schema: GEOMETRY_SCHEMA,
      coordinateSpace: 'analysisPixels',
      analysisScale: finite(options.analysisScale) ? Number(options.analysisScale) : 1,
      lines: lines,
      count: lines.length,
      spacingPx: step,
      rmsPx: rms,
      relativeRms: relativeRms,
      slopeSpread: slopeSpread,
      y0: y0,
      y1: y1,
      x0: x0,
      x1: x1,
      width: width,
      height: height,
      fieldThreshold: fieldThreshold,
      warnings: warnings,
      debug: {
        peaks: peaks.slice(0, 200).map(function (line) {
          return {
            x: line.xAtReferenceY,
            y0: line.y0,
            y1: line.y1,
            widthPx: line.widthPx,
            localDensity: line.localDensity
          };
        })
      }
    };
  }

  /* 在条纹纵带中心重新计算各刻线横坐标，返回源图像素坐标和同带拟合。 */
  function localScaleAtBand(geometry, fringeBand) {
    if (!geometry || !Array.isArray(geometry.lines) || geometry.lines.length < 3) {
      return {
        ok: false,
        lineCount: geometry && geometry.lines ? geometry.lines.length : 0,
        warnings: ['reticle-lines-insufficient']
      };
    }
    if (!fringeBand || !(fringeBand.y1 > fringeBand.y0)) {
      return { ok: false, lineCount: geometry.count || 0, warnings: ['fringe-band-invalid'] };
    }
    var scale = finite(geometry.analysisScale) && geometry.analysisScale > 0
      ? Number(geometry.analysisScale)
      : 1;
    var band = {
      y0: Number(fringeBand.y0),
      y1: Number(fringeBand.y1)
    };
    var centerY = (band.y0 + band.y1) / 2;
    var overlapRatios = geometry.lines.map(function (line) {
      return verticalOverlapRatio(line, band);
    });
    var overlapRatio = Math.min.apply(null, overlapRatios);
    /* 分离刻线梳使用同一帧内的独立短刻线，再通过各线斜率投影到条纹带中心。
     * 这里不要求纵向区域重叠，但不能跨帧借用或用两点高度差直接相减。
     */
    var bandSeparated = geometry.method === 'separated-comb';
    var overlapPassed = bandSeparated || overlapRatio >= 0.70;
    var positions = geometry.lines.map(function (line) {
      return lineXAtY(line, centerY);
    });
    var actualSpacing = [];
    for (var i = 1; i < positions.length; i++) {
      actualSpacing.push((positions[i] - positions[i - 1]) /
        Math.max(1, geometry.lines[i].index - geometry.lines[i - 1].index));
    }
    var meanIndex = mean(geometry.lines.map(function (line) { return line.index; }));
    var meanPosition = mean(positions);
    var numerator = 0;
    var denominator = 0;
    geometry.lines.forEach(function (line, index) {
      numerator += (line.index - meanIndex) * (positions[index] - meanPosition);
      denominator += (line.index - meanIndex) * (line.index - meanIndex);
    });
    var tickSpacingPx = denominator > 0 ? numerator / denominator : geometry.spacingPx;
    var rms = Math.sqrt(geometry.lines.reduce(function (sum, line, index) {
      var fitted = meanPosition + tickSpacingPx * (line.index - meanIndex);
      return sum + Math.pow(positions[index] - fitted, 2);
    }, 0) / positions.length);
    var relativeRms = rms / Math.max(1, tickSpacingPx);
    var slopeSpread = Math.max.apply(null, geometry.lines.map(function (line) {
      return Number(line.slopePxPerPx || 0);
    })) - Math.min.apply(null, geometry.lines.map(function (line) {
      return Number(line.slopePxPerPx || 0);
    }));
    var warnings = (geometry.warnings || []).slice();
    if (!overlapPassed) warnings.push('reticle-fringe-band-overlap-low');
    if (bandSeparated) warnings.push('reticle-fringe-band-separated-projected');
    if (relativeRms > 0.02) warnings.push('reticle-spacing-consistency-low');
    if (Math.abs(slopeSpread) > 0.025) warnings.push('strong-perspective');
    return {
      ok: overlapPassed && relativeRms <= 0.02,
      lineCount: geometry.lines.length,
      tickSpacingPx: tickSpacingPx / scale,
      sourceSpacingPx: tickSpacingPx / scale,
      analysisSpacingPx: tickSpacingPx,
      linePositionsPx: positions.map(function (position) { return position / scale; }),
      linePositionsAnalysisPx: positions,
      lineSlopesPxPerPx: geometry.lines.map(function (line) {
        return Number(line.slopePxPerPx || 0);
      }),
      fringeBand: {
        y0: band.y0 / scale,
        y1: band.y1 / scale
      },
      overlapRatio: overlapRatio,
      overlapPassed: overlapPassed,
      bandSeparated: bandSeparated,
      rmsPx: rms / scale,
      relativeRms: relativeRms,
      slopeSpread: slopeSpread,
      adjacentSpacingPx: actualSpacing.map(function (value) { return value / scale; }),
      analysisScale: scale,
      warnings: warnings
    };
  }

  function confidenceOf(local) {
    if (!local || !local.ok) return 0;
    var countScore = Math.min(1, (local.lineCount - 2) / 3);
    var residualScore = Math.max(0, 1 - local.relativeRms / 0.02);
    var overlapScore = local.overlapPassed
      ? 1
      : Math.max(0, Math.min(1, local.overlapRatio));
    var perspectiveScore = Math.max(0, 1 - Math.abs(local.slopeSpread || 0) / 0.04);
    return Math.max(0, Math.min(1,
      0.30 * countScore +
      0.30 * residualScore +
      0.25 * overlapScore +
      0.15 * perspectiveScore
    ));
  }

  function baseCalibration(local, options, method, status, source) {
    var tickSpacingMm = finite(options && options.tickSpacingMm)
      ? Number(options.tickSpacingMm)
      : TICK_SPACING_MM;
    var tickSpacingPx = numberOrNull(local && local.tickSpacingPx);
    var kMmPx = tickSpacingPx !== null && tickSpacingPx > 0
      ? tickSpacingMm / tickSpacingPx
      : null;
    return {
      schema: SCHEMA,
      method: method,
      tickSpacingMm: tickSpacingMm,
      tickSpacingPx: tickSpacingPx,
      kMmPx: kMmPx,
      coordinateSpace: 'sourcePixels',
      analysisScale: local && finite(local.analysisScale) ? local.analysisScale : 1,
      lineCount: local ? Number(local.lineCount) || 0 : 0,
      linePositionsPx: local && local.linePositionsPx ? local.linePositionsPx.slice() : [],
      lineSlopesPxPerPx: local && local.lineSlopesPxPerPx
        ? local.lineSlopesPxPerPx.slice()
        : [],
      fringeBand: local && local.fringeBand ? clone(local.fringeBand) : null,
      rmsPx: local ? numberOrNull(local.rmsPx) : null,
      relativeRms: local ? numberOrNull(local.relativeRms) : null,
      confidence: confidenceOf(local),
      status: status,
      source: source,
      warnings: local && local.warnings ? local.warnings.slice() : []
    };
  }

  function calculateLocalCalibration(geometry, fringeBand, options) {
    options = options || {};
    var local = localScaleAtBand(geometry, fringeBand);
    var status = 'rejected';
    var qualityPassed = options.fringeQualityPassed !== false;
    var fringeHarmonic = false;
    var fringePeriodPx = numberOrNull(options.fringePeriodPx);
    if (local && local.ok && fringePeriodPx !== null &&
        fringePeriodPx > 1 &&
        finite(local.analysisSpacingPx) && local.analysisSpacingPx > 0) {
      var harmonicRatio = Number(local.analysisSpacingPx) / fringePeriodPx;
      var nearestHarmonic = Math.round(harmonicRatio);
      /* 分划尺间距若恰为条纹周期的整数倍，通常是把第 2、3…条条纹
       * 当成刻线；即使拟合残差为 0，也不能作为真实像素标定。
       */
      fringeHarmonic = nearestHarmonic >= 1 &&
        Math.abs(harmonicRatio - nearestHarmonic) <=
          Math.max(0.025, nearestHarmonic * 0.008);
      if (fringeHarmonic) {
        local.warnings = (local.warnings || []).concat('reticle-fringe-harmonic');
      }
    }
    if (local && local.ok && qualityPassed) {
      var accepted =
        local.lineCount >= 4 &&
        local.relativeRms <= 0.015 &&
        local.overlapPassed &&
        !fringeHarmonic &&
        !(local.warnings.indexOf('strong-perspective') >= 0);
      var pending =
        local.lineCount === 3 ||
        (local.relativeRms > 0.015 && local.relativeRms <= 0.02) ||
        local.warnings.indexOf('strong-perspective') >= 0;
      status = fringeHarmonic
        ? 'rejected'
        : (accepted ? 'autoAccepted' : (pending ? 'pending' : 'rejected'));
    }
    if (!qualityPassed) local.warnings = (local.warnings || []).concat('fringe-quality-failed');
    var calibration = baseCalibration(local, options, 'auto-same-frame', status, 'auto');
    if (!local || !local.ok || status === 'rejected') {
      if (!calibration.warnings.length) {
        calibration.warnings.push(local && !local.ok ? 'local-scale-rejected' : 'auto-reticle-failed');
      }
    }
    return calibration;
  }

  /*
   * 同一帧先做刻线几何，再按条纹 ROI 的纵向范围复算局部 k。
   * 页面只传分析画布数据，毫米结果和状态均由核心统一生成。
   */
  function calibrateSameFrame(data, width, height, fringeResult, options) {
    options = options || {};
    var geometry = detectReticleGeometry(data, width, height, options);
    var roi = fringeResult && fringeResult.roi;
    var band = roi
      ? {
        y0: Math.max(0, Number(roi.y)),
        y1: Math.min(height, Number(roi.y) + Number(roi.height))
      }
      : null;
    var qualityPassed = !fringeResult ||
      (Number.isFinite(Number(fringeResult.visibility)) &&
        Number(fringeResult.visibility) >= (options.minVisibility || 0.03));
    var calibration = calculateLocalCalibration(geometry, band, Object.assign({}, options, {
      fringeQualityPassed: qualityPassed,
      analysisScale: options.analysisScale,
      fringePeriodPx: fringeResult && numberOrNull(fringeResult.periodPx)
    }));
    calibration.fringeBand = band;
    calibration.geometryError = geometry && geometry.error ? geometry.error : null;
    calibration.detectedLineCount = geometry && Number(geometry.count) || 0;
    return {
      calibration: calibration,
      geometry: geometry
    };
  }

  /* 人工点选两条相邻主刻线；把两点投影到同一高度，得到条纹横向测量所需像素间距。 */
  function applyManualReticle(width, height, firstPoint, secondPoint, options) {
    options = options || {};
    if (!firstPoint || !secondPoint ||
        !finite(firstPoint.x) || !finite(firstPoint.y) ||
        !finite(secondPoint.x) || !finite(secondPoint.y)) {
      throw new Error('请在同一帧点选两条相邻主刻线');
    }
    var slope = finite(options.slopePxPerPx) ? Number(options.slopePxPerPx) : 0;
    var dx = Number(secondPoint.x) - Number(firstPoint.x);
    var dy = Number(secondPoint.y) - Number(firstPoint.y);
    var horizontalSpacing = Math.abs(dx - slope * dy);
    if (!(horizontalSpacing > 0)) throw new Error('两条刻线点击位置重合');
    var tickSpacingMm = finite(options.tickSpacingMm)
      ? Number(options.tickSpacingMm)
      : TICK_SPACING_MM;
    var warnings = [];
    if (!finite(options.slopePxPerPx)) warnings.push('manual-slope-not-available-horizontal-fallback');
    if (horizontalSpacing < width * 0.04 || horizontalSpacing > width * 0.30) {
      warnings.push('manual-spacing-outside-geometry-range');
    }
    if (Math.abs(dy) > horizontalSpacing * 0.35 &&
        !finite(options.slopePxPerPx)) {
      warnings.push('manual-height-difference-large');
    }
    var manualSpacingValid =
      horizontalSpacing >= Math.max(2, width * 0.01) &&
      horizontalSpacing <= width * 0.50;
    var local = {
      ok: manualSpacingValid,
      lineCount: 2,
      tickSpacingPx: horizontalSpacing,
      linePositionsPx: [Number(firstPoint.x), Number(secondPoint.x)],
      lineSlopesPxPerPx: [slope, slope],
      fringeBand: options.fringeBand ? clone(options.fringeBand) : null,
      overlapRatio: 1,
      rmsPx: 0,
      relativeRms: 0,
      slopeSpread: 0,
      analysisScale: 1,
      warnings: warnings
    };
    var calibration = baseCalibration(
      local,
      options,
      'manual-same-frame',
      local.ok ? 'manualAccepted' : 'rejected',
      'manual'
    );
    calibration.manual = {
      firstPoint: { x: Number(firstPoint.x), y: Number(firstPoint.y) },
      secondPoint: { x: Number(secondPoint.x), y: Number(secondPoint.y) },
      slopePxPerPx: slope,
      acceptedAt: new Date().toISOString()
    };
    calibration.sourceWidth = Number(width) || null;
    calibration.sourceHeight = Number(height) || null;
    return calibration;
  }

  /* 在人工点击邻域内逐行寻找暗刻线中心，再线性拟合 x(y)。
   * 返回源图或分析图中的“横向像素 / 纵向像素”斜率；证据不足时返回 null。
   */
  function estimateLineSlopeAt(data, width, height, point, options) {
    options = options || {};
    if (!data || !(width > 20) || !(height > 20) ||
        data.length < width * height * 4 || !point ||
        !finite(point.x) || !finite(point.y)) {
      return null;
    }
    var radius = Math.max(8, Math.min(40, Math.round(
      finite(options.radius) ? Number(options.radius) : 18
    )));
    var searchRadius = Math.max(3, Math.min(24, Math.round(
      finite(options.searchRadius)
        ? Number(options.searchRadius)
        : Math.max(5, radius * 0.45)
    )));
    var centerX = Math.round(Number(point.x));
    var centerY = Math.round(Number(point.y));
    var y0 = Math.max(5, centerY - radius);
    var y1 = Math.min(height - 6, centerY + radius);
    if (y1 - y0 < 8) return null;

    var gray = new Float32Array(width * height);
    for (var i = 0; i < gray.length; i++) {
      var p = i * 4;
      gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    var localRadius = Math.max(6, Math.min(18, Math.round(radius * 0.60)));
    var samples = [];
    var weakRows = 0;
    for (var y = y0; y <= y1; y++) {
      var left = Math.max(0, centerX - searchRadius - localRadius);
      var right = Math.min(width - 1, centerX + searchRadius + localRadius);
      var meanSum = 0;
      var meanCount = 0;
      for (var mx = left; mx <= right; mx++) {
        meanSum += gray[y * width + mx];
        meanCount += 1;
      }
      var localMean = meanCount ? meanSum / meanCount : 0;
      var bestX = -1;
      var bestScore = 0;
      for (var x = Math.max(1, centerX - searchRadius);
           x <= Math.min(width - 2, centerX + searchRadius); x++) {
        // 用左右窄邻域均值抑制孤立噪声，同时保留细暗线峰值。
        var side = (gray[y * width + x - 1] + gray[y * width + x + 1]) / 2;
        var score = Math.max(0, localMean - gray[y * width + x], side - gray[y * width + x]);
        if (score > bestScore) {
          bestScore = score;
          bestX = x;
        }
      }
      if (bestX < 0 || bestScore < 8) {
        weakRows += 1;
        continue;
      }
      var threshold = bestScore * 0.45;
      var lo = bestX;
      var hi = bestX;
      while (lo > Math.max(1, centerX - searchRadius) &&
             localMean - gray[y * width + lo - 1] >= threshold) lo -= 1;
      while (hi < Math.min(width - 2, centerX + searchRadius) &&
             localMean - gray[y * width + hi + 1] >= threshold) hi += 1;
      samples.push({ x: (lo + hi) / 2, y: y });
    }
    if (samples.length < Math.max(8, Math.round((y1 - y0 + 1) * 0.55))) return null;

    // 先做一次线性拟合，再剔除明显离群行后重新拟合。
    function fit(list) {
      var meanY = mean(list.map(function (sample) { return sample.y; }));
      var meanX = mean(list.map(function (sample) { return sample.x; }));
      var num = 0;
      var den = 0;
      list.forEach(function (sample) {
        num += (sample.y - meanY) * (sample.x - meanX);
        den += (sample.y - meanY) * (sample.y - meanY);
      });
      return den > 0 ? num / den : null;
    }
    var firstSlope = fit(samples);
    if (!finite(firstSlope)) return null;
    var inliers = samples.filter(function (sample) {
      var meanY = mean(samples.map(function (item) { return item.y; }));
      var meanX = mean(samples.map(function (item) { return item.x; }));
      var predicted = meanX + firstSlope * (sample.y - meanY);
      return Math.abs(sample.x - predicted) <= 1.5;
    });
    if (inliers.length < samples.length * 0.60) return null;
    var slope = fit(inliers);
    if (!finite(slope) || Math.abs(slope) > 1.5) return null;
    return slope;
  }

  function calibrationStatus(frame) {
    if (!frame) return 'rejected';
    if (frame.localCalibration && KNOWN_STATUS[frame.localCalibration.status]) {
      return frame.localCalibration.status;
    }
    if (KNOWN_STATUS[frame.calibrationStatus]) return frame.calibrationStatus;
    return 'legacyGlobalK';
  }

  function isFormalFrame(frame) {
    var status = calibrationStatus(frame);
    return !!frame &&
      frame.excluded !== true &&
      (status === 'autoAccepted' || status === 'manualAccepted') &&
      numberOrNull(frame.deltaXmm) !== null &&
      Number(frame.deltaXmm) > 0;
  }

  function attachLocalCalibration(frame, calibration) {
    var result = Object.assign({}, frame || {});
    result.localCalibration = calibration || null;
    result.calibrationStatus = calibration ? calibration.status : 'rejected';
    var deltaXPx = numberOrNull(result.deltaXPx);
    var kMmPx = calibration ? numberOrNull(calibration.kMmPx) : null;
    if (deltaXPx !== null && deltaXPx > 0 &&
        kMmPx !== null && kMmPx > 0 &&
        (calibration.status === 'autoAccepted' ||
          calibration.status === 'manualAccepted')) {
      result.deltaXmm = deltaXPx * kMmPx;
    } else {
      result.deltaXmm = null;
    }
    return result;
  }

  function summarizeLocalCalibrations(frames) {
    var list = frames || [];
    var accepted = list.filter(isFormalFrame);
    var values = accepted.map(function (frame) { return Number(frame.deltaXmm); });
    var kValues = accepted.map(function (frame) {
      return numberOrNull(frame.localCalibration && frame.localCalibration.kMmPx);
    }).filter(function (value) { return value !== null && value > 0; });
    var stripeValues = accepted.map(function (frame) {
      return numberOrNull(frame.stripeCount);
    }).filter(function (value) { return value !== null && value > 0; });
    var avg = mean(values);
    var sd = sampleSd(values, avg);
    return {
      n: values.length,
      meanMm: avg,
      sdMm: sd,
      uAMm: sd === null ? null : sd / Math.sqrt(values.length),
      cv: avg && sd !== null ? sd / avg : null,
      meanStripeCount: mean(stripeValues),
      autoAccepted: accepted.filter(function (frame) {
        return calibrationStatus(frame) === 'autoAccepted';
      }).length,
      manualAccepted: accepted.filter(function (frame) {
        return calibrationStatus(frame) === 'manualAccepted';
      }).length,
      pending: list.filter(function (frame) {
        return calibrationStatus(frame) === 'pending';
      }).length,
      rejected: list.filter(function (frame) {
        return calibrationStatus(frame) === 'rejected';
      }).length,
      legacyGlobalK: list.filter(function (frame) {
        return calibrationStatus(frame) === 'legacyGlobalK';
      }).length,
      kMinMmPx: kValues.length ? Math.min.apply(null, kValues) : null,
      kMaxMmPx: kValues.length ? Math.max.apply(null, kValues) : null,
      kMeanMmPx: mean(kValues)
    };
  }

  function statusLabel(status) {
    return {
      autoAccepted: '自动合格',
      manualAccepted: '人工确认',
      pending: '待确认',
      rejected: '已拒绝',
      legacyGlobalK: '旧全局 k，仅历史参考'
    }[status] || status;
  }

  var API = {
    SCHEMA: SCHEMA,
    GEOMETRY_SCHEMA: GEOMETRY_SCHEMA,
    TICK_SPACING_MM: TICK_SPACING_MM,
    detectReticleGeometry: detectReticleGeometry,
    detectSeparatedReticle: detectSeparatedReticle,
    chooseReticleGeometry: chooseReticleGeometry,
    estimateLineSlopeAt: estimateLineSlopeAt,
    localScaleAtBand: localScaleAtBand,
    calculateLocalCalibration: calculateLocalCalibration,
    calibrateSameFrame: calibrateSameFrame,
    applyManualReticle: applyManualReticle,
    attachLocalCalibration: attachLocalCalibration,
    summarizeLocalCalibrations: summarizeLocalCalibrations,
    calibrationStatus: calibrationStatus,
    isFormalFrame: isFormalFrame,
    statusLabel: statusLabel,
    lineXAtY: lineXAtY
  };

  global.BP = global.BP || {};
  global.BP.frameCalibration = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
