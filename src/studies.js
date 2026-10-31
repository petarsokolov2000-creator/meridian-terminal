// Technical studies over arrays of closes (or bars). Leading values are null.

export function sma(xs, n) {
  const out = new Array(xs.length).fill(null);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i];
    if (i >= n) s -= xs[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(xs, n) {
  const out = new Array(xs.length).fill(null);
  const k = 2 / (n + 1);
  let e = null;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] == null) continue;
    e = e == null ? xs[i] : xs[i] * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}

export function bollinger(xs, n = 20, k = 2) {
  const mid = sma(xs, n);
  const up = mid.map(() => null);
  const dn = mid.map(() => null);
  for (let i = n - 1; i < xs.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (xs[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    up[i] = mid[i] + k * sd;
    dn[i] = mid[i] - k * sd;
  }
  return { mid, up, dn };
}

export function rsi(xs, n = 14) {
  const out = new Array(xs.length).fill(null);
  let g = 0;
  let l = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    const up = Math.max(d, 0);
    const dn = Math.max(-d, 0);
    if (i <= n) {
      g += up / n;
      l += dn / n;
      if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

export function macd(xs, a = 12, b = 26, c = 9) {
  const fa = ema(xs, a);
  const fb = ema(xs, b);
  const line = xs.map((_, i) => (fa[i] != null && fb[i] != null ? fa[i] - fb[i] : null));
  const firstIdx = line.findIndex((v) => v != null);
  const sig = new Array(xs.length).fill(null);
  if (firstIdx >= 0) {
    const s = ema(line.slice(firstIdx), c);
    for (let i = 0; i < s.length; i++) sig[firstIdx + i] = s[i];
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, sig, hist };
}

export function vwap(bars) {
  let pv = 0;
  let v = 0;
  return bars.map((b) => {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * (b.v || 1);
    v += b.v || 1;
    return pv / v;
  });
}

export function logReturns(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push(Math.log(xs[i] / xs[i - 1]));
  return out;
}

export function diffs(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
  return out;
}

export function corr(a, b) {
  const n = Math.min(a.length, b.length);
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let c = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    c += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  return c / Math.sqrt(vx * vy);
}

export function linreg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let c = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    c += (xs[i] - mx) * (ys[i] - my);
    v += (xs[i] - mx) ** 2;
  }
  const slope = c / v;
  return { slope, intercept: my - slope * mx, r: corr(xs, ys) };
}
