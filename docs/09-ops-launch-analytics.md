# 09 — Operations, Integrations, Launch, Analytics, Edge Cases

---

## 1. Pakistan-first deployment

### 1.1 Launch configuration — deliberately narrow

| Dimension | Launch | Why |
|---|---|---|
| Cities | **One** (Karachi or Lahore) | Supply density is the bottleneck. Two thin cities is worse than one dense one. |
| Categories | Used phones + laptops | Clearest checklist, strongest serial story, easiest buyer trust, lowest liability |
| Team | Founder-led agent recruitment | Agents will not join a marketplace they cannot find buyers on. You must hand-recruit the first 50. |
| Support | In-app chat + phone line, staffed during seller/agent hours | Support cost per transaction must be under 10 minutes of blended time |
| Moderation | Human review of every txn > PKR 300,000, plus every risk signal > 50 | Automate everything else |
| Payments | Task + success fee only, two PSPs | No purchase-fund custody |
| Courier | 2 partners (TCS + Leopards) | Redundancy, national coverage |

### 1.2 Infrastructure

- **Cloud:** AWS, `ap-south-1` (Mumbai) — the lowest-latency compliant option. Pakistan has no
  AWS or Azure region. `[LEGAL REVIEW]` on the transfer question (`08` §4.4).
- **Frontend/API:** NestJS modular monolith on ECS Fargate (or Lambda for burst), behind
  Cloudflare (WAF, DDoS, bot management, caching).
- **Database:** RDS PostgreSQL 16, Multi-AZ, `PostGIS`, PITR, encrypted at rest, private
  subnets only.
- **Cache/queue:** ElastiCache Redis, SQS or BullMQ (BullMQ on Redis for MVP simplicity).
- **Media:** S3, private, versioned, Object Lock (compliance mode) for evidence; CloudFront for
  signed delivery.
- **Media workers:** ECS workers for re-encode, pHash, AV scan, EXIF strip, OCR. Queue-backed,
  horizontally scalable, dead-lettered.
- **SFU:** LiveKit self-hosted in-region, 3 nodes, autoscaled, recording via Egress.
- **Realtime:** WebSocket service, sticky sessions or Redis pub/sub fan-out.
- **Observability:** self-hosted Prometheus + Grafana + Loki, Sentry self-hosted, Metabase on a
  read replica. All in-region (`08` §4.4).
- **CI/CD:** GitHub Actions, blue/green on ECS, IaC in Terraform, feature flags for rollback.

### 1.3 Network reality (do not design for a datacenter)

Pakistan mobile broadband is frequently 3G-equivalent with high latency and dropouts; prepaid
data is a real cost for agents. Consequences:

- Media uploads must be chunked, resumable, and adaptive (agent can set "low bandwidth mode"
  that caps video to 480p and photo size).
- Agent flows are offline-first (`07` §7). Non-negotiable for adoption.
- Data-saver defaults; video only on demand.
- Push (FCM) plus rationed SMS for critical notifications (`09` §3). Notifications are
  app-native only — there is no WhatsApp channel.
- Target the mid-range Android, not the flagship (`02` §8).

---

## 2. Integration architecture

Every external system is behind an adapter interface with a provider registry, so no PSP,
courier, or KYC vendor becomes a hard dependency.

### 2.1 Payment adapter
```ts
interface PaymentAdapter {
  provider: string;
  createIntent(p: { purpose, amountMinor, currency, idempotencyKey, meta }): Promise<Intent>;
  confirm(p: { intentId }): Promise<Payment>;
  refund(p: { paymentId, amountMinor, reason }): Promise<Refund>;
  verifyWebhook(rawBody, headers): WebhookEvent;      // HMAC; throws on bad signature
  reconcile(from: Date, to: Date): Promise<SettlementEntry[]>;
  capabilities(): { cards: boolean; wallets: string[]; maxMinor: number; chargebackWindowDays: number };
}
```
Providers: **JazzCash**, **Easypaisa**, **PayFast** (cards + aggregator), **HBL/Meezan** (bank,
high-value). All PKR; all webhook-verified; all reconciled nightly (`06` §10).

### 2.2 Courier adapter
```ts
interface CourierAdapter {
  code: string;
  createWaybill(p: { txnRef, pickup: Address, dropoff: Address, parcel, declaredValueMinor,
                     insurance?: boolean, cod?: number }): Promise<Waybill>;
  schedulePickup(waybill, when): Promise<void>;
  track(waybill): Promise<TrackingUpdate[]>;
  cancel(waybill): Promise<void>;
  claim(waybill, p: { type: 'lost'|'damaged', evidenceIds, amountMinor }): Promise<ClaimRef>;
  verifyWebhook(rawBody, headers): WebhookEvent;
  supportsInsurance: boolean; maxDeclaredValueMinor: number;
}
```
Partners: **TCS** (widest coverage, POD with photo + signature, declared-value insurance),
**Leopards** (fast urban), **CallCourier** (southern corridor). Adapter normalises status →
`shipment_status` and POD → `evidence_objects` with `capture_app='courier_webhook'`.

Courier handover evidence chain (`03` BR-038/039): agent photographs sealed package → creates
waybill → courier scans → handover confirmed with agent capture as proof → POD at delivery.

### 2.3 Contact — how people actually reach each other

**Decision: we do not build on WhatsApp.** Users share their own WhatsApp number in the
request description; buyer↔agent and agent↔seller coordination happens however they like.
Consequences:

- **No WhatsApp Business API, no BSP, no template approval process.** One less vendor, one less
  cost line, no template-registration dependency.
- **The phone number is a user-supplied string, not a verified channel.** We store it in
  `transaction_parties.contact_enc` / `requests.seller_phone_declared` and display it masked
  until a party agrees to reveal. We never send to it, and never treat it as verified identity.
- **Notifications are app-native only:** in-app + push (FCM) + SMS for OTP and payment failures.
  If a user has no notifications installed, they will not know the agent arrived. Mitigate with
  mandatory SMS on the four genuinely critical events (see §3.1), not on everything.
- **Video verification stays in-app and recorded.** This was already required for evidentiary
  reasons (`09` §2.5) — WhatsApp has no video-call API and a WhatsApp call leaves no evidence
  trail. Nothing is lost by dropping WhatsApp; the recorded in-app session remains the system's
  proof and the UI should say so plainly: *"The recorded call in the app is your record."*
- **Support:** users may still reach us on WhatsApp. That is an inbound support channel only —
  staff use the admin console, not a personal number, so the conversation is not the system of
  record. We do not message users back from a personal account.

### 2.4 KYC adapter
CNIC verification via a NADRA-authorised integrator (V1) or manual review + liveness (MVP).
Adapter surface: `verify(docType, docNumber, selfieObjectId) → { match, score, dob, addressHint }`.

### 2.5 LiveKit
Token minting server-side, short TTL, room-per-transaction. Recording via Egress to S3, then
ingested as `evidence_objects` (`capture_app='app_capture'`, hashed). Auto-end at 60 min.

---

## 3. Notification system

### 3.1 Channels and preference

| Channel | Use | Fallback |
|---|---|---|
| In-app | Everything, always | — |
| Push (FCM) | All time-critical updates (agent selected, arrived, inspection ready, decision needed, delivery) | SMS |
| SMS | **Only four events** + OTP: (1) agent selected, (2) agent arrived at seller, (3) your decision is needed, (4) payment failed | none — treat SMS failures as P1 |
| Email | KYC decisions, payout statements, dispute outcomes | In-app |
| WhatsApp | **Not used.** Users coordinate off-platform on their own number | — |

SMS is expensive and noisy, so it is rationed to the four events where a missed notification
costs money or a deal. Everything else is push + in-app.

### 3.2 Notification policy per transition

| Transition | Buyer | Agent | Escalation |
|---|---|---|---|
| Request published | — | Push (matched agents) | — |
| Offer received | Push | — | — |
| Agent selected | Push + **SMS** | Push + **SMS** | — |
| Inspection bid paid | In-app | Push | — |
| Agent en route / arrived | Push (live map) + **SMS on arrival** | Push | T&S if arrived > 3h |
| Seller verified / possession gate passed | Push | Push | T&S if `POSSESSION_FAILED` or risk ≥ 50 |
| Inspection reported | Push | — | Buyer nudge if unread > 6h |
| Live session required/started | Push + **SMS** | Push + **SMS** | Auto-escalate if buyer unreachable twice |
| Buyer decision pending | Push + **SMS** | Push | Task stalls if unaddressed; flagged after 24h |
| Settlement pending | Push | Push | — |
| Custody verified / packaged | Push | Push | — |
| Handover / in transit | Push (tracking) | Push | T&S if no courier scan in 6h |
| Delivered | Push | Push | — |
| Dispute opened | Push | Push | T&S paged by SLA |
| Commission settled / paid | Push + email | Push + email | Finance if payout failed |

Every notification has a `template`, is deduplicated (`UNIQUE (user, channel, template_key)`),
retries with backoff, and respects per-channel consent. Critical notifications (live call,
arrival, SOS) ignore quiet hours; marketing never sends.

---

## 4. Analytics & events

### 4.1 Event taxonomy (partitioned `analytics_events`)

Funnel:
`request_draft_started → request_published → agents_viewed → agent_selected → task_fee_paid →
agent_arrived → possession_confirmed → inspection_reported → live_session_started →
buyer_decision_made → purchase_authorized → settled → custody_verified → packaged →
handover → delivered → buyer_confirmed → commission_settled`

Quality & risk:
`verdict_submitted{verdict}`, `discrepancy_count`, `risk_score_at_settlement`,
`risk_signal_raised{code}`, `sos_triggered`, `safety_exit`, `no_show`, `checklist_amended`,
`negotiation_count`, `ceiling_override_requested`, `evidence_rejected{reason}`

Money:
`task_fee_charged`, `success_fee_charged`, `refund_issued{reason}`, `commission_posted`,
`payout_sent`, `dispute_remedy{type,amount}`

Every event carries `transaction_id`, `actor_id`, `user_role`, `city_id`, `state_from`,
`state_to`, `app_version`, `platform`. Sessionised for funnel analysis.

### 4.2 North-star and guardrail metrics

| Metric | Target (pilot) | Why it matters |
|---|---|---|
| Request → agent assigned (median) | < 6 hours | Marketplace liquidity. This is the make-or-break number. |
| % requests matched within 24h | > 70% | Liquidity at scale |
| Inspection → buyer approval rate | 50–70% | If < 40%, the inspection is finding too many problems (or agents are too harsh). If > 90%, inspections are rubber stamps. |
| Deal close rate | 30–45% | Healthy. Higher = agents are overselling. |
| Success fee / GMV | per band | |
| Net contribution per txn | > 0 per band | Every band, not blended. Blended hides the small-item problem. |
| Dispute rate | < 8% | |
| Fraud-confirmed rate | < 1% | |
| Agent no-show rate | < 3% | Supply reliability |
| Median time to payout | < 8 days | Agent retention driver |
| NPS (buyer) | > 40 | |
| Support minutes / transaction | < 12 | Ops scalability |
| Zero-count guardrails | 0 | Commission on cancelled deals, unauthenticated admin actions, evidence-tamper confirmations, KYC bypasses |

### 4.3 Dashboards
- **Founder/ops:** today's funnel, unmatched requests by city, disputes past SLA, unmatched payouts.
- **Finance:** daily reconciliation, contribution by price band, payout run status.
- **T&S:** risk queue, flagged sellers, evidence anomalies, agent watchlist.
- **Growth:** request sources, repeat rate, city liquidity heat.

---

## 5. Admin & moderation

### 5.1 Moderation queues
`fraud_review` · `high_value_review` · `agent_kyc` · `seller_abuse` · `buyer_abuse` ·
`agent_abuse` · `dispute` · `refund_review` · `payout_hold`

Every case: priority, SLA, assigned owner, evidence links, outcome and reason. Two-person
sign-off on: agent suspension, seller block, refund > PKR 20,000, commission clawback, risk-signal
dismissal.

### 5.2 Dispute adjudication workflow
1. Intake (auto-freeze commission; `dispute_open` notification).
2. Triage: category, priority, SLA clock, evidence completeness check.
3. Statement from both parties with structured forms (what was claimed vs what is evidenced).
4. Evidence review: inspection report, live recording, package media, serial records, check-in GPS.
5. Decision: remedy enum + rationale + amount. Written for the buyer in plain language.
6. Appeal window (7 days).
7. Root-cause tag fed back into product (`checklist_gaps`, `seller_false_information`, etc.).
8. Publish an anonymised version to the team knowledge base — disputes are our best source of
   product truth.

Adjudication principles: no automatic guilt; the burden is proportionate to the claim; the agent
is presumed honest absent contradicting evidence; the seller is not a party we can compel;
"other documented reason" always available with a required note.

---

## 6. Reliability

- **Offline-first agent flow** (`07` §7) is the primary resilience mechanism, not a bonus.
- **Side effects are queue-based** (outbox → workers). A PSP outage never blocks a state
  transition; payments go to `pending` and reconcile later.
- **Degradation matrix** (what still works when a dependency fails):

| Down | Still works | Queued |
|---|---|---|
| PSP (collection) | Everything except payment | Payments + notifications to buyer |
| LiveKit | Everything; live call shown unavailable; buyer warned, transaction continues with a risk flag | Recording |
| Courier API | Everything; handover proof via manual photos + waybill entered manually | Tracking |
| Notification provider (FCM/SMS) | Everything; in-app only | Push retry |
| NADRA | Everything; manual KYC review | Auto-verification |
| Media worker | Checklist, chat, states; media queued on device | Evidence processing |

- **SLOs:** API p95 < 400 ms (reads), < 800 ms (writes); state-transition success > 99.9%;
  evidence upload success > 99.5%; zero lost committed evidence.
- **Backup/DR:** PITR on the DB; cross-region replica for the ledger; quarterly restore drill.
  The ledger is the one thing we cannot rebuild from a backup without losing money records — so
  it gets an independent replication and a daily export.

---

## 7. Edge cases (the ones that actually happen)

| # | Case | Handling |
|---|---|---|
| E1 | Seller not at the agreed location | Agent logs 30-min wait, `SELLER_IDENTITY_PENDING`, captures context, aborts → `deal_failed`, inspection bid per §6 of `03` |
| E2 | Seller's location differs from listing | `gps_mismatch` signal, T&S review, agent safety check before proceeding |
| E3 | Seller refuses ID capture | Cannot pass the gate → `deal_failed`, inspection bid 70% |
| E4 | Seller refuses live video | If required (value/agent tier), abort with reason; else flag |
| E5 | Product has no serial (furniture, appliances) | Checklist variant without serial; possession via invoice + seller ID; custody ceiling lower |
| E6 | Buyer unreachable at decision time | 24h hold, then `buyer_abandoned` (70% inspection bid), buyer can reopen within 7 days |
| E7 | Buyer offline during live session | Session ends `network`; agent continues; risk flag; success fee halved if required session missed |
| E8 | Agent's phone dies mid-inspection | Offline queue survives; evidence uploads on next open |
| E9 | Agent's phone is stolen/lost | Device binding flags the account; T&S freezes; in-flight txn escalated |
| E10 | Item damaged between inspection and packaging | Agent photographs, re-verdict, buyer re-approves (state returns to `buyer_decision_pending`) |
| E11 | Seller demands cash only, large amount | Above ceiling → cannot; agent aborts or buyer transfers before |
| E12 | Seller tries to go above the ceiling | Agent cannot accept; `CEILING_EXCEEDED` blocks server-side |
| E13 | Negotiation drags on | 8-counter / 45-min cap forces a buyer decision |
| E14 | Serial mismatches at custody | Hard stop; auto-dispute `serial_mismatch`; agent's commission frozen |
| E15 | Buyer pays seller but transfer fails | Evidence check fails → `settlement.timeout` → `deal_failed`; buyer re-tries within 6h |
| E16 | Seller's bank/wallet account wrong | Visible before confirm; buyer corrects |
| E17 | Courier refuses the parcel (packaging/value) | Agent re-packs or personal delivery if within ceiling; SLA breach if neither |
| E18 | Courier loses the parcel | Courier claim; insurance if bound; platform supports the claim, does not underwrite |
| E19 | Buyer says "never arrived" after POD | Dispute; POD + geotag + buyer OTP is the rebuttal |
| E20 | Agent delivered personally to the wrong address | GPS + buyer OTP evidence; dispute; agent strike if negligent |
| E21 | Buyer requests the agent deliver personally | Allowed within custody ceiling and city rules |
| E22 | Buyer asks for a discount the ceiling doesn't cover | Buyer must raise the ceiling explicitly |
| E23 | Counterfeit suspected but not certain | Verdict `MISMATCH` + `risk_signal`; T&S decides block; buyer decides risk |
| E24 | Very high value (car, >PKR 1M) | Restricted category; platform pre-approval; senior agent; insurance; `[LEGAL REVIEW]` |
| E25 | Buyer and agent know each other | Flagged, not blocked; monitor collusion |
| E26 | Seller gives the agent a kickback | Not detectable directly; collusion graph + price anomalies + pattern review |
| E27 | Buyer abandons after paying seller | Agent returns item if safe or holds; dispute; agent priority custody |
| E28 | Refund to a failed card | Fall back to wallet credit + payout account |
| E29 | Duplicate PSP webhook | `idempotency_key` no-op |
| E30 | Clock skew across devices | All money and state decisions use server time; device time stored but never trusted |

---

## 8. International expansion

The platform is hyperlocal: a buyer's trust in Karachi is irrelevant to Peshawar. Expansion is
**city-by-city supply build**, not a global launch.

### 8.1 Country pack
```ts
type CountryPack = {
  code: string; currency: string; locale: string; timezones: string[];
  payments: PaymentAdapter[];                 // collection + payout
  kyc: KycAdapter[];                          // doc types, verification method
  couriers: CourierAdapter[];
  legal: { termsUrl, disputeLaw, arbitrationBody, consumerRightDays, warrantyDisclosure };
  tax: { vatRate, withholdingAgent, withholdingBuyer, registrationRequired };
  travelRules: { maxDeclaredValueMinor, prohibitedCategories, insuranceRequiredAbove };
  categories: CategoryConfig[];               // per-market allow-list
};
```
Everything market-specific lives in a pack: category risk rules, fee bands, tax, KYC, courier,
prohibited goods, dispute law. Core code has **no country conditionals** — a hard rule, so
market N+1 is configuration, not a fork.

### 8.2 Sequence
1. **Pakistan, one city, phones/laptops** — prove the unit economics and the trust loop.
2. **Pakistan, 3–5 cities, more categories** — reuse the playbook; new city = supply build.
3. **Pakistan, vehicles + real-estate-adjacent high value** — only with insurance and `[LEGAL REVIEW]`.
4. **First international market** — one where the model is proven and a payment/licensing path
   exists (UAE is the realistic first: English-speaking, high used-goods volume, agent-friendly,
   working PSP settlement, no local marketplace incumbent of this type).
5. **Others** — only after a city in market 1 reaches liquidity, because the model is supply-first.

---

## 9. Customer support playbook (the actual operating manual)

| Tier | Channel | Scope |
|---|---|---|
| 1 | In-app chat + support line | "Where is my agent?", payment status, delivery tracking, ETA |
| 2 | Ops | Failed transactions, expiry confusion, refund status, agent no-show |
| 3 | T&S | Disputes, fraud reports, safety, seller abuse |
| 4 | Eng | Bugs via in-app diagnostics, never a support ticket |

Rules: every message answered within 30 min during 9am–11pm PKT; no agent is ever asked to
explain platform policy to a buyer (that is our job and removes the agent from the conflict); a
buyer in a failed transaction receives a proactive, scripted apology + the exact money outcome.

---

## 10. Where the launch actually goes wrong (and the pre-emptive fix)

| Failure mode | Pre-emptive fix |
|---|---|
| No agents in the seller's city | Seed supply manually before any marketing; city-level demand throttled to supply. Never open a city you cannot staff. |
| Agents join, get one job, and leave | Guarantee the first payout; pay within 48h for the first three jobs; personally onboard; give them a category playbook that makes their first job easy |
| Buyers who get burned post publicly | Detect, respond fast, resolve visibly; a fast public resolution beats a slow perfect one |
| Support eats the margin | Instrument support minutes per transaction from day one; treat it as a product metric, not an ops afterthought |
| Quality collapses under volume | Hard cap jobs per agent per day (start at 3), mandatory human review above PKR 300,000, ramp limits |
| The trust corpus is not built | Require checklist completeness and discrepancy acknowledgement; these are the assets that compound |