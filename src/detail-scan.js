// Loads Yahoo's company details (insider trades, short interest, …) for a list of stocks a few at a
// time, so a list screen fills in row by row. The server keeps each answer for an hour, so a second
// screen over the same stocks (INSIDER, then SI) is instant and costs Yahoo nothing.

import { store } from './fmt.js';
import { loadBook } from './functions/tools.js';

/** The stocks behind WATCH / PORT / MARKET: company stocks only (no ETFs, indices, FX). */
export function stocksOf(E, which) {
  if (which === 'MARKET') return E.equities.filter((i) => i.cls === 'EQ' && !i.etf);
  const syms = which === 'WATCH' ? store(`watch:${E.mode}`, E.defaults.watch) : Object.keys(loadBook(E).positions);
  return syms.map((x) => E.get(x)).filter((i) => i && i.cls === 'EQ' && !i.etf);
}

/** Signed share count of the user's paper position (negative = short), 0 if none. */
export function positionOf(E, sym) {
  return loadBook(E).positions[sym]?.q || 0;
}

/**
 * Calls onEach(inst, { det } | { error }) as each stock arrives. `parallel` requests at a time.
 * Returns { stop } (also stops by itself when finished).
 */
export function scan(E, stocks, onEach, parallel = 2) {
  const queue = [...stocks];
  let stopped = false;
  const worker = async () => {
    while (queue.length && !stopped) {
      const i = queue.shift();
      let out;
      try {
        out = { det: await E.details(i.sym) };
      } catch (err) {
        out = { error: err?.message || 'no data' };
      }
      if (!stopped) onEach(i, out);
    }
  };
  const done = Promise.all(Array.from({ length: Math.min(parallel, stocks.length) }, worker));
  return { stop: () => { stopped = true; queue.length = 0; }, done };
}
