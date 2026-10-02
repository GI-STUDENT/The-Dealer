const $ = (s, r = document) => r.querySelector(s);
// The bottom sheet is only for results/status views. Writing into it brings it up.
const content = () => { showSheet(true); return $('#sheet-content'); };
function showSheet(on) {
  const el = $('#sheet');
  if (el) el.classList.toggle('hidden', !on);
  syncProfileAnchor();
}

// On phone widths the avatar sits above the open sheet instead of behind it.
function syncProfileAnchor() {
  const sheet = $('#sheet');
  const open = !!sheet && !sheet.classList.contains('hidden');
  const h = open ? Math.round(sheet.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--profile-anchor', `${h + 16}px`);
}

const fmt = (minor) => 'Rs ' + Math.round(minor / 100).toLocaleString('en-PK');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  published: { label: 'Finding a dealer', cls: 'blue' },
  agent_selected: { label: 'Dealer selected', cls: 'amber' },
  bid_secured: { label: 'Bid paid', cls: 'green' },
  inspected: { label: 'Inspected', cls: 'amber' },
  completed: { label: 'Completed', cls: 'green' },
  failed: { label: 'Not completed', cls: 'red' },
};

const state = { config: null, current: null, list: [], dealers: [], step: 1, user: null, bidTouched: false };

const TOKEN_KEY = 'hd_token';

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = 'toast hidden'), 3000);
}

// ---------- seller location: coordinates or place-name search ----------
// Nominatim (OpenStreetMap) when online, so any place works. A built-in list of Pakistani
// cities keeps the search usable when there is no network.
const PK_PLACES = [
  { name: 'Lahore', area: 'Punjab, Pakistan', lat: 31.5204, lng: 74.3587 },
  { name: 'Johar Town, Lahore', area: 'Lahore, Punjab', lat: 31.468, lng: 74.2417 },
  { name: 'DHA Phase 6, Lahore', area: 'Lahore, Punjab', lat: 31.471, lng: 74.392 },
  { name: 'Gulberg III, Lahore', area: 'Lahore, Punjab', lat: 31.51, lng: 74.345 },
  { name: 'Model Town, Lahore', area: 'Lahore, Punjab', lat: 31.482, lng: 74.322 },
  { name: 'Bahria Town, Lahore', area: 'Lahore, Punjab', lat: 31.468, lng: 74.481 },
  { name: 'Wapda Town, Lahore', area: 'Lahore, Punjab', lat: 31.448, lng: 74.354 },
  { name: 'Karachi', area: 'Sindh, Pakistan', lat: 24.8607, lng: 67.0011 },
  { name: 'Clifton, Karachi', area: 'Karachi, Sindh', lat: 24.8138, lng: 67.03 },
  { name: 'Gulshan-e-Iqbal, Karachi', area: 'Karachi, Sindh', lat: 24.92, lng: 67.08 },
  { name: 'Islamabad', area: 'Capital Territory', lat: 33.6844, lng: 73.0479 },
  { name: 'Rawalpindi', area: 'Punjab, Pakistan', lat: 33.5651, lng: 73.0169 },
  { name: 'Faisalabad', area: 'Punjab, Pakistan', lat: 31.418, lng: 73.079 },
  { name: 'Multan', area: 'Punjab, Pakistan', lat: 30.1575, lng: 71.5249 },
  { name: 'Peshawar', area: 'Khyber Pakhtunkhwa', lat: 34.0151, lng: 71.5249 },
  { name: 'Quetta', area: 'Balochistan, Pakistan', lat: 30.1798, lng: 66.975 },
  { name: 'Gujranwala', area: 'Punjab, Pakistan', lat: 32.1877, lng: 74.1945 },
  { name: 'Sialkot', area: 'Punjab, Pakistan', lat: 32.4945, lng: 74.5229 },
  { name: 'Hyderabad', area: 'Sindh, Pakistan', lat: 25.396, lng: 68.3578 },
  { name: 'Bahawalpur', area: 'Punjab, Pakistan', lat: 29.3956, lng: 71.6836 },
  { name: 'Sargodha', area: 'Punjab, Pakistan', lat: 32.0836, lng: 72.6711 },
  { name: 'Sukkur', area: 'Sindh, Pakistan', lat: 27.7052, lng: 68.8574 },
  { name: 'Abbottabad', area: 'Khyber Pakhtunkhwa', lat: 34.1688, lng: 73.2215 },
  { name: 'Murree', area: 'Punjab, Pakistan', lat: 33.905, lng: 73.39 },
];

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

function parseCoords(q) {
  const m = COORD_RE.exec(q);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) return null;
  return { lat, lng };
}

function localPlaceResults(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return PK_PLACES.filter((p) => (p.name + ' ' + p.area).toLowerCase().includes(s)).slice(0, 6);
}

async function searchPlaces(q) {
  const coords = parseCoords(q);
  if (coords) {
    return [{ name: `${coords.lat}, ${coords.lng}`, area: 'Pasted coordinates', lat: coords.lat, lng: coords.lng }];
  }
  const fallback = localPlaceResults(q);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&q=' + encodeURIComponent(q);
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      const hits = (Array.isArray(data) ? data : []).map((r) => {
        const parts = String(r.display_name || '').split(',').map((p) => p.trim());
        return { name: parts.slice(0, 2).join(', ') || q, area: parts.slice(2).join(', '), lat: Number(r.lat), lng: Number(r.lon) };
      });
      if (hits.length) return hits;
    }
  } catch {}
  finally { clearTimeout(timer); }
  return fallback;
}

// Tap-to-pick: resolve the tapped point to a place name (nearest known place when offline).
function haversineKm(a, b, c, d) {
  const R = 6371, p = Math.PI / 180;
  const x = Math.sin(((c - a) * p) / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function reversePlace(lat, lng) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.ok) {
      const d = await res.json();
      const a = d.address || {};
      const name = [a.shop, a.amenity, a.tourism, a.leisure, a.house, a.building, a.road, a.pedestrian]
        .find((x) => typeof x === 'string' && x.trim()) || d.name;
      const city = [a.suburb, a.neighbourhood, a.city_district, a.town, a.city, a.village, a.county].find((x) => typeof x === 'string' && x.trim());
      if (name && city) return `${name}, ${city}`;
      if (name) return String(name);
      if (city) return String(city);
      if (d.display_name) return String(d.display_name).split(',').slice(0, 2).join(',').trim();
    }
  } catch {}
  finally { clearTimeout(timer); }

  let best = null;
  for (const p of PK_PLACES) {
    const km = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || km < best.km) best = { p, km };
  }
  if (best && best.km <= 35) return best.km < 2 ? best.p.name : `${best.p.name} (${best.km.toFixed(1)} km)`;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// ---------- map loading progress line (top of the bar) ----------
let mapProgressEl = null;
let mapStatus = 'loading';

function setMapStatus(s) {
  mapStatus = s;
  if (mapProgressEl) mapProgressEl.className = 'mapload ' + s;
}

function mountMapProgress() {
  const host = $('#map');
  if (!host) return;
  if (!mapProgressEl) {
    mapProgressEl = document.createElement('div');
    mapProgressEl.id = 'mapload';
    mapProgressEl.innerHTML = '<i></i>';
  }
  mapProgressEl.className = 'mapload ' + mapStatus;
  if (mapProgressEl.parentElement !== host) host.appendChild(mapProgressEl);
}

// ---------- map (OpenFreeMap vector tiles via MapLibre, no API key) ----------
const LAHORE = [74.3587, 31.5204];
const SPOTS = [
  [74.3450, 31.5350], [74.3800, 31.5300], [74.3720, 31.5060],
  [74.3340, 31.5110], [74.3960, 31.5450], [74.3220, 31.5300],
];
const WORLD_VIEW = { center: [30, 18], zoom: 1.6 };
let map = null;
let mapReady = false;
let mapErrCount = 0;
let queuedMarkers = null;
let dealerMarkers = [];
let sellerMarker = null;

function flyTo(center, zoom) {
  if (map) map.flyTo({ center, zoom, duration: 900 });
}
function worldView() { flyTo(WORLD_VIEW.center, WORLD_VIEW.zoom); }
function cityView() { flyTo(LAHORE, 12.4); }

function setOrigin(lng, lat) {
  if (!map || lng == null || lat == null) return;
  if (!sellerMarker) {
    const el = document.createElement('div');
    el.className = 'mepin';
    el.title = 'Seller location';
    sellerMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
  } else {
    sellerMarker.setLngLat([lng, lat]);
  }
}

function clearOrigin() {
  if (sellerMarker) { sellerMarker.remove(); sellerMarker = null; }
}

// OpenFreeMap's "liberty" style concatenates latin + non-latin (Urdu/Arabic) names. MapLibre
// cannot shape Arabic script, so those labels render as disconnected letters. Force English.
const EN_LABEL = ['coalesce', ['get', 'name:en'], ['get', 'name:latin']];
let applyingLabels = false;
function applyEnglishLabels() {
  if (!map || applyingLabels) return 0;
  const style = map.getStyle();
  if (!style || !style.layers) return 0;
  const target = JSON.stringify(EN_LABEL);
  applyingLabels = true;
  let n = 0;
  try {
    for (const layer of style.layers) {
      if (layer.type !== 'symbol') continue;
      const tf = layer.layout && layer.layout['text-field'];
      if (!tf) continue;
      const s = JSON.stringify(tf);
      if (s === target) continue;
      if (s.includes('"ref"')) continue;
      if (!/name/.test(s)) continue;
      try { map.setLayoutProperty(layer.id, 'text-field', EN_LABEL); n++; } catch {}
    }
  } finally {
    applyingLabels = false;
  }
  return n;
}

function initMap() {
  if (map) return;
  mountMapProgress();
  if (typeof maplibregl === 'undefined') {
    setMapStatus('fail');
    toast('Map library did not load. Refresh the page.', true);
    return;
  }
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: WORLD_VIEW.center,
      zoom: WORLD_VIEW.zoom,
      attributionControl: false,
    });
  } catch (e) {
    setMapStatus('fail');
    toast('Map could not start. Use an up-to-date browser with WebGL enabled.', true);
    return;
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  mapReady = true;
  window.__map = map;
  window.__mapErrors = [];
  let mapErrShown = false;
  map.on('error', (e) => {
    const msg = e && e.error ? String(e.error.message || e.error) : 'unknown';
    window.__mapErrors.push(msg);
    mapErrCount++;
    if (!mapErrShown) {
      mapErrShown = true;
      toast('Map could not load. Check your internet connection.', true);
    }
  });
  map.on('styledata', applyEnglishLabels);
  window.__applyLabels = applyEnglishLabels;

  // Progress line in the bar: sweeping while tiles load, solid when the map is ready.
  map.on('load', () => setMapStatus('done'));
  map.on('idle', () => setMapStatus('done'));
  setTimeout(() => { if (mapStatus === 'loading') setMapStatus(mapErrCount ? 'fail' : 'done'); }, 12000);

  // Tap anywhere on the map to pick that spot as the seller location.
  map.on('click', (e) => {
    if (state.current) return;
    const { lat, lng } = e.lngLat;
    pickLocation(lat, lng);
  });
  window.__pickAt = pickLocation;

  setTimeout(applyEnglishLabels, 1500);
  setTimeout(applyEnglishLabels, 3500);
  setTimeout(applyEnglishLabels, 7000);
  setTimeout(applyEnglishLabels, 12000);
  if (queuedMarkers) { paintMarkers(queuedMarkers); queuedMarkers = null; }
}

function paintMarkers(items) {
  if (!mapReady) { queuedMarkers = items; return; }
  dealerMarkers.forEach((m) => m.remove());
  dealerMarkers = [];
  items.forEach((it, i) => {
    const coords = it.at || SPOTS[i % SPOTS.length];
    const el = document.createElement('div');
    el.className = 'mpin' + (it.last ? ' last' : '');
    el.innerHTML = it.last
      ? `<span class="av">→</span>${esc(it.label || 'Dealer')}`
      : `<span class="av">${it.photo ? `<img src="${it.photo}" alt="">` : esc((it.name || '?')[0])}</span>${esc((it.name || 'Dealer').split(' ')[0])}`;
    if (it.profile) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openDealerProfile(it.profile.reqId, it.profile.responseId);
      });
    }
    dealerMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map));
  });
}

// ---------- band helpers ----------
// Fair range is purely distance based: Rs 30 per km between seller and dealer, capped at the
// 50 km range (Rs 1,500). No category maths.
function computeBand(radiusKm = state.form.radiusKm) {
  const cfg = state.config || {};
  const rate = Number(cfg.bidPerKm) || 3000;
  const maxKm = Number(cfg.maxRadiusKm) || 50;
  const km = Math.min(maxKm, Math.max(1, Math.ceil(Number(radiusKm) || 1)));
  const mid = Math.round(rate * km);
  return { km, min: Math.round(mid * 0.85), mid, max: Math.round(mid * 1.2) };
}

function normalBidRupees(radiusKm) { return Math.max(50, Math.round(computeBand(radiusKm).mid / 100)); }

function setForm(patch) { state.form = { ...state.form, ...patch }; }

const defaultForm = () => {
  const radiusKm = Math.min(50, Math.max(1, Number(localStorage.getItem('hd_radius')) || 15));
  return {
    category: 'phone',
    title: '',
    description: '',
    location: '',
    lat: null,
    lng: null,
    radiusKm,
    askingPrice: 150000,
    // Start on the distance-based normal: Rs 30/km of range.
    bid: normalBidRupees(radiusKm),
  };
};

function hasLocation() { return state.form.lat != null && state.form.lng != null; }
function canPost() { return hasLocation() && String(state.form.title).trim().length > 0; }

// ---------- top bar ----------
function renderTopbar(req) {
  const tb = $('#topbar');
  if (!tb) return;

  if (req) {
    tb.classList.add('hidden');
    tb.innerHTML = '';
    return;
  }
  tb.classList.remove('hidden');

  const f = state.form;
  const step = state.step;

  const pills = [
    ['1', 'Location', stepDone(1)],
    ['2', 'Bid', stepDone(2)],
    ['3', 'Item', stepDone(3)],
  ].map(([n, label, done]) => {
    const cls = Number(n) === step ? 'on' : done ? 'done' : '';
    const mark = done && Number(n) !== step ? '✓' : n;
    return `<button type="button" class="pill ${cls}" data-step="${n}"><i>${mark}</i>${label}</button>`;
  }).join('');

  let body = '';
  if (step === 1) {
    body = `
      <div class="locbox">
        <input class="locinput" id="loc-input" placeholder="Search a place, or tap the map to pick"
               value="${esc(f.location)}" autocomplete="off" spellcheck="false">
        <button class="locbtn" id="loc-go">Search</button>
      </div>
      <div class="locresults hidden" id="loc-results"></div>
      <div class="locchip ${hasLocation() ? '' : 'hidden'}" id="loc-chip">
        <span>📍</span><span id="loc-chip-text">${esc(f.location)}</span>
        <span class="loccount" id="loc-coord">${hasLocation() ? `${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}` : ''}</span>
      </div>`;
  } else if (step === 2) {
    body = `
      <div class="bidbox">
        <div class="bidrow">
          <button type="button" class="step" id="bid-minus">−</button>
          <div class="bidval"><b id="bid-val">${fmt(f.bid * 100)}</b><span>you pay the agent</span></div>
          <button type="button" class="step" id="bid-plus">+</button>
        </div>
        <div class="rangebar"><div class="band" id="band-seg"></div><div class="you" id="you-mark"></div></div>
        <div class="rlabels"><span id="r-min"></span><span id="r-max"></span></div>
        <div class="bandnote" id="bandnote"></div>
        <div class="flag" id="flag"></div>
      </div>
      <div class="field"><label>Item asking price (Rs)</label>
        <input class="input" id="f-price" type="number" min="1" step="500" value="${f.askingPrice}"></div>`;
  } else {
    body = `
      <div class="field"><label class="budgetlabel">Item <span class="cnt" id="title-cnt">${f.title.length}/50</span></label>
        <input class="input" id="f-title" maxlength="50" placeholder="e.g. iPhone 13 Pro 256GB" value="${esc(f.title)}"></div>
      <div class="field"><label class="budgetlabel">Description <span class="cnt" id="desc-cnt">${f.description.length}/150</span></label>
        <textarea class="input" id="f-desc" maxlength="150" rows="2" placeholder="Condition, accessories, what to check">${esc(f.description)}</textarea></div>`;
  }

  const action = step === 3
    ? `<button type="button" class="btn primary" id="post" ${canPost() ? '' : 'disabled'}>Find dealers · <span id="cta-price">${fmt(f.bid * 100)}</span></button>`
    : `<button type="button" class="btn primary" id="tb-next">${step === 1 ? 'Next: set your bid' : 'Next: describe the item'}</button>`;

  const foot = (step > 1 && hasLocation() ? `
    <button type="button" class="chosen" data-step="1" title="Change location">
      <span class="pin">📍</span>
      <span class="txt" id="chosen-text">${esc(f.location)}</span>
      <span class="loccount">${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)} · within ${f.radiusKm} km</span>
      <span class="edit">Edit</span>
    </button>` : '')
    + (step === 1 ? `
    <div class="tb-radius">
      <input type="range" id="f-radius" min="1" max="50" step="1" value="${f.radiusKm}" aria-label="Search radius">
      <b id="radius-label">${f.radiusKm} km</b>
    </div>` : '')
    + action;

  tb.innerHTML = `
    <div class="tb-steps">${pills}</div>
    <div class="tb-body">${body}</div>
    <div class="tb-foot">${foot}</div>`;

  tb.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => { state.step = Number(b.dataset.step); renderTopbar(); }));

  const next = $('#tb-next');
  if (next) next.addEventListener('click', () => { state.step = Math.min(3, state.step + 1); renderTopbar(); });

  if (step === 1) wireLocationStep();
  if (step === 2) { wireBidStep(); paintBid(); }
  if (step === 3) {
    wireItemStep();
    const p = $('#post');
    if (p) p.addEventListener('click', post);
  }
}

function wireLocationStep() {
  const input = $('#loc-input');
  const results = $('#loc-results');

  const run = async () => {
    const q = input.value.trim();
    if (!q) { toast('Type a place name, or paste coordinates.', true); return; }
    results.classList.remove('hidden');
    results.innerHTML = '<div class="locres"><span>Searching…</span></div>';
    const hits = await searchPlaces(q);
    if (!hits.length) {
      results.innerHTML = '<div class="locres"><span>No place found. Try another name or paste lat, lng.</span></div>';
      return;
    }
    results.innerHTML = hits.map((h, i) =>
      `<div class="locres" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.area || '')}</span></div>`).join('');
    results.querySelectorAll('[data-i]').forEach((el) =>
      el.addEventListener('click', () => applyLocation(hits[Number(el.dataset.i)].lat, hits[Number(el.dataset.i)].lng, hits[Number(el.dataset.i)].name)));
  };

  $('#loc-go').addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  input.addEventListener('input', () => {
    clearTimeout(wireLocationStep._t);
    wireLocationStep._t = setTimeout(() => { if (input.value.trim()) run(); }, 450);
  });

  $('#f-radius').addEventListener('input', (e) => {
    const km = Number(e.target.value);
    const patch = { radiusKm: km };
    // Re-price the bid off the new distance unless the buyer has steered it themselves.
    if (!state.bidTouched) patch.bid = normalBidRupees(km);
    setForm(patch);
    $('#radius-label').textContent = e.target.value + ' km';
    const h = $('#find-hint');
    if (h && state.step !== 1) h.textContent = `Will show dealers available within ${e.target.value} km.`;
  });
}

function wireBidStep() {
  $('#bid-minus').addEventListener('click', () => { state.bidTouched = true; setForm({ bid: Math.max(50, state.form.bid - 100) }); paintBid(); refreshNext(); });
  $('#bid-plus').addEventListener('click', () => { state.bidTouched = true; setForm({ bid: state.form.bid + 100 }); paintBid(); refreshNext(); });
  $('#f-price').addEventListener('input', (e) => { setForm({ askingPrice: Number(e.target.value) || 0 }); paintBid(); });
}

function wireItemStep() {
  const t = $('#f-title');
  const d = $('#f-desc');
  t.addEventListener('input', () => {
    setForm({ title: t.value });
    $('#title-cnt').textContent = `${t.value.length}/50`;
    refreshNext();
  });
  d.addEventListener('input', () => {
    setForm({ description: d.value });
    $('#desc-cnt').textContent = `${d.value.length}/150`;
    refreshNext();
  });
}

function refreshNext() {
  const b = $('#post');
  if (b) b.disabled = !canPost();
}

function applyLocation(lat, lng, label) {
  setForm({ lat, lng, location: label });
  setOrigin(lng, lat);
  flyTo([lng, lat], 12);
  if (state.step === 1) state.step = 2;
  renderTopbar();
}

// Used by the map "click to pick" handler and by tests.
async function pickLocation(lat, lng) {
  if (state.current) return null;
  toast('Finding this place…');
  const label = await reversePlace(lat, lng);
  applyLocation(lat, lng, label);
  toast(`Picked: ${label}`);
  return label;
}

// ---------- step gating ----------
function stepDone(n) {
  const f = state.form;
  if (n === 1) return hasLocation();
  if (n === 2) return hasLocation() && f.bid > 0 && f.askingPrice > 0;
  if (n === 3) return hasLocation() && f.bid > 0 && f.askingPrice > 0 && String(f.title).trim().length > 0;
  return false;
}

// ---------- views ----------
function renderHome() {
  const f = state.form;
  state.step = Math.min(3, Math.max(1, Number(state.step) || 1));
  showSheet(false);

  paintMarkers([]);
  if (hasLocation()) { setOrigin(f.lng, f.lat); flyTo([f.lng, f.lat], 12); }
  else { clearOrigin(); worldView(); }

  renderTopbar();
}

function paintBid() {
  const f = state.form;
  const band = computeBand();
  const bidMinor = f.bid * 100;
  $('#bid-val').textContent = fmt(bidMinor);
  const cta = $('#cta-price');
  if (cta) cta.textContent = fmt(bidMinor);
  $('#r-min').textContent = fmt(band.min);
  $('#r-max').textContent = fmt(band.max);

  const rateLabel = (state.config && state.config.bidPerKmLabel) || 'Rs 30';
  const maxKm = (state.config && state.config.maxRadiusKm) || 50;
  const atMax = band.km >= maxKm ? '' : ` · ${maxKm} km = ${fmt((band.mid / band.km) * maxKm)}`;
  const note = $('#bandnote');
  if (note) note.textContent = `${rateLabel}/km × ${band.km} km = ${fmt(band.mid)} normal${atMax}`;

  const lo = band.min * 0.5;
  const hi = band.max * 1.4;
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const seg = $('#band-seg');
  seg.style.left = pct(band.min) + '%';
  seg.style.width = (pct(band.max) - pct(band.min)) + '%';
  $('#you-mark').style.left = pct(bidMinor) + '%';

  const flag = $('#flag');
  if (bidMinor < band.min) { flag.className = 'flag low'; flag.textContent = `Below typical for ${band.km} km — dealers may counter`; }
  else if (bidMinor > band.max) { flag.className = 'flag high'; flag.textContent = `Above typical for ${band.km} km — you may be overpaying`; }
  else { flag.className = 'flag ok'; flag.textContent = `Fair range for this job · ${band.km} km`; }
}

function statusView(req) {
  paintMarkersFromRequest(req);
  if (req.origin) { setOrigin(req.origin.lng, req.origin.lat); flyTo([req.origin.lng, req.origin.lat], 12); }
  else cityView();
  renderTopbar(req);
  if (req.status === 'published') return renderWaiting(req);
  if (req.status === 'agent_selected') return renderSelected(req);
  if (req.status === 'bid_secured') return renderSecured(req);
  if (req.status === 'inspected') return renderInspected(req);
  return renderDone(req);
}

function paintMarkersFromRequest(req) {
  const resp = req.responses || [];
  if (req.status === 'published') {
    paintMarkers(resp.map((r) => ({
      name: r.dealer.name,
      at: r.dealer.at,
      photo: r.dealer.photo,
      profile: { reqId: req.id, responseId: r.id },
    })));
  } else {
    const chosen = resp.find((r) => r.id === req.selectedResponseId) || resp[0];
    if (chosen) paintMarkers([{ name: chosen.dealer.name, at: chosen.dealer.at, label: 'Dealer on the way', last: true }]);
  }
}

function header(req, glyph, bg) {
  const s = STATUS[req.status];
  const place = req.origin ? req.origin.place : req.location;
  return `<div class="statushead">
    <div class="big" style="background:${bg}">${glyph}</div>
    <div><h1>${esc(req.title)}</h1><p>${esc(place)} · within ${req.radiusKm} km · <span class="badgepill ${s.cls}">${s.label}</span></p></div>
  </div>`;
}

function renderWaiting(req) {
  const cards = req.responses.map((r, i) => {
    const tag = r.kind === 'accept' ? 'Accept' : 'Counter';
    const d = r.dealer;
    return `<div class="dealer" data-profile="${r.id}" role="button" tabindex="0" style="animation-delay:${i * 0.12}s">
      <div class="av">${d.photo ? `<img src="${d.photo}" alt="">` : esc(d.name[0])}</div>
      <div class="info"><b>${esc(d.name)}</b>
        <div class="meta">${d.rating}★ · ${d.jobs} jobs · ${d.distanceKm} km away</div>
        <div class="note">"${esc(r.note)}"</div>
        <div class="peek">Reviews &amp; responses →</div>
      </div>
      <div class="price"><b>${fmt(r.amountMinor)}</b><span class="tag ${r.kind}">${tag}</span>
        <div><button class="go" data-select="${r.id}">Hire</button></div>
      </div></div>`;
  }).join('');

  content().innerHTML = `
    ${header(req, '📡', '#e8f1fe')}
    <div class="waittop"><div class="radar"></div><div>
      <b>${req.responses.length} dealers available within ${req.radiusKm} km</b>
      <div class="sub" style="margin:0;font-size:12.5px">Your bid ${fmt(req.bidMinor)} · ${req.check.belowBand ? 'below typical' : 'within typical'}</div>
    </div></div>
    ${cards}
    <button class="btn ghost" id="back-home">Change search</button>
  `;
  content().querySelectorAll('[data-select]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); act(req.id, '/select', { responseId: b.dataset.select }); }));
  content().querySelectorAll('[data-profile]').forEach((el) => {
    el.addEventListener('click', () => renderDealerProfile(req, el.dataset.profile));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderDealerProfile(req, el.dataset.profile); }
    });
  });
  $('#back-home').addEventListener('click', goHome);
}

// Clicking a dealer's map pin opens the same review page as clicking their card.
async function openDealerProfile(reqId, responseId) {
  let req = state.current && state.current.id === reqId ? state.current : null;
  if (!req) {
    try { req = await api('/api/requests/' + reqId); } catch { return; }
    state.current = req;
  }
  renderDealerProfile(req, responseId);
}

function renderDealerProfile(req, responseId) {
  const r = req.responses.find((x) => x.id === responseId);
  if (!r) return renderWaiting(req);
  const d = r.dealer;
  const tag = r.kind === 'accept' ? 'Accept' : 'Counter';
  const stars = (n) => `${'★'.repeat(Math.max(0, Math.min(5, n)))}${'☆'.repeat(Math.max(0, 5 - n))}`;

  const reviews = (d.reviews || []).length
    ? d.reviews.map((v) => `
      <div class="review">
        <div class="rstars">${stars(v.stars)}</div>
        <p>${esc(v.text)}</p>
        <div class="rby">${esc(v.author)} · ${esc(v.when)}</div>
      </div>`).join('')
    : `<div class="dpempty">No reviews yet.</div>`;

  const replies = (d.replies || []).length
    ? d.replies.map((t) => `<div class="resp"><span class="q">“</span><div class="respbody">${esc(t)}</div></div>`).join('')
    : `<div class="dpempty">No responses yet.</div>`;

  content().innerHTML = `
    <div class="dpbar">
      <button class="modalback" id="dp-back">← All dealers</button>
      <span class="dpratepill">${d.rating}★ · ${d.jobs} jobs</span>
    </div>

    <div class="dphead">
      <div class="av big">${d.photo ? `<img src="${d.photo}" alt="">` : esc(d.name[0])}</div>
      <div class="dpwho">
        <b>${esc(d.name)}</b>
        <div class="dprate">${stars(Math.round(d.rating))} <span>${d.rating}</span></div>
        <div class="dpstats">
          <span>${d.acceptRate}% accept rate</span>
          <span>~${d.replyMin} min reply</span>
          <span>${d.jobs} jobs done</span>
        </div>
      </div>
    </div>

    <div class="dpquote">"${esc(r.note)}"
      <span>Response to your job · ${fmt(r.amountMinor)} ${tag}</span>
    </div>

    <div class="dpsec"><h3>Reviews</h3><div class="dpsub">What people said</div></div>
    ${reviews}

    <div class="dpsec"><h3>Responses</h3><div class="dpsub">What he sent to buyers</div></div>
    ${replies}

    <div style="height:14px"></div>
    <button class="btn primary" id="dp-hire">Hire ${esc(d.name.split(' ')[0])} · ${fmt(r.amountMinor)}</button>
    <div style="height:10px"></div>
    <button class="btn ghost" id="dp-back2">Back to responses</button>
  `;

  const back = () => renderWaiting(req);
  $('#dp-back').addEventListener('click', back);
  $('#dp-back2').addEventListener('click', back);
  $('#dp-hire').addEventListener('click', () => act(req.id, '/select', { responseId: r.id }));
}

function renderSelected(req) {
  const r = req.responses.find((x) => x.id === req.selectedResponseId);
  content().innerHTML = `
    ${header(req, '✅', '#fef4e2')}
    <div class="dealer">
      <div class="av">${r.dealer.photo ? `<img src="${r.dealer.photo}" alt="">` : esc(r.dealer.name[0])}</div>
      <div class="info"><b>${esc(r.dealer.name)}</b>
        <div class="meta">${r.dealer.rating}★ · ${r.dealer.jobs} jobs · ${r.dealer.distanceKm} km away · ${esc(r.dealer.city)}</div>
        <div class="note">"${esc(r.note)}"</div>
      </div>
      <div class="price"><b>${fmt(req.agreedBidMinor)}</b><span class="tag accept">Job price</span></div>
    </div>
    <div class="receipt">
      <div class="line"><span class="k">Inspection bid</span><b>${fmt(req.agreedBidMinor)}</b></div>
      <div class="line total"><span class="k">Pay now to secure the dealer</span><b>${fmt(req.agreedBidMinor)}</b></div>
    </div>
    <div class="notice">Paid in-app. Released to the dealer on completion, or split per the outcome policy if the deal doesn't close.</div>
    <div style="height:14px"></div>
    <button class="btn primary" id="pay">Pay ${fmt(req.agreedBidMinor)}</button>
    <div style="height:10px"></div>
    <button class="btn ghost" id="back">Back to responses</button>
  `;
  $('#pay').addEventListener('click', () => act(req.id, '/pay', {}));
  $('#back').addEventListener('click', () => openRequest(req.id));
}

function renderSecured(req) {
  const steps = [
    ['Hired', 'Dealer accepted your bid', true],
    ['On the way', 'Travelling to the seller', true],
    ['At seller', 'Verifying seller identity & 3% fee consent', false],
    ['Live inspection', 'You watch the item being checked on video', false],
    ['Report', 'Verdict and photos delivered', false],
  ];
  const tl = steps.map(([t, d, done], i) => `<div class="tl ${done ? 'done' : i === 2 ? 'active' : ''}">
    <div class="dot">${done ? '✓' : ''}</div><div><div class="t">${t}</div><div class="d">${d}</div></div></div>`).join('');

  content().innerHTML = `
    ${header(req, '🛵', '#e7f8ef')}
    <div class="timeline">${tl}</div>
    <div class="divider"></div>
    <label class="field" style="display:block"><span style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px">Simulate inspection (demo)</span></label>
    <div class="field"><label>Verdict</label>
      <select id="v"><option value="pass">Pass — worth buying</option><option value="negotiate">Negotiate — problems found</option><option value="reject">Reject — do not buy</option></select>
    </div>
    <div class="field"><label>Notes</label><textarea id="n" rows="2" placeholder="e.g. Battery health 88%, small scratch on frame"></textarea></div>
    <button class="btn dark" id="report">Submit report</button>
    <div style="height:10px"></div>
    <button class="btn ghost" id="home">Home</button>
  `;
  $('#report').addEventListener('click', () => act(req.id, '/inspect', { verdict: $('#v').value, notes: $('#n').value }));
  $('#home').addEventListener('click', goHome);
}

function renderInspected(req) {
  const v = req.inspection.verdict;
  content().innerHTML = `
    ${header(req, '🔎', '#f3ebff')}
    <div class="receipt">
      <div class="line"><span class="k">Verdict</span><b>${esc(v)}</b></div>
      ${req.inspection.notes ? `<div class="line"><span class="k">Notes</span><b style="text-align:right;max-width:60%">${esc(req.inspection.notes)}</b></div>` : ''}
    </div>
    <div class="divider"></div>
    <div class="field"><label>Final sale price (Rs)</label><input class="input" id="sale" type="number" min="1" step="500" value="${Math.round(req.askingMinor / 100)}"></div>
    <button class="btn green" id="complete">Sale completed</button>
    <div style="height:10px"></div>
    <div class="field"><label>Did the deal fall through?</label><select id="fail"></select></div>
    <button class="btn danger" id="nope">Deal did not close</button>
    <div style="height:10px"></div>
    <button class="btn ghost" id="home">Home</button>
  `;
  const sel = $('#fail');
  state.config.failures.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.key; o.textContent = f.label;
    sel.appendChild(o);
  });
  $('#complete').addEventListener('click', () => act(req.id, '/complete', { salePrice: Number($('#sale').value) }));
  $('#nope').addEventListener('click', () => act(req.id, '/fail', { outcome: sel.value }));
  $('#home').addEventListener('click', goHome);
}

function renderDone(req) {
  if (req.status === 'completed') {
    const m = req.money;
    content().innerHTML = `
      ${header(req, '🎉', '#e7f8ef')}
      <h1 class="title" style="font-size:18px">Sale complete — fees charged</h1>
      <p class="sub">Your money went straight to the seller. We only charged the success fees.</p>
      <div class="receipt">
        <div class="line"><span class="k">Sale price</span><b>${fmt(m.salePrice)}</b></div>
        <div class="line"><span class="k">Inspection bid</span><b>${fmt(m.bidPaid)}</b></div>
        <div class="line"><span class="k">Buyer success fee (5%)</span><b>${fmt(m.buyerFee)}</b></div>
        <div class="line"><span class="k">You paid in total</span><b>${fmt(m.buyerTotal)}</b></div>
        <div class="divider" style="margin:0"></div>
        <div class="line"><span class="k">Seller success fee (3%)</span><b>${fmt(m.sellerFee)}</b></div>
        <div class="line"><span class="k">Seller receives</span><b>${fmt(m.sellerReceives)}</b></div>
        <div class="divider" style="margin:0"></div>
        <div class="line"><span class="k">Dealer bonus (2%)</span><b>${fmt(m.dealerBonus)}</b></div>
        <div class="line total"><span class="k">Dealer total (bid + bonus)</span><b>${fmt(m.dealerTotal)}</b></div>
      </div>`;
  } else {
    const s = req.money.settlement;
    const paid = s.dealerBidAmount + s.buyerRefund;
    content().innerHTML = `
      ${header(req, '😔', '#fdecec')}
      <h1 class="title" style="font-size:18px">${esc(req.money.outcomeLabel)}</h1>
      <p class="sub">No sale means no success fee, no bonus, and no company take.</p>
      <div class="receipt">
        <div class="line"><span class="k">Bid you paid</span><b>${fmt(paid)}</b></div>
        <div class="line"><span class="k">Dealer keeps (${s.dealerBidShareBps / 100}%)</span><b>${fmt(s.dealerBidAmount)}</b></div>
        <div class="line total"><span class="k">Refunded to you</span><b>${fmt(s.buyerRefund)}</b></div>
        <div class="line"><span class="k">Success fees</span><b>Rs 0</b></div>
      </div>`;
  }
  const b = document.createElement('button');
  b.className = 'btn primary';
  b.style.marginTop = '16px';
  b.textContent = 'New request';
  b.addEventListener('click', goHome);
  content().appendChild(b);
}

// ---------- accounts: home / login / signup ----------
function hideAuth() { $('#auth').classList.add('hidden'); }

function showAuth(view = 'home') {
  const el = $('#auth');
  el.classList.remove('hidden');
  setProfileMenu(null);
  const tb = $('#topbar');
  tb.innerHTML = '';
  tb.classList.add('hidden');
  showSheet(false);

  if (view === 'login') {
    el.innerHTML = `
      <div class="authcard">
        <div class="authlogo">HD</div>
        <h1 class="authtitle">Welcome back</h1>
        <p class="authsub">Log in to hire an agent near the seller.</p>
        <div class="field"><label>Email</label><input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input class="input" id="au-pass" type="password" autocomplete="current-password" placeholder="At least 6 characters"></div>
        <div class="autherr hidden" id="au-err"></div>
        <button class="btn primary" id="au-go">Log in</button>
        <div class="authalt">New here? <button type="button" data-go="signup">Create an account</button></div>
      </div>`;
  } else if (view === 'signup') {
    el.innerHTML = `
      <div class="authcard">
        <div class="authlogo">HD</div>
        <h1 class="authtitle">Create your account</h1>
        <p class="authsub">Inspect it before you pay.</p>
        <div class="field"><label>Name</label><input class="input" id="au-name" autocomplete="name" placeholder="Your name"></div>
        <div class="field"><label>Email</label><input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com"></div>
        <div class="field"><label>Password</label><input class="input" id="au-pass" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
        <div class="autherr hidden" id="au-err"></div>
        <button class="btn primary" id="au-go">Create account</button>
        <div class="authalt">Already have an account? <button type="button" data-go="login">Log in</button></div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="authcard">
        <div class="authlogo">HD</div>
        <h1 class="authtitle">Hire a Dealer</h1>
        <p class="authsub">Inspect it before you pay — hire a verified agent near the seller.</p>
        <button class="btn primary" id="au-login">Log in</button>
        <div style="height:10px"></div>
        <button class="btn ghost" id="au-signup">Create account</button>
      </div>`;
  }
  wireAuth(view);
}

function authError(msg) {
  const e = $('#au-err');
  if (!e) return;
  e.textContent = msg;
  e.classList.toggle('hidden', !msg);
}

function wireAuth(view) {
  const go = (v) => showAuth(v);
  const swap = document.querySelector('[data-go]');
  if (swap) swap.addEventListener('click', () => go(swap.dataset.go));
  const l = $('#au-login');
  if (l) l.addEventListener('click', () => go('login'));
  const s = $('#au-signup');
  if (s) s.addEventListener('click', () => go('signup'));

  const btn = $('#au-go');
  if (!btn) return;
  const submit = async () => {
    authError('');
    btn.disabled = true;
    btn.textContent = view === 'signup' ? 'Creating…' : 'Logging in…';
    try {
      const email = $('#au-email').value.trim();
      const password = $('#au-pass').value;
      const body = view === 'signup'
        ? { name: $('#au-name').value.trim(), email, password }
        : { email, password };
      const res = await api(`/api/auth/${view === 'signup' ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem(TOKEN_KEY, res.token);
      state.user = res.user;
      enterApp();
    } catch (e) {
      authError(e.message);
      btn.disabled = false;
      btn.textContent = view === 'signup' ? 'Create account' : 'Log in';
    }
  };
  btn.addEventListener('click', submit);
  document.querySelectorAll('#auth .input').forEach((i) =>
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
}

function enterApp() {
  hideAuth();
  setProfileMenu(state.user);
  renderHome();
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  localStorage.removeItem(TOKEN_KEY);
  state.user = null;
  state.current = null;
  state.form = defaultForm();
  state.step = 1;
  clearOrigin();
  paintMarkers([]);
  showAuth('home');
}

// ---------- profile menu (bottom-left) ----------
function setProfileMenu(user) {
  const el = $('#profile');
  if (!user) { closeProfileMenu(); el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('#avatar').textContent = ((user.name || '?').trim()[0] || '?').toUpperCase();
  $('#pm-name').textContent = user.name || '';
  $('#pm-email').textContent = user.email || '';
}

function closeProfileMenu() {
  const m = $('#pmenu');
  if (m) m.classList.add('hidden');
  const a = $('#avatar');
  if (a) a.setAttribute('aria-expanded', 'false');
}

function toggleProfileMenu() {
  const m = $('#pmenu');
  const open = m.classList.contains('hidden');
  m.classList.toggle('hidden', !open);
  $('#avatar').setAttribute('aria-expanded', String(open));
}

function wireProfile() {
  const avatar = $('#avatar');
  if (!avatar) return;
  avatar.addEventListener('click', (e) => { e.stopPropagation(); toggleProfileMenu(); });

  $('#pmenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pm]');
    if (!b) return;
    e.stopPropagation();
    closeProfileMenu();
    const what = b.dataset.pm;
    if (what === 'logout') {
      if (window.confirm(`Log out ${state.user ? state.user.name : ''}?`)) logout();
    } else if (what === 'settings') openSettings();
    else if (what === 'docs') openDocs();
  });

  // click anywhere else closes the menu
  document.addEventListener('click', (e) => {
    const p = $('#profile');
    if (p && !p.contains(e.target)) closeProfileMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeProfileMenu();
    closeModal();
  });
}

// ---------- modal (settings / docs) ----------
function modal(html) {
  $('#modal-card').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

function wireModal() {
  const m = $('#modal');
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
}

function openSettings() {
  const u = state.user || {};
  const saved = Math.min(50, Math.max(1, Number(localStorage.getItem('hd_radius')) || 15));
  modal(`
    <div class="modalhead"><h2>Settings</h2><button class="modalx" data-close aria-label="Close">✕</button></div>
    <div class="settingsacc">
      <div class="avatar sm">${esc(((u.name || '?').trim()[0] || '?').toUpperCase())}</div>
      <div class="accinfo"><b>${esc(u.name || '')}</b><span>${esc(u.email || '')}</span></div>
    </div>
    <div class="field"><label class="budgetlabel">Default search radius <span class="cnt" id="set-radius-v">${saved} km</span></label>
      <input type="range" id="set-radius" min="1" max="50" step="1" value="${saved}" style="width:100%;accent-color:var(--green)"></div>
    <button class="btn ghost" data-close>Close</button>`);
  const r = $('#set-radius');
  r.addEventListener('input', () => {
    const v = Number(r.value);
    $('#set-radius-v').textContent = v + ' km';
    localStorage.setItem('hd_radius', v);
    if (!state.current) {
      setForm({ radiusKm: v });
      if (state.step === 1) renderTopbar();
    }
  });
}

async function openDocs() {
  modal(`<div class="modalhead"><h2>Docs</h2><button class="modalx" data-close aria-label="Close">✕</button></div>
    <div class="docslist" id="docslist">Loading…</div>`);
  try {
    const list = await api('/api/docs');
    const el = $('#docslist');
    if (!list.length) { el.textContent = 'No docs found.'; return; }
    el.innerHTML = list.map((d) => `<button class="docrow" data-doc="${esc(d.file)}">${esc(d.title)}</button>`).join('');
    el.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => openDoc(b.dataset.doc)));
  } catch (e) {
    $('#docslist').textContent = e.message;
  }
}

async function openDoc(file) {
  modal(`<div class="modalhead"><button class="modalback" id="doc-back">← Docs</button><button class="modalx" data-close aria-label="Close">✕</button></div>
    <pre class="docbody" id="docbody">Loading…</pre>`);
  $('#doc-back').addEventListener('click', openDocs);
  try {
    const res = await fetch('/docs/' + encodeURIComponent(file));
    $('#docbody').textContent = res.ok ? await res.text() : `Could not load ${file}`;
  } catch (e) {
    $('#docbody').textContent = e.message;
  }
}

// ---------- data ----------
async function refreshList() {
  state.list = await api('/api/requests');
}

async function post() {
  try {
    const f = state.form;
    if (!hasLocation()) { toast('Set the seller location first.', true); return; }
    const req = await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({
        title: f.title || 'Item inspection',
        category: f.category,
        location: f.location,
        lat: f.lat,
        lng: f.lng,
        radiusKm: f.radiusKm,
        askingPrice: f.askingPrice,
        bid: f.bid,
      }),
    });
    state.current = req;
    await refreshList();
    statusView(req);
  } catch (e) { toast(e.message, true); }
}

async function openRequest(id) {
  const req = await api('/api/requests/' + id);
  state.current = req;
  statusView(req);
}

async function act(id, path, body) {
  try {
    const req = await api('/api/requests/' + id + path, { method: 'POST', body: JSON.stringify(body) });
    state.current = req;
    await refreshList();
    statusView(req);
    toast('Done.');
  } catch (e) { toast(e.message, true); }
}

function goHome() {
  state.current = null;
  state.form = defaultForm();
  state.step = 1;
  renderHome();
}

async function onRefresh() {
  await refreshList();
  if (state.current) await openRequest(state.current.id); else renderHome();
  toast('Refreshed.');
}

window.__hd = { state, computeBand, normalBidRupees };

async function boot() {
  wireProfile();
  wireModal();
  if (window.ResizeObserver) new ResizeObserver(syncProfileAnchor).observe($('#sheet'));
  syncProfileAnchor();
  initMap();
  state.config = await api('/api/config');
  state.form = defaultForm();
  await refreshList().catch(() => {});
  const me = await api('/api/auth/me').catch(() => null);
  if (me && me.user) { state.user = me.user; enterApp(); }
  else showAuth('home');
}

boot().catch((e) => toast(e.message, true));
