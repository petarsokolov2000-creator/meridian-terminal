// Number formatting and small DOM helpers shared by every function.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function num(v, dp = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export const px = (inst, v = inst.last) => num(v, inst.dp);
export function signed(v, dp = 2, suffix = '') {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), dp)}${suffix}`;
}
export const pct = (v, dp = 2) => signed(v == null ? null : v * 100, dp, '%');
export const dir = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

export function big(v, dp = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(dp)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(dp)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(dp)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return num(v, 0);
}

// Change cell for any instrument: percent for prices, basis points for yields.
export function chgText(inst) {
  return inst.additive ? signed(inst.chgBp, 1, 'bp') : pct(inst.pct);
}
export function netText(inst) {
  return inst.additive ? signed(inst.chg, 3) : signed(inst.chg, inst.dp);
}

export const secLink = (inst, text = inst.sym) => `<a class="sec" data-sec="${esc(inst.sym)}" href="#">${esc(text)}</a>`;

// Keyed table that updates cells in place and flashes prices when they tick.
export class LiveTable {
  constructor(host, cols, { onRow, cls = '' } = {}) {
    this.cols = cols;
    this.rows = new Map();
    this.wrap = document.createElement('div');
    this.wrap.className = `tbl-wrap ${cls}`;
    this.table = document.createElement('table');
    this.table.className = 'tbl';
    this.table.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c.cls || ''}" title="${esc(c.title || '')}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody></tbody>`;
    this.tbody = this.table.querySelector('tbody');
    this.wrap.appendChild(this.table);
    host.appendChild(this.wrap);
    if (onRow) {
      this.tbody.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const tr = e.target.closest('tr');
        if (tr) onRow(tr.dataset.key, e);
      });
    }
  }
  // items: array of {key, ...}; each column has value(item) -> html and optional
  // flash(item) -> number used to decide the flash direction.
  set(items) {
    const seen = new Set();
    let prev = null;
    for (const it of items) {
      const key = String(it.key);
      seen.add(key);
      let r = this.rows.get(key);
      if (!r) {
        const tr = document.createElement('tr');
        tr.dataset.key = key;
        const tds = this.cols.map((c) => {
          const td = document.createElement('td');
          td.className = c.cls || '';
          tr.appendChild(td);
          return td;
        });
        r = { tr, tds, last: [] };
        this.rows.set(key, r);
      }
      this.cols.forEach((c, i) => {
        const html = c.value(it);
        if (html !== r.last[i]) {
          r.tds[i].innerHTML = html;
          if (c.cellCls) r.tds[i].className = `${c.cls || ''} ${c.cellCls(it)}`;
          if (c.flash && r.last[i] !== undefined) {
            const v = c.flash(it);
            const pv = r.flashPrev?.[i];
            if (pv !== undefined && v !== pv) {
              r.tds[i].classList.remove('flash-up', 'flash-down');
              void r.tds[i].offsetWidth;
              r.tds[i].classList.add(v > pv ? 'flash-up' : 'flash-down');
            }
          }
          r.last[i] = html;
        }
        if (c.flash) (r.flashPrev ||= [])[i] = c.flash(it);
      });
      if (it.rowCls !== undefined) r.tr.className = it.rowCls;
      // keep DOM order equal to item order
      const want = prev ? prev.nextSibling : this.tbody.firstChild;
      if (want !== r.tr) this.tbody.insertBefore(r.tr, want);
      prev = r.tr;
    }
    for (const [k, r] of this.rows) {
      if (!seen.has(k)) {
        r.tr.remove();
        this.rows.delete(k);
      }
    }
  }
}

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function store(key, fallback) {
  try {
    const v = localStorage.getItem(`meridian:${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function save(key, v) {
  try {
    localStorage.setItem(`meridian:${key}`, JSON.stringify(v));
  } catch {
    // storage unavailable: keep in memory only
  }
}
