// CellHub Intelligence — Statistical Utilities

export function movingAverage(data: number[], window: number): number[] {
  if (data.length < window) return data;
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) {
      result.push(data[i]);
    } else {
      const slice = data.slice(i - window + 1, i + 1);
      const sum = slice.reduce((a, b) => a + b, 0);
      result.push(sum / window);
    }
  }
  return result;
}

export function weightedMovingAverage(data: number[], window: number): number[] {
  if (data.length < window) return data;
  const weights = Array.from({ length: window }, (_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) {
      result.push(data[i]);
    } else {
      let weightedSum = 0;
      for (let j = 0; j < window; j++) {
        weightedSum += data[i - window + 1 + j] * weights[j];
      }
      result.push(weightedSum / weightSum);
    }
  }
  return result;
}

export function standardDeviation(data: number[]): number {
  if (data.length === 0) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const squaredDiffs = data.map(x => Math.pow(x - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / data.length;
  return Math.sqrt(avgSquaredDiff);
}

export function percentile(data: number[], p: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

export function linearRegression(data: [number, number][]): { slope: number; intercept: number; r2: number } {
  if (data.length < 2) return { slope: 0, intercept: 0, r2: 0 };
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (const [x, y] of data) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTotal = 0, ssResidual = 0;
  for (const [x, y] of data) {
    const predicted = slope * x + intercept;
    ssTotal += Math.pow(y - meanY, 2);
    ssResidual += Math.pow(y - predicted, 2);
  }
  const r2 = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;
  return { slope, intercept, r2 };
}

export function median(data: number[]): number {
  return percentile(data, 50);
}

export function zScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

export function exponentialSmoothing(data: number[], alpha: number): number[] {
  if (data.length === 0) return [];
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

export function correlationCoefficient(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumXX = x.reduce((a, b) => a + b * b, 0);
  const sumYY = y.reduce((a, b) => a + b * b, 0);
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function calculateGrowthRate(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export function movingSum(data: number[], window: number): number[] {
  if (data.length < window) return data;
  const result: number[] = [];
  let windowSum = data.slice(0, window).reduce((a, b) => a + b, 0);
  result.push(windowSum);
  for (let i = window; i < data.length; i++) {
    windowSum = windowSum - data[i - window] + data[i];
    result.push(windowSum);
  }
  return result;
}