// SHIPS: a world map of ships with their position and ID (MMSI = the radio identity every ship
// transmits, IMO = the permanent hull number). Data: AIS, via the Meridian server (server/ships.mjs):
// AISStream with the user's free key (command AISKEY), else Digitraffic (Finland / Baltic only).
//
// AIS is a radio signal: only ships near a receiver are heard, so coasts and busy lanes are full and
// the open ocean is mostly empty. The map says so, and shows how many ships it actually has.
// The coastline is Natural Earth (public domain), src/world-land.json.

import { register } from '../registry.js';
import { esc, el, num } from '../fmt.js';

const CATS = ['Cargo', 'Tanker', 'Passenger', 'Fishing', 'Tug / special', 'Sailing / pleasure', 'Military', 'Other / unknown'];
const COLORS = ['--s2', '--s1', '--s5', '--s4', '--s6', '--s3', '--down', '--dim'];
const MIN_SCALE_FIT = 1; // pixels per degree is derived from the width; this is only a floor
const MAX_SCALE = 600;

let landCache = null;
/** Natural Earth land as rings of [lon, lat] (TopoJSON, decoded once). */
function loadLand() {
  if (!landCache) {
    landCache = fetch(new URL('../world-land.json', import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`the coastline file answered HTTP ${r.status}`);
      return r.json();
    }).then((topo) => {
      const [sx, sy] = topo.transform.scale;
      const [tx, ty] = topo.transform.translate;
      const arcs = topo.arcs.map((a) => {
        let x = 0;
        let y = 0;
        return a.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
      });
      const arc = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
      const ring = (idx) => idx.flatMap((i, k) => (k ? arc(i).slice(1) : arc(i)));
      const rings = [];
      const geom = (g) => {
        if (g.type === 'GeometryCollection') g.geometries.forEach(geom);
        else if (g.type === 'Polygon') g.arcs.forEach((r) => rings.push(ring(r)));
        else if (g.type === 'MultiPolygon') g.arcs.forEach((p) => p.forEach((r) => rings.push(ring(r))));
      };
      Object.values(topo.objects).forEach(geom);
      return rings;
    }).catch((err) => {
      landCache = null;
      throw err;
    });
  }
  return landCache;
}

const ago = (t) => {
  if (!t) return 'unknown';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const pos = (lat, lon) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
const NAV = ['under way with engine', 'at anchor', 'not under command', 'restricted manoeuvrability', 'constrained by draught', 'moored', 'aground', 'fishing', 'under way sailing'];

register({
  code: 'SHIPS', aliases: ['VESSELS', 'AIS', 'MARITIME', 'SEA'], name: 'Ships of the world', cat: 'Markets',
  help: 'SHIPS — map of ships with position and ID (MMSI, IMO); search by name, MMSI or IMO; free AISStream key (AISKEY yourkey) for the whole world, without one: Baltic Sea only',
  run(ctx) {
    ctx.el.innerHTML = '<div class="empty">Ship positions need real data. Switch with <kbd>MODE LIVE</kbd> (Meridian has to be running from its icon).</div>';
  },
  live(ctx) {
    const root = el('div', 'ships');
    ctx.el.appendChild(root);
    root.innerHTML = `<div class="toolbar ships-bar"><input class="ships-q" type="search" placeholder="Search name, MMSI or IMO" maxlength="40" aria-label="Search ships"><button class="tb" data-a="go">SEARCH</button><span class="sep"></span><button class="tb" data-a="in" title="Zoom in">+</button><button class="tb" data-a="out" title="Zoom out">−</button><button class="tb" data-a="world" title="Show the whole world">WORLD</button></div>
      <div class="ships-map"><canvas class="ships-canvas" role="img" aria-label="Map of ships"></canvas><div class="ships-tip" hidden></div></div>
      <div class="ships-status note"></div>
      <div class="alloc-key ships-legend"></div>
      <div class="ships-card" hidden></div>
      <div class="ships-lists"></div>`;
    const canvas = root.querySelector('canvas');
    const g = canvas.getContext('2d');
    const mapBox = root.querySelector('.ships-map');
    const statusEl = root.querySelector('.ships-status');
    const legendEl = root.querySelector('.ships-legend');
    const cardEl = root.querySelector('.ships-card');
    const listsEl = root.querySelector('.ships-lists');
    const tipEl = root.querySelector('.ships-tip');
    const qEl = root.querySelector('.ships-q');

    let W = 600;
    let H = 320;
    let dpr = 1;
    const view = { cx: 10, cy: 25, s: 3 }; // centre lon/lat, pixels per degree
    let land = null;
    let data = null; // the last answer of /api/ships
    let shown = new Set(CATS.keys()); // categories on the map
    let selected = null; // MMSI
    let query = '';
    let matches = null;
    let gone = false;
    let timer = null;
    let loading = 0;
    let error = null;

    const fitScale = () => Math.max(W / 360, H / 180, MIN_SCALE_FIT / 100);
    const clamp = () => {
      view.s = Math.min(MAX_SCALE, Math.max(fitScale(), view.s));
      const halfW = W / 2 / view.s;
      const halfH = H / 2 / view.s;
      view.cx = halfW >= 180 ? 0 : Math.min(180 - halfW, Math.max(-180 + halfW, view.cx));
      view.cy = halfH >= 90 ? 0 : Math.min(90 - halfH, Math.max(-90 + halfH, view.cy));
    };
    const px = (lon, lat) => [(lon - view.cx) * view.s + W / 2, (view.cy - lat) * view.s + H / 2];
    const lonlat = (x, y) => [view.cx + (x - W / 2) / view.s, view.cy - (y - H / 2) / view.s];
    const bbox = (pad = 0.1) => {
      const [w, n] = lonlat(-W * pad, -H * pad);
      const [e, s] = lonlat(W * (1 + pad), H * (1 + pad));
      return [Math.max(-180, w), Math.max(-90, s), Math.min(180, e), Math.min(90, n)];
    };
    const css = (name) => getComputedStyle(root).getPropertyValue(name).trim() || '#888';

    // ---- drawing -------------------------------------------------------------------------------
    function draw() {
      if (gone) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = css('--chart-bg');
      g.fillRect(0, 0, W, H);
      // graticule
      g.strokeStyle = css('--chart-grid');
      g.lineWidth = 1;
      g.beginPath();
      const step = view.s > 60 ? 1 : view.s > 15 ? 5 : view.s > 5 ? 10 : 30;
      for (let lon = -180; lon <= 180; lon += step) {
        const [x] = px(lon, 0);
        if (x >= 0 && x <= W) {
          g.moveTo(x, 0);
          g.lineTo(x, H);
        }
      }
      for (let lat = -90; lat <= 90; lat += step) {
        const [, y] = px(0, lat);
        if (y >= 0 && y <= H) {
          g.moveTo(0, y);
          g.lineTo(W, y);
        }
      }
      g.stroke();
      // land
      if (land) {
        g.beginPath();
        for (const r of land) {
          // a ring that jumps across the 180° line is cut there, so no line is drawn across the whole map
          let prev = null;
          for (const [lon, lat] of r) {
            const [x, y] = px(lon, lat);
            if (prev === null) g.moveTo(x, y);
            else if (Math.abs(lon - prev) > 180) {
              g.closePath();
              g.moveTo(x, y);
            } else g.lineTo(x, y);
            prev = lon;
          }
          g.closePath();
        }
        g.fillStyle = css('--panel-head');
        g.fill('evenodd');
        g.strokeStyle = css('--dim');
        g.globalAlpha = 0.55;
        g.lineWidth = 0.7;
        g.stroke();
        g.globalAlpha = 1;
      }
      if (data?.mode === 'cells') drawCells();
      else if (data?.ships) drawShips();
      if (!data && !error) {
        g.fillStyle = css('--dim');
        g.font = '12px sans-serif';
        g.fillText('Loading ships…', 12, 20);
      }
    }

    function drawCells() {
      const accent = css('--s2');
      const text = css('--text');
      for (const [lat, lon, n] of data.cells) {
        const [x, y] = px(lon, lat);
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) continue;
        const r = Math.min(26, 5 + Math.log2(n + 1) * 2.4);
        g.globalAlpha = 0.5;
        g.fillStyle = accent;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        if (r > 9) {
          g.fillStyle = text;
          g.font = '10px sans-serif';
          g.textAlign = 'center';
          g.fillText(n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n), x, y + 3.5);
          g.textAlign = 'start';
        }
      }
    }

    function drawShips() {
      const cols = COLORS.map(css);
      const zoomed = view.s >= 25;
      const rad = view.s >= 60 ? 4 : view.s >= 12 ? 3 : 2;
      for (const sh of data.ships) {
        const [mmsi, lat, lon, cog, cat] = sh;
        if (!shown.has(cat)) continue;
        const [x, y] = px(lon, lat);
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
        g.fillStyle = cols[cat];
        if (zoomed && cog >= 0) {
          const a = (cog * Math.PI) / 180;
          g.save();
          g.translate(x, y);
          g.rotate(a);
          g.beginPath();
          g.moveTo(0, -rad * 1.8);
          g.lineTo(rad, rad * 1.3);
          g.lineTo(-rad, rad * 1.3);
          g.closePath();
          g.fill();
          g.restore();
        } else {
          g.fillRect(x - rad / 2, y - rad / 2, rad, rad);
        }
        if (mmsi === selected) {
          g.strokeStyle = css('--text');
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, rad + 5, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }

    // ---- data ------------------------------------------------------------------------------------
    async function load() {
      const [w, s, e, n] = bbox();
      const id = ++loading;
      const qs = new URLSearchParams({ w: w.toFixed(3), s: s.toFixed(3), e: e.toFixed(3), n: n.toFixed(3), list: '1' });
      if (query) qs.set('q', query);
      try {
        const res = await fetch(`/api/ships?${qs}`);
        const body = await res.json().catch(() => ({ error: `Server answered ${res.status}` }));
        if (gone || id !== loading) return;
        if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
        data = body;
        matches = query ? body.matches || [] : null;
        error = null;
      } catch (err) {
        if (gone || id !== loading) return;
        error = err.message;
      }
      paintAll();
    }
    const soon = (ms = 350) => {
      clearTimeout(timer);
      timer = setTimeout(load, ms);
    };

    function paintAll() {
      draw();
      paintStatus();
      paintLegend();
      paintLists();
    }

    function paintStatus() {
      if (error) {
        statusEl.innerHTML = `Couldn't load ships: ${esc(error)}<br><span class="dim small">A free AISStream key (<kbd>AISKEY</kbd> followed by the key, from aisstream.io) is a second source for ships worldwide.</span>`;
        return;
      }
      if (!data) {
        statusEl.textContent = 'Loading…';
        return;
      }
      const src = data.source === 'aisstream' ? 'AISStream (worldwide, wherever AIS stations can hear)' : data.source === 'digitraffic' ? 'Digitraffic (Finland and the Baltic Sea only)' : 'no source';
      const state = data.state === 'live' ? `live, last message ${ago(data.lastMsg)}` : data.state === 'error' ? 'error' : 'connecting…';
      const baltic = data.source === 'digitraffic';
      statusEl.innerHTML = `<b>${num(data.total, 0)}</b> ships heard in the last 2 hours · <b>${num(data.inView, 0)}</b> in this view${data.mode === 'cells' ? ' (grouped: zoom in to see single ships)' : ''}<br>Source: ${esc(src)} · ${esc(state)}${data.error ? ` · ${esc(data.error)}` : ''}${data.note ? `<br><span class="st-bad">${esc(data.note)}</span>` : ''}<br>`
        + `<span class="dim small">${baltic ? 'Without a key only ships near Finland and the Baltic are shown. For the whole world get a free key at aisstream.io and type <kbd>AISKEY</kbd> followed by the key. ' : ''}AIS is a radio signal: coasts and busy lanes are well covered, the open ocean is mostly empty, and this is not a count of all ships that exist. Coastline: Natural Earth.</span>`;
    }

    function paintLegend() {
      const counts = data?.counts || [];
      legendEl.innerHTML = CATS.map((c, k) => `<button type="button" class="ships-leg ${shown.has(k) ? 'on' : ''}" data-cat="${k}" title="Show or hide ${esc(c)}"><i class="sw" style="background:var(${COLORS[k]})"></i>${esc(c)}${counts[k] != null ? ` ${num(counts[k], 0)}` : ''}</button>`).join('');
    }

    const row = (s) => `<tr data-mmsi="${s.mmsi}" class="${s.mmsi === selected ? 'self' : ''}"><td class="l">${esc(s.name || '—')}</td><td class="l">${s.mmsi}</td><td class="l">${s.imo || '—'}</td><td class="l">${esc(s.category)}</td><td class="l dim">${pos(s.lat, s.lon)}</td><td class="r">${s.sog != null ? num(s.sog, 1) : '—'}</td></tr>`;
    const table = (title, list, hint) => `<h3 class="alloc-h">${esc(title)}</h3><div class="tbl-wrap"><table class="tbl ships-tbl"><thead><tr><th class="l">Name</th><th class="l" title="Maritime Mobile Service Identity: the ship's radio ID">MMSI</th><th class="l" title="International Maritime Organization number: the hull's permanent ID">IMO</th><th class="l">Type</th><th class="l">Position</th><th class="r">kn</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>${hint ? `<p class="note">${esc(hint)}</p>` : ''}`;

    function paintLists() {
      let html = '';
      if (query) {
        html += matches?.length
          ? table(`Search “${query}”`, matches, matches.length >= 50 ? 'Showing the first 50 matches. Tap a row to go to the ship.' : 'Tap a row to go to the ship.')
          : `<p class="note">No ship matching “${esc(query)}” is in the live data (the search covers ships heard in the last 2 hours).</p>`;
      }
      if (data?.list?.length) html += table('Ships in this view', data.list, data.inView > data.list.length ? `The first ${data.list.length} of ${num(data.inView, 0)} ships in view, by name. Zoom in for the rest.` : '');
      else if (data?.mode === 'cells') html += '<p class="note">Too many ships in view to list them: zoom in (scroll or pinch) to see single ships with their name, MMSI and IMO.</p>';
      listsEl.innerHTML = html;
    }

    function showCard(s) {
      if (!s) {
        cardEl.hidden = true;
        return;
      }
      cardEl.hidden = false;
      cardEl.innerHTML = `<b>${esc(s.name || 'Unnamed ship')}</b> <span class="dim">${esc(s.category)}</span>
        <div class="ships-grid"><span class="dim">MMSI</span><span>${s.mmsi}</span><span class="dim">IMO</span><span>${s.imo || '—'}</span>
        <span class="dim">Call sign</span><span>${esc(s.call || '—')}</span><span class="dim">AIS type code</span><span>${s.type ?? '—'}</span>
        <span class="dim">Position</span><span>${pos(s.lat, s.lon)}</span><span class="dim">Speed / course</span><span>${s.sog != null ? `${num(s.sog, 1)} kn` : '—'} / ${s.cog != null ? `${Math.round(s.cog)}°` : '—'}</span>
        <span class="dim">Status</span><span>${s.nav != null && NAV[s.nav] ? esc(NAV[s.nav]) : '—'}</span><span class="dim">Destination</span><span>${esc(s.dest || '—')}</span>
        <span class="dim">Last heard</span><span>${ago(s.seen)}</span></div>
        <p class="dim small">Destination and type are typed in by the crew and may be out of date.</p>`;
    }

    async function select(mmsi, fly) {
      selected = mmsi;
      try {
        const res = await fetch(`/api/ships/one?mmsi=${mmsi}`);
        const body = await res.json().catch(() => ({}));
        if (gone) return;
        if (!res.ok || body.error) {
          cardEl.hidden = false;
          cardEl.innerHTML = `<span class="dim">${esc(body.error || `HTTP ${res.status}`)}</span>`;
        } else {
          showCard(body);
          if (fly) {
            view.cx = body.lon;
            view.cy = body.lat;
            view.s = Math.max(view.s, 40);
            clamp();
            soon(50);
          }
        }
      } catch (err) {
        if (!gone) cardEl.innerHTML = `<span class="dim">Couldn't load the ship: ${esc(err.message)}</span>`;
      }
      draw();
      paintLists();
    }

    // ---- interaction -----------------------------------------------------------------------------------
    function zoomAt(x, y, factor) {
      const [lon, lat] = lonlat(x, y);
      view.s *= factor;
      clamp();
      // keep the point under the cursor in place
      view.cx = lon - (x - W / 2) / view.s;
      view.cy = lat + (y - H / 2) / view.s;
      clamp();
      draw();
      soon();
    }

    const pointers = new Map();
    let drag = null;
    let pinch = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      drag = { x: e.offsetX, y: e.offsetY, moved: 0 };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        hover(e.offsetX, e.offsetY);
        return;
      }
      if (pointers.size === 2 && pinch) {
        p.x = e.offsetX;
        p.y = e.offsetY;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 0 && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
        pinch.d = d;
        drag.moved = 99;
        return;
      }
      const dx = e.offsetX - p.x;
      const dy = e.offsetY - p.y;
      p.x = e.offsetX;
      p.y = e.offsetY;
      if (drag) drag.moved += Math.abs(dx) + Math.abs(dy);
      view.cx -= dx / view.s;
      view.cy += dy / view.s;
      clamp();
      draw();
      soon(500);
    });
    const up = (e) => {
      const wasClick = drag && drag.moved < 6 && pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasClick) click(e.offsetX, e.offsetY);
      if (!pointers.size) drag = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.4 : 1 / 1.4);
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 2));

    function nearest(x, y, maxd) {
      if (!data?.ships) return null;
      let best = null;
      let bd = maxd * maxd;
      for (const sh of data.ships) {
        if (!shown.has(sh[4])) continue;
        const [sx, sy] = px(sh[2], sh[1]);
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bd) {
          bd = d;
          best = sh;
        }
      }
      return best;
    }
    function hover(x, y) {
      const sh = data?.mode === 'ships' ? nearest(x, y, 8) : null;
      if (!sh) {
        tipEl.hidden = true;
        canvas.style.cursor = data?.mode === 'cells' ? 'zoom-in' : 'grab';
        return;
      }
      canvas.style.cursor = 'pointer';
      const hit = data.list?.find((s) => s.mmsi === sh[0]);
      tipEl.hidden = false;
      tipEl.textContent = `${hit?.name || `MMSI ${sh[0]}`} · ${CATS[sh[4]]}${sh[5] >= 0 ? ` · ${num(sh[5], 1)} kn` : ''}`;
      tipEl.style.left = `${Math.min(W - 160, x + 12)}px`;
      tipEl.style.top = `${Math.max(0, y - 26)}px`;
    }
    function click(x, y) {
      if (data?.mode === 'cells') {
        const [lon, lat] = lonlat(x, y);
        view.cx = lon;
        view.cy = lat;
        view.s *= 4;
        clamp();
        draw();
        soon(50);
        return;
      }
      const sh = nearest(x, y, 10);
      if (sh) select(sh[0], false);
      else {
        selected = null;
        showCard(null);
        draw();
        paintLists();
      }
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) {
        if (b.dataset.a === 'go') return runSearch();
        if (b.dataset.a === 'in') zoomAt(W / 2, H / 2, 2);
        if (b.dataset.a === 'out') zoomAt(W / 2, H / 2, 0.5);
        if (b.dataset.a === 'world') {
          view.cx = 0;
          view.cy = 0;
          view.s = fitScale();
          clamp();
          draw();
          soon(50);
        }
        return;
      }
      const leg = e.target.closest('[data-cat]');
      if (leg) {
        const k = Number(leg.dataset.cat);
        if (shown.has(k)) shown.delete(k);
        else shown.add(k);
        paintLegend();
        draw();
        return;
      }
      const tr = e.target.closest('tr[data-mmsi]');
      if (tr) select(Number(tr.dataset.mmsi), true);
    });
    function runSearch() {
      query = qEl.value.trim();
      if (query && query.length < 2) {
        statusEl.textContent = 'Type at least 2 characters (a name, an MMSI or an IMO number).';
        return;
      }
      load();
    }
    qEl.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here must not trigger terminal shortcuts
      if (e.key === 'Enter') runSearch();
    });
    qEl.addEventListener('input', () => {
      if (!qEl.value.trim() && query) {
        query = '';
        matches = null;
        load();
      }
    });

    // ---- size ---------------------------------------------------------------------------------------------
    const resize = () => {
      const w = Math.max(240, Math.round(mapBox.clientWidth || root.clientWidth || 600));
      const h = Math.max(220, Math.min(560, Math.round(Math.max(w * 0.5, Math.min(window.innerHeight * 0.5, 480)))));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      if (w === W && h === H && canvas.width === Math.round(w * dpr)) return;
      W = w;
      H = h;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      clamp();
      draw();
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(mapBox);
    resize();
    view.s = Math.max(view.s, fitScale());
    clamp();

    loadLand().then((rings) => {
      land = rings;
      draw();
    }).catch((err) => {
      error = error || `the coastline couldn't be loaded (${err.message}); ships are still shown`;
    });
    load();
    const poll = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);

    return {
      destroy() {
        gone = true;
        clearInterval(poll);
        clearTimeout(timer);
        ro?.disconnect();
      },
    };
  },
});
