<div align="center">

# 🚀 Hire a Dealer


### **Hire a verified Field Agent to inspect any used item before you buy**


Post a bid, compare dealers by distance and their own Rs/km rate, and close the deal with an evidence-backed inspection report — without ever visiting the seller.


![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.6-brightgreen?logo=nodedotjs)
![Platform](https://img.shields.io/badge/Platform-Web-blue)
![Dependencies](https://img.shields.io/badge/Dependencies-0-green)
![Status](https://img.shields.io/badge/Status-Active-success)
![Feature](https://img.shields.io/badge/Feature-Field%20Agents-orange)

</div>

---

# Hire a Dealer

**Can't visit the seller? Hire someone there to check it for you.**

Pakistan-first service where a buyer **posts a bid to hire a verified Field Agent** to physically
visit a used item (or meet the seller), inspect it on video, and send back an evidence-backed
report. The buyer and seller then close the deal as a separate step — no listings, no seller
accounts, no delivery app. Just buyer-side physical representation.

## Quick start

1. Install [Node.js](https://nodejs.org) 22.6+ (24 recommended). Nothing else — the server has
   zero runtime dependencies and the map library ships in `public/vendor/`.
2. Double-click **`run.bat`** (or run `node server.mjs`).
3. Your browser opens **http://localhost:3000** automatically. Set `$env:NO_OPEN = 1`
   (PowerShell) first if you do not want that.

The demo is local: requests, responses and accounts are in-memory (accounts also persist to
`data/accounts.json`), so a server restart clears the jobs. Map tiles load from OpenFreeMap —
everything else works offline.

## The journey

- **Sign up / log in** (name, email, password).
- **Buyer — 4 steps:** Location (search or map-pick the seller, radius 1–50 km) → Bid (fair band
  = Rs 30/km × your radius, ±15%/+20%) → Item (title, description) → Fees (price-driven
  calculator) → *Find dealers*.
- **Responses:** each dealer inside your radius shows their distance, **their own Rs/km rate**
  and their quote (their rate × their distance).
  - **Accept** = their rate is within yours · **Counter** = their rate is above yours — the
    totals do not decide the tag (a Rs 250 quote can be a Counter, a Rs 900 quote an Accept).
  - Your rate = your budget per km, floored at the fair Rs 30/km, shown in the list header.
  - Quotes above your budget carry a warning: *“Rs 393 over your Rs 500 budget · 25.5 km of
    your 50 km range”* — on the card and on the dealer's review page.
  - Click a card for reviews, canned responses, rate breakdown and **Hire**.
- **After hiring:** pay the bid → simulated inspection report → complete the sale with the fee
  breakdown, or settle a failure outcome per the policy.
- **Dealer mode:** profile menu → *Switch to dealer profile* flips the app to a job feed with an
  availability toggle. **Preferences** (Search radius, Bid rate, Max distance) are dealer-only,
  editable, and stored separately from the buyer's Settings radius — the two never mix.
- **Profile:** full-screen page at **`/user/<username>`** — stats, account details, copy-link,
  and the Buyer ⇄ Dealer switch.

## Pricing (what the code charges)

| Who | Pays |
|---|---|
| Buyer | the inspection bid + **0.5%** of the sale price (success fee) |
| Seller | **0.5%** of the sale price — collected on the spot by the dealer |
| Dealer | the inspection bid in full + **0.4%** of the sale price (40% of the fee pool) |
| Platform | **0.6%** of the sale price (60% of the fee pool) |

Pure percentages — **no floor, no cap** — so the calculator shows the same shape at any price.
Rs 10,000 item: buyer 50, seller 50, dealer 40, platform 60.

- **Inspection bid** is buyer-set; the recommended band is Rs 30/km × search radius (85%–120%).
  It is labelled `[non-refundable]` in the fee box; failure outcomes split it per the settlement
  policy. The platform takes no cut of the bid.
- **Dealer quotes** are personal: every dealer sets their own price/km in Preferences (default
  Rs 30/km), so 5 km at Rs 50/km = Rs 250 while 30 km at Rs 30/km = Rs 900.

Implemented in `packages/domain/src/pricing.ts` and `bid.ts` (unit-tested).

## Commands

| Command | What it does |
|---|---|
| `run.bat` / `node server.mjs` | start the app (auto-opens the browser) |
| `npm test` | 65 domain tests — pricing, bid band, money, commission, state machine |
| `npm run typecheck` | TypeScript check of `packages/domain` (needs `npm install`) |
| `npm run check:ddl` | validates the SQL in `docs/04` (needs Python) |
| `npm run check` | typecheck + tests + DDL |

`npm install` is only needed for the TypeScript tooling — the app itself and `npm test` run
without it.

## Layout

```
server.mjs        zero-dependency HTTP server: static files, demo API, /user/* SPA route
public/           index.html, app.js, styles.css (+ vendored MapLibre GL, no API key)
packages/domain   money, pricing, bid band, commission, state machine + tests (TypeScript)
docs/             full product & technical spec — start at docs/README.md
DECISIONS.md      the business model — read first
tools/            check_ddl.py (static SQL validator)
data/             accounts.json (created on first signup)
run.bat           launcher
```

## Status

A working **local demo**, not production: no real payments, no KYC, a fictional dealer pool, an
in-memory store, and a simulated inspection. The fees above are what the app charges
(`packages/domain/src/pricing.ts`); parts of `DECISIONS.md` and `docs/` still describe an
earlier 10% draft — where text and code disagree, the code wins for behaviour and
`DECISIONS.md` wins for intent.
