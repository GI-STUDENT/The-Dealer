# 07 — Trust, Fraud, Safety & Verification

This is the layer that determines whether the marketplace has a future. idea.txt §14, §15, §21
all point here. The organizing principle:

> **We cannot make humans trustworthy. We can make dishonesty expensive, detectable, and
> consequential — and we can make the honest path easy for everyone else.**

---

## 1. Identity & KYC

### 1.1 Four tiers

| Tier | Requirements | Unlocks | Cannot |
|---|---|---|---|
| **L0** | Phone OTP, name, city | Browse requests, create requests, chat | Accept jobs, transact, be paid |
| **L1** | L0 + CNIC (number + expiry, format-valid) + selfie | Accept jobs in `basic` clearance categories, up to PKR 50,000 declared value | Payouts released until 7 days after first job |
| **L2** | L1 + NADRA e-KYC match **or** manual doc review + liveness pass + IBAN title match + home-city GPS self-portrait | All standard categories, up to PKR 300,000, success-fee accrual | — |
| **L3** | L2 + business registration + NTN + 10 completed jobs + human review of a sample report | Full v1 ceiling, up to PKR 500,000, `high_value` clearance | — |

### 1.2 Rules

- **Agents cannot transact below L1.** A new agent at L0 can see the feed and take low-value
  cash jobs only after L1.
- **Payout hold:** L1 agents are paid on the weekly run but a rolling 7-day hold applies to the
  *first three* jobs; L2+ have no hold. This is the cheapest anti-fraud control available and
  costs the agent almost nothing in perceived terms.
- **KYC is never "done by support over chat".** Manual review is a real review with two-person
  sign-off for L3.
- **Tier changes are one-way upward within 24h; downward is immediate** on a risk trigger.
- **Re-KYC triggers:** doc expiry, account email/phone change, payout account change, >PKR 500,000
  cumulative volume in 30 days.

### 1.3 NADRA integration (Pakistan-specific)

| Option | Mechanism | Notes |
|---|---|---|
| **NADRA e-KYC / CNIC verification** | Via an authorised integrator with a data-sharing agreement | Best signal (name/DOB/address match), but the data-sharing agreement is the long pole `[LEGAL REVIEW]` |
| **CNIC validity + format service** | Cheaper, verifies the CNIC exists and is not cancelled | Partial signal; does not prove the person is the holder |
| **Manual review** | Ops reads the doc images | Slow, unscalable, but a genuine fallback that must exist on day one |
| **Liveness + face match against doc** | Third-party biometric SDK | Proves possession of the document, not identity |

**Recommendation:** ship with manual review + liveness as MVP, integrate NADRA in V1. Do not
launch dependent on a regulatory data-sharing agreement you do not yet have. Support
L1-only operation if NADRA slips.

---

## 2. Reputation

### 2.1 Ratings: transaction-gated, unique, dimensioned

- One rating per rater per transaction (DB-enforced unique constraint).
- Only possible in `transaction_completed` (DB trigger).
- Five dimensions (communication, thoroughness, punctuality, honesty, safety) + overall +
  "would rebook" + free text.
- **Both directions:** the buyer rates the agent; the agent rates the buyer (and it matters —
  buyers who waste agent time get visibly worse service).
- Ratings are **immutable** once written; a change is a new row plus a moderation flag.
- Sellers are **not** rated publicly. There is no seller account. See §5.
- **Seller identity is captured on the agent's device at the visit** because the seller must be
  charged 3% on a closed sale (`DECISIONS.md` §2.2, §4). This is the minimum: name, phone, and
  a CNIC photo are recorded for the payment trail and are retained under the seller's own
  consent, spoken on camera. No seller app, no seller login, no seller-initiated relationship.
  If the seller declines, the deal does not close — see §5.

### 2.2 Trust score (agent)

Not a vanity composite. An explainable, inspectable model:

```
trust_score (0–100) =
    40 × completion_rate                 (completed / accepted)
  + 20 × rating_percentile_in_city       (city-relative, not global)
  + 15 × verification_completeness       (L2+, docs, payout account, categories)
  + 10 × volume_score                    (log-scaled completed jobs)
  + 10 × response_score                  (median first response to a matched request)
  +  5 × safety_score                    (zero SOS-with-cause, zero no-shows)
  − penalties:
      no_show_count × 8
      (confirmed_fraud_disputes) × 25
      cancelled_by_seller_rate > 30% × 10
      median_inspection_gap_rate > 5%  × 6
```

Every component is queryable by the agent ("Trust score → how it's built") and by the buyer
("Why this agent"). Decline counts for **safety** are never a penalty; decline counts for
**quality** reduce `response_score` mildly and never appear as a visible strike.

### 2.3 Anti-gaming

- **New-agent ramp:** an agent with < 20 completed jobs may receive at most PKR 100,000/day in
  transaction value. Protects buyers from an untested agent and prevents one bad actor from
  taking large jobs on day one.
- **Fairness rotation:** no agent gets > 60% of a city's jobs in a rolling 7 days.
- **Reciprocity detection:** buyers and agents who always choose each other are fine; a cluster
  that only transacts with each other is flagged for collusion review.
- **Rating velocity spikes:** > 3 ratings in 24h, or a burst of 5-star ratings after a single
  low rating, is flagged.

---

## 3. Fraud signal catalogue

22 signals in `risk_signals`, each producing a score contribution. Per-transaction risk score
= weighted sum, capped at 100.

| Signal | Detects | Weight |
|---|---|---|
| `multiple_accounts` | Same device / phone / IBAN across accounts | 25 |
| `device_reuse` | One install across multiple accounts, or refresh-token rebind | 20 |
| `impossible_travel` | Agent check-ins imply > 140 km/h, or buyer city ≠ declared | 30 |
| `gps_mismatch` | Check-in > 5 km from the agreed seller location | 25 |
| `low_accuracy_spoof` | GPS accuracy < 10m consistently (emulator/mock location) | 20 |
| `image_reuse` | pHash collision with evidence from another transaction or agent | 30 |
| `image_manipulation` | Client hash ≠ server hash after re-encode, or EXIF anomaly | 35 |
| `no_capture_attestation` | Evidence imported from gallery rather than captured in-app | 10 |
| `checklist_gaps` | Mandatory items NA with implausible reasons, or skipped sections | 10 |
| `report_amended` | Report amended after submit (rare, high severity) | 30 |
| `repeated_fail_verdicts` | Agent reports FAIL > 60% of the time (either great or lying) | 15 |
| `high_cancel_rate` | Buyer cancels after acceptance > 25% | 10 |
| `seller_repeat` | Same seller entity, multiple buyers, elevated risk | 10 |
| `seller_known_bad` | Seller entity blocked or high risk score | 40 |
| `collusion_graph` | Buyer↔agent↔seller triangle with no other edges | 40 |
| `price_anomaly` | Final price > 130% of declared, or PKR 0 sale | 20 |
| `serial_blacklist_hit` | Serial matches a stolen/blacklisted IMEI or VIN | 60 |
| `bank_account_mismatch` | IBAN title ≠ verified name | 40 |
| `kyc_mismatch` | CNIC name ≠ payout account title ≠ live face | 50 |
| `unreachable_buyer` | Two failed live-session attempts on a high-value txn | 15 |
| `cash_ceiling_pressure` | Multiple near-ceiling cash events in a day | 20 |
| `fast_serial_read` | Serial captured in < 60s from check-in on a high-value item | 25 |

### 3.1 Risk bands and actions

| Score | Band | Action |
|---|---|---|
| 0–29 | low | Automatic |
| 30–49 | medium | Automatic + risk signals shown to the buyer ("Declined to verify ownership proof") |
| 50–69 | high | Automatic + T&S reviews **before** settlement is released; live session mandatory; payout hold 14 days |
| 70–89 | critical | T&S review before agent assignment; consider refusing |
| 90–100 | blocked | Auto-halt; human adjudication within 1h |

### 3.2 What we explicitly cannot do

Stated plainly because it prevents over-engineering later:

- We **cannot** reliably detect a sophisticated actor using a real phone and a modified app.
  Play Integrity / Device Attestation raises the cost but is bypassable.
- We **cannot** detect AI-generated or edited product photos with certainty. We can detect
  *reuse* and *metadata* anomalies, which catches the lazy cases.
- We **cannot** prove the product is not counterfeit from a checklist. Only a knowledgeable
  human in front of the item can, and they can be fooled.
- We **cannot** reliably detect an agent and seller who are genuinely colluding, only patterns.

Design accordingly: the goal is to raise the cost of fraud and to leave an evidentiary trail,
not to promise prevention.

---

## 4. Safety

### 4.1 Field controls

| Control | Implementation |
|---|---|
| Location sharing | Live location to the buyer's transaction screen and to the agent's trusted contact while on-site |
| Check-in / check-out | Mandatory at arrival; `AGENT_ARRIVED` cannot be reached without it |
| Check-in timeout | If the agent is "on site" > 3h with no activity, T&S pings |
| Trusted contact | Required for L2+; notified on SOS and on overdue check-in |
| SOS | One tap from every agent screen: alerts contact, calls the safety line, starts a police liaison countdown |
| Safety exit | Consequence-free early abort with full fee release |
| Safe-location guidance | Prefer public meetup points where the seller will agree; recommend for first-time and high-value jobs |
| Prohibited categories | Blocked at request creation, so the agent is never sent somewhere illegal |
| Incident playbook | Written procedures for: robbery, harassment, accident, arrest, medical emergency, agent illness |

### 4.2 Honest limits

We do not provide physical security to agents. We do not verify that a location is safe. Our
duty is: reveal location, react fast, and never punish an agent for choosing safety.

### 4.3 Buyer protections

- Never expose the buyer's contact details or exact address to the seller; the agent is the
  intermediary (this also prevents buyer harassment by sellers).
- Buyer can pause or cancel at any point before authorization.
- Buyer sees live location of the agent during the on-site window.

---

## 5. Seller intelligence (the defensive asset)

Sellers are never users, but a persistent, privacy-conscious risk corpus is one of our most
defensible assets.

- `seller_entities` keyed on `HMAC(phone)` + normalised-name similarity.
- Per entity: sighting count, possession-proof rate, claimed-vs-verified gap, fail-verdict rate,
  dispute counts, GPS clusters (do they really operate in the city they claim?).
- **Blocked entities** are enforced platform-wide: a new request naming a blocked seller is
  refused, and an agent arriving at one aborts immediately.
- **Never exposed publicly, never sold, never shared with buyers.** Sharing "this seller is
  bad" with a buyer tells the seller they are on a list. This data is used for prevention and
  law-enforcement referral only, with legal review on the referral pathway.

---

## 6. Evidence integrity

| Threat | Control |
|---|---|
| Edited photo | Client SHA-256 + server recompute after re-encode; mismatch → `image_manipulation` |
| Reused photo | pHash index across all evidence; collisions across actors → `image_reuse` |
| Stock/borrowed listing photos | Reverse-image search at request creation; result shown to the agent as "these listing photos also appear on 4 other listings" |
| Gallery-imported fake capture | `capture_app` + attestation; gallery imports are visibly marked to the buyer |
| Edited report text | Report sealed with a hash; amendments require T&S approval and are versioned |
| Deleted evidence | Append-only table + WORM object storage; delete = tombstone with reason |
| Tampered audit trail | Hash-chained `audit_log`; chain verification runs nightly |
| Metadata stripping | Server-side re-encode removes EXIF/GPS, then GPS is recorded separately from the device attestation |

---

## 7. Offline evidence capture (Pakistan-critical)

Agents work in markets, basements, and buildings with no signal. If the app fails there, the
supply side dies.

```
Capture (offline)
  ├─ photo/video → encrypted file (AES-256-GCM, per-session key) in app storage
  ├─ GPS fix + accuracy + device attestation → local record
  ├─ checklist item status, notes (voice-to-text), values → SQLite (encrypted)
  └─ SHA-256 computed on-device, stored with the record

Queue
  └─ resumable chunked upload, 256KB chunks, exponential backoff, survives app kill

Commit (online)
  └─ POST /evidence/:id/commit → server verifies hash, re-encodes, indexes, links to transaction
  └─ hash mismatch → quarantined, never presented as verified

Conflict resolution
  └─ first-write-wins on inspection_items, guarded by (inspection_id, key, client_version)
  └─ a sealed report can never be overwritten by an offline replay
  └─ every replayed write is logged for audit
```

Storage budget: agent devices must handle ~500 MB of queued media. If a device cannot, the app
refuses to start a job it cannot finish — better than silent evidence loss.

---

## 8. Preventing the specific scams that motivate this product

| Scam | Control |
|---|---|
| Fake/counterfeit iPhone | Serial read + IMEI blacklist + ownership proof + category checklist with a trained agent |
| Bait-and-switch (different unit) | Claimed-vs-verified diff + serial re-verification at custody + package media showing the serial |
| Undisclosed damage | Mandatory damage photo set + buyer screen-share comparison + discrepancy acknowledgement |
| Battery-health lie | Category-specific functional test (agent walks the buyer through Settings on video) |
| Missing accessories | Explicit accessories checklist item, not a free-text note |
| Seller ghosting after payment | Live session required above PKR 100,000; settlement only with evidence; dispute window |
| Wrong location | Geotagged check-in, offset recorded, `gps_mismatch` signal |
| Refurbished sold as new | Locked-network check, parts-replacement checklist, battery-cycle count |
| Stolen device | IMEI/VIN blacklist check + ownership proof gate |
| Agent collusion | Live session + seller contact captured + collusion graph |
| Agent substitutes a better/worse unit | Serial re-verification machine-match before packaging |
| Seller payment never made (fake receipt) | Settlement requires transfer reference captured on video; buyer-side confirmation |

---

## 9. Trust surfaces in the UI

Design rule: show the *mechanism*, not a verdict. "Verified agent" is a claim. The user needs:

- **Agent:** tier badge with a tap-through explaining exactly what was checked.
- **Transaction:** the timeline with evidence count, checklist completion, live-session
  recording availability.
- **Seller:** `Not verified` chips, honestly shown.
- **Dispute:** the evidence both parties submitted, before either sees the other's argument.

Never display an aggregate "trust score" to buyers without the ability to expand it into its
components. A number without a mechanism is marketing, not trust.