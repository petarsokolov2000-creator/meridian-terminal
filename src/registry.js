// Function registry. A function renders into a panel body and may return
// { update(), destroy() }; update runs on every engine tick while it is visible.

export const FUNCTIONS = new Map();
export const ALIASES = new Map();

export function register(def) {
  FUNCTIONS.set(def.code, def);
  for (const a of def.aliases || []) ALIASES.set(a, def.code);
}

export function resolve(code) {
  code = code.toUpperCase();
  if (FUNCTIONS.has(code)) return FUNCTIONS.get(code);
  if (ALIASES.has(code)) return FUNCTIONS.get(ALIASES.get(code));
  return null;
}

export const CATEGORIES = ['Markets', 'Equity', 'Rates & FX', 'Calendars', 'News', 'Analytics', 'Trading', 'System'];
