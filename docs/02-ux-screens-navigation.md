# 02 — UX, Screens & Navigation

## 1. UX principles

| # | Principle | Consequence in the UI |
|---|---|---|
| 1 | **Explain in 10 seconds** | Home hero is a 6-frame vertical story, not a paragraph. Never lead with "marketplace". |
| 2 | **Money is never ambiguous** | Inspection Bid / Success Fee / Purchase Price always appear as three separate labelled lines, everywhere, including receipts. |
| 3 | **Claimed ≠ Verified, always** | Two-column diff panel. "Not verified" is a valid, visible state. |
| 4 | **Evidence is a first-class citizen** | Every agent action produces an artifact; the agent sees progress "Evidence captured: 23/25" to motivate completeness. |
| 5 | **The buyer is in control, not a passenger** | Live session is a first-class button, not a request the agent may ignore. Ceiling is enforced server-side and shown to the agent as a hard bar. |
| 6 | **Safety must be one thumb away** | SOS is a persistent bottom-bar item on every agent screen. Never inside a menu. |
| 7 | **Offline-first for agents** | Agents work in basements and metal markets with no signal. The whole inspection flow is local-first. |
| 8 | **Plain language, no jargon** | "Field Agent", "Inspection", "Purchase limit". Never "verification fee", "escrow", "arbitration". |
| 9 | **Never fake availability** | If no agents match, say so and offer to notify. Do not show a fake shortlist. |
| 10 | **Show the human** | Agent photo, name, area, completed count, response time. The buyer is buying a person. |

---

## 2. The 10-second explainer (home hero)

A vertical 6-frame scroll, auto-playing, each frame one sentence + one icon:

```
1  You found a phone online.
2  The seller is in another city.
3  You can't go check it.
4  So you hire someone who is there.
5  They check it. You watch on video.
6  If it's real, they buy it. If it's not, you pay only the inspection fee.
```

One button: **"Check a product for me"** → `/requests/new`.
Secondary: **"I'm a Field Agent"** → agent onboarding.

This is the entire pitch. No feature list. No carousel of categories.

---

## 3. Global navigation

### Buyer app (bottom nav, 4 tabs)
```
Requests | Explore (agents) | Orders | Account
        +  persistent "help/SOS-lite" via Account
```
Active request pinned above the tab bar whenever one exists:

```
┌─────────────────────────────────────┐
│ ● LIVE — Agent at seller, Lahore     │  ← tappable, opens live session or progress
│   23/25 checks done · 2h 41m on site │
└─────────────────────────────────────┘
```

### Agent app (bottom nav, 5 tabs)
```
Feed | Jobs | Earnings | Wallet | Me
```

### Admin (web, sidebar)
```
Overview | Transactions | Disputes | Agents | Buyers | Sellers | Risk | Finance | Content | Config | Audit
```

---

## 4. Screen inventory

### 4.1 Shared, auth, onboarding (16 screens)

| ID | Screen | Route |
|---|---|---|
| S-01 | Splash / session check | `/` |
| S-02 | Language & role chooser | `/start` |
| S-03 | Phone entry (+ country code PK prefilled) | `/auth/phone` |
| S-04 | OTP verify | `/auth/otp` |
| S-05 | Account type: Buyer / Field Agent | `/auth/role` |
| S-06 | Buyer profile: name, city, language | `/onboarding/buyer` |
| S-07 | Buyer consent & terms | `/onboarding/buyer/consent` |
| S-08 | Agent onboarding: intro + earnings explainer | `/agents/join` |
| S-09 | Agent onboarding: identity + CNIC front/back | `/agents/join/kyc1` |
| S-10 | Agent onboarding: selfie + liveness | `/agents/join/kyc2` |
| S-11 | Agent onboarding: home city, service area map | `/agents/join/area` |
| S-12 | Agent onboarding: categories + clearance pick | `/agents/join/skills` |
| S-13 | Agent onboarding: bank account / IBAN | `/agents/join/payout` |
| S-14 | Agent onboarding: rules + fee schedule + declaration | `/agents/join/rules` |
| S-15 | Pending verification screen | `/agents/pending` |
| S-16 | Rejected / appeal screen | `/agents/rejected` |

### 4.2 Buyer (30 screens)

| ID | Screen | Route |
|---|---|---|
| B-01 | Home (hero + active request) | `/home` |
| B-02 | **Create request — entry** | `/requests/new` |
| B-03 | Create request — from screenshots (AI extract, confirm) | `/requests/new/extract` |
| B-04 | Create request — seller details | `/requests/new/seller` |
| B-05 | Create request — product details | `/requests/new/product` |
| B-06 | Create request — location & meeting safety | `/requests/new/location` |
| B-07 | Create request — price: asking / max / target / negotiation | `/requests/new/price` |
| B-08 | Create request — checklist builder | `/requests/new/checklist` |
| B-09 | Create request — evidence upload (listing, chats) | `/requests/new/evidence` |
| B-10 | Create request — review & publish | `/requests/new/review` |
| B-11 | Category blocked screen (prohibited) | `/requests/blocked` |
| B-12 | **Agent shortlist** (match results) | `/requests/:id/agents` |
| B-13 | Agent offer compare view | `/requests/:id/offers` |
| B-14 | Agent profile (full) | `/agents/:id` |
| B-15 | Pay inspection bid | `/requests/:id/pay` |
| B-16 | Payment result | `/payments/:id/result` |
| B-17 | **Request tracker (master timeline)** | `/txn/:id` |
| B-18 | Seller & product: Claimed vs Verified | `/txn/:id/verify` |
| B-19 | Live session lobby (pre-flight) | `/txn/:id/live/lobby` |
| B-20 | **Live session (video + screen-share + shot list)** | `/txn/:id/live` |
| B-21 | Inspection report (read-only, annotated) | `/txn/:id/report` |
| B-22 | Negotiation ledger | `/txn/:id/negotiation` |
| B-23 | Approve / Reject / Counter screen | `/txn/:id/decision` |
| B-24 | Reject — reason picker | `/txn/:id/reject` |
| B-25 | Authorize purchase (ceiling check) | `/txn/:id/authorize` |
| B-26 | Settlement instructions (how to pay seller) | `/txn/:id/settle` |
| B-27 | Settlement receipt & proof review | `/txn/:id/receipt` |
| B-28 | Package & tracking | `/txn/:id/shipment` |
| B-29 | Delivery confirm / report problem | `/txn/:id/delivery` |
| B-30 | Dispute wizard | `/txn/:id/dispute/new` |
| B-31 | Dispute thread | `/disputes/:id` |
| B-32 | Rate agent | `/txn/:id/rate` |
| B-33 | Saved agents / favourites | `/account/agents` |
| B-34 | Rebook previous agent | `/account/agents/:id/rebook` |
| B-35 | Notification centre | `/notifications` |
| B-36 | Help & FAQ | `/help` |
| B-37 | Settings (language, notifications, privacy) | `/account/settings` |

### 4.3 Field Agent (34 screens)

| ID | Screen | Route |
|---|---|---|
| A-01 | Agent home / availability toggle | `/agent` |
| A-02 | Earnings today/this week + next payout | `/agent/earnings` |
| A-03 | **Request feed** (eligible, matched) | `/agent/feed` |
| A-04 | Request detail (buyer-visible info only) | `/agent/requests/:id` |
| A-05 | Offer sheet: accept / bid / counter | `/agent/requests/:id/offer` |
| A-06 | My active jobs list | `/agent/jobs` |
| A-07 | Job detail + timer + next-step checklist | `/agent/jobs/:id` |
| A-08 | **Pre-visit call script + seller contact** | `/agent/jobs/:id/call` |
| A-09 | Contact seller outside app (dialer + logged) | `/agent/jobs/:id/contact` |
| A-10 | Travel & navigation, cost logging | `/agent/jobs/:id/travel` |
| A-11 | **Check-in (GPS + photo + consent)** | `/agent/jobs/:id/checkin` |
| A-12 | Seller identity capture — CNIC | `/agent/jobs/:id/seller/id` |
| A-13 | Seller identity capture — presence selfie | `/agent/jobs/:id/seller/selfie` |
| A-14 | Seller location proof (pin + context) | `/agent/jobs/:id/seller/location` |
| A-15 | Possession check (invoice/box/serial) | `/agent/jobs/:id/possession` |
| A-16 | **Inspection checklist runner** (per section) | `/agent/jobs/:id/inspect/:section` |
| A-17 | Checklist item detail (status, notes, media, value) | `/agent/jobs/:id/inspect/:section/:item` |
| A-18 | Camera: guided shots (serial close-up, full item, damage) | `/agent/jobs/:id/capture` |
| A-19 | Compare-to-listing (side-by-side) | `/agent/jobs/:id/compare` |
| A-20 | Functional test helper (per category: battery, screen, ports…) | `/agent/jobs/:id/test/:device` |
| A-21 | Findings & discrepancies log | `/agent/jobs/:id/findings` |
| A-22 | Verdict screen (PASS/PASS_WITH_NOTES/MISMATCH/FAIL) | `/agent/jobs/:id/verdict` |
| A-23 | Submit & seal report | `/agent/jobs/:id/submit` |
| A-24 | Live session — start (buyer notified) | `/agent/jobs/:id/live/start` |
| A-25 | **Live session — agent view (shot list, walkthrough)** | `/agent/jobs/:id/live` |
| A-26 | Negotiation — open with seller price | `/agent/jobs/:id/negotiate/open` |
| A-27 | Negotiation — counter & log | `/agent/jobs/:id/negotiate/counter` |
| A-28 | Ceiling breach → call buyer (required) | `/agent/jobs/:id/negotiate/override` |
| A-29 | Settlement: watch buyer pay seller | `/agent/jobs/:id/settle` |
| A-30 | Cash collection (within ceiling) | `/agent/jobs/:id/cash` |
| A-31 | Serial re-verify + machine match | `/agent/jobs/:id/custody/verify` |
| A-32 | Packaging per category protocol | `/agent/jobs/:id/package` |
| A-33 | Handover: create waybill / book courier | `/agent/jobs/:id/handover` |
| A-34 | Personal delivery flow + buyer OTP | `/agent/jobs/:id/deliver` |
| A-35 | Job complete → request payout | `/agent/jobs/:id/complete` |
| A-36 | Decline task — reason picker | `/agent/feed/:id/decline` |
| A-37 | Profile & reputation | `/agent/profile` |
| A-38 | Trust score explainer | `/agent/profile/trust` |
| A-39 | Wallet & payout history | `/agent/wallet` |
| A-40 | Payout account | `/agent/wallet/account` |
| A-41 | **SOS** | `/agent/sos` |
| A-42 | Training & category playbooks | `/agent/training` |
| A-43 | Rules & fee schedule | `/agent/rules` |

### 4.4 Admin web (21 screens)

| ID | Screen | Route |
|---|---|---|
| AD-01 | Overview (GMV, funnel, alerts) | `/admin` |
| AD-02 | Transaction list + filters | `/admin/txns` |
| AD-03 | Transaction 360 (timeline, evidence, money, risk) | `/admin/txns/:id` |
| AD-04 | Disputes queue (SLA-ordered) | `/admin/disputes` |
| AD-05 | Dispute case file + adjudication | `/admin/disputes/:id` |
| AD-06 | Agent list + status/clearance | `/admin/agents` |
| AD-07 | Agent detail (KYC, earnings, risk, strikes) | `/admin/agents/:id` |
| AD-08 | Agent approval queue | `/admin/agents/queue` |
| AD-09 | Agent suspension & reinstatement | `/admin/agents/:id/enforce` |
| AD-10 | Buyer list + risk | `/admin/buyers` |
| AD-11 | Seller entity intelligence | `/admin/sellers` |
| AD-12 | Seller entity detail (patterns, photos, cases) | `/admin/sellers/:id` |
| AD-13 | Risk & fraud queue | `/admin/risk` |
| AD-14 | Fraud signal detail + case notes | `/admin/risk/:id` |
| AD-15 | Finance: ledger & reconciliation | `/admin/finance/ledger` |
| AD-16 | Payout run builder | `/admin/finance/payouts` |
| AD-17 | Refunds & adjustments | `/admin/finance/refunds` |
| AD-18 | Content: checklist templates & category rules | `/admin/content/checklists` |
| AD-19 | Content: notification templates | `/admin/content/templates` |
| AD-20 | Config: pricing, fees, limits, flags | `/admin/config` |
| AD-21 | Audit log search | `/admin/audit` |

Total: 16 + 37 + 43 + 21 = **117 screens** (includes sub-screens and wizards).

---

## 5. Detailed screen specs — the twelve that decide the product

### B-17 · Request tracker (buyer's master view)

**Purpose:** the buyer should never wonder what is happening or what they must do.

```
┌────────────────────────────────────────────────────────┐
│ ← Order #FA-2049            ⚠ Action needed           │
│ Used iPhone 15 Pro · seller in Lahore                  │
├────────────────────────────────────────────────────────┤
│ [Progress bar: 8 of 11 steps]                          │
│                                                        │
│ ● DONE  Request published                    Aug 12     │
│ ● DONE  Agent selected — Ayesha K. (★4.9, 212 done)    │
│ ● DONE  Inspection fee paid — Rs 1,500                  │
│ ● NOW   Agent is at the seller (checked in 2h ago)      │
│ ○ NEXT Seller identity + possession verified           │
│ ○       Product inspection (23 of 25 checks)            │
│ ○       Live video call with you                        │
│ ○       Your approval                                    │
│ ○       Purchase + payment to seller                    │
│ ○       Packaging + courier                              │
│ ○       Delivery + your confirmation                     │
├────────────────────────────────────────────────────────┤
│ YOUR MONEY SO FAR                                      │
│ Inspection fee  Rs 1,500   paid                         │
│ Success fee      Rs 0      charged only if you buy      │
│ Price to seller  Rs 142,000  paid by you, not by us     │
├────────────────────────────────────────────────────────┤
│ [ 📹 Request live call ]   [ 💬 Message agent ]         │
└────────────────────────────────────────────────────────┘
```

Key rules: the "YOUR MONEY SO FAR" block is **pinned to every buyer screen in the
transaction**. The live-call button is enabled from `PRODUCT_INSPECTION_STARTED` until
`PURCHASE_APPROVED` — the buyer is never locked out of seeing.

---

### B-18 · Claimed vs Verified

Two columns, never merged. Missing verification renders as a grey `Not verified` chip, never
as a blank or an assumption.

```
┌──────────────────────┬─────────────────────────┬───────┐
│ Field                │ Claimed (seller listing)│Verified│
├──────────────────────┼─────────────────────────┼───────┤
│ Seller name          │ Ali R.                  │✔ CNIC  │
│ Seller phone         │ 0300-1234567            │✔ same  │
│ Location             │ "Johar Town, Lahore"    │⚠ 2.1km │
│                      │                         │  away  │
│ IMEI                 │ 356938…                 │✔ match │
│ Battery health       │ "92% — like new"        │✖ 89%  │
│ Cosmetic             │ "No scratches"          │✖ 1 deep│
│ Accessories          │ "Box + charger"         │✔ all   │
│ Seller ID            │ —                       │⚠ unvfy│
│ Ownership proof      │ —                       │✖ none │
└──────────────────────┴─────────────────────────┴───────┘
        ⚠ 2 differences found. Read the report before approving.
```

Differences auto-generate a `discrepancy` record which the agent must acknowledge in the
verdict. **Discrepancy detection is the product.** If the buyer only ever looks at one screen,
it is this one.

---

### B-20 · Live session (buyer view)

```
┌────────────────────────────────────────────────────────┐
│ ⏱ 12:04  ● REC        [ ⏹ End ] [ ✋ Ask agent ]       │
├───────────────────────────────┬────────────────────────┤
│                               │  SHOT LIST             │
│                               │  ✔ Show serial number  │
│                               │  ✔ Battery health      │
│                               │  ▶ Test the speaker    │
│                               │  ○ Both sides of body  │
│                               │  ○ Box + accessories    │
│        [video: agent holding │                        │
│         phone, rotating]      │  SELLER INFO           │
│                               │  "Ali, shop in Johar"  │
│                               │                        │
├───────────────────────────────┴────────────────────────┤
│ 💬 "Turn it off and on again"          [ Send ]       │
├────────────────────────────────────────────────────────┤
│ [📤 Share listing photo]  →  agent holds item beside it│
└────────────────────────────────────────────────────────┘
```

Features: screen-share both ways (buyer shares listing photo #3 → agent holds the physical
item beside it — this is the single most persuasive moment in the product), buyer "shot
list" chips the agent can see (removes the "agent didn't show me" dispute class), recording
with consent banner, and a rewind-to-timestamp list of recorded clips after the call.

---

### A-16 · Inspection checklist runner (agent view, offline-first)

Section-per-screen, big tap targets, no horizontal scroll.

```
┌────────────────────────────────────────────────────────┐
│ ‹ Screens & Display        Section 3 of 6               │
│ Item 9 of 14                                            │
├────────────────────────────────────────────────────────┤
│ ▶  Display — check for dead pixels, burn-in, cracks   │
│                                                        │
│  Status                                                │
│  [ ✓ Pass ]  [ ! Warning ]  [ ✕ Fail ]  [ – N/A ]      │
│                                                        │
│  Notes (voice-to-text OK)                               │
│  ┌────────────────────────────────────────────┐        │
│  │ No dead pixels. Tiny burn-in top-right…    │        │
│  └────────────────────────────────────────────┘        │
│                                                        │
│  EVIDENCE                                   3 attached │
│  ┌────┐ ┌────┐ ┌────┐ ┌ ─ ─ ─ ┐                        │
│  │IMG │ │IMG │ │VID │ │ + add │                        │
│  └────┘ └────┘ └────┘ └ ─ ─ ─ ┘                        │
│                                                        │
│  Device value:  battery_health = [ 89 ] %              │
├────────────────────────────────────────────────────────┤
│ Evidence 23/25  ·  ⛅ Offline ·  queued, will sync      │
├────────────────────────────────────────────────────────┤
│  [ ← Previous ]                        [ Next → ]      │
└────────────────────────────────────────────────────────┘
```

Non-negotiable details: voice-to-text for notes (agents type slowly, one-handed, in sunlight);
"queued, will sync" explicit so the agent never double-takes a photo; the running
evidence counter as a progress motivator; a `Skip` that requires a reason (never a silent gap).

---

### A-41 · SOS (agent)

```
┌────────────────────────────────────────────────────────┐
│                    ARE YOU SAFE?                       │
│                                                        │
│      [  🆘  EMERGENCY  ]                                │
│                                                        │
│  Tapping alerts your trusted contact with your live      │
│  location, calls the platform safety line, and starts  │
│  a 5-minute countdown to police liaison.               │
│                                                        │
│  Trusted contact:   Bilal (brother)      [change]      │
│  Live location:     sharing ✓                           │
│  Safety line:       1102                                │
├────────────────────────────────────────────────────────┤
│  [ I feel unsafe — exit early ]   [ Report a problem ]  │
└────────────────────────────────────────────────────────┘
```

"I feel unsafe" is a one-tap, consequence-free exit that ends the task with a safety-failure
verdict and full task-fee release. **Never penalise a safety exit.** This is the single rule
that keeps good agents in the network.

---

### AD-03 · Transaction 360 (admin)

Four quadrants, one screen: timeline (all events), evidence vault (thumbnails, hashes,
pHash-match warnings), money (ledger entries for this transaction, line by line), risk
(signals, score, graph links to seller/agent/buyer). Every admin action writes to the audit
chain with actor, reason, and before/after.

---

### 5.1 The four dashboards

**Buyer dashboard (`B-01`)** — active request card, next action required, money summary,
saved agent shortcut, and nothing else. No feed, no recommendations, no upsells. This is a
transactional product, not a shopping app.

**Field Agent dashboard (`A-01`)** — availability toggle, "jobs waiting for you near
Islamabad: 7", next payout date and amount, trust-score delta this week, one-tap
"your last inspection report was viewed 4× by buyers" (social proof nudges quality).

**Seller / transaction information interface (B-18)** — the Claimed-vs-Verified panel above.
Sellers have no interface; they are recorded, and this panel is the buyer-facing rendering of
that record. Admin gets the deeper version at `AD-12`.

**Admin dashboard (`AD-01`)** — four numbers (open disputes past SLA, unmatched payouts,
transactions at risk, today's GMV and net contribution) and four queues. No vanity charts.

---

## 6. Copy deck — strings that carry the product

| Screen | String |
|---|---|
| Home hero CTA | Check a product for me |
| Inspection bid explainer | You pay the agent for the visit and inspection. It's due even if you don't buy. |
| Success fee explainer | We charge 10% only if the sale goes through. Never charged if it doesn't. |
| Purchase price explainer | You pay the seller directly, while you watch on video. We never hold your money. |
| Failure screen | The inspection failed. You paid only the inspection fee — Rs 750. Nothing else was charged. |
| Ceiling explainer | Hard limit. The agent cannot go above this without calling you. |
| Negotiation explainer | The agent can negotiate for you, but can never go above your limit without asking. |
| Report lock | Submitted. This report can't be changed. |
| Declared vs verified | Not verified |
| Difference badge | 2 differences found |
| Live session banner | This call is being recorded so both of you have a record. |
| Delivery confirm | Got it. Everything matches? Confirm to release the agent's commission. |
| Dispute open | Your commission is on hold while we look at this. |
| Agent payout | Paid. Next payout run: Friday. |
| No agents match | No agents are available in {city} for {category} right now. We'll alert you the moment one is. |
| Safety exit | End this task. You won't be penalised and you'll be paid what you've earned. |

Banned words: escrow, escrow account, verified seller (we verify an *entity*, not a seller),
guarantee, insured purchase, buyer protection (implies protection we don't underwrite).

---

## 7. Empty, loading, and error states

Every list screen defines its own empty state; no generic "No data".

| Context | Empty state |
|---|---|
| No requests | "You haven't checked a product yet." + CTA |
| No agents match | Explicit geographic/category explanation + notify-me toggle + nearest-city suggestion |
| Report not submitted | "Your agent is still checking. Last update 8 min ago." + message agent |
| No earnings | "Your first payout arrives within 7 days of your first job." + training link |
| No messages | Not shown; chat is a sheet, not a screen |
| Offline | Persistent top bar: `You're offline. Work is saved on this phone and will sync.` |

Error states: never blame the user. Actions are always one tap. Every payment error states
**whether the buyer was charged**, in the first sentence.

---

## 8. Connectivity, device, and accessibility

- **Target device:** 2GB RAM Android 10+, mid-range. If the app needs a flagship phone to run,
  the supply side breaks. Enforce a bundle-size budget (APK ≤ 25MB, cold start ≤ 2.5s on
  3G) in CI.
- **Agent offline mode:** full inspection flow works offline. Media queued encrypted on device
  (AES-256, key from server session). Sync on reconnect, exponential backoff, resumable chunked
  upload. Conflict rule: first-write-wins on checklist items with version vector; agent cannot
  overwrite a sealed report.
- **Buyer on poor connections:** live session degrades to audio + stills + chat, explicitly
  announced ("Video unstable — switching to photos"). Never silently drop video while the buyer
  thinks they are watching.
- **Data saver mode:** photos compress server-side; video 480p default, HD opt-in.
- **Accessibility:** minimum 16sp body, 4.5:1 contrast, all status conveyed by icon **and** text
  (never colour alone — "Pass/Fail" pills carry labels), screen-reader labels on every media,
  Urdu RTL from V1 at the layout level even if translations land later.