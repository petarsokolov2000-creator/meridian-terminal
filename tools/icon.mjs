/* The Meridian icon: an amber price line rising across a dark tile, with faint grid lines.
   Drawn per pixel with 4x4 supersampling; png() and ico() encode it without dependencies. */
import zlib from 'node:zlib';

export function icon(S) {
  const k = S / 192;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const BG = hex('#0b0d11');
  const GRID = hex('#1f242d');
  const AMBER = hex('#ffa028');
  const P = (x, y) => [x * k, y * k];
  const pts = [P(36, 134), P(70, 112), P(96, 124), P(128, 80), P(156, 58)];
  const segDist = (px, py, [ax, ay], [bx, by]) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
  };
  const rrect = (x0, y0, x1, y1, r) => (x, y) => {
    const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
    const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && Math.hypot(dx, dy) <= r;
  };
  const tile = rrect(0, 0, S, S, 40 * k);
  const grid = (x, y) => [60, 96, 132].some((g) => Math.abs(y - g * k) <= 1.6 * k) && x > 28 * k && x < 164 * k;
  const line = (x, y) => pts.slice(1).some((b, i) => segDist(x, y, pts[i], b) <= 9 * k);
  const dot = (x, y) => Math.hypot(x - pts[4][0], y - pts[4][1]) <= 15 * k;
  const layers = [[tile, BG], [grid, GRID], [line, AMBER], [dot, AMBER]];
  const px = Buffer.alloc(S * S * 4);
  const N = 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const X = x + (sx + 0.5) / N;
          const Y = y + (sy + 0.5) / N;
          if (!tile(X, Y)) continue;
          let c = null;
          for (const [hit, col] of layers) if (hit(X, Y)) c = col;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * S + x) * 4;
      if (a) {
        px[i] = r / a;
        px[i + 1] = g / a;
        px[i + 2] = b / a;
      }
      px[i + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return png(S, S, px);
}

export function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// .ico holding PNG images (Windows Vista and later), largest first.
export function ico(sizes = [256, 48, 32, 16]) {
  const imgs = sizes.map((s) => icon(s));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(imgs.length, 4);
  let offset = head.length;
  imgs.forEach((img, i) => {
    const e = 6 + i * 16;
    head[e] = sizes[i] >= 256 ? 0 : sizes[i];
    head[e + 1] = sizes[i] >= 256 ? 0 : sizes[i];
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(img.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([head, ...imgs]);
}
