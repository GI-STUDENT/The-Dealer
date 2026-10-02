# 05 — API Architecture

## 1. Shape of the system

**Modular monolith with an outbox.** Not microservices. Reasons:

- The domain is one tightly-coupled workflow (a transaction state machine). Microservices would
  put a distributed transaction around every state transition, which is precisely the wrong
  tradeoff for correctness-critical money and evidence.
- Pakistan-scale launch: one city, tens of agents, low hundreds of daily transactions. One
  deployment is one fewer thing to be on call for.
- The boundaries are already explicit (see §2), so extraction later is a matter of moving a
  module behind a queue, not a rewrite.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Flutter app  │   │ Flutter app  │   │ Admin web    │
│  Buyer       │   │  Agent       │   │ (Next.js)    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       └──────────────────┴──────────────────┘
                          │ HTTPS / WSS
                 ┌────────▼─────────┐
                 │  Cloudflare (WAF,│
                 │  CDN, DDoS, bot) │
                 └────────┬─────────┘
                 ┌────────▼─────────┐
                 │  API Gateway     │  rate limit, auth, idempotency
                 └────────┬─────────┘
        ┌─────────────────┼─────────────────┐
┌───────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐
│ NestJS app    │ │ SFU (LiveKit) │ │ Media worker  │
│ 12 modules    │ └───────────────┘ │ transcode,    │
└───────┬───────┘                   │ re-encode,    │
        │                           │ pHash, OCR    │
        │                    ┌──────▼───────┐       └───────┬───────┘
        │                    │ Object store │ (S3 + WORM)  │
┌───────▼────────────────────▼─────────────┴───────────────▼───────┐
│  PostgreSQL + PostGIS    Redis    BullMQ    Audit/WORM       │
└──────────────────────────────────────────────────────────────────┘
        │ outbox → workers → push / SMS / courier webhooks
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ Integrations: JazzCash · Easypaisa · PayFast · NADRA e-KYC ·     │
│ LiveKit · TCS/Leopards/CallCourier · FCM · Sentry · Metabase     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Module map

Each module owns its tables and its events. Cross-module access is by service interface, never
by reaching into another module's repository.

| Module | Responsibility | Tables |
|---|---|---|
| `identity` | users, sessions, devices, roles, consent | users, user_profiles, user_devices |
| `kyc` | tiers, NADRA, docs, liveness, payout accounts | kyc_records, kyc_documents, payout_accounts |
| `geo` | cities, service areas, matching geography, routes | cities, agent_service_areas |
| `agents` | agent profile, clearances, skills, availability, trust score | agent_profiles, agent_skill_clearances, agent_category_skills |
| `catalogue` | categories, risk rules, checklist templates | categories, category_risk_rules, checklist_templates* |
| `requests` | request lifecycle, validation, fee recommendation | requests, request_checklist_items, request_evidence |
| `matching` | eligible-agent query, ranking, fairness rotation | (read-only across the above) |
| `offers` | offer/counter lifecycle, selection (atomic) | offers |
| `transactions` | **the state machine** — sole writer of `state` | transactions, transaction_events, transaction_parties |
| `inspection` | checklist runs, verdicts, sealing, serials | inspections, inspection_items, serials |
| `evidence` | upload, integrity, redaction, retention | evidence_objects, evidence_links |
| `negotiation` | negotiation ledger, ceiling enforcement | negotiation_events |
| `realtime` | live session tokens, recordings, presence | live_sessions |
| `sellers` | seller entity identity & risk corpus | seller_entities, seller_entity_sightings |
| `logistics` | packages, shipments, courier adapters | packages, shipments, shipment_events |
| `payments` | PSP integration, payments, refunds | payments |
| `ledger` | **the only writer of ledger rows** | ledger_accounts, ledger_entries, ledger_postings, payout_* |
| `commission` | eligibility guard + posting (see `06`) | (writes via ledger) |
| `disputes` | cases, messages, appeals, remedies | disputes, dispute_appeals, moderation_cases |
| `trust` | ratings, risk signals, reports | ratings, risk_signals, reports |
| `messaging` | in-app chat (retained as evidence) | messages |
| `notifications` | template dispatch across channels | notifications, notification_templates |
| `admin` | moderation console, config, feature flags | feature_flags, audit_log |

**Single-writer rules** (enforced in code review and by CI grep):
- Only `transactions.transition()` may write `transactions.state`.
- Only `ledger` may write `ledger_postings`.
- Only `commission.postCommission()` may write `4000` revenue.
- Only `evidence` may write `evidence_objects`.

---

## 3. Conventions

| Concern | Rule |
|---|---|
| Base path | `/api/v1` |
| Versioning | URL major version. Additive changes only within v1; breaking → `/v2`. Clients pinned to a min version via `X-Client-Version`. |
| Envelope | Requests/responses are the bare resource. Errors use the catalogue in §9. |
| Auth | `Authorization: Bearer <access_token>`; access 15 min, refresh 30 d rotating. |
| Idempotency | **Required** on every POST. `Idempotency-Key: <uuid>`. Replay returns the original response with `Idempotency-Replayed: true`. |
| Optimistic locking | Mutating a transaction requires `If-Match: <state_version>`. Stale → `409 VERSION_CONFLICT`. |
| Money | Integer paisa in the field, always suffixed: `amount_minor`. `currency` always present. |
| Timestamps | ISO-8601 UTC with offset. Never local time on the wire. |
| Pagination | Cursor-based: `?cursor=<opaque>&limit=50`. Never offset. |
| Filtering | Explicit allow-listed query params. No arbitrary JSON filters. |
| Rate limits | Per user + per IP + per endpoint class. See §8. |
| Errors | RFC-7807-shaped `application/problem+json`. |
| Webhooks | Signed, at-least-once, with `provider_event_id` dedupe. |
| Realtime | WebSocket for state push and chat; SFU for media. Never send money or state transitions over the socket — always re-read via REST. |

---

## 4. Auth architecture

```
Phone ──► OTP via SMS  (5 min TTL, 5 attempts, resend 60s)
       └─► JWT access (RS256, 15m) + opaque rotating refresh token (30d, device-bound)

Users coordinate with each other on their own phone numbers/WhatsApp off-platform; we
never send to those numbers and never treat them as verified channels (`09` §2.3).
```

- **Device binding:** refresh token stores a hash of `install_id` + `device_fingerprint`.
  A refresh from a different device requires re-auth and raises `device_reuse` risk signal.
- **Step-up auth** required for: agent payout account change, KYC resubmission, cash-collect
  override, dispute opening above PKR 300,000, admin operations. Re-OTP, not just a token.
- **Staff:** separate IdP (Google Workspace SSO) + mandatory TOTP + IP allowlist for payouts.
- **Service-to-service:** mTLS service accounts; no long-lived API keys.
- **Third parties** (courier, ops scripts): scoped API keys with per-endpoint allowlists and a
  mandatory `X-Request-Reason`.

---

## 5. Endpoints

### 5.1 Auth & account
```
POST   /auth/otp/request          { channel, phone_e164, purpose }
POST   /auth/otp/verify           { phone_e164, code, install_id, device_fingerprint }
POST   /auth/refresh              { refresh_token }
POST   /auth/logout               { all_devices? }
GET    /me
PATCH  /me
POST   /me/consents              { version, channels, retention }
GET    /me/notifications
PATCH  /me/notifications/:id
```

### 5.2 Requests
```
POST   /requests                        create draft
GET    /requests                        list mine (cursor, filters)
GET    /requests/:id
PATCH  /requests/:id                    If-Match required
POST   /requests/:id/publish            runs category risk rules + checklist validation
POST   /requests/:id/cancel
POST   /requests/:id/evidence           multipart, presigned direct upload
POST   /requests/:id/extract            { object_id[] } → suggested fields (buyer must confirm)
GET    /requests/:id/agents             eligible agents, ranked
POST   /requests/:id/bid                  { bid_minor, negotiation_target_minor? } — the buyer's bid
GET    /requests/:id/responses            who accepted / countered / declined
GET    /offers/:id
```

### 5.3 Agents
```
GET    /agent/profile
PATCH  /agent/profile
POST   /agent/service-areas             polygon
POST   /agent/availability
GET    /agent/feed                      live buyer bids in range, with the suggested band beside each
POST   /agent/bids/:request_id/accept    { } — must equal the bid; freezes it
POST   /agent/bids/:request_id/counter   { amount_minor, message } — one counter per chain
POST   /agent/bids/:request_id/decline   { reason } — safety, qualification, and bid_too_low are penalty-free
GET    /agent/jobs
GET    /agent/jobs/:id
GET    /agent/earnings
GET    /agent/wallet/payouts
POST   /agent/wallet/account            step-up auth
GET    /agent/trust/score               explainable breakdown
```

### 5.4 Transactions (the guarded core)
```
GET    /txns/:id                          buyer/agent view, state_version, timeline
POST   /txns/:id/checkins                 { kind, gps, accuracy_m, attestation, object_id }
POST   /txns/:id/seller/identity          { name, phone, doc_object_ids, consent }
POST   /txns/:id/seller/location          { gps, address_text }
POST   /txns/:id/possession               { result, object_ids, note }
GET    /txns/:id/verify                   CLAIMED vs VERIFIED diff (the key endpoint)
POST   /txns/:id/inspections/start
PATCH  /txns/:id/inspections/items/:key   autosave; offline queue replays these
POST   /txns/:id/inspections/submit       seals; requires verdict + mandatory items
POST   /txns/:id/negotiations             { kind, amount_minor, message, object_ids }
POST   /txns/:id/decision                 { approve | reject | counter, reason }
POST   /txns/:id/authorize                { price_minor } — guard: ≤ ceiling
POST   /txns/:id/settlements/pay          buyer pays seller; records ref + evidence
POST   /txns/:id/settlements/success-fee  buyer pays platform success fee
POST   /txns/:id/settlement/verify        agent confirms seller paid; needs evidence
POST   /txns/:id/custody/verify           serial re-read; mismatch → dispute auto-opened
POST   /txns/:id/package                  { weight, dims, sealed_object_ids, declared_value_minor }
POST   /txns/:id/handover                 { mode, courier_code, waybill?, object_ids }
POST   /txns/:id/deliver                  { receiver_otp }
POST   /txns/:id/confirm-receipt          buyer
POST   /txns/:id/auto-confirm             internal, after 72h
GET    /txns/:id/evidence                 role-filtered
```

### 5.5 Realtime
```
POST   /txns/:id/live/token               { participant } → LiveKit access token
POST   /txns/:id/live/start               { required }
POST   /txns/:id/live/end                 { reason }
POST   /txns/:id/live/shot-request        buyer's shot list → agent's live UI
WS     /realtime                          state changes, chat, presence, job alerts
```

**Critical rule:** the WebSocket is a *notification channel*. Clients must handle a missed
frame by re-fetching `/txns/:id`. It never carries authoritative state or money.

### 5.6 Money
```
POST   /payments/intent                 { purpose, amount_minor, transaction_id? }
POST   /payments/:id/confirm            client-side PSP confirmation → server verifies
GET    /payments/:id
GET    /txns/:id/ledger                 role-filtered money view (three lines, always)
POST   /admin/finance/payout-runs
POST   /admin/finance/payout-runs/:id/approve
```

### 5.7 Disputes, ratings, trust
```
POST   /txns/:id/disputes               freezes commission
GET    /disputes/:id
POST   /disputes/:id/messages
POST   /disputes/:id/resolve            staff only
POST   /disputes/:id/appeal
POST   /txns/:id/ratings
GET    /agents/:id/reviews
POST   /reports
POST   /sos                            { gps, kind, contact_notified }
```

### 5.8 Evidence upload (presigned, direct to storage)
```
POST   /evidence/upload-intent          { kind, mime, bytes, client_sha256 }
                                          → { object_id, upload_url, headers }
PUT    <upload_url>                     direct to S3 (no app server in the path)
POST   /evidence/:id/commit             { client_sha256 } → server re-encodes, verifies, links
```
The app server never proxies media bytes. This is why the server can strip EXIF cheaply and
compute hashes without holding megabytes in memory.

### 5.9 Webhooks (inbound)
```
POST   /webhooks/psp/{provider}         signature-verified, idempotent
POST   /webhooks/courier/{code}         signature-verified, idempotent
POST   /webhooks/livekit/recording      recording-ready → evidence ingest
```

---

## 6. Key request/response examples

### `POST /txns/:id/decision` — the rejection path
```json
// request
{ "decision": "reject", "reason": "condition_not_as_listed",
  "detail": "Battery health 89%, listing said 92%. Scratch on back not shown in listing." }
```
```json
// 200
{ "state": "buyer_rejected",
  "state_version": 14,
  "money": {
    "bid_minor": 1500, "bid_released_minor": 1050,
    "refund_minor": 450,
    "purchase_price_minor": 0,
    "buyer_fee_minor": 0, "seller_fee_minor": 0,
    "dealer_bonus_minor": 0, "company_take_minor": 0
  },
  "next_action": null }
```
Note `purchase_price_minor: 0` and **every success-fee field at 0**. No sale, so no buyer 5%,
no seller 3%, no dealer bonus, no company revenue (`DECISIONS.md` section 3). The dealer still
earns the 70% released above — that is the cost of an honest "no". The response makes the
outcome unambiguous, so no UI bug can imply otherwise.

### `POST /txns/:id/negotiations` — ceiling breach
```json
// request
{ "kind": "counter", "counterparty": "seller", "amount_minor": 11200000, "message": "…" }
// 409
{ "type": "https://api.fa-marketplace.pk/problems/ceiling-exceeded",
  "title": "Negotiation exceeds buyer's authorized maximum",
  "status": 409,
  "detail": "Offered 112,000 exceeds max_authorized_minor 110,000. Request buyer override.",
  "max_authorized_minor": 11000000,
  "required_event": "buyer.override" }
```

### `GET /txns/:id/verify` — claimed vs verified
```json
{
  "seller": [
    { "field": "name",   "declared": "Ali R.", "verified": "Ali Raza", "verified_source": "cnic", "match": true },
    { "field": "phone",  "declared": "03001234567", "verified": "03001234567", "match": true },
    { "field": "address","declared": "Johar Town", "verified_gps": { "lat": 31.4691, "lng": 74.2648 },
      "offset_m": 2100, "match": false }
  ],
  "product": [
    { "field": "battery_health", "declared": "92%", "verified": "89%", "match": false, "severity": "material" },
    { "field": "cosmetic",      "declared": "No scratches", "verified": "1 deep scratch, rear",
      "match": false, "severity": "material", "object_ids": ["…"] }
  ],
  "differences": 2,
  "ownership_proof": "none",
  "risk_note": "No original invoice or box provided. IMEI read from device only."
}
```

### `POST /webhooks/psp/jazzcash`
```
Headers: X-JazzCash-Signature: HMAC-SHA256(secret, raw_body)
Body:    { "eventId":"…", "type":"payment.captured", "data":{ … } }

→ INSERT payments(idempotency_key=provider:eventId) ON CONFLICT DO NOTHING
→ if new: process transition, write ledger postings, outbox event
→ 200 { "received": true }
```
Duplicate `eventId` → 200 with no side effect. Unknown `eventId` → 200 (never 4xx to the
provider; you will get retried forever for a typo). Invalid signature → 401 + security alert.

---

## 7. Realtime protocol (WebSocket)

```
Client → Server
  { "op": "subscribe",   "topic": "txn:<id>" }
  { "op": "unsubscribe", "topic": "txn:<id>" }
  { "op": "chat",        "txn": "<id>", "body": "…", "client_msg_id": "<uuid>" }
  { "op": "presence",    "txn": "<id>", "action": "typing|viewing_report" }
  { "op": "ping" }

Server → Client
  { "op": "state",        "txn": "<id>", "state": "…", "state_version": 14, "at": "…" }
  { "op": "chat",         "txn": "<id>", "message": { … } }
  { "op": "shot_request", "txn": "<id>", "label": "Show the serial number" }
  { "op": "job_offered",  "request": { … } }        // agents only
  { "op": "sos",          "txn": "<id>" }           // staff + trusted contact webhook
  { "op": "pong" }
```
Authorisation is per-topic on subscribe. Every `state` frame includes `state_version`; clients
discard frames older than their known version, and on any gap they re-`GET /txns/:id`.

---

## 8. Rate limits and abuse controls

| Class | Limit | Notes |
|---|---|---|
| OTP request | 5/hour/phone, 3/IP/hour | SMS only; a failed SMS is a P1 |
| OTP verify | 5 attempts, then 15-min lock | |
| `POST /requests` | 10/day/buyer (5 open) | |
| `POST /txns/:id/checkins` | 20/day/agent | |
| `POST /evidence/upload-intent` | 400/day/agent | |
| `POST /txns/:id/negotiations` | 8/transaction | Hard cap `03` BR-026 |
| Chat | 60/min | |
| `GET /agents/:id` | 200/hour/buyer | Anti-scraping of the agent supply |
| Admin write | 200/hour/actor + step-up on finance | |
| Global | Per-user soft limit with exponential backoff; per-IP hard block | |

Abuse responses are `429` with `Retry-After`. WAF handles volumetric attacks; app-level limits
handle the rest.

---

## 9. Error catalogue

```json
{
  "type": "https://api.fa-marketplace.pk/problems/ceiling-exceeded",
  "title": "Negotiation exceeds buyer's authorized maximum",
  "status": 409,
  "code": "CEILING_EXCEEDED",
  "detail": "Offered 112,000 exceeds max_authorized_minor 110,000.",
  "trace_id": "0af7651916cd43dd",
  "violated_rule": "BR-025",
  "meta": { "max_authorized_minor": 11000000 }
}
```

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Field errors in `errors[]` |
| 400 | `INVALID_STATE_TRANSITION` | Guard table lookup failed |
| 400 | `CEILING_EXCEEDED` | Negotiation above authorized max |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` / `STEP_UP_REQUIRED` | |
| 403 | `FORBIDDEN_ROLE` / `FORBIDDEN_KYC_TIER` / `FORBIDDEN_CLEARANCE` / `EVIDENCE_NOT_ACCESSIBLE` | |
| 404 | `NOT_FOUND` | Deliberately indistinguishable across resources you may not see |
| 409 | `VERSION_CONFLICT` | `If-Match` stale — re-fetch and retry |
| 409 | `OFFER_ALREADY_SELECTED` | Race lost |
| 409 | `CASH_CEILING_EXCEEDED` | Agent cash rule |
| 409 | `CUSTODY_CEILING_EXCEEDED` | Agent transport rule |
| 409 | `SERIAL_MISMATCH` | Anti-substitution gate tripped |
| 409 | `COMMISSION_INELIGIBLE` | With `reason` from `06` §3.2 |
| 409 | `DISPUTE_OPEN` | Action blocked while a dispute is open |
| 413 | `EVIDENCE_TOO_LARGE` | Per-kind limit |
| 415 | `UNSUPPORTED_MEDIA` | |
| 422 | `CATEGORY_PROHIBITED` | With `prohibited_reason` |
| 422 | `CHECKLIST_INCOMPLETE` | Missing mandatory items |
| 422 | `POSSESSION_UNVERIFIED` | Gate not passed |
| 429 | `RATE_LIMITED` | |
| 500 | `INTERNAL` | Never leaks a stack trace |
| 503 | `DEPENDENCY_UNAVAILABLE` | PSP or SFU down — include `degraded: true` and what still works |

**Design rule:** every 4xx that a user can cause must carry copy the UI can display verbatim.
No raw codes leaking into the interface. All codes have a human string in the client bundle.

---

## 10. Observability

- **Tracing:** OpenTelemetry, one trace id propagated from the client through the gateway into
  every module and out to PSP/courier calls. `trace_id` is returned on every response and shown
  in the error UI — users can read it to support.
- **Metrics:** RED for every endpoint; business metrics per `09` §4.
- **Alerts (paging):** DB-trigger `commission_requires_completed_purchase` firing; ledger
  imbalance; reconciliation break; SOS received; webhook signature failures > 5/min; media
  pipeline backlog > 1000; PSP error rate > 2% for 5 min.
- **Logs:** structured JSON, PII-scrubbed in the logger itself (not a post-filter), 90-day hot
  retention.

---

## 11. Client architecture

```
lib/
  api/         generated client (OpenAPI), typed errors, retry + idempotency
  state/       Riverpod; offline-first cache backed by drift/Isar
  realtime/    WS client with version-gap recovery
  evidence/    encrypted local queue, chunked resumable uploader, sha256
  media/       camera, gallery, guided-capture prompts
  ui/          design system: status pills, diff panels, timeline, money line items
features/
  auth  request  matching  agent_feed  job  inspection  negotiation
  live  payment  dispute  wallet  admin
```

- **One Flutter codebase**, two entry points (buyer/agent flavouring via build flavour flag).
  Rationale: 90%+ of the code is shared, and the agent must run on cheap Android hardware in
  poor connectivity. See `10` §2 for why not React Native.
- **Offline:** agent job flows are local-first. Checklist edits, photos, notes are written to
  an encrypted local store immediately and uploaded opportunistically. Sync is idempotent and
  conflict-aware (`03` R5, `09` §6).
- **Contract tests:** consumer-driven (Pact) between the Flutter client and the API, plus
  generated OpenAPI types so a breaking change fails CI rather than production.
- **Release:** staged rollout by `install_id` hash, instant rollback via feature flag, not app
  store wait.