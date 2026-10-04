import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { pkr, toRupees, formatPkr } from './packages/domain/src/money.ts';
import { pricingBreakdown } from './packages/domain/src/pricing.ts';
import { suggestedBand, checkBid, CATEGORY_BASE_PKR, BID_PER_KM_PKR, MAX_DISTANCE_KM } from './packages/domain/src/bid.ts';
import { evaluateCommission, settleFailedDeal } from './packages/domain/src/commission.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DOCS_DIR = path.join(__dirname, 'docs');
const PORT = Number(process.env.PORT || 3000);

const BID_PER_KM = pkr(BID_PER_KM_PKR);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------------------------
// In-memory store. A restart clears everything - this is a local demo, not production.
// ---------------------------------------------------------------------------------------------
const requests = new Map();

// Accounts + sessions (server-side, in-memory like everything else here).
const accounts = new Map(); // email -> { email, name, salt, hash, createdAt }
const sessions = new Map(); // token -> { email, expiresAt }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hashPassword(password, saltHex) {
  return scryptSync(String(password), saltHex, 64).toString('hex');
}

function verifyPassword(password, saltHex, expected) {
  const actual = Buffer.from(hashPassword(password, saltHex), 'hex');
  const want = Buffer.from(expected, 'hex');
  return actual.length === want.length && timingSafeEqual(actual, want);
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function publicUser(a) {
  return { name: a.name, email: a.email, createdAt: a.createdAt };
}

function createSession(email) {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function currentUser(req) {
  const token = bearer(req);
  const s = token && sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(token); return null; }
  const a = accounts.get(s.email);
  return a ? { user: publicUser(a), token } : null;
}

// Accounts survive a server restart; everything else in this demo is in-memory.
const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

function loadAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    (raw.accounts || []).forEach((a) => { if (a && a.email) accounts.set(a.email, a); });
    (raw.sessions || []).forEach((s) => { if (s && s.token && s.expiresAt > Date.now()) sessions.set(s.token, s); });
  } catch {}
}

function saveAccounts() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({
      accounts: [...accounts.values()],
      sessions: [...sessions.entries()].map(([token, s]) => ({ token, ...s })),
    }, null, 2));
  } catch (e) {
    console.error('Could not save accounts:', e.message);
  }
}

// Demo dealer pool. Real availability comes from the agent app's location + status feed;
// here we place them around the seller's point so the buyer sees who is actually in range.
// Profile photo as an inline SVG data URI - no upload, no third party, works offline.
function avatarPhoto(name) {
  const initials = String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hue = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},72%,46%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},64%,30%)"/>`
    + `</linearGradient></defs>`
    + `<rect width="160" height="160" rx="80" fill="url(#g)"/>`
    + `<circle cx="80" cy="62" r="30" fill="rgba(255,255,255,0.16)"/>`
    + `<path d="M30 160c6-34 26-52 50-52s44 18 50 52z" fill="rgba(255,255,255,0.16)"/>`
    + `<text x="80" y="84" fill="#fff" font-family="Segoe UI,Arial,sans-serif" font-size="54" font-weight="700" `
    + `text-anchor="middle" dominant-baseline="central">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEALER_POOL = [
  { name: 'Ahmed Raza', rating: 4.9, jobs: 214,
    reviews: [
      [5, 'Hamza S.', '2 weeks ago', 'Checked the IMEI and battery health on video. Caught a fake listing before I paid.'],
      [5, 'Mariam A.', '1 month ago', 'At Johar Town on time, full report in my inbox 20 minutes later.'],
      [4, 'Bilal A.', '2 months ago', 'Solid inspection. Took a little longer than promised, but he called to update me.'],
    ],
    replies: [
      'I can be there within 2 hours and video-call you through every check.',
      'If the seller refuses the IMEI read, that is usually the tell - walk away.',
    ] },
  { name: 'Bilal Khan', rating: 4.8, jobs: 158,
    reviews: [
      [5, 'Usman R.', '3 weeks ago', 'Talked me out of a cracked-frame phone the seller swore was mint.'],
      [5, 'Zoya K.', '2 months ago', 'Sent photos of the screen under a flashlight - you can see the micro-scratches.'],
      [4, 'Talha M.', '3 months ago', 'Good job. Reached 10 minutes late for traffic, he warned me in advance.'],
    ],
    replies: [
      'Send me the listing link first - I will tell you what to check before I travel.',
      'I do a 14-point check with video; you watch live on call.',
    ] },
  { name: 'Sana Malik', rating: 4.7, jobs: 91,
    reviews: [
      [5, 'Ayesha N.', '1 week ago', 'She checked the laptop battery cycles and the charger, exactly what I asked for.'],
      [4, 'Faisal I.', '1 month ago', 'Thorough on the TV panel check. Report was clear and full of photos.'],
      [5, 'Noman S.', '6 weeks ago', 'Polite, patient with my questions, and she negotiated the price down for me.'],
    ],
    replies: [
      'I always video-record the serial number so you can match it with the bill.',
      'Evening slots are free - I can go after 6 pm.',
    ] },
  { name: 'Usman Tariq', rating: 4.6, jobs: 73,
    reviews: [
      [5, 'Kashif B.', '2 weeks ago', 'Found a replaced screen on a phone that looked perfect. Saved me Rs 12,000.'],
      [4, 'Sara P.', '2 months ago', 'Came on time, report was a bit short but the photos were good.'],
      [4, 'Imran H.', '4 months ago', 'Straightforward, no drama. Would hire again.'],
    ],
    replies: [
      'If the deal is within 10 km I can go right now.',
      'Tell me your ceiling beforehand and I will tell you honestly if it is fair.',
    ] },
  { name: 'Hina Aslam', rating: 4.8, jobs: 132,
    reviews: [
      [5, 'Danish R.', '1 week ago', 'She tested every port and speaker on camera. Nothing slipped past her.'],
      [5, 'Mahnoor A.', '1 month ago', 'The report included the battery health screenshot - exactly what I needed.'],
      [5, 'Zeeshan K.', '5 weeks ago', 'Fast reply, arrived in 40 minutes.'],
    ],
    replies: [
      'I will call the seller on video so you can hear the answers yourself.',
      'Do not pay if the serial does not match the box - remember that.',
    ] },
  { name: 'Faisal Iqbal', rating: 4.5, jobs: 64,
    reviews: [
      [4, 'Hassan M.', '3 weeks ago', 'Decent inspection of the fridge, he checked the compressor noise properly.'],
      [5, 'Rabia S.', '2 months ago', 'Very honest - he told me the sofa fabric was reupholstered before I paid.'],
      [4, 'Ali Z.', '3 months ago', 'A bit slow on the report, but the inspection itself was thorough.'],
    ],
    replies: [
      'For appliances I listen to the compressor for a full minute - that is where faults hide.',
      'I can share my previous reports so you know exactly what you get.',
    ] },
  { name: 'Ayesha Noor', rating: 4.9, jobs: 201,
    reviews: [
      [5, 'Junaid F.', '2 weeks ago', 'Best in Lahore. She walked me through the camera sensor test live.'],
      [5, 'Sadia I.', '1 month ago', 'Caught a water-damaged phone in 5 minutes.'],
      [5, 'Hamza T.', '2 months ago', 'Detailed report with serial numbers and close-up photos.'],
    ],
    replies: [
      'I have inspected 200+ phones - the fakes follow the same three tricks.',
      'Available mornings, I can be at any Lahore address within the hour.',
    ] },
  { name: 'Kamran Shah', rating: 4.4, jobs: 48,
    reviews: [
      [4, 'Adnan Q.', '1 month ago', 'Good with bikes, he checked the chassis number and the engine noise.'],
      [5, 'Faraz L.', '2 months ago', 'Cheapest quote and he still did the full checklist.'],
      [3, 'Nida S.', '3 months ago', 'Arrived late and I had to remind him about two checks.'],
    ],
    replies: [
      'I do bikes and small electronics - send me the details first.',
      'If it is outside 20 km I will need a little extra for travel.',
    ] },
  { name: 'Nadia Rehman', rating: 4.7, jobs: 110,
    reviews: [
      [5, 'Waqas H.', '2 weeks ago', 'She tested the laptop under load - the fan fault showed up straight away.'],
      [5, 'Amna R.', '6 weeks ago', 'Friendly, on time, and the report came in English and Urdu.'],
      [4, 'Saad M.', '3 months ago', 'Good inspection, slightly expensive for that distance.'],
    ],
    replies: [
      'I send the report the same day, with photos of every fault I find.',
      'Live video call is included - you do not have to take my word for it.',
    ] },
  { name: 'Tariq Mehmood', rating: 4.6, jobs: 88,
    reviews: [
      [5, 'Bilal R.', '3 weeks ago', 'Checked the car documents against the chassis number. Very professional.'],
      [4, 'Shazia K.', '2 months ago', 'He pointed out paint work I could not see. Happy I hired him.'],
      [5, 'Owais N.', '4 months ago', 'Report was clear and he followed up the next day.'],
    ],
    replies: [
      'I verify the documents as well as the item - that is where frauds get caught.',
      'Send the address and your budget, I will tell you if the trip is worth it.',
    ] },
];

DEALER_POOL.forEach((d) => { d.photo = avatarPhoto(d.name); });

// Each dealer sets their OWN price/km in their preferences - there is no system rate for them.
// The buyer's fair Rs 30/km is only the floor of the buyer's own rate; quotes come from these.
const DEALER_RATES = {
  'Ahmed Raza': 25, 'Bilal Khan': 45, 'Sana Malik': 30, 'Usman Tariq': 50, 'Hina Aslam': 35,
  'Faisal Iqbal': 60, 'Ayesha Noor': 40, 'Kamran Shah': 100, 'Nadia Rehman': 30, 'Tariq Mehmood': 28,
};
DEALER_POOL.forEach((d) => { d.rate = DEALER_RATES[d.name] || 30; });

const MAX_RADIUS_KM = MAX_DISTANCE_KM;

const ACCEPT_NOTES = [
  'Can be there within 2 hours.',
  'Available this evening.',
  'It is on my route, I can go now.',
  'Happy to take this one.',
  'I can reach you in about an hour.',
];
const COUNTER_NOTES = [
  'Far for me - need a bit more for travel.',
  'My fuel cost is higher for that distance.',
  'I can do it at your price if the item is nearby.',
  'That is a long way - could you add a little?',
];

/** Move a point `distKm` from (lat,lng) along `bearingDeg`. */
function offsetKm(lat, lng, distKm, bearingDeg) {
  const R = 6371;
  const br = (bearingDeg * Math.PI) / 180;
  const d = distKm / R;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lng * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(l2 * 180) / Math.PI, (p2 * 180) / Math.PI];
}

function makeResponses(request) {
  const { lat, lng } = request.origin;
  const radius = request.radiusKm;
  const bid = request.bidMinor;
  const pool = DEALER_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 6);

  // The buyer's rate = budget per km, floored at the fair Rs 30/km. Every dealer then quotes
  // THEIR OWN price/km (set in their preferences) x their own distance - no system price:
  // 5 km at Rs 50/km = Rs 250, 5 km at Rs 100/km = Rs 500, 30 km at Rs 30/km = Rs 900.
  // Their rate vs yours decides Accept or Counter - the totals do not.
  const yourRate = Math.max(bid / 100 / radius, BID_PER_KM_PKR);

  const out = pool.map((d, i) => {
    const distanceKm = Math.round((0.8 + Math.random() * (radius - 0.8)) * 10) / 10;
    const [dlng, dlat] = offsetKm(lat, lng, distanceKm, Math.random() * 360);
    const ownPrice = Math.round((pkr(d.rate) * distanceKm) / 100) * 100;
    return {
      id: randomUUID(),
      dealer: {
        name: d.name,
        rating: d.rating,
        jobs: d.jobs,
        ratePerKm: d.rate,
        city: request.origin.place,
        distanceKm,
        at: [Number(dlng.toFixed(5)), Number(dlat.toFixed(5))],
        photo: d.photo,
        reviews: d.reviews.map(([stars, author, when, text]) => ({ stars, author, when, text })),
        replies: d.replies.slice(),
        acceptRate: Math.min(96, Math.round(58 + (d.rating - 4.4) * 45)),
        replyMin: Math.max(6, Math.round(18 - (d.rating - 4.4) * 15)),
      },
      kind: d.rate <= yourRate ? 'accept' : 'counter',
      amountMinor: ownPrice,
      note: d.rate <= yourRate ? ACCEPT_NOTES[i % ACCEPT_NOTES.length] : COUNTER_NOTES[i % COUNTER_NOTES.length],
      createdAt: nowIso(),
    };
  });

  // A buyer should always have someone to hire.
  if (out.length && !out.some((r) => r.kind === 'accept')) {
    const cheapest = out.slice().sort((a, b) => a.dealer.ratePerKm - b.dealer.ratePerKm)[0];
    cheapest.kind = 'accept';
    cheapest.note = ACCEPT_NOTES[0];
  }

  out.sort((a, b) => a.dealer.distanceKm - b.dealer.distanceKm);
  return out;
}

const FAILURE_LABELS = {
  honest_reject: 'Buyer decided not to buy',
  seller_fraud: 'Seller turned out to be fraudulent',
  price_exceeds_limit: 'Price rose above the buyer limit',
  seller_fee_refused: 'Seller refused the 0.5% fee',
  seller_unavailable: 'Seller was unavailable',
  inspector_unsafe: 'Inspector aborted for safety',
  inspector_no_show: 'Inspector never showed up',
};

function createRequest(body) {
  const title = String(body.title || '').trim();
  const category = String(body.category || 'phone');
  const location = String(body.location || '').trim();
  const lat = body.lat == null ? null : Number(body.lat);
  const lng = body.lng == null ? null : Number(body.lng);
  const radiusKm = Number(body.radiusKm ?? 15);
  const askingRupees = Number(body.askingPrice ?? 0);
  const bidRupees = Number(body.bid ?? 0);

  if (!title) throw new HttpError(400, 'Give the item a short title.');
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new HttpError(400, 'Pick the seller location by search or coordinates.');
  }
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new HttpError(400, 'Those coordinates are out of range.');
  }
  if (!(radiusKm >= 1 && radiusKm <= MAX_RADIUS_KM)) {
    throw new HttpError(400, `Search radius must be between 1 and ${MAX_RADIUS_KM} km.`);
  }
  if (!(askingRupees > 0)) throw new HttpError(400, 'Asking price must be greater than zero.');
  if (!(bidRupees > 0)) throw new HttpError(400, 'Your inspection bid must be greater than zero.');
  if (!(CATEGORY_BASE_PKR[category])) throw new HttpError(400, 'Unknown category.');

  // The normal bid is a straight km rate on the seller-to-dealer range: Rs 30/km, so the full
  // 50 km range is Rs 1,500 and a 10 km job is Rs 300.
  const bandDistanceKm = radiusKm;
  const band = suggestedBand({ distanceKm: bandDistanceKm });
  const check = checkBid(pkr(bidRupees), band);

  const request = {
    id: randomUUID(),
    ref: 'HD-' + randomUUID().slice(0, 6).toUpperCase(),
    title,
    category,
    location,
    origin: { lat, lng, place: location || `${lat.toFixed(4)}, ${lng.toFixed(4)}` },
    radiusKm,
    distanceKm: bandDistanceKm,
    askingMinor: pkr(askingRupees),
    bidMinor: pkr(bidRupees),
    band,
    check,
    status: 'published',
    selectedResponseId: null,
    responses: [],
    inspection: null,
    outcome: null,
    money: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  request.responses = makeResponses(request);
  requests.set(request.id, request);
  return request;
}

function selectResponse(request, responseId) {
  if (request.status !== 'published') throw new HttpError(409, 'A dealer is already selected.');
  const r = request.responses.find((x) => x.id === responseId);
  if (!r) throw new HttpError(404, 'That response no longer exists.');
  request.selectedResponseId = r.id;
  // Hiring pays the dealer's own quote (their km-based price), not the radius-wide bid.
  request.agreedBidMinor = r.amountMinor;
  request.status = 'agent_selected';
  request.updatedAt = nowIso();
  return request;
}

function payBid(request) {
  if (request.status !== 'agent_selected') throw new HttpError(409, 'Select a dealer first.');
  request.status = 'bid_secured';
  request.paidAt = nowIso();
  request.updatedAt = nowIso();
  return request;
}

function submitInspection(request, body) {
  if (request.status !== 'bid_secured') throw new HttpError(409, 'The bid is not secured yet.');
  request.inspection = {
    verdict: String(body.verdict || 'pass'),
    notes: String(body.notes || '').slice(0, 1000),
    at: nowIso(),
  };
  request.status = 'inspected';
  request.updatedAt = nowIso();
  return request;
}

function completeSale(request, body) {
  if (request.status !== 'inspected') throw new HttpError(409, 'No inspection report yet.');
  const saleRupees = Number(body.salePrice ?? toRupees(request.askingMinor));
  if (!(saleRupees > 0)) throw new HttpError(400, 'Sale price must be greater than zero.');
  const salePrice = pkr(saleRupees);

  const windowEnd = new Date(Date.now() - 1000).toISOString();
  const decision = evaluateCommission(
    {
      publicRef: request.ref,
      state: 'dispute_window_elapsed',
      purchasePriceMinor: salePrice,
      purchaseCompletedAt: nowIso(),
      buyerConfirmedAt: nowIso(),
      disputeWindowEndsAt: windowEnd,
      hasOpenDispute: false,
    },
    new Date(),
  );
  if (!decision.eligible) throw new HttpError(500, `Fee engine refused: ${decision.reason}`);

  const bidPaid = request.agreedBidMinor ?? request.bidMinor;
  request.money = {
    salePrice,
    bidPaid,
    buyerFee: decision.buyerFee,
    sellerFee: decision.sellerFee,
    totalFees: decision.totalFees,
    dealerBonus: decision.dealerBonus,
    dealerTotal: bidPaid + decision.dealerBonus,
    companyTake: decision.companyTake,
    buyerTotal: salePrice + decision.buyerFee + bidPaid,
    sellerReceives: salePrice - decision.sellerFee,
  };
  request.status = 'completed';
  request.updatedAt = nowIso();
  return request;
}

function failDeal(request, body) {
  if (request.status === 'completed') throw new HttpError(409, 'Sale is already complete.');
  if (request.status === 'published' || request.status === 'agent_selected') {
    throw new HttpError(409, 'The bid has not been paid yet - nothing to settle.');
  }
  const outcome = String(body.outcome || 'honest_reject');
  if (!FAILURE_LABELS[outcome]) throw new HttpError(400, 'Unknown failure outcome.');
  const bidPaid = request.agreedBidMinor ?? request.bidMinor;
  const settlement = settleFailedDeal(outcome, bidPaid);
  request.outcome = outcome;
  request.money = { settlement, outcomeLabel: FAILURE_LABELS[outcome] };
  request.status = 'failed';
  request.updatedAt = nowIso();
  return request;
}

// ---------------------------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon' };

function serveStatic(res, rel) {
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store, must-revalidate' });
    res.end(data);
  });
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  const method = req.method;

  try {
    if (p === '/' || p === '/index.html') return serveStatic(res, 'index.html');
    if (p.startsWith('/user/')) return serveStatic(res, 'index.html');
    if (p === '/styles.css') return serveStatic(res, 'styles.css');
    if (p === '/app.js') return serveStatic(res, 'app.js');
    if (p.startsWith('/vendor/')) return serveStatic(res, p.slice(1));

    if (p === '/api/config' && method === 'GET') {
      return json(res, 200, {
        categories: Object.entries(CATEGORY_BASE_PKR).map(([key, base]) => ({
          key,
          label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          base: pkr(base),
          baseLabel: formatPkr(pkr(base)),
        })),
        bidPerKm: BID_PER_KM,
        bidPerKmLabel: formatPkr(BID_PER_KM),
        maxRadiusKm: MAX_RADIUS_KM,
        normalBidAtMaxRange: pkr(BID_PER_KM_PKR * MAX_RADIUS_KM),
        normalBidAtMaxRangeLabel: formatPkr(pkr(BID_PER_KM_PKR * MAX_RADIUS_KM)),
        failures: Object.entries(FAILURE_LABELS).map(([key, label]) => ({ key, label })),
      });
    }

    // Fee calculator for step 4: same code path the money flow uses (pricingBreakdown).
    if (p === '/api/fees' && method === 'GET') {
      const price = Number(u.searchParams.get('price'));
      if (!Number.isFinite(price) || price <= 0 || price > 100_000_000) {
        throw new HttpError(400, 'Enter an item price greater than zero.');
      }
      const minor = pkr(Math.round(price));
      const b = pricingBreakdown(minor);
      const pctOf = (m) => Math.round((m / minor) * 1000) / 10;
      return json(res, 200, {
        price: minor,
        buyerFee: b.buyerFee,
        buyerPct: pctOf(b.buyerFee),
        sellerFee: b.sellerFee,
        sellerPct: pctOf(b.sellerFee),
        dealerBonus: b.dealerBonus,
        dealerPct: pctOf(b.dealerBonus),
        platformCut: b.companyTake,
        platformPct: pctOf(b.companyTake),
        totalFees: b.totalFees,
        poolPct: pctOf(b.totalFees),
        dealerSharePct: b.totalFees > 0 ? Math.round((b.dealerBonus / b.totalFees) * 100) : 0,
        platformSharePct: b.totalFees > 0 ? Math.round((b.companyTake / b.totalFees) * 100) : 0,
      });
    }

    if (p === '/api/auth/signup' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (name.length < 2) throw new HttpError(400, 'Enter your name.');
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
      if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
      if (accounts.has(email)) throw new HttpError(409, 'That email is already registered.');
      const salt = randomBytes(16).toString('hex');
      accounts.set(email, { email, name, salt, hash: hashPassword(password, salt), createdAt: nowIso() });
      const token = createSession(email);
      saveAccounts();
      return json(res, 201, { token, user: { name, email } });
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      const account = accounts.get(email);
      const ok = account && verifyPassword(body.password, account.salt, account.hash);
      if (!ok) throw new HttpError(401, 'Email or password is wrong.');
      const token = createSession(email);
      saveAccounts();
      return json(res, 200, { token, user: publicUser(account) });
    }

    if (p === '/api/auth/me' && method === 'GET') {
      const me = currentUser(req);
      if (!me) throw new HttpError(401, 'Please log in.');
      return json(res, 200, { user: me.user });
    }

    if (p === '/api/auth/logout' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const token = bearer(req) || String(body.token || '');
      if (token) sessions.delete(token);
      saveAccounts();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/docs' && method === 'GET') {
      let files = [];
      try { files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort(); } catch {}
      const docs = files.map((f) => {
        let title = f;
        try {
          const first = fs.readFileSync(path.join(DOCS_DIR, f), 'utf8').split('\n').find((l) => l.startsWith('# '));
          if (first) title = first.replace(/^#\s+/, '').trim();
        } catch {}
        return { file: f, title };
      });
      return json(res, 200, docs);
    }

    if (p.startsWith('/docs/') && method === 'GET') {
      const name = path.basename(decodeURIComponent(p.slice('/docs/'.length)));
      if (!name.endsWith('.md')) return notFound(res);
      const file = path.join(DOCS_DIR, name);
      if (!file.startsWith(DOCS_DIR)) return notFound(res);
      return fs.readFile(file, (err, data) => {
        if (err) return notFound(res);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end(data);
      });
    }

    if (p === '/api/requests' && method === 'GET') {
      const list = [...requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json(res, 200, list);
    }

    if (p === '/api/requests' && method === 'POST') {
      const body = await readBody(req);
      const request = createRequest(body);
      return json(res, 201, request);
    }

    const m = p.match(/^\/api\/requests\/([^/]+)(?:\/([^/]+))?$/);
    if (m) {
      const request = requests.get(m[1]);
      if (!request) return json(res, 404, { error: 'Request not found.' });
      const action = m[2];

      if (!action && method === 'GET') return json(res, 200, request);

      if (action === 'select' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, selectResponse(request, body.responseId));
      }
      if (action === 'pay' && method === 'POST') return json(res, 200, payBid(request));
      if (action === 'inspect' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, submitInspection(request, body));
      }
      if (action === 'complete' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, completeSale(request, body));
      }
      if (action === 'fail' && method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, failDeal(request, body));
      }
      return json(res, 405, { error: 'Method not allowed.' });
    }

    return notFound(res);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error(err);
    return json(res, 500, { error: 'Something went wrong on the server.' });
  }
});

let listenPort = PORT;
let attempts = 0;

loadAccounts();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && attempts < 10) {
    attempts += 1;
    listenPort += 1;
    console.log(`  Port ${listenPort - 1} is busy, trying ${listenPort}...`);
    server.listen(listenPort);
  } else {
    console.error('  Could not start the server:', err.message);
    process.exit(1);
  }
});

server.on('listening', () => {
  const url = `http://localhost:${listenPort}`;
  console.log('');
  console.log('  Hire a Dealer - local server running');
  console.log(`  ${url}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  if (process.platform === 'win32' && !process.env.NO_OPEN) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});

server.listen(listenPort);
