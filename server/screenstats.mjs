// Volatility, beta and RSI for the extra screener companies (src/companies.js).
//
// The bulk quote the screener uses for those ~1,100 companies has a price but no price history, so these three
// columns were empty. This works them out from one year of daily closes from Yahoo, the same source as the
// prices, with the same formulas the built-in stocks use on the client:
//   vol  = standard deviation of daily log returns × √252, in percent
//   beta = covariance with the S&P 500 ÷ variance of the S&P 500, on the most recent common length
//   rsi  = Wilder's 14-day RSI
// The job runs in the background a few requests at a time, fills in progressively, and is redone after six hours.

import { pool } from './yahoo.mjs';

const TTL = 6 * 3600e3;
const BENCH = '^GSPC';

const logRet = (c) => {
  const r = [];
  for (let k = 1; k < c.length; k++) if (c[k - 1] > 0 && c[k] > 0) r.push(Math.log(c[k] / c[k - 1]));
  return r;
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export function rsi14(c, n = 14) {
  if (c.length < n + 2) return null;
  let g = 0;
  let l = 0;
  for (let k = 1; k <= n; k++) {
    const d = c[k] - c[k - 1];
    g += Math.max(d, 0) / n;
    l += Math.max(-d, 0) / n;
  }
  for (let k = n + 1; k < c.length; k++) {
    const d = c[k] - c[k - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}

/** [vol %, beta, RSI] from closes (oldest first) and the benchmark's log returns; null where it can't be worked out. */
export function statsOf(closes, benchRet) {
  const rr = logRet(closes);
  if (rr.length < 30) return null;
  const m = mean(rr);
  const vol = Math.sqrt(rr.reduce((s, v) => s + (v - m) ** 2, 0) / (rr.length - 1)) * Math.sqrt(252) * 100;
  let beta = null;
  if (benchRet?.length) {
    const n = Math.min(rr.length, benchRet.length);
    const x = benchRet.slice(-n);
    const y = rr.slice(-n);
    const mx = mean(x);
    const my = mean(y);
    let cov = 0;
    let vr = 0;
    for (let i = 0; i < n; i++) {
      cov += (y[i] - my) * (x[i] - mx);
      vr += (x[i] - mx) ** 2;
    }
    if (vr > 0) beta = cov / vr;
  }
  const r = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  return [r(vol, 1), r(beta, 2), r(rsi14(closes), 1)];
}

export function createScreenStats({ yahoo, symbols, concurrency = 6, log = () => {} }) {
  let job = null; // { total, done, failed, stats, running, finishedAt, benchOk }

  async function run(j) {
    let benchRet = null;
    try {
      benchRet = logRet((await yahoo.chart(BENCH, '1y', '1d')).bars.map((b) => b.c));
      j.benchOk = benchRet.length > 30;
    } catch (err) {
      log(`screen stats: no benchmark, beta left empty (${err.message})`);
    }
    const one = async (s) => {
      const c = await yahoo.chart(s, '1y', '1d');
      const st = statsOf(c.bars.map((b) => b.c), benchRet);
      if (st) j.stats[s] = st;
    };
    let failed = [];
    await pool(symbols, concurrency, async (s) => {
      try {
        await one(s);
      } catch {
        failed.push(s);
      }
      j.done++;
    });
    // one more try for the ones that failed (Yahoo sometimes pushes back when asked quickly)
    const again = failed;
    failed = [];
    await pool(again, 2, async (s) => {
      try {
        await one(s);
      } catch {
        failed.push(s);
      }
    });
    j.failed = failed.length;
    j.running = false;
    j.finishedAt = Date.now();
  }

  /** Current state; starts (or, after six hours, restarts) the background job. */
  function snapshot() {
    if (!job || (!job.running && Date.now() - job.finishedAt > TTL)) {
      const old = job?.stats || {};
      job = { total: symbols.length, done: 0, failed: 0, stats: { ...old }, running: true, finishedAt: 0, benchOk: false };
      const j = job;
      run(j).catch((err) => {
        j.running = false;
        j.finishedAt = Date.now();
        j.error = err.message;
        log(`screen stats failed: ${err.message}`);
      });
    }
    return { fields: ['vol', 'beta', 'rsi'], total: job.total, done: job.done, failed: job.failed, running: job.running, benchOk: job.benchOk, error: job.error || null, stats: job.stats };
  }

  return { snapshot };
}
