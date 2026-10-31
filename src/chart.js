// Canvas charting: a price chart with studies, crosshair, zoom and pan, and an XY plot
// for curves and scatters. Colours come from CSS custom properties on the panel.

import { sma, ema, bollinger, rsi, macd, vwap } from './studies.js';

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

class Surface {
  constructor(host) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(50, Math.floor(r.width));
    this.h = Math.max(50, Math.floor(r.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render?.();
  }
  colors() {
    const h = this.host;
    return {
      bg: css(h, '--chart-bg') || '#000',
      grid: css(h, '--chart-grid') || '#222',
      text: css(h, '--chart-text') || '#aaa',
      up: css(h, '--up') || '#2c2',
      down: css(h, '--down') || '#e33',
      line: css(h, '--accent') || '#fa0',
      cross: css(h, '--chart-cross') || '#888',
      series: [css(h, '--s1'), css(h, '--s2'), css(h, '--s3'), css(h, '--s4'), css(h, '--s5'), css(h, '--s6')],
    };
  }
  destroy() {
    this.ro.disconnect();
    this.canvas.remove();
  }
}

export class PriceChart extends Surface {
  constructor(host, { onHover } = {}) {
    super(host);
    this.view = null; // [start, end) bar indices
    this.mouse = null;
    this.onHover = onHover;
    this.opts = { type: 'candle', studies: {}, dp: 2, compare: [] };
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (this.drag) {
        const per = (this.plotW || 1) / (this.view[1] - this.view[0]);
        const shift = Math.round((this.drag.x - this.mouse.x) / per);
        this.setView(this.drag.view[0] + shift, this.drag.view[1] + shift);
      }
      this.render();
    });
    c.addEventListener('mouseleave', () => {
      this.mouse = null;
      this.drag = null;
      this.render();
    });
    c.addEventListener('mousedown', (e) => {
      this.drag = { x: e.offsetX, view: [...this.view] };
    });
    window.addEventListener('mouseup', () => (this.drag = null));
    c.addEventListener('wheel', (e) => {
      if (!this.view) return;
      e.preventDefault();
      const [a, b] = this.view;
      const n = b - a;
      const nn = Math.round(Math.max(15, Math.min(this.bars.length, n * (e.deltaY > 0 ? 1.15 : 0.87))));
      const anchor = this.mouse ? a + ((this.mouse.x - this.padL) / this.plotW) * n : b;
      const ratio = (anchor - a) / n;
      const na = Math.round(anchor - ratio * nn);
      this.setView(na, na + nn);
      this.render();
    }, { passive: false });
  }

  setView(a, b) {
    const n = this.bars.length;
    const len = b - a;
    if (b > n) [a, b] = [n - len, n];
    if (a < 0) [a, b] = [0, Math.min(n, len)];
    this.view = [a, b];
  }

  // bars: [{o,h,l,c,v}], label(i) -> string for the x axis
  setData(bars, opts = {}) {
    const keepView = this.view && this.bars && this.bars.length && opts.keepView;
    const atEnd = keepView && this.view[1] >= this.bars.length;
    this.bars = bars;
    this.opts = { ...this.opts, ...opts };
    const closes = bars.map((b) => b.c);
    const s = this.opts.studies;
    this.calc = {
      sma: (s.sma || []).map((n) => ({ n, v: sma(closes, n) })),
      ema: (s.ema || []).map((n) => ({ n, v: ema(closes, n) })),
      bb: s.bb ? bollinger(closes, 20, 2) : null,
      rsi: s.rsi ? rsi(closes, 14) : null,
      macd: s.macd ? macd(closes) : null,
      vwap: s.vwap ? vwap(bars) : null,
    };
    if (!keepView) {
      const n = Math.min(bars.length, this.opts.window || bars.length);
      this.view = [bars.length - n, bars.length];
    } else if (atEnd) {
      const len = this.view[1] - this.view[0];
      this.setView(bars.length - len, bars.length);
    }
    this.render();
  }

  render() {
    if (!this.bars || !this.bars.length) return;
    const { ctx, w, h } = this;
    const C = this.colors();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px var(--mono), ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const s = this.opts.studies;
    const subs = [s.rsi && 'rsi', s.macd && 'macd'].filter(Boolean);
    const padL = 6;
    const padR = 68;
    const padT = 18;
    const axisH = 18;
    const subH = subs.length ? Math.min(90, (h - padT - axisH) * 0.22) : 0;
    const mainH = h - padT - axisH - subs.length * subH;
    this.padL = padL;
    this.plotW = w - padL - padR;
    const [a, b] = this.view;
    const vis = this.bars.slice(a, b);
    const n = b - a;
    const per = this.plotW / n;
    const xOf = (i) => padL + (i - a + 0.5) * per;
    const compare = this.opts.compare || [];
    const pctMode = compare.length > 0;
    const base = vis[0].c;
    const tf = pctMode ? (v) => (v / base - 1) * 100 : (v) => v;

    // y-range
    let lo = Infinity;
    let hi = -Infinity;
    vis.forEach((bar) => {
      lo = Math.min(lo, tf(pctMode ? bar.c : bar.l));
      hi = Math.max(hi, tf(pctMode ? bar.c : bar.h));
    });
    if (!pctMode) {
      for (const st of [...this.calc.sma, ...this.calc.ema]) st.v.slice(a, b).forEach((v) => v != null && ((lo = Math.min(lo, v)), (hi = Math.max(hi, v))));
      if (this.calc.bb) for (let i = a; i < b; i++) if (this.calc.bb.up[i] != null) { lo = Math.min(lo, this.calc.bb.dn[i]); hi = Math.max(hi, this.calc.bb.up[i]); }
    }
    for (const cs of compare) {
      const b0 = cs.closes[a];
      cs.closes.slice(a, b).forEach((v) => {
        const p = (v / b0 - 1) * 100;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      });
    }
    if (hi === lo) { hi += 1; lo -= 1; }
    const padY = (hi - lo) * 0.06;
    lo -= padY;
    hi += padY;
    const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * mainH;
    this.yInv = (y) => lo + (1 - (y - padT) / mainH) * (hi - lo);

    // grid + right axis
    const step = niceStep(hi - lo, mainH / 42);
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.text;
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(pctMode ? `${v.toFixed(step < 1 ? 1 : 0)}%` : fmtAxis(v, step), w - padR + 6, y);
    }
    // x labels
    const label = this.opts.label || ((i) => String(i));
    const every = Math.max(1, Math.ceil(n / (this.plotW / 80)));
    ctx.textAlign = 'center';
    for (let i = a; i < b; i++) {
      if ((i - a) % every !== 0) continue;
      const x = Math.round(xOf(i)) + 0.5;
      if (x < padL + 22) continue; // a label this close to the edge would be clipped
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h - axisH);
      ctx.stroke();
      ctx.fillText(label(i), x, h - axisH / 2);
    }

    // volume overlay
    if (s.vol !== false && !pctMode) {
      const vmax = Math.max(...vis.map((x) => x.v || 0));
      if (vmax > 0) {
        const vh = mainH * 0.18;
        for (let i = a; i < b; i++) {
          const bar = this.bars[i];
          const hh = ((bar.v || 0) / vmax) * vh;
          ctx.fillStyle = bar.c >= bar.o ? C.up : C.down;
          ctx.globalAlpha = 0.28;
          ctx.fillRect(xOf(i) - per * 0.35, padT + mainH - hh, Math.max(1, per * 0.7), hh);
        }
        ctx.globalAlpha = 1;
      }
    }

    // Bollinger band fill
    if (this.calc.bb && !pctMode) {
      const { up, dn, mid } = this.calc.bb;
      ctx.beginPath();
      let started = false;
      for (let i = a; i < b; i++) if (up[i] != null) { started ? ctx.lineTo(xOf(i), yOf(up[i])) : ctx.moveTo(xOf(i), yOf(up[i])); started = true; }
      for (let i = b - 1; i >= a; i--) if (dn[i] != null) ctx.lineTo(xOf(i), yOf(dn[i]));
      ctx.closePath();
      ctx.fillStyle = C.series[2];
      ctx.globalAlpha = 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.polyline(mid, a, b, xOf, yOf, C.series[2], 1, [3, 3]);
    }

    // price
    const type = pctMode ? 'line' : this.opts.type;
    if (type === 'candle' || type === 'ohlc') {
      const bw = Math.max(1, per * 0.68);
      for (let i = a; i < b; i++) {
        const bar = this.bars[i];
        const up = bar.c >= bar.o;
        ctx.strokeStyle = ctx.fillStyle = up ? C.up : C.down;
        const x = Math.round(xOf(i)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, yOf(bar.h));
        ctx.lineTo(x, yOf(bar.l));
        ctx.stroke();
        if (type === 'candle') {
          const y1 = yOf(Math.max(bar.o, bar.c));
          const y2 = yOf(Math.min(bar.o, bar.c));
          ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
        } else {
          ctx.beginPath();
          ctx.moveTo(x - bw / 2, yOf(bar.o));
          ctx.lineTo(x, yOf(bar.o));
          ctx.moveTo(x, yOf(bar.c));
          ctx.lineTo(x + bw / 2, yOf(bar.c));
          ctx.stroke();
        }
      }
    } else {
      const vals = this.bars.map((x) => tf(x.c));
      if (type === 'area') {
        ctx.beginPath();
        ctx.moveTo(xOf(a), padT + mainH);
        for (let i = a; i < b; i++) ctx.lineTo(xOf(i), yOf(vals[i]));
        ctx.lineTo(xOf(b - 1), padT + mainH);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, padT, 0, padT + mainH);
        g.addColorStop(0, C.line + '55');
        g.addColorStop(1, C.line + '00');
        ctx.fillStyle = g;
        ctx.fill();
      }
      this.polyline(vals, a, b, xOf, yOf, C.line, 1.6);
    }
    for (const [k, cs] of compare.entries()) {
      const b0 = cs.closes[a];
      this.polyline(cs.closes.map((v) => (v / b0 - 1) * 100), a, b, xOf, yOf, C.series[(k + 1) % C.series.length], 1.3);
    }
    if (!pctMode) {
      this.calc.sma.forEach((st, k) => this.polyline(st.v, a, b, xOf, yOf, C.series[(k + 1) % 6], 1.2));
      this.calc.ema.forEach((st, k) => this.polyline(st.v, a, b, xOf, yOf, C.series[(k + 3) % 6], 1.2, [5, 3]));
      if (this.calc.vwap) this.polyline(this.calc.vwap, a, b, xOf, yOf, C.series[4], 1.2, [2, 2]);
    }

    // last price marker
    const last = this.bars[this.bars.length - 1];
    if (b === this.bars.length) {
      const ly = yOf(tf(last.c));
      ctx.fillStyle = last.c >= (this.opts.ref ?? this.bars[0].o) ? C.up : C.down;
      ctx.fillRect(w - padR + 1, ly - 8, padR - 2, 16);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      ctx.fillText(pctMode ? `${tf(last.c).toFixed(2)}%` : last.c.toFixed(this.opts.dp), w - padR + 5, ly);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(padL, ly);
      ctx.lineTo(w - padR, ly);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // sub-panes
    let top = padT + mainH;
    for (const sub of subs) {
      const y0 = top + 4;
      const y1 = top + subH - 2;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(padL, top + 0.5);
      ctx.lineTo(w - padR, top + 0.5);
      ctx.stroke();
      if (sub === 'rsi') {
        const yR = (v) => y0 + (1 - v / 100) * (y1 - y0);
        ctx.fillStyle = C.text;
        ctx.textAlign = 'left';
        for (const lv of [30, 70]) {
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(padL, yR(lv));
          ctx.lineTo(w - padR, yR(lv));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillText(String(lv), w - padR + 6, yR(lv));
        }
        this.polyline(this.calc.rsi, a, b, xOf, yR, C.series[1], 1.2);
        ctx.fillText('RSI 14', padL + 4, y0 + 6);
      } else {
        const { line, sig, hist } = this.calc.macd;
        let m = 1e-9;
        for (let i = a; i < b; i++) for (const v of [line[i], sig[i], hist[i]]) if (v != null) m = Math.max(m, Math.abs(v));
        const yM = (v) => (y0 + y1) / 2 - (v / m) * ((y1 - y0) / 2);
        for (let i = a; i < b; i++) {
          if (hist[i] == null) continue;
          ctx.fillStyle = hist[i] >= 0 ? C.up : C.down;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(xOf(i) - per * 0.35, Math.min(yM(0), yM(hist[i])), Math.max(1, per * 0.7), Math.abs(yM(hist[i]) - yM(0)));
        }
        ctx.globalAlpha = 1;
        this.polyline(line, a, b, xOf, yM, C.series[0], 1.2);
        this.polyline(sig, a, b, xOf, yM, C.series[2], 1.2);
        ctx.fillStyle = C.text;
        ctx.textAlign = 'left';
        ctx.fillText('MACD 12 26 9', padL + 4, y0 + 6);
      }
      top += subH;
    }

    // crosshair + readout
    if (this.mouse && this.mouse.x > padL && this.mouse.x < w - padR) {
      const i = Math.max(a, Math.min(b - 1, a + Math.floor((this.mouse.x - padL) / per)));
      const bar = this.bars[i];
      const x = Math.round(xOf(i)) + 0.5;
      ctx.strokeStyle = C.cross;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h - axisH);
      if (this.mouse.y > padT && this.mouse.y < padT + mainH) {
        ctx.moveTo(padL, this.mouse.y + 0.5);
        ctx.lineTo(w - padR, this.mouse.y + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (this.mouse.y > padT && this.mouse.y < padT + mainH) {
        const v = this.yInv(this.mouse.y);
        ctx.fillStyle = C.cross;
        ctx.fillRect(w - padR + 1, this.mouse.y - 8, padR - 2, 16);
        ctx.fillStyle = '#000';
        ctx.textAlign = 'left';
        ctx.fillText(pctMode ? `${v.toFixed(2)}%` : v.toFixed(this.opts.dp), w - padR + 5, this.mouse.y);
      }
      const lab = label(i, true);
      ctx.fillStyle = C.cross;
      const tw = ctx.measureText(lab).width + 10;
      ctx.fillRect(x - tw / 2, h - axisH + 1, tw, axisH - 2);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.fillText(lab, x, h - axisH / 2);
      this.readout(bar, C, padL, i);
      this.onHover?.(i, bar);
    } else {
      this.readout(last, C, padL, this.bars.length - 1);
    }
  }

  readout(bar, C, x, i) {
    const { ctx } = this;
    const dp = this.opts.dp;
    const parts = [
      ['O', bar.o.toFixed(dp)], ['H', bar.h.toFixed(dp)], ['L', bar.l.toFixed(dp)], ['C', bar.c.toFixed(dp)],
    ];
    if (bar.v) parts.push(['V', fmtVol(bar.v)]);
    for (const st of this.calc.sma) if (st.v[i] != null) parts.push([`SMA${st.n}`, st.v[i].toFixed(dp)]);
    for (const st of this.calc.ema) if (st.v[i] != null) parts.push([`EMA${st.n}`, st.v[i].toFixed(dp)]);
    ctx.textAlign = 'left';
    let cx = x + 4;
    for (const [k, v] of parts) {
      ctx.fillStyle = C.text;
      ctx.fillText(k, cx, 9);
      cx += ctx.measureText(k).width + 3;
      ctx.fillStyle = C.line;
      ctx.fillText(v, cx, 9);
      cx += ctx.measureText(v).width + 10;
    }
  }

  polyline(vals, a, b, xOf, yOf, color, width = 1, dash = []) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (let i = a; i < b; i++) {
      const v = vals[i];
      if (v == null || Number.isNaN(v)) { pen = false; continue; }
      pen ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v));
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

// XY plot: series of {x, y, label} points, drawn as lines and/or labelled dots.
export class XYChart extends Surface {
  constructor(host) {
    super(host);
    this.canvas.addEventListener('mousemove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.render();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouse = null;
      this.render();
    });
  }
  setData(d) {
    this.d = d;
    this.render();
  }
  render() {
    if (!this.d) return;
    const { ctx, w, h } = this;
    const C = this.colors();
    const { series, xFmt = (v) => v.toFixed(1), yFmt = (v) => v.toFixed(2), xLabel = '', yLabel = '', xCat, zeroLine } = this.d;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px var(--mono), ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    const padL = 58;
    const padR = 18;
    const padT = 22;
    const padB = 34;
    const pts = series.flatMap((s) => s.points);
    if (!pts.length) return;
    let [x0, x1] = [Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x))];
    let [y0, y1] = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
    if (zeroLine) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (x1 === x0) { x1 += 1; x0 -= 1; }
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    const px = (x1 - x0) * 0.06;
    const py = (y1 - y0) * 0.1;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
    const X = (v) => padL + ((v - x0) / (x1 - x0)) * (w - padL - padR);
    const Y = (v) => padT + (1 - (v - y0) / (y1 - y0)) * (h - padT - padB);
    ctx.strokeStyle = C.grid;
    ctx.fillStyle = C.text;
    const ys = niceStep(y1 - y0, (h - padT - padB) / 40);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
      ctx.beginPath();
      ctx.moveTo(padL, Math.round(Y(v)) + 0.5);
      ctx.lineTo(w - padR, Math.round(Y(v)) + 0.5);
      ctx.stroke();
      ctx.fillText(yFmt(v), padL - 6, Y(v));
    }
    ctx.textAlign = 'center';
    if (xCat) {
      for (const [v, lab] of xCat) ctx.fillText(lab, X(v), h - padB + 12);
    } else {
      const xs = niceStep(x1 - x0, (w - padL - padR) / 70);
      for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) {
        ctx.beginPath();
        ctx.moveTo(Math.round(X(v)) + 0.5, padT);
        ctx.lineTo(Math.round(X(v)) + 0.5, h - padB);
        ctx.stroke();
        ctx.fillText(xFmt(v), X(v), h - padB + 12);
      }
    }
    if (zeroLine) {
      ctx.strokeStyle = C.cross;
      ctx.beginPath();
      ctx.moveTo(padL, Y(0));
      ctx.lineTo(w - padR, Y(0));
      ctx.stroke();
    }
    ctx.fillStyle = C.text;
    ctx.fillText(xLabel, (padL + w - padR) / 2, h - 8);
    ctx.save();
    ctx.translate(12, (padT + h - padB) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    let hover = null;
    series.forEach((s, k) => {
      const col = s.color || C.series[k % C.series.length];
      if (s.line) {
        ctx.strokeStyle = col;
        ctx.lineWidth = s.width || 1.6;
        ctx.setLineDash(s.dash || []);
        ctx.beginPath();
        s.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }
      if (s.dots !== false) {
        for (const p of s.points) {
          ctx.fillStyle = p.color || col;
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.y), s.r || 3, 0, Math.PI * 2);
          ctx.fill();
          if (s.labels && p.label) {
            ctx.fillStyle = C.text;
            ctx.textAlign = 'left';
            ctx.fillText(p.label, X(p.x) + 5, Y(p.y) - 7);
          }
          if (this.mouse && Math.hypot(this.mouse.x - X(p.x), this.mouse.y - Y(p.y)) < 7) hover = { p, s };
        }
      }
    });
    // legend
    ctx.textAlign = 'left';
    let lx = padL + 4;
    series.forEach((s, k) => {
      if (!s.name) return;
      ctx.fillStyle = s.color || C.series[k % C.series.length];
      ctx.fillRect(lx, 8, 10, 3);
      ctx.fillStyle = C.text;
      ctx.fillText(s.name, lx + 14, 10);
      lx += ctx.measureText(s.name).width + 30;
    });
    if (hover) {
      const t = `${hover.p.label ? `${hover.p.label}  ` : ''}${xFmt(hover.p.x)}, ${yFmt(hover.p.y)}`;
      const tw = ctx.measureText(t).width + 12;
      const tx = Math.min(w - tw - 4, X(hover.p.x) + 8);
      ctx.fillStyle = C.cross;
      ctx.fillRect(tx, Y(hover.p.y) + 8, tw, 18);
      ctx.fillStyle = '#000';
      ctx.fillText(t, tx + 6, Y(hover.p.y) + 17);
    }
  }
}

export function sparkline(values, { w = 80, h = 18, color = 'currentColor' } = {}) {
  if (!values.length) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - lo) / (hi - lo || 1)) * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.2" points="${pts}"/></svg>`;
}

function fmtAxis(v, step) {
  const dp = step >= 1 ? 0 : Math.min(5, Math.ceil(-Math.log10(step)));
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function fmtVol(v) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
