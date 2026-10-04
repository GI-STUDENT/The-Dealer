# 03 — State Machine & Business Rules

> **Two confirmed changes** (`DECISIONS.md` §5, §2):
> 1. **The buyer bids first.** `PUBLISHED_REQUEST` fans a bid out to the dealer feed; dealers
>    respond with accept / counter / decline. The bid is frozen on first acceptance
>    (`bid_locked_at`). See BR-009 and the `RESPONSE_RECEIVED` → `RESPONSE_RECEIVED` guard.
> 2. **Success fees are two-sided** (buyer 5%, seller 5%) and exist **only when money moves**.
>    The `commission.settle` transition therefore settles *both* fees and the dealer bonus at
>    once, and is unreachable unless `purchase_completed_at` is set. See `06` §3.2.
>
> Names used below follow the confirmed model: `REQUEST` is a buyer's bid, `OFFER` is a
> dealer's response to it, and `offers.proposed_fee_minor` is the amount that dealer is asking
> (equal to the buyer's bid on an accept, or the dealer's counter).

## 1. Why the original state machine failed

The 23 states in idea.txt §16 have five structural defects:

1. **No negotiation loop.** Negotiation can occur before, during, and after inspection, and can
   iterate. The original places `NEGOTIATION` after `BUYER_REVIEWING`, which is only one of
   three valid positions.
2. **`PURCHASE_COMPLETED` vs `TRANSACTION_COMPLETED` are undefined and unreachable.** No
   transition chain reaches either from `PURCHASE_APPROVED`. Money settlement, custody handoff,
   delivery, and financial close are four distinct events; the original has two.
3. **The agent-delivered path is absent.** idea.txt §19 Option B (personal delivery) has no
   states, yet you listed it as a first-class delivery mode.
4. **No expiry states.** In a two-sided marketplace the majority of transactions die from
   non-response and non-payment. There must be states for request expiry, offer expiry, bid
   non-payment, and agent no-show.
5. **No custody or serial-verification gate.** The single highest-value anti-substitution
   control (idea.txt §17 implies it, never states it) had no state.

Corrected: **34 states**, an explicit guarded transition table, and a rule that all state
mutation goes through one function.

---

## 2. State inventory

Grouped by phase. `T` = terminal. `F` = failure/terminal-without-sale.

### Phase 0 — Request (pre-agreement)
| State | Meaning |
|---|---|
| `DRAFT` | Buyer is filling the request form |
| `AWAITING_BID_PAYMENT` | Buyer selected an agent, inspection bid unpaid |
| `REQUEST_PUBLISHED` | Live in the agent feed, no agent selected yet |
| `RESPONSE_RECEIVED` | ≥1 offer exists, buyer has not chosen |
| `AGENT_SELECTED` | Offer accepted; inspection bid pending |
| `EXPIRED_REQUEST` | **F** — request timed out unpublished or unanswered |
| `CANCELLED_BY_BUYER` | **F** — buyer withdrew before agreement |

### Phase 1 — Agreement
| State | Meaning |
|---|---|
| `BID_SECURED` | Inspection bid in platform reserve; agent committed |
| `AGENT_EN_ROUTE` | Agent travelling to seller |
| `AGENT_ARRIVED` | GPS check-in recorded |

### Phase 2 — Verification (gates, not checklist items)
| State | Meaning |
|---|---|
| `SELLER_IDENTITY_PENDING` | Agent on site, seller identity not yet captured |
| `SELLER_IDENTITY_VERIFIED` | Seller name/phone/ID/presence captured & stored |
| `POSSESSION_PENDING` | Ownership/possession evidence not yet satisfactory |
| `POSSESSION_CONFIRMED` | **GATE PASSED** — agent may proceed to inspection |
| `POSSESSION_FAILED` | **F path** — cannot prove ownership → deal cannot proceed |

### Phase 3 — Inspection
| State | Meaning |
|---|---|
| `INSPECTION_IN_PROGRESS` | Checklist running |
| `INSPECTION_REPORTED` | Report sealed; verdict recorded |
| `LIVE_SESSION_ACTIVE` | Live video running (overlay on INSPECTION_IN_PROGRESS / INSPECTION_REPORTED) |
| `LIVE_SESSION_ENDED` | Session closed, recording stored |

### Phase 4 — Decision & negotiation (looping region)
| State | Meaning |
|---|---|
| `NEGOTIATION_OPEN` | Agent negotiating with seller within authority |
| `NEGOTIATION_WAITING_BUYER` | Ceiling or target breach needs buyer decision |
| `BUYER_DECISION_PENDING` | Verdict + price presented to buyer |
| `BUYER_REJECTED` | **F** — buyer declined the product |

### Phase 5 — Purchase
| State | Meaning |
|---|---|
| `PURCHASE_AUTHORIZED` | Buyer approved price ≤ ceiling; authority to spend established |
| `SETTLEMENT_PENDING` | Awaiting purchase money movement + success fee payment |
| `SETTLEMENT_VERIFIED` | Seller payment confirmed on evidence; purchase price recorded |
| `PURCHASE_COMPLETED` | Money settled + receipt captured. **Success fee now chargeable.** |
| `CUSTODY_VERIFIED` | Serial re-read matched inspection serial. Anti-substitution gate. |
| `PURCHASE_CANCELLED` | **F** — after authorization but before collection |

### Phase 6 — Custody & logistics
| State | Meaning |
|---|---|
| `ITEM_COLLECTED` | Agent has physical possession |
| `PACKAGED` | Sealed + photographed |
| `HANDOVER_PENDING` | Awaiting courier scan or agent delivery confirmation |
| `COURIER_HANDOVER_CONFIRMED` | Courier accepted; tracking live |
| `IN_TRANSIT` | Courier movement |
| `DELIVERED_COURIER` | Courier POD captured |
| `DELIVERED_AGENT` | Agent personally delivered; buyer OTP confirmed |
| `DELIVERED` | Normalised delivery state (from either) |

### Phase 7 — Close
| State | Meaning |
|---|---|
| `BUYER_CONFIRMED_RECEIPT` | Buyer accepted; dispute window opens |
| `DISPUTE_WINDOW_ELAPSED` | 72h passed with no dispute |
| `COMMISSION_SETTLED` | Commission + agent share posted to ledger |
| `TRANSACTION_COMPLETED` | **T** — everything financial and evidentiary closed |

### Side states (may attach to any active state)
| State | Meaning |
|---|---|
| `DISPUTE_OPENED` | Auto-freezes commission; arbitrated by T&S |
| `DISPUTE_RESOLVED` | Adjudicated; may route back to a prior state or close |
| `ABORTED_UNSAFE` | **F** — agent or buyer safety abort; full milestone release |
| `AGENT_NO_SHOW` | **F** — auto-expired; 100% bid refund; strike |
| `BUYER_ABANDONED` | **F** — buyer unresponsive past SLA |
| `BID_REFUNDED` | **F** — full refund terminal |

### Overlays (flags, not states)
`IS_RECORDED` · `IS_AT_RISK` · `IS_UNDER_REVIEW` · `AGENT_TRANSPORT_MODE` ·
`DISPUTE_WINDOW_ACTIVE` · `REQUIRED_LIVE_SESSION` · `AUTO_APPROVED`

---

## 3. Transition table

Guards are server-side and evaluated in order. A transition fails closed: any unmet guard →
`409 INVALID_TRANSITION` with the failing guard named.

### 0 → 1
| From | Event | Guard | To |
|---|---|---|---|
| `DRAFT` | `request.publish` | category allowed ∧ required fields ∧ checklist≥1 ∧ evidence≥1 | `REQUEST_PUBLISHED` |
| `DRAFT` | `request.discard` | actor=buyer | `CANCELLED_BY_BUYER` |
| `REQUEST_PUBLISHED` | `offer.respond` | actor=dealer ∧ eligible ∧ no conflict ∧ response count < 5 | `RESPONSE_RECEIVED` |
| `RESPONSE_RECEIVED` | `offer.respond` | actor=dealer ∧ response live ∧ counter_round ≤ 1 | `RESPONSE_RECEIVED` |
| `RESPONSE_RECEIVED` | `offer.select` | actor=buyer ∧ a dealer response is live ∧ that dealer is eligible | `AGENT_SELECTED` |
| `RESPONSE_RECEIVED` | `offer.expire` | all dealer responses expired/none | `REQUEST_PUBLISHED` |
| `AGENT_SELECTED` | `payment.bid.succeeded` | amount = request.bid_minor ∧ provider sig valid | `BID_SECURED` |
| `AGENT_SELECTED` | `payment.bid.failed` | — | `AWAITING_BID_PAYMENT` |
| `AWAITING_BID_PAYMENT` | `payment.bid.succeeded` | idempotency key unused | `BID_SECURED` |
| `AWAITING_BID_PAYMENT` | `bid.expire` | `+2h` since selection | `CANCELLED_BY_BUYER` (releases hold) |
| `REQUEST_PUBLISHED` | `request.expire` | `published_at + 14d` | `EXPIRED_REQUEST` |
| `REQUEST_PUBLISHED` \| `RESPONSE_RECEIVED` | `request.cancel` | actor=buyer ∧ bid not yet paid | `CANCELLED_BY_BUYER` |

### 1 → 2
| From | Event | Guard | To |
|---|---|---|---|
| `BID_SECURED` | `agent.checkin` | GPS within service area ∧ accuracy ≤ 100m ∧ screenshot required | `AGENT_ARRIVED` |
| `BID_SECURED` | `agent.enroute` | actor=agent | `AGENT_EN_ROUTE` |
| `AGENT_EN_ROUTE` | `agent.checkin` | as above | `AGENT_ARRIVED` |
| `BID_SECURED` | `agent.no_show.expire` | `accepted_at + 4h` ∧ no check-in | `AGENT_NO_SHOW` |
| `AGENT_ARRIVED` | `seller.identity.capture` | ≥1 ID image ∧ consent flag ∧ seller name+phone captured ∧ **seller acknowledges the 5% success fee on camera** | `SELLER_IDENTITY_VERIFIED` |
| `SELLER_IDENTITY_VERIFIED` | `seller.fee.declined` | seller withdraws consent to the 5% | `DEAL_FAILED(seller_fee_refused)` — bid refunded per `06` §4, no success fee, no dealer bonus |
| `SELLER_IDENTITY_VERIFIED` | `possession.submit` | evidence present ∧ reviewer verdict recorded | `POSSESSION_CONFIRMED` or `POSSESSION_FAILED` |
| `SELLER_IDENTITY_VERIFIED` | `seller.absent.expire` | wait ≥ 30 min logged | `DEAL_FAILED(seller_unavailable)` |
| `POSSESSION_CONFIRMED` | `inspection.start` | actor=agent ∧ category clearance | `INSPECTION_IN_PROGRESS` |

### 3 → 4
| From | Event | Guard | To |
|---|---|---|---|
| `INSPECTION_IN_PROGRESS` | `live_session.start` | buyer reachable ∧ consent both ∧ `REQUIRED_LIVE_SESSION` satisfied-or-waived | `LIVE_SESSION_ACTIVE` |
| `LIVE_SESSION_ACTIVE` | `live_session.end` | duration ≤ 60 min | `INSPECTION_IN_PROGRESS` or `INSPECTION_REPORTED` |
| `INSPECTION_IN_PROGRESS` | `inspection.submit` | all checklist items addressed ∧ ≥1 whole-item photo ∧ verdict set | `INSPECTION_REPORTED` |
| `INSPECTION_REPORTED` | `live_session.start` | buyer reachable | `LIVE_SESSION_ACTIVE` |
| `INSPECTION_REPORTED` | `live_session.end` | — | `LIVE_SESSION_ENDED` |
| `INSPECTION_REPORTED` | `negotiation.open` | `negotiation_enabled` ∧ actor=agent | `NEGOTIATION_OPEN` |
| `INSPECTION_REPORTED` | `buyer.decide` | verdict = PASS or PASS_WITH_NOTES | `BUYER_DECISION_PENDING` |
| `INSPECTION_REPORTED` | `buyer.decide` | verdict = MISMATCH or FAIL | `BUYER_DECISION_PENDING` (discrepancy banner forced) |

### 4 (looping)
| From | Event | Guard | To |
|---|---|---|---|
| `NEGOTIATION_OPEN` | `negotiation.counter` | new price > `min_price` ∧ logged | `NEGOTIATION_OPEN` |
| `NEGOTIATION_OPEN` | `negotiation.accept` | price ≤ ceiling ∧ price ≥ 1 | `BUYER_DECISION_PENDING` |
| `NEGOTIATION_OPEN` | `negotiation.breach` | price > ceiling ∨ (price > target ∧ buyer approval required) | `NEGOTIATION_WAITING_BUYER` |
| `NEGOTIATION_WAITING_BUYER` | `buyer.override` | actor=buyer ∧ records max new ceiling ∧ **recording flag + audio/video evidence preferred** | `NEGOTIATION_OPEN` |
| `NEGOTIATION_WAITING_BUYER` | `buyer.hold_ceiling` | actor=buyer | `ABORTED_UNSAFE`→ no — `DEAL_FAILED(price_exceeds_authorization)` |
| `NEGOTIATION_OPEN` \| `BUYER_DECISION_PENDING` | `negotiation.reject` | seller withdraws | `DEAL_FAILED(seller_withdrew)` |
| `BUYER_DECISION_PENDING` | `buyer.approve` | price ≤ ceiling ∧ actor=buyer | `PURCHASE_AUTHORIZED` |
| `BUYER_DECISION_PENDING` | `buyer.reject` | reason required | `BUYER_REJECTED` |
| `BUYER_DECISION_PENDING` | `buyer.counter` | new ceiling recorded | `NEGOTIATION_OPEN` |
| `LIVE_SESSION_ENDED` \| `INSPECTION_REPORTED` | `negotiation.open` | as above | `NEGOTIATION_OPEN` |

**Loop protection:** `NEGOTIATION_OPEN → NEGOTIATION_OPEN` capped at 8 counters per
transaction and 45 minutes wall-clock, then forced to `NEGOTIATION_WAITING_BUYER`.

### 5
| From | Event | Guard | To |
|---|---|---|---|
| `PURCHASE_AUTHORIZED` | `settlement.start` | bid settled ∧ both success-fee amounts computed server-side | `SETTLEMENT_PENDING` |
| `SETTLEMENT_PENDING` | `payment.buyer_success_fee.succeeded` | amount = computed buyer fee | `SETTLEMENT_PENDING` (sub-flag) |
| `SETTLEMENT_PENDING` | `payment.seller_success_fee.collected` | amount = computed seller fee ∧ evidence ≥1 (on-cam transfer or receipt) | `SETTLEMENT_PENDING` (sub-flag) |
| `SETTLEMENT_PENDING` | `settlement.seller_paid` | evidence ≥1 (transfer receipt or on-cam capture) ∧ price ≤ ceiling | `SETTLEMENT_VERIFIED` |
| `SETTLEMENT_PENDING` | `settlement.timeout` | `+6h` | `DEAL_FAILED(seller_unpaid)` |
| `SETTLEMENT_PENDING` | `settlement.seller_fee_refused` | seller reneges after acknowledging at identity capture (late path; rare) | `DEAL_FAILED(seller_fee_refused)` |
| `SETTLEMENT_VERIFIED` | `purchase.complete` | price recorded ∧ receipt captured | `PURCHASE_COMPLETED` |
| `PURCHASE_COMPLETED` | `custody.serial_verify` | re-read serial ≡ inspection serial (hash match) | `CUSTODY_VERIFIED` |
| `PURCHASE_COMPLETED` | `custody.serial_verify` | mismatch | `DISPUTE_OPENED` (auto, `serial_mismatch`) |
| `PURCHASE_AUTHORIZED` \| `SETTLEMENT_PENDING` \| `SETTLEMENT_VERIFIED` | `purchase.cancel` | actor=buyer ∧ reason | `PURCHASE_CANCELLED` |

**Invariant:** `PURCHASE_COMPLETED` is the *only* state from which the success fee may be
charged and the *only* state that satisfies the commission precondition. Encoded in the
commission service as a hard invariant (see `06`).

### 6
| From | Event | Guard | To |
|---|---|---|---|
| `CUSTODY_VERIFIED` | `item.collect` | item in hand | `ITEM_COLLECTED` |
| `ITEM_COLLECTED` | `package.seal` | sealed-package photo ≥2 ∧ weight/dims captured | `PACKAGED` |
| `PACKAGED` | `handover.courier` | waybill ∧ courier scan ∧ declared value set | `COURIER_HANDOVER_CONFIRMED` |
| `PACKAGED` | `handover.agent_deliver` | declared value ≤ custody ceiling ∧ buyer OTP channel ready | `HANDOVER_PENDING` |
| `COURIER_HANDOVER_CONFIRMED` | `courier.in_transit` | webhook signature valid | `IN_TRANSIT` |
| `IN_TRANSIT` | `courier.delivered` | POD captured | `DELIVERED_COURIER` |
| `HANDOVER_PENDING` | `agent.delivered` | buyer OTP verified | `DELIVERED_AGENT` |
| `DELIVERED_COURIER` \| `DELIVERED_AGENT` | `normalize` | — | `DELIVERED` |

### 7
| From | Event | Guard | To |
|---|---|---|---|
| `DELIVERED` | `buyer.confirm_receipt` | actor=buyer | `BUYER_CONFIRMED_RECEIPT` |
| `DELIVERED` | `delivery.auto_confirm` | POD valid ∧ `+72h` no dispute | `BUYER_CONFIRMED_RECEIPT` |
| `BUYER_CONFIRMED_RECEIPT` | `dispute_window.elapse` | `+72h` ∧ no open dispute | `DISPUTE_WINDOW_ELAPSED` |
| `DISPUTE_WINDOW_ELAPSED` | `commission.settle` | state = `PURCHASE_COMPLETED` ∧ window elapsed ∧ no dispute | `COMMISSION_SETTLED` |
| `COMMISSION_SETTLED` | `transaction.close` | all ledger postings balanced | `TRANSACTION_COMPLETED` |

### Side / failure
| From | Event | Guard | To |
|---|---|---|---|
| any ≥ `BID_SECURED` | `dispute.open` | actor=buyer\|agent ∧ category valid | `DISPUTE_OPENED` |
| `DISPUTE_OPENED` | `dispute.resolve` | resolver=staff ∧ rationale + remedy recorded | `DISPUTE_RESOLVED` |
| `DISPUTE_RESOLVED` | `dispute.appeal` | within 7d | `DISPUTE_OPENED` (new case) |
| `DISPUTE_RESOLVED` | `resume` | remedy implies continuation | prior state (recorded) |
| any active | `abort.unsafe` | actor=agent with safety reason, or buyer with safety reason | `ABORTED_UNSAFE` |
| any active | `buyer.abandon` | `last_buyer_activity + 48h` ∧ pre-`PURCHASE_AUTHORIZED` | `BUYER_ABANDONED` |
| any pre-`BID_SECURED` | `refund.full` | — | `BID_REFUNDED` |

---

## 4. Guard implementation rules

```
R1  All mutations go through TransactionService.transition(txnId, event, actor, payload).
R2  Transition acquires SELECT ... FOR UPDATE on the transaction row.
R3  Guard failure throws DomainError(GUARD_FAILED) → HTTP 409, names the guard.
R4  Business state and ledger state are updated in ONE transaction, or neither.
R5  Success-fee charging and commission posting are reachable ONLY from the events
    purchase.complete and commission.settle respectively, and both re-verify the
    precondition inside the same DB transaction (defence in depth).
R6  State transitions emit an outbox event; downstream (notifications, analytics,
    webhooks) consume asynchronously. Never notify inline.
R7  Every transition writes an audit_log row chained by SHA-256 of (prev_hash, payload).
R8  All state-changing endpoints require Idempotency-Key.
```

---

## 5. Business rules (BR-001 … BR-060)

### Request
- BR-001 Category must be in the allow-list. Prohibited categories fail at `request.publish`.
- BR-002 `max_authorized_price` must be ≥ 60% and ≤ 120% of declared price (override with reason).
- BR-003 A request expires 14 days after publish with no agent selection.
- BR-004 Only one live transaction per request.
- BR-005 A buyer may have max 5 open requests (anti-spam).

### Matching & offers
- BR-006 Agent must be cleared for the category, cover the GPS area, be available, and be
  conflict-free in the next 6 hours.
- BR-007 Max 5 concurrent offers per agent. Max 2 counters per offer chain in MVP.
- BR-008 Offers expire 12h after creation.
- BR-009 **The buyer sets the inspection bid** (`DECISIONS.md` §5). The platform shows a
  suggested range; a bid below the range floor is allowed but displayed to dealers as "below
  typical". At most **1 counter** per offer chain in MVP.
- BR-010 Fairness rotation: no agent receives > 60% of a city's jobs in a rolling 7 days.

### Identity & possession
- BR-011 Seller identity capture is mandatory; transaction cannot pass `SELLER_IDENTITY_VERIFIED`
  without it.
- BR-012 Seller ID images are stored encrypted, visible only to the agent who captured them and
  to T&S under a logged reason.
- BR-013 **Possession gate:** at least one of — original invoice/box with matching serial, or
  serial clean-check with seller ID captured. If neither: `POSSESSION_FAILED`, deal cannot
  proceed, inspection bid still payable.
- BR-014 Seller entity is deduplicated by hashed phone + name similarity; repeated sightings by
  different buyers aggregate risk.

### Inspection
- BR-015 Every checklist item must be explicitly PASS/FAIL/WARN/NA. Silent gaps are impossible.
- BR-016 Skip requires a reason and is recorded in the buyer-visible report.
- BR-017 Minimum evidence: ≥1 whole-item photo, ≥1 serial close-up (where the category has a
  serial), ≥1 damage/condition photo set.
- BR-018 Report seals on submit. Amendment requires T&S approval, reason, and version increment.
- BR-019 Verdict `FAIL` blocks progression to negotiation and purchase without buyer override.
- BR-020 Discrepancies auto-generated from Claimed-vs-Verified diff must be acknowledged by the
  agent before submit.

### Live session
- BR-021 Both parties' consent required; recording disclosed before join.
- BR-022 Hard cap 60 minutes; auto-end with save.
- BR-023 `REQUIRED_LIVE_SESSION` is mandatory for declared value > PKR 100,000 or agent tier < 2.
- BR-024 Failure to reach the buyer twice does not block the transaction; it flags
  `IS_AT_RISK` and reduces the agent's success fee by 50% (agent-side remedy).

### Negotiation
- BR-025 The agent may never record an accepted price above `max_authorized_price` without a
  prior `buyer.override` record. Server-enforced, no exceptions, no config flag.
- BR-026 Max 8 counters, 45 minutes, then forced buyer decision.
- BR-027 Every counter stores amount, actor, timestamp, and message. Unlogged negotiation is
  not permitted.
- BR-028 Negotiation-enabled requests must have both target and ceiling set.

### Money
- BR-029 Inspection Bid, Success Fee, and Purchase Price are always three distinct line items.
- BR-030 **Success fee is charged only on `purchase.complete`**, computed from the actual
  purchase price, server-side only.
- BR-031 Commission posts only after `buyer.confirm_receipt` (+72h window) and only if
  `state = PURCHASE_COMPLETED` and no open dispute.
- BR-032 All money in integer paisa. No floating point in any money path.
- BR-033 Cash held by agent ≤ PKR 5,000 for ≤ 10 minutes (hard cap PKR 20,000 with override).
- BR-034 Personal transport allowed ≤ PKR 100,000 declared value; above requires courier +
  insurance.
- BR-035 Failed deal ⇒ success fee = 0, always. Enforced by BR-030 + R5.
- BR-036 Refunds are milestone-proportional per §6, never arbitrary.

### Custody & logistics
- BR-037 Serial re-verification at collection is mandatory where a serial exists. Mismatch
  auto-opens a dispute.
- BR-038 ≥2 photos of the sealed package before handover, timestamped and geotagged.
- BR-039 Courier handover requires a waybill + scan. Personal delivery requires buyer OTP.
- BR-040 Delivery auto-confirms 72h after POD with no dispute.

### Trust & safety
- BR-041 Safety abort (`ABORTED_UNSAFE`) releases all earned milestones and never counts as a
  quality strike.
- BR-042 Agent no-show = 100% bid refund + strike. 3 strikes / 30 days ⇒ suspension.
- BR-043 Seller non-cooperation releases arrival + inspection milestones only; agent is not
  penalised.
- BR-044 Agent may decline any request; safety/qualification declines are penalty-free.
- BR-045 Ratings require a completed transaction and are unique per rater per transaction.

### Disputes
- BR-046 Opening a dispute auto-freezes commission settlement.
- BR-047 Buyer may raise a delivery-quality dispute within 14 days of delivery.
- BR-048 Agent may dispute a false quality complaint within 7 days of the case closing.
- BR-049 Buyer may dispute the platform for fee/conduct; resolved by T&S, not by agents.
- BR-050 Every dispute has an SLA (24h first response, 72h resolution target) and a named owner.

### Expiry & abandonment
- BR-051 Inspection bid must be paid within 2h of agent selection.
- BR-052 Agent no-show expiry at 4h.
- BR-053 Seller wait limit 30 min logged before `seller_unavailable`.
- BR-054 Buyer abandonment at 48h inactivity before purchase authorization.
- BR-055 Every expiry notifies both parties with the next available action.

---

## 6. Inspection bid milestone schedule (the failure-payment policy)

This is the most commercially sensitive table in the spec. It answers idea.txt §7: *"the buyer
still pays the agreed field agent inspection bid"* — **how much**.

| Milestone | Trigger state | % released | Cumulative | Rationale |
|---|---|---|---|---|
| M1 Accepted & en route | `AGENT_EN_ROUTE` | 10% | 10% | Rewards acceptance; penalises late no-show only lightly |
| M2 Arrived & seller ID captured | `SELLER_IDENTITY_VERIFIED` | 20% | 30% | Real work + real risk taken |
| M3 Inspection report sealed | `INSPECTION_REPORTED` | 40% | 70% | The core deliverable |
| M4 Package sealed + media | `PACKAGED` | 20% | 90% | Custody responsibility begins |
| M5 Delivery confirmed | `DELIVERED` | 10% | 100% | Ties the last tranche to actual arrival |

**Applied to failure cases:**

| Failure | Milestones released | Inspection bid paid | Success fee |
|---|---|---|---|
| Seller unavailable / refused / fake product | M1+M2+M3 | **70%** | 0 |
| Buyer rejects product after report | M1+M2+M3 | **70%** | 0 |
| Price exceeds authorization | M1+M2+M3 | **70%** | 0 |
| Agent aborts for safety | All earned + M4 | **100%** | 0 |
| Agent no-show | none | **0%** (full refund) | 0 |
| Buyer abandons pre-authorization | M1+M2+M3 | **70%** | 0 |
| Buyer never pays inspection bid | n/a | **0%** | 0 |
| Transaction completes normally | All | **100%** | charged |
| Dispute upholds agent | All | **100%** | charged |
| Dispute upholds buyer (product not as inspected) | M1+M2+M3 | **70%** | charged, then refunded per remedy |

**Copy rule:** the buyer sees this schedule *before* paying, in the fee explainer, in plain
numbers ("If the inspection happens but you don't buy, you pay 70% of the inspection fee").
Hiding it turns a fair policy into a dispute generator.

**Agent rule:** the agent sees a live "earned so far: PKR 1,050" counter. It is the single
strongest anti-abandonment device available and costs nothing.

---

## 7. Pricing rules

### 7.1 Success fee curve (recommended; see `11-open-decisions.md` Q5)
```
value ≤ 25,000            → flat 1,500
25,001 … 500,000          → 10%
> 500,000                  → 8%, capped 40,000
```
Base of 10% preserved as specified. Floor and cap added because un-floored 10% is
loss-making below ~PKR 15,000 (`00` §3 C2).

### 7.2 Inspection bid band derivation
```
band.mid = category_base
         + per_km_rate × distance_km(service_area_edge → seller)
         + difficulty_modifier
              after_hours          × 1.25
              high_risk_location   × 1.50
              requires_transport   × 1.15
         + serialisation_modifier  (vehicles, machinery: × 2.0 base)
band.min = band.mid × 0.85
band.max = band.mid × 1.20
```
`per_km_rate` initial: PKR 60 (Karachi/Lahore metro), PKR 90 (other cities).

### 7.3 Agent split
```
Agent receives  = task_fee (per milestone schedule)
                + 50% of success_fee   (only at COMMISSION_SETTLED)
Platform keeps  = 50% of success_fee
```

### 7.4 Rounding and edge rules
- All amounts integer paisa; round half-up at the paisa level only.
- Success fee rounds in the buyer's favour on the *charge* (round up), in the platform's
  favour nowhere — the platform must never gain by rounding.
- Travel fee is quoted and fixed at offer time, not metered (no meter disputes).
- Zero-value success fee (value 0) ⇒ fee 0, and the transaction is auto-flagged for review
  (a PKR 0 sale is a fraud signal, not a free transaction).

---

## 8. State coverage matrix — every terminal path

| Terminal | Reached from | Money outcome | Seller entity action |
|---|---|---|---|
| `TRANSACTION_COMPLETED` | `COMMISSION_SETTLED` | all three fees settled | risk-updated |
| `DEAL_FAILED` | 12 failure reasons | inspection bid per §6, no success fee | risk-updated, sometimes flagged |
| `ABORTED_UNSAFE` | safety abort | 100% inspection bid | risk-updated |
| `AGENT_NO_SHOW` | 4h expiry | 100% refund | none |
| `BUYER_ABANDONED` | 48h inactivity | 70% inspection bid | none |
| `PURCHASE_CANCELLED` | post-authorization cancel | success fee not charged; remedy may refund | flagged |
| `CANCELLED_BY_BUYER` | pre-agreement | nothing charged | none |
| `BID_REFUNDED` | admin/manual | full refund | none |
| `EXPIRED_REQUEST` | timeout | nothing charged | none |

Every transaction ends in exactly one of these. No path is left without a money resolution.