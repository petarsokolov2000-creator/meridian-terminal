// Insider-trading and short-interest signals for list screens (the WATCH columns), loaded a couple of
// stocks at a time and remembered for half an hour. Same maths as INSIDER and SI (insider-data.js):
// this only fetches and caches.
//
//   peekSignals(E, inst, onReady) -> undefined (not a company stock) | null (still loading)
//                                    | { error } | { sig, trades, short }

import { normalize, signal, shortStats } from './insider-data.js';
import { isStock } from './intrinsic.js';

const done = new Map(); // sym -> { at, res }
const busy = new Set();
const waiting = [];
let running = 0;
const TTL = 30 * 60000;
const SLOTS = 2;

function build(d) {
  const rows = normalize(d.insiders);
  return { sig: signal(rows, Date.now()), trades: rows.length, short: shortStats(d.stats) };
}

function pump(E) {
  while (running < SLOTS && waiting.length) {
    const job = waiting.shift();
    running++;
    E.details(job.sym)
      // a failed load is kept for one minute only, then tried again
      .then((d) => ({ at: Date.now(), res: build(d) }), (err) => ({ at: Date.now() - TTL + 60000, res: { error: err?.message || 'no data' } }))
      .then((r) => {
        done.set(job.sym, r);
        busy.delete(job.sym);
      })
      .finally(() => {
        running--;
        job.ready();
        pump(E);
      });
  }
}

export function peekSignals(E, inst, onReady) {
  if (!isStock(E, inst)) return undefined;
  const hit = done.get(inst.sym);
  if (hit && Date.now() - hit.at < TTL) return hit.res;
  if (!busy.has(inst.sym)) {
    busy.add(inst.sym);
    waiting.push({ sym: inst.sym, ready: () => onReady?.() });
    pump(E);
  }
  return null;
}
