// Ships: where the vessels of the world are, from AIS (the transponder every larger ship must
// broadcast: position, speed, course, name, MMSI and IMO number).
//
// Two sources, nothing is invented:
//   1. AISStream (aisstream.io): a free API key gives a live feed of AIS messages received by
//      volunteer and partner stations. The key stays on this device (command AISKEY).
//   2. Digitraffic (meri.digitraffic.fi, Finnish Transport Infrastructure Agency, open data,
//      no key): Finland and the Baltic Sea only. Used while no AISStream key is set.
//
// What AIS can NOT do: it is a radio signal, so only ships near a receiver (coasts, ports, busy
// lanes) are heard. The open ocean is mostly empty on any free feed, and the number of ships
// shown is the number heard recently, not the number that exist. Satellite AIS covering the
// oceans is a paid product.
//
// The feed runs only while somebody looks at the map and stops 10 minutes after the last request.

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const DIGI = 'https://meri.digitraffic.fi/api/ais/v1';
const MESSAGE_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData'];
const IDLE_STOP = 10 * 60e3;
const MAX_AGE = 2 * 3600e3;
const MAX_SHIPS = 200000;
const SHIPS_IN_VIEW = 4000; // more than this in view: counted in grid cells instead

export const CATS = ['Cargo', 'Tanker', 'Passenger', 'Fishing', 'Tug / special', 'Sailing / pleasure', 'Military', 'Other / unknown'];

/** AIS ship-type code (0-99) to one of CATS (index). */
export function categoryOf(type) {
  const t = Number(type);
  if (!Number.isFinite(t) || t <= 0) return 7;
  if (t >= 70 && t <= 79) return 0;
  if (t >= 80 && t <= 89) return 1;
  if (t >= 60 && t <= 69) return 2;
  if (t === 30) return 3;
  if (t === 35) return 6;
  if (t === 36 || t === 37) return 5;
  if ((t >= 31 && t <= 34) || (t >= 50 && t <= 59)) return 4;
  return 7;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export class ShipsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function textOf(data) {
  if (typeof data === 'string') return data;
  if (data && typeof data.text === 'function') return data.text(); // Blob
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data ?? '');
}

export function createShips({ getKey, fetchImpl = fetch, WebSocketImpl = globalThis.WebSocket, maxShips = MAX_SHIPS } = {}) {
  const ships = new Map(); // mmsi -> record
  const st = { source: 'none', state: 'idle', error: null, note: null, messages: 0, since: null, lastMsg: null, fellBack: false };
  let generation = 0;
  let running = false;
  let ws = null;
  let retry = 0;
  const timers = new Set();
  let idleTimer = null;

  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const every = (fn, ms) => {
    const t = setInterval(fn, ms);
    timers.add(t);
    return t;
  };

  function record(mmsi) {
    let r = ships.get(mmsi);
    if (!r) {
      r = { mmsi, name: '', imo: null, type: null, call: '', dest: '', lat: null, lon: null, sog: null, cog: null, hdg: null, nav: null, t: 0 };
      ships.set(mmsi, r);
    }
    return r;
  }

  function place(r, lat, lon, t) {
    if (!finite(lat) || !finite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    if (lat === 91 || lon === 181) return; // AIS "not available"
    r.lat = lat;
    r.lon = lon;
    r.t = t || Date.now();
  }

  // ---- AISStream message ---------------------------------------------------------------------

  function ingestAis(o) {
    const meta = o?.MetaData;
    const type = o?.MessageType;
    if (!meta || !type) return;
    const mmsi = num(meta.MMSI);
    if (!mmsi) return;
    const body = o.Message?.[type] || {};
    const r = record(mmsi);
    const shipName = String(meta.ShipName ?? body.Name ?? '').replace(/@+/g, '').trim();
    if (shipName) r.name = shipName;
    st.messages++;
    st.lastMsg = Date.now();
    if (type === 'ShipStaticData') {
      const imo = num(body.ImoNumber);
      if (imo) r.imo = imo;
      const ty = num(body.Type);
      if (ty != null) r.type = ty;
      if (body.Destination) r.dest = String(body.Destination).replace(/@+/g, '').trim();
      if (body.CallSign) r.call = String(body.CallSign).replace(/@+/g, '').trim();
      return;
    }
    if (type === 'ExtendedClassBPositionReport') {
      const ty = num(body.Type);
      if (ty != null) r.type = ty;
    }
    const sog = num(body.Sog);
    const cog = num(body.Cog);
    const hdg = num(body.TrueHeading);
    r.sog = sog != null && sog < 102.3 ? sog : null;
    r.cog = cog != null && cog < 360 ? cog : null;
    r.hdg = hdg != null && hdg < 360 ? hdg : null;
    r.nav = num(body.NavigationalStatus);
    place(r, num(meta.latitude ?? body.Latitude), num(meta.longitude ?? body.Longitude), Date.now());
  }

  async function onAisMessage(gen, data) {
    let text;
    try {
      text = await textOf(data);
    } catch {
      return;
    }
    if (gen !== generation) return;
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      return;
    }
    if (o?.error) {
      // a wrong key or a refused connection: stop asking AISStream, show the Baltic feed instead
      st.note = `AISStream: ${String(o.error).slice(0, 200)}. Showing the open Baltic feed instead.`;
      st.error = null;
      st.state = 'error';
      closeSocket();
      fallBack(gen);
      return;
    }
    if (st.state !== 'live') {
      st.state = 'live';
      st.error = null;
      st.since = Date.now();
      retry = 0;
    }
    ingestAis(o);
  }

  function closeSocket() {
    const s = ws;
    ws = null;
    if (s) {
      s.onclose = s.onmessage = s.onerror = s.onopen = null;
      try {
        s.close();
      } catch {
        // already closed
      }
    }
  }

  function connectAis(gen) {
    const key = getKey();
    if (!key) return fallBack(gen);
    st.source = 'aisstream';
    st.state = 'connecting';
    let sock;
    try {
      sock = new WebSocketImpl(AIS_URL);
    } catch (err) {
      st.note = `AISStream couldn't be opened (${err?.message || 'WebSocket unavailable'}). Showing the open Baltic feed instead.`;
      return fallBack(gen);
    }
    ws = sock;
    sock.onopen = () => {
      if (gen !== generation) return;
      sock.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: MESSAGE_TYPES }));
    };
    sock.onmessage = (ev) => onAisMessage(gen, ev.data);
    sock.onerror = () => {};
    sock.onclose = () => {
      if (gen !== generation) return;
      ws = null;
      if (st.state === 'error') return;
      st.state = 'connecting';
      st.error = st.error || 'AISStream closed the connection; reconnecting';
      retry = Math.min(retry + 1, 6);
      if (retry >= 4 && !st.lastMsg) {
        st.note = "AISStream didn't answer after several tries. Showing the open Baltic feed instead.";
        return fallBack(gen);
      } // never got anything: use the open feed meanwhile
      later(() => gen === generation && connectAis(gen), Math.min(60e3, 2000 * 2 ** retry));
    };
  }

  // ---- Digitraffic (Finland / Baltic) ----------------------------------------------------------

  async function digi(path) {
    let res;
    try {
      res = await fetchImpl(`${DIGI}${path}`, { headers: { accept: 'application/json', 'Digitraffic-User': 'Meridian-Terminal' }, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      throw Object.assign(new ShipsError(`Digitraffic couldn't be reached (${err?.message || 'network error'})`, 502), { http: 'network' });
    }
    if (!res.ok) throw Object.assign(new ShipsError(`Digitraffic answered HTTP ${res.status}`, res.status), { http: res.status });
    try {
      return await res.json();
    } catch {
      throw new ShipsError('Digitraffic sent something that is not JSON', 502);
    }
  }

  async function digiLocations(gen) {
    const j = await digi(`/locations?from=${Date.now() - 3600e3}`);
    if (gen !== generation) return;
    for (const f of j?.features || []) {
      const mmsi = num(f.mmsi ?? f.properties?.mmsi);
      const c = f.geometry?.coordinates;
      if (!mmsi || !Array.isArray(c)) continue;
      const p = f.properties || {};
      const r = record(mmsi);
      const sog = num(p.sog);
      const cog = num(p.cog);
      const hdg = num(p.heading);
      r.sog = sog != null && sog < 102.3 ? sog : null;
      r.cog = cog != null && cog < 360 ? cog : null;
      r.hdg = hdg != null && hdg < 360 ? hdg : null;
      r.nav = num(p.navStat);
      place(r, num(c[1]), num(c[0]), num(p.timestampExternal ?? p.timestamp) || Date.now());
      st.messages++;
    }
    st.lastMsg = Date.now();
    st.state = 'live';
    st.error = null;
    if (!st.since) st.since = Date.now();
  }

  async function digiVessels(gen) {
    const list = await digi('/vessels');
    if (gen !== generation || !Array.isArray(list)) return;
    for (const v of list) {
      const mmsi = num(v.mmsi);
      if (!mmsi) continue;
      const r = ships.get(mmsi);
      if (!r) continue; // static data only for ships we have seen (keeps memory down)
      if (v.name) r.name = String(v.name).trim();
      if (num(v.imo)) r.imo = num(v.imo);
      if (num(v.shipType) != null) r.type = num(v.shipType);
      if (v.destination) r.dest = String(v.destination).trim();
      if (v.callSign) r.call = String(v.callSign).trim();
    }
  }

  function startDigitraffic(gen) {
    st.source = 'digitraffic';
    st.state = 'connecting';
    const loop = async (fn, ms, first) => {
      let delay = ms;
      const tick = async () => {
        if (gen !== generation) return;
        try {
          await fn(gen);
          delay = ms;
        } catch (err) {
          st.error = err.message;
          if (st.state !== 'live') st.state = 'error';
          delay = Math.min(delay * 2, 10 * 60e3);
        }
        if (gen === generation) later(tick, delay);
      };
      if (first) await tick();
      else later(tick, ms);
    };
    loop(digiLocations, 60e3, true).then(() => loop(digiVessels, 30 * 60e3, true));
  }

  function fallBack(gen) {
    if (gen !== generation) return;
    st.fellBack = true;
    closeSocket();
    startDigitraffic(gen);
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  function prune() {
    const cut = Date.now() - MAX_AGE;
    for (const [k, r] of ships) if (r.t && r.t < cut) ships.delete(k);
    if (ships.size > maxShips) {
      const old = [...ships.values()].sort((a, b) => a.t - b.t).slice(0, Math.ceil(maxShips * 0.1));
      for (const r of old) ships.delete(r.mmsi);
    }
  }

  function start() {
    if (running) return;
    running = true;
    generation++;
    const gen = generation;
    st.error = null;
    st.note = null;
    st.fellBack = false;
    st.state = 'connecting';
    st.since = null;
    every(prune, 60e3);
    if (getKey()) connectAis(gen);
    else startDigitraffic(gen);
  }

  function stop() {
    running = false;
    generation++;
    closeSocket();
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    timers.clear();
    clearTimeout(idleTimer);
    st.state = 'idle';
  }

  /** Called with every request: starts the feed and keeps it alive for another 10 minutes. */
  function touch() {
    start();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, IDLE_STOP);
    idleTimer.unref?.();
  }

  // a new key (or none): restart on the right source
  function restart() {
    const was = running;
    stop();
    ships.clear();
    st.messages = 0;
    st.lastMsg = null;
    retry = 0;
    if (was) touch();
  }

  // ---- queries ---------------------------------------------------------------------------------

  const full = (r) => ({
    mmsi: r.mmsi, name: r.name || null, imo: r.imo, type: r.type, category: CATS[categoryOf(r.type)], call: r.call || null,
    dest: r.dest || null, lat: r.lat, lon: r.lon, sog: r.sog, cog: r.cog, hdg: r.hdg, nav: r.nav, seen: r.t,
  });

  function search(q, limit) {
    const s = String(q).trim().toUpperCase();
    if (s.length < 2) return [];
    const digits = /^\d+$/.test(s);
    const hits = [];
    for (const r of ships.values()) {
      if (r.lat == null) continue;
      let score = 0;
      if (digits) {
        if (String(r.mmsi) === s || String(r.imo) === s) score = 3;
        else if (s.length >= 4 && (String(r.mmsi).startsWith(s) || (r.imo && String(r.imo).startsWith(s)))) score = 1;
      } else if (r.name) {
        const n = r.name.toUpperCase();
        if (n === s) score = 3;
        else if (n.startsWith(s)) score = 2;
        else if (n.includes(s)) score = 1;
      }
      if (score) hits.push([score, r]);
    }
    hits.sort((a, b) => b[0] - a[0] || String(a[1].name).localeCompare(String(b[1].name)));
    return hits.slice(0, limit).map((h) => full(h[1]));
  }

  /**
   * What is in the box [west, south, east, north]: the ships themselves when there are few enough,
   * else grid cells with a count. `list` also returns full records (name, MMSI, IMO...) of up to 200.
   */
  function query({ bbox = [-180, -90, 180, 90], q = '', list = false, limit = 50 } = {}) {
    touch();
    const [w, s, e, n] = bbox;
    const inBox = [];
    const counts = new Array(CATS.length).fill(0);
    let total = 0;
    for (const r of ships.values()) {
      if (r.lat == null) continue;
      total++;
      if (r.lat < s || r.lat > n || r.lon < w || r.lon > e) continue;
      inBox.push(r);
      counts[categoryOf(r.type)]++;
    }
    const out = { ...status(), total, inView: inBox.length, counts, categories: CATS, mode: 'ships' };
    if (inBox.length <= SHIPS_IN_VIEW) {
      out.ships = inBox.map((r) => [r.mmsi, +r.lat.toFixed(4), +r.lon.toFixed(4), r.cog == null ? -1 : Math.round(r.cog), categoryOf(r.type), r.sog == null ? -1 : +r.sog.toFixed(1)]);
      if (list) out.list = inBox.sort((a, b) => String(a.name || '~').localeCompare(String(b.name || '~'))).slice(0, 200).map(full);
    } else {
      out.mode = 'cells';
      const size = Math.max(0.5, (e - w) / 60);
      const cells = new Map();
      for (const r of inBox) {
        const k = `${Math.floor((r.lat + 90) / size)}:${Math.floor((r.lon + 180) / size)}`;
        const c = cells.get(k) || { n: 0, lat: 0, lon: 0 };
        c.n++;
        c.lat += r.lat;
        c.lon += r.lon;
        cells.set(k, c);
      }
      out.cells = [...cells.values()].map((c) => [+(c.lat / c.n).toFixed(3), +(c.lon / c.n).toFixed(3), c.n]);
      out.cellSize = size;
    }
    if (q) out.matches = search(q, Math.min(100, Math.max(1, limit)));
    return out;
  }

  function one(mmsi) {
    touch();
    const r = ships.get(Number(mmsi));
    return r && r.lat != null ? full(r) : null;
  }

  function status() {
    return {
      source: st.source, state: st.state, error: st.error, note: st.note, keyed: !!getKey(), fellBack: st.fellBack,
      known: ships.size, messages: st.messages, lastMsg: st.lastMsg, since: st.since,
    };
  }

  // ---- key check and diagnostics -------------------------------------------------------------------

  /** Opens AISStream once with the key and waits for the first answer (an error message means the key is wrong). */
  function check() {
    const key = getKey();
    if (!key) return Promise.reject(new ShipsError('No AISStream key set', 401));
    return new Promise((resolve, reject) => {
      let done = false;
      let opened = false;
      let sock;
      const fin = (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (sock) {
          sock.onclose = sock.onmessage = sock.onerror = sock.onopen = null;
          try {
            sock.close();
          } catch {
            // already closed
          }
        }
        if (err) reject(err);
        else resolve(true);
      };
      const t = setTimeout(() => fin(opened ? null : Object.assign(new ShipsError("AISStream didn't answer within 10 s (timeout)", 504), { http: 'timeout' })), 10000);
      try {
        sock = new WebSocketImpl(AIS_URL);
      } catch (err) {
        return fin(new ShipsError(`AISStream couldn't be opened (${err?.message || 'WebSocket unavailable'})`, 502));
      }
      sock.onopen = () => {
        opened = true;
        sock.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport'] }));
      };
      sock.onmessage = async (ev) => {
        let o = null;
        try {
          o = JSON.parse(await textOf(ev.data));
        } catch {
          // not JSON: treat as data
        }
        fin(o?.error ? Object.assign(new ShipsError(String(o.error).slice(0, 200), 401), { http: 401 }) : null);
      };
      sock.onerror = () => fin(Object.assign(new ShipsError("AISStream couldn't be reached", 502), { http: 'network' }));
      // a server's error message and its close arrive together: give the message a moment to be read first
      sock.onclose = () => setTimeout(() => fin(Object.assign(new ShipsError('AISStream closed the connection without answering', 502), { http: 'network' })), 300);
    });
  }

  const probe = {
    async digitraffic() {
      const j = await digi(`/locations?from=${Date.now() - 600e3}`);
      return `${(j?.features || []).length} ships in Finnish and Baltic waters in the last 10 minutes`;
    },
  };

  return { query, one, status, touch, stop, restart, check, probe };
}
