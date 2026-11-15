// Your notes on securities: why you hold or want a stock, the entry price, target and stop, and a dated
// journal. Kept in this browser's (or the phone app's) storage, one set per data mode (real / simulated).
// Pure data and arithmetic: the screens are in functions/notes.js.

import { store, save } from './fmt.js';

export const SIDES = ['LONG', 'SHORT', 'WATCH'];
const key = (mode) => `notes:${mode}`;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export const loadNotes = (mode) => {
  const v = store(key(mode), {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
export const getNote = (mode, sym) => loadNotes(mode)[sym] || null;
export function saveNote(mode, sym, note) {
  const all = loadNotes(mode);
  all[sym] = { ...note, updated: Date.now() };
  save(key(mode), all);
  return all[sym];
}
export function deleteNote(mode, sym) {
  const all = loadNotes(mode);
  delete all[sym];
  save(key(mode), all);
}
export const localDay = (d = new Date()) => d.toLocaleDateString('en-CA'); // 2026-11-15

/** Merge notes from a backup: a note already here is replaced only by a newer one. Returns how many were taken. */
export function importNotes(mode, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw new Error('That is not a Meridian notes backup.');
  const all = loadNotes(mode);
  let n = 0;
  for (const [sym, v] of Object.entries(incoming)) {
    if (!v || typeof v !== 'object' || !SIDES.includes(v.side) || !/^[A-Z0-9^][A-Z0-9^.=\-/ ]{0,24}$/.test(sym)) continue;
    if (all[sym] && (all[sym].updated || 0) >= (v.updated || 0)) continue;
    all[sym] = {
      side: v.side, entry: fin(v.entry) ? v.entry : null, entryAt: typeof v.entryAt === 'string' ? v.entryAt.slice(0, 10) : null,
      target: fin(v.target) ? v.target : null, stop: fin(v.stop) ? v.stop : null,
      reason: String(v.reason || '').slice(0, 2000), updated: fin(v.updated) ? v.updated : Date.now(),
      log: (Array.isArray(v.log) ? v.log : []).slice(0, 200).map((l) => ({ t: fin(l?.t) ? l.t : Date.now(), text: String(l?.text || '').slice(0, 500) })).filter((l) => l.text),
    };
    n++;
  }
  save(key(mode), all);
  return n;
}

/**
 * What the note says about where the price is now. Everything is from your side of the trade:
 * for a SHORT a falling price is a gain. WATCH counts like a long (a price move since you noted it).
 */
export function noteStats(n, price) {
  const sign = n.side === 'SHORT' ? -1 : 1;
  const out = { sign, pnl: null, toTarget: null, targetReached: false, cushion: null, stopHit: false, rr: null, days: null, problems: [] };
  if (!fin(price)) return out;
  if (fin(n.entry) && n.entry > 0) out.pnl = sign * (price / n.entry - 1);
  if (fin(n.target) && n.target > 0) {
    out.toTarget = sign * (n.target / price - 1);
    out.targetReached = sign > 0 ? price >= n.target : price <= n.target;
  }
  if (fin(n.stop) && n.stop > 0) {
    out.cushion = sign * (price / n.stop - 1);
    out.stopHit = sign > 0 ? price <= n.stop : price >= n.stop;
  }
  if (fin(n.entry) && fin(n.target) && fin(n.stop) && n.entry > 0) {
    const reward = (sign * (n.target - n.entry)) / n.entry;
    const risk = (sign * (n.entry - n.stop)) / n.entry;
    if (reward > 0 && risk > 0) out.rr = reward / risk;
  }
  if (n.entryAt) {
    const d = Math.max(0, Math.floor((Date.now() - new Date(`${n.entryAt}T00:00:00`).getTime()) / 86400000));
    if (Number.isFinite(d) && d >= 0) out.days = d;
  }
  if (n.side !== 'WATCH' && fin(n.entry)) {
    if (fin(n.target) && sign * (n.target - n.entry) <= 0) out.problems.push(`for a ${n.side.toLowerCase()} the target should be ${sign > 0 ? 'above' : 'below'} the entry price`);
    if (fin(n.stop) && sign * (n.entry - n.stop) <= 0) out.problems.push(`for a ${n.side.toLowerCase()} the stop should be ${sign > 0 ? 'below' : 'above'} the entry price`);
  }
  return out;
}
