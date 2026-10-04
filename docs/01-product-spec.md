# 01 — Product Specification

## 1. Problem, in the buyer's own words

> *"I found a used iPhone on Facebook for Rs 150,000. The seller is in Lahore. I am in
> Karachi. He says the battery health is 92% and there are no scratches. I cannot check.
> I have been scammed twice before — once a fake, once a smashed phone in a box. I will not
> pay the money unless I am sure."*

The buyer is not price-constrained. They are **certainty-constrained**. The product's job is
to convert certainty they cannot obtain themselves into certainty they can buy.

---

## 2. Actors

| Actor | Is a platform user? | Notes |
|---|---|---|
| **Buyer** | Yes | The paying customer. Can be anyone. KYC tier 1 minimum. |
| **Field Agent** | Yes | The supply side. Also a *customer* of the task-fee product. Highly treated. |
| **Seller** | **No** — MVP | External party from Facebook/OLX/whatsApp/shop. Recorded as a lightweight `seller_entity`, never onboarded, never rated publicly. |
| **Courier partner** | No | Third-party. TCS / Leopards / CallCourier. Reached via adapter. |
| **Ops / Trust & Safety** | Yes (staff) | Moderates, arbitrates disputes, watches fraud. |
| **Admin** | Yes (staff) | Config, pricing, agent approval, risk policy. |
| **Finance** | Yes (staff) | Ledger reconciliation, payout runs, refunds. |

### 2.1 Buyer capabilities (authoritative list)

1. Create a purchase/inspection request with seller + product + location + budget.
2. Upload listing screenshots, seller photos, seller messages.
3. Choose inspection checklist items + add custom instructions.
4. Set max authorized price; optionally set negotiation target + hard ceiling.
5. Browse eligible agents; filter by category, rating, distance, price, availability.
6. Accept an agent's offer or place a bid within the band.
7. Pay inspection bid (+ any advance success fee if the design chooses Option C).
8. Chat with agent in-app; request a live video session.
9. Watch, ask questions, and use screen-share to compare listing vs physical item.
10. Approve / reject / counter after inspection.
11. Authorize purchase within ceiling; watch settlement.
12. Track package, confirm delivery or raise a problem.
13. Open a dispute (typed category, evidence, requested remedy).
14. Rate the agent after completion.
15. Re-book a previous agent in one tap.

### 2.2 Field Agent capabilities (authoritative list)

Grouped, because the order *is* the product:

**A. Marketplace**
1. Opt into availability; set service area, max travel distance, hourly availability window.
2. See eligible requests (city + category match + clearance).
3. Accept listed inspection bid, or place a bid (configurable per market).
4. Counter a buyer's offer (max 2 counters, MVP).

**B. Pre-visit**
5. View seller's declared details, listing evidence, checklist, and buyer's instructions.
6. Call/WhatsApp seller to confirm time and place.
7. Record seller identity: name, phone, CNIC photo (with consent), selfie with seller.
8. Check-in at seller location (GPS + timestamp + accuracy).

**C. Inspection**
9. Verify possession: invoice/box/serial cross-check.
10. Capture IMEI / serial / model / VIN; check for tampering.
11. Execute the checklist item by item, with per-item photo/video evidence.
12. Compare physical item to buyer-uploaded listing photos (side-by-side view).
13. Run functional tests (screen, camera, speakers, mic, charging, storage, battery health…).
14. Record damage, missing accessories, replaced parts.
15. Mark verdict: PASS / PASS_WITH_NOTES / MISMATCH / FAIL.
16. Submit report (locks report; cannot edit after submission without T&S override).

**D. Buyer participation**
17. Initiate live video; walk buyer through product; take buyer-directed shots.
18. Screen-share buyer's listing photo alongside the physical item.
19. Hold session for buyer questions; end only when buyer or timeout.

**E. Negotiation** (only if authorized)
20. Open with seller's asking price; negotiate down toward target.
21. Never exceed hard ceiling. Hard stop. Must call buyer to exceed.
22. Log every counteroffer with amount + message + timestamp.
23. Request buyer approval for any price above target (below ceiling).

**F. Purchase & custody**
24. Confirm buyer authorization (on camera / signed capture).
25. Confirm buyer has paid seller (or collect cash ≤ ceiling).
26. Capture purchase receipt.
27. Collect item; verify serial matches inspection serial (machine check).
28. Package per category protocol; photograph sealed package.
29. Either hand to courier (create waybill, capture handover) or personally deliver.
30. Capture proof of delivery.
31. Complete job → request payout.

**G. Never allowed**
- Alter or omit buyer instructions in negotiation.
- Exceed ceiling without explicit recorded approval.
- Take custody above the cash/item ceilings without a platform override.
- Contact the buyer off-platform to solicit the next job (no poaching).
- Buy from a source other than the verified seller at the verified location.

### 2.3 Seller — the "declared vs verified" wall

The single most important UX element in the whole product. Every piece of seller and product
information is stored **twice**:

| Field | Declared (by buyer) | Verified (by agent) |
|---|---|---|
| Seller name | from listing | from CNIC / seller statement |
| Seller phone | from listing | number actually reachable at visit |
| Seller address | from listing | GPS pin at visit + street context |
| Seller identity | unknown | CNIC captured + match status |
| Possession | claimed | invoice/box/serial cross-check result |
| Product condition | listing photos + text | inspection checklist + media |
| Serial / IMEI | from listing text | read from device |
| Price | listing price | negotiated price |

UI rule: **never** merge these into one record. Show as a side-by-side "Claimed vs Verified"
panel with a red/green diff. When a field has no verification, show "Not verified" — never a
plausible-looking default.

---

## 3. Domain glossary

These words must be used identically in code, UI, and support training.

| Term | Definition |
|---|---|
| **Request** | Buyer's *intent*: product, seller, location, budget, checklist. Pre-payment. |
| **Offer** | An agent's response to a Request: fee + ETA. Kind = ACCEPT or BID. |
| **Transaction** | The binding commitment created when a buyer selects an Offer. One Request → at most one live Transaction. |
| **Inspection Bid** | Buyer's payment to the agent for the inspection service. Paid regardless of deal outcome. |
| **Success Fee** | Platform's 10% (tiered) of the actual purchase price. Charged only on settlement. |
| **Purchase Price** | The money that goes to the seller. Not custodied by platform in MVP. |
| **Seller Entity** | A deduplicated record of a physical seller, created by the agent at visit. Not a user. |
| **Checklist** | Category-specific ordered list of verification items with pass/fail/warn states. |
| **Verdict** | Agent's structured conclusion: PASS / PASS_WITH_NOTES / MISMATCH / FAIL. |
| **Evidence** | Any artifact attached to a transaction: photo, video, doc, location fix, text, event. Immutable once sealed. |
| **Live Session** | Platform-native audio+video call between buyer and agent, optionally screen-share, optionally recorded. |
| **Milestone** | A payable step of the inspection bid (arrive, inspect, package, deliver). |
| **Ceiling** | Buyer's absolute max purchase price. Hard limit on agent authority. |
| **Target** | Buyer's negotiation aim. Agent may exceed target; may not exceed ceiling. |
| **Settlement** | The moment purchase money moves to seller. Triggers Success Fee. |
| **Commission Settled** | Terminal financial state after buyer receipt + dispute window. Releases agent's 50% share. |
| **Dispute Window** | 72h default after delivery before commission is released. |
| **Cash Ceiling** | Max cash an agent may hold for >10 min. Default PKR 5,000. |
| **Custody Ceiling** | Max declared value an agent may personally transport. Default PKR 100,000. |
| **Abuse** | Any deliberate misrepresentation by buyer, agent, or seller. Abuse strikes ≠ quality strikes. |

---

## 4. User journeys

### J1 — Buyer: happy path (used iPhone 15 Pro, Lahore seller)

1. Buyer pastes listing screenshots from Facebook. Sets product "Used iPhone 15 Pro 256GB",
   seller city Lahore, declared Rs 150,000, max authorized Rs 145,000, negotiation target
   Rs 140,000.
2. Buyer picks checklist: IMEI, battery health, cameras, Face ID, display, speakers, mic,
   charging, physical damage, replaced parts, accessories, compare-to-listing.
3. Buyer requests a live video session at handover-of-approval.
4. Buyer chooses category + city + budget → sees 6 eligible agents in Lahore. Filters: rating
   ≥ 4.5, completed ≥ 20, price ≤ Rs 1,800.
5. Buyer selects one → **Inspection Bid Rs 1,500 + travel** charged to card/wallet. Funds move to
   *Reserve*.
6. Agent accepts, calls seller, checks in at location (GPS pin recorded).
7. Agent captures seller CNIC + presence selfie. Ownership check: invoice with matching IMEI →
   PASS. Sells are unverifiable seller phone → new seller entity.
8. Agent runs checklist, 14 items, 31 photos, 4 videos. IMEI read: `35…` matches box.
9. Agent starts live session. Buyer watches. Buyer screen-shares listing photo #3; agent holds
   physical phone next to it. One scratch on the back not in listing → MISMATCH flagged.
10. Agent submits report: `MISMATCH — undisclosed scratch, battery 89% not 92%`.
11. Agent opens negotiation at Rs 150,000, settles Rs 142,000. Logs both counters.
12. Agent calls buyer for approval (video). Buyer sees price vs ceiling vs target: approves.
13. **Settlement:** buyer pays success fee 10% = Rs 14,200 to platform, then transfers
    Rs 142,000 to seller's JazzCash on camera. Receipt captured. Agent logs seller payment ref.
14. Agent re-scans IMEI on the item in his hand → machine-match OK. Packages, photographs
    sealed box. Creates TCS waybill, captures handover scan.
15. Buyer tracks parcel. Courier delivers; POD captured; buyer confirms receipt.
16. Dispute window (72h) elapses → **Commission Settled.** Platform share Rs 7,100; agent
    share Rs 7,100 + remaining task-fee milestone. Agent paid in weekly run.
17. Buyer rates agent 5★ and saves agent as favourite.

### J2 — Buyer: deal fails, only inspection fee is charged

Same up to step 9. Agent finds: IMEI on box ≠ IMEI on device, seller cannot explain, seller
invites a discount to skip the check. Verdict `FAIL — suspected tampering / resale of a
blacklisted IMEI`. Agent calls buyer, both agree to abort. Transaction → `DEAL_FAILED(reason
= counterfeit_suspicion)`.
- Purchase price: never charged.
- Success fee: **PKR 0**.
- Inspection bid: **PKR 750 released** (40% — inspection milestone only). See state machine §6.
- Seller entity flagged. Agent paid. Buyer refunded nothing because nothing was taken.
Buyer sees one screen: *"Inspection failed. You paid only the inspection fee."*

### J3 — Buyer: negotiation exceeded ceiling, agent stops

Ceiling Rs 110,000, target Rs 105,000. Seller's floor is Rs 118,000. Agent logs counters,
hits ceiling at Rs 110,000, cannot proceed. Calls buyer (required), buyer declines and
authorizes up to Rs 112,000 with a warning. Agent resumes, closes at Rs 112,000, records
buyer's approval capture. If buyer had *not* authorized, agent must abort. System blocks any
`negotiation_accepted` event with `price > ceiling` without a matching
`buyer_override` record.

### J4 — Agent: refuses the task (safety / legitimacy)

Agent opens request, sees seller's area is a known high-risk zone, seller's listing has
mismatched photos (reverse-image search flagged), or the category is restricted for the
agent's clearance level. Agent taps **Decline — reason: Safety / Not qualified / Out of
area.** No penalty for safety reasons. Repeat declines for *quality* reasons throttle
visibility; declines for *safety* reasons never penalise. This distinction protects the
supply side and is a critical supply-retention rule.

### J5 — Agent: no-show / timeout

Agent accepts, never checks in. Auto-expiry at `accepted_at + 4h` (configurable). Inspection bid
refunded 100%, strike recorded, agent notified. 3 strikes / 30d → suspension and manual
review. Buyer's request returns to the pool; one-tap "pick another agent".

### J6 — Seller refuses cooperation

Agent arrives, seller refuses inspection, refuses video, refuses ID capture. Agent selects
failure reason from a typed list, uploads evidence (video of refusal / no-answer log),
ends task. Inspection bid released at 30% (arrival milestone) + 25% penalty from agent withheld
if seller was pre-contacted and agreed. Rule: **agent is not penalised for seller
non-cooperation.**

### J7 — Post-delivery problem

Delivered, buyer finds a dead screen 2 days later (POD captured fine). Buyer opens dispute
`product_not_as_inspected`. Agent's checklist shows display PASS with video of it working.
T&S adjudicates on evidence: agent's video vs buyer's claim. Likely resolution: partial
refund of Success Fee, or buyer-funded repair, or denial if agent evidence is conclusive.
Dispute opens automatically if buyer reports within 14 days of delivery; commission stays
held during dispute.

### J8 — High-value transaction (> PKR 500,000 car)

Request auto-routes to platform pre-approval. A senior agent (vehicle clearance) with
tier-2 KYC is matched. Insurance bound. Two-party rule: agent may not personally transport
above PKR 100,000; mandatory insured courier. T&S watches live. Title-transfer docs verified
by agent but the platform issues **no certificate** — agent's report is evidence, not a
certificate. Legal review required before shipping this category at all. `[LEGAL REVIEW]`

---

## 5. Functional requirements

Grouped by domain with stable IDs for traceability.

### Request & matching (FR-REQ)
- FR-REQ-01 Create request from manual entry **or** screenshot upload with AI-extracted
  fields (suggested, never auto-committed; buyer confirms).
- FR-REQ-02 Validate category against allow-list; refuse prohibited categories with a
  specific, non-generic message.
- FR-REQ-03 Require: category, product description, seller city, seller location text or pin,
  declared price, max authorized price, at least one checklist item, at least one listing
  evidence item.
- FR-REQ-04 Enforce `max_authorized_price ≤ declared_price × 1.2` soft cap with override +
  reason capture (guards against fat-finger budgets).
- FR-REQ-05 Auto-expiry: unpublished requests expire after 30 days; published requests with
  no agent after 14 days notify buyer once then expire.
- FR-REQ-06 Match: eligible agents = `active AND cleared_for(category) AND service_area covers
  seller_gps AND within max_travel AND available AND not suspended AND conflict-free in
  next 6h`.
- FR-REQ-07 Ranking: distance → rating → completed count → response time → fairness rotation
  (avoid starvation; cap 60% of jobs to top 10 agents per city).
- FR-REQ-08 Recommend a fee band from distance only: Rs 30 per km of seller-to-dealer range,
  capped at the 50 km range (Rs 1,500), ±15%. Item category, difficulty and declared value never
  move it.
  Agent accepts/declines within band.

### Buyer bid & dealer assignment (FR-BID)
- FR-BID-01 **The buyer sets the inspection bid.** The platform suggests a band from category
  base + distance + difficulty + declared value. A bid below the band floor is allowed but
  flagged in the dealer feed (`DECISIONS.md` §5.3).
- FR-BID-02 The buyer also sets a hard **price ceiling** for the seller, and optionally a
  negotiation target. The dealer can never authorise above the ceiling.
- FR-BID-03 Dealer feed shows, per live bid: amount, distance, area, category, the buyer's
  ceiling, the suggested band, and the full check list. A dealer can decide without asking
  anything (`DECISIONS.md` §5.2).
- FR-BID-04 Dealer actions: **Accept / Counter (max 1 per chain) / Decline**. Decline reasons
  include safety, qualification, and `bid_too_low` — all penalty-free.
- FR-BID-05 On **accept**, the bid is frozen (`bid_locked_at`) and the buyer is charged the bid
  in the app. The dealer sees `paid` before travelling. The platform takes **no cut** of the bid.
- FR-BID-06 Buyer selects one accepting dealer; selecting atomically supersedes all sibling
  responses and creates the Transaction. Race-safe via `SELECT … FOR UPDATE` on request.
- FR-BID-07 Concurrent response cap per dealer (default 5). Response auto-expires (default 12h).

### Task execution (FR-TASK)
- FR-TASK-01 Guided checklist UI, one screen per section, progress persisted offline.
- FR-TASK-02 Each checklist item: status (PASS/FAIL/WARN/NA), notes, 0..n media, value fields.
- FR-TASK-03 Verdict screen requires: verdict + every checklist item addressed + ≥1 photo of
  the whole item.
- FR-TASK-04 Report is sealed on submit. Amendments require T&S approval and are versioned.
- FR-TASK-05 Live session: native audio+video, optional recording, optional screen-share,
  60-min hard cap, both parties' consent logged.
- FR-TASK-06 Negotiation ledger: every counter with amount, actor, timestamp, evidence ref.
- FR-TASK-07 Ceiling enforcement is server-side, not client-side. Hard reject.
- FR-TASK-08 Custody: serial re-read and machine-match against inspection serial before
  packaging. Mismatch → hard stop, dispute auto-opened.
- FR-TASK-09 Package per category protocol; sealed-package media mandatory.
- FR-TASK-10 Handover: courier waybill or personal delivery; proof mandatory.

### Money (FR-MONEY)
- FR-MONEY-01 Inspection bid, success fee, purchase price are three separate line items in UI,
  API, and ledger. Never merged.
- FR-MONEY-02 Success fee is computed and charged **only** at settlement, from the actual
  purchase price. Server-side only. Never accepted from a client-supplied amount.
- FR-MONEY-03 Commission is posted only after `buyer_confirmed_receipt` + dispute window.
- FR-MONEY-04 Refund of inspection bid is milestone-based, not all-or-nothing.
- FR-MONEY-05 All money is integer minor units (paisa). No floats anywhere.
- FR-MONEY-06 Payouts: weekly batch, bank transfer to verified IBAN, ledger-backed, with
  reconciliation report.

### Evidence (FR-EV)
- FR-EV-01 Every state transition writes an immutable `audit_log` entry (hash-chained).
- FR-EV-02 Media upload: client computes SHA-256; server re-encodes, strips EXIF, recomputes
  hash, stores pHash. Mismatch → flag.
- FR-EV-03 Evidence is append-only. "Delete" is a tombstone + reason, retained for legal hold.
- FR-EV-04 Evidence visibility is role-scoped; seller evidence is redacted before buyer sees.
- FR-EV-05 Retention policy per class (see `08`).

### Trust (FR-TRUST)
- FR-TRUST-01 Four KYC tiers; capability gating per tier.
- FR-TRUST-02 Rating requires a completed transaction + rater participation.
- FR-TRUST-03 Risk score per transaction from live signals; auto-review threshold.
- FR-TRUST-04 SOS always reachable by agent from any screen.
- FR-TRUST-05 Every agent check-in/out must be within service area; failures flag.

### Support (FR-SUP)
- FR-SUP-01 Any participant can open a dispute at any non-terminal state.
- FR-SUP-02 Dispute auto-freezes commission release.
- FR-SUP-03 Every dispute has an SLA timer and an assigned human owner.
- FR-SUP-04 In-app chat is retained as evidence; off-platform contact is disclosed but not
  prevented.

---

## 6. Non-goals — explicitly out of scope

Do not build these. Building them is the main way this project dies.

| Non-goal | Why |
|---|---|
| A general marketplace with seller onboarding/listing pages | Not the value. Enormous surface. Sellers stay external. |
| Escrow, wallets, or stored value for buyers | Regulatory risk, and unnecessary if purchase money never touches us. |
| Payments to sellers through the platform | Same. Seller is paid directly, on camera, by the buyer. |
| Logistics/micro-fulfilment, warehousing, shipping-rate shopping | Use couriers. |
| Agent-generated leads for the buyer | Out of scope; creates conflict of interest. |
| Price prediction, valuation, or market analytics | Separate business, needs volume. |
| Auto-negotiation by an AI agent | Way too much risk. Human negotiates, capped by ceiling. |
| Multi-language / regional-language UI in MVP | Urdu labels can come later; add when an agent cohort requires it. |
| Installment/BNPL for the purchase price | Requires licensing and credit risk. |
| Vehicle title transfer / vehicle registration support | Legal complexity. Inspect and report only. `[LEGAL REVIEW]` |
| Native iOS-first design | Pakistan is Android-dominant. One Flutter codebase. |
| Seller accounts and seller-side apps | Rejected: the agent's phone is the seller-facing interface. The seller's 5% fee is collected on-site via a payment link on the agent's device — the seller still never installs or registers for anything (`DECISIONS.md` §4). |
| The buyer raising a bid to hire an inspector | **IN — this is the core interaction.** The buyer posts a bid with amount, location, and a checklist of what to inspect; the dealer feed shows amount, distance, typical range, and the check list; the dealer accepts, counters once, or declines; on accept the buyer pays the bid in-app and the dealer sees a paid job (`DECISIONS.md` §5). |
| Cars and property | Out of v1. Registration transfer and tenancy agreements need a different product and a lawyer-reviewed flow. Cars in v2 (`DECISIONS.md` §6). |
| Insurance products | V2+, requires a licensed partner. |
| Blockchain / smart-contract settlement | No. Use a double-entry ledger and a bank. |

---

## 7. MVP acceptance criteria (the hypothesis under test)

The MVP is done when **all** of these hold:

1. A buyer in Karachi can create a phone-inspection request for a Lahore seller in under
   4 minutes, from a listing screenshot.
2. A verified agent in Lahore sees it, accepts, and the buyer's inspection bid is secured.
3. The agent can complete a 14-item checklist with ≥20 photos fully offline in poor
   connectivity and sync losslessly.
4. The buyer can watch a live, recorded video session and confirm the physical IMEI matches
   the listing.
5. The agent can negotiate up to a ceiling, and the system **hard-blocks** exceeding it.
6. Settlement captures seller payment on video; success fee is charged; commission is held.
7. A courier waybill is created, tracked, and POD closes the transaction.
8. Commission settles automatically 72h after buyer receipt confirmation.
9. A failed inspection charges only the inspection milestone, and zero success fee.
10. A dispute can be opened, auto-freezes commission, and is resolved by a human with evidence.
11. Net contribution per transaction is measurable and positive at the launch price points.
12. Zero unresolved data breaches and zero un-reviewed KYC exceptions during pilot.

Anything that does not serve one of those twelve does not ship in MVP.