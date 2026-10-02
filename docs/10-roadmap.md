# 10 — Roadmap

## 1. The phasing principle

idea.txt §26 asks for MVP / V1 / V2 / Future, and — correctly — asks what should **not** be
built. The organising rule:

> **MVP must answer one question: will a Pakistani consumer pay PKR 1,200–2,500 for a verified
> inspection of a used phone they cannot travel to see?**

Everything in MVP serves that question. Everything else is deferred, including things that are
genuinely important, because a marketplace with 200 well-executed transactions beats one with
200,000 half-executed ones.

Second rule: **the safety and money invariants ship in MVP, or the platform should not launch.**
Verification, evidence integrity, cash ceiling, ceiling enforcement, and commission-gating are
not "V1 polish". They are the product.

---

## 2. MVP — the falsifiable pilot

**Target:** one city, phones + laptops, **8–12 agents**, ~200–400 real transactions.

### Ship

| Area | MVP scope |
|---|---|
| Identity | OTP (SMS), L0/L1 tiers, manual KYC review, payout account (IBAN) with title check |
| Requests | Manual entry + screenshot upload with AI-suggested fields; category allow-list; blocked-category refusal; price ceiling/target; checklist builder; evidence upload |
| Agents | Manual recruitment + profile + service-area map + category clearance (phones/laptops only); availability toggle; feed; accept/decline within a platform-suggested band |
| Task | Full state machine, **all 34 states**, guarded, with every guard tested |
| Inspection | Phone and laptop checklists; per-item status/notes/voice/photo/video; offline-first with encrypted queue; verdict + sealing; serial capture + IMEI read + black-list check hook |
| Claimed vs verified | The diff panel, discrepancy acknowledgement |
| Live | Platform-native LiveKit session with recording, buyer shot-list, screen-share; recorded as evidence |
| Negotiation | Ceiling enforcement (server-side), counter logging, 8-counter cap, buyer override with recording |
| Settlement | Buyer pays seller directly with in-app transfer + evidence; success fee charged at settlement; cash ceiling enforcement |
| Custody | Serial re-verification machine-match, packaging media, courier handover via TCS + Leopards, POD, tracking |
| Money | Double-entry ledger, commission gate + DB trigger, milestone release schedule, refunds, weekly payout run, nightly reconciliation |
| Disputes | Open, freeze commission, staff queue with SLA, evidence review, remedy + appeal |
| Ratings | Transaction-gated, dimensioned, bidirectional |
| Ops | Admin console: txns 360, disputes, agents, sellers, finance ledger, payouts, refunds, audit search |
| Safety | SOS, trusted contact, live location, check-in/out, safety exit (full fee release), incident playbook |
| Fraud | 22 signals, risk bands, human review above PKR 300,000, seller entity corpus |
| Notifications | In-app + push, rationed SMS on four critical events, email; state-driven templates. No WhatsApp channel |
| Analytics | Full event taxonomy + the zero-count guardrails |

### Deliberately cut from MVP

| Cut | Why it is safe to cut now | When it returns |
|---|---|---|
| NADRA e-KYC | Manual review is a genuine path; the regulatory agreement is the long pole anyway | V1 |
| Open bidding | Suggested band + accept/decline is simpler and better for MVP quality | V2 |
| Insurance | Above PKR 50,000, MVP restricts to insured courier or refuses; the exposure is bounded | V2 |
| Personal delivery by agent | Cut it — courier-only MVP reduces the "agent disappears with the item" risk to near zero | V2 |
| OCR / AI extract of listings | Suggest-then-confirm is fine with manual entry | V1 (low-risk, big UX win) |
| Self-service payout account change | Ops-assisted in MVP (reduces T3 takeover risk) | V1 |
| Multi-language UI | English + the agent's phone in Urdu is the constraint that matters first | V1 |
| Agent self-service KYC resubmission | Ops-assisted | V1 |
| Rebook-a-previous-agent as a first-class feature | Saved agents is V1; agents will re-contact buyers manually | V1 |
| Advanced analytics / cohort tooling | Funnel + guardrails suffice | V1 |

### MVP "no" list (build nothing toward these)

- No seller app, no seller accounts, no seller-facing screens.
- No escrow, no wallet, no stored value, no purchase-fund custody.
- No microservices, no Kubernetes, no event-streaming platform, no data warehouse.
- No native iOS app; no separate tablet layout.
- No AI negotiation, no image-based defect detection, no model training.
- No vehicle/machinery/real-estate categories.
- No blockchain, no smart contracts, no token.
- No multi-currency, no cross-border payments.

### Sequencing (~14 weeks to pilot)

| Weeks | Deliverable |
|---|---|
| 1–2 | Ledger + state machine + commission engine + property tests. **The money core first**, because everything else depends on it. |
| 3–4 | Identity, KYC (manual), requests, agent onboarding, matching |
| 5–7 | Inspection flow, offline evidence, claimed-vs-verified, serial capture |
| 8–9 | Live session, negotiation, settlement, custody gate |
| 10 | Logistics, disputes, ratings, risk signals, admin console |
| 11 | Notifications, analytics, reconciliation, audit chain |
| 12–13 | Agent recruitment (founder-led, **8–12 agents**, not 50 — see `00-strategic-brief.md`), pilot with 10–20 buyers |
| 14 | Iterate on the funnel; instrument support minutes per transaction |

**Agent supply is a flow, not a stock.** Recruit agents only as fast as requests arrive — target
one job per agent every 2 days. An under-supplied city with busy agents beats a flooded city with
starving agents, because starving agents leave publicly and word spreads faster than marketing.

---

## 3. V1 — proving it works and can be trusted at volume

**After:** MVP shows request→assignment < 6h median, approval rate 50–70%, contribution positive
in every price band, zero commission on cancelled deals, dispute rate < 8%.

| Area | V1 scope |
|---|---|
| Liquidity | Second and third city; open bidding within bands; fairness rotation enforced |
| KYC | NADRA e-KYC integration; L2 tier live; agent bond / earnings reserve (post-`[LEGAL REVIEW]`) |
| Reliability | Personal delivery by agent (within custody ceiling) with insurance; SOS deep-integration (police liaison) |
| Payments | PSP escrow/split settlement explored and, if viable, piloted on high-value only |
| Product | Rebook-a-previous-agent; saved agents; Urdu UI; listing AI extraction; self-service KYC and payout changes with step-up |
| Ops | Dispute automation (evidence pre-assembly), T&S tooling, multi-city dashboards |
| Trust | pHash clustering at scale, collusion graph, seller corpus enrichment |
| Categories | Laptops, computers, cameras, TVs, furniture, appliances — each with a playbook |

---

## 4. V2 — the high-value and capital layers

| Area | V2 scope |
|---|---|
| High value | Vehicles (static inspection only, `[LEGAL REVIEW]`), machinery, industrial — with insurance mandatory and platform pre-approval |
| Insurance | In-transit product-in-transit cover and agent liability cover via a licensed partner |
| Payments | Licensed escrow or PSP-held settlement, if the perimeter opinion allows |
| Capital | Optional buyer-side instalment/BNPL *through a licensed partner* — never on our own balance sheet |
| Agent economy | Tier progression (Bronze/Silver/Gold by trust score), priority job access, training/certification, bonus pool |
| Scale | Multi-city, category playbooks as a marketplace of templates, self-serve agent onboarding with sampling-based review |
| Intl | First country pack (UAE) |

---

## 5. Future (explicitly speculative)

| Idea | Notes |
|---|---|
| Seller-side product | Only if sellers demand analytics of their own. Counterparty is currently non-compliant-by-design |
| B2B / corporate procurement | Companies buying used IT in bulk — a real and sizeable Pakistan segment |
| Insurance-as-a-service | Needs a licence; partner |
| Certified inspection reports | High-liability document; `[LEGAL REVIEW]`; only after the evidence corpus is strong |
| Reputation API for lenders/insurers | After the corpus compounds; serious privacy review |
| Cross-border purchase facilitation | Requires remittance + customs + tax modelling; not before V2 |
| Valuation engine | Needs volume; use the inspection data once you have 10,000 items |

---

## 6. What should NOT be built — the anti-roadmap

These are the ideas that look like product strategy and are actually ways to die:

1. **A seller marketplace.** The sellers do not want to be on your platform; the buyer does not
   want to browse your platform. Adding listings makes you a worse classifieds site and
   destroys the focus.
2. **Escrow before you have legal cover.** A wallet without an SBP perimeter opinion is a
   liability that can end the company.
3. **Vehicle transactions early.** Title transfer, insurance, roadworthiness, and accident
   history are all legal quagmires. Inspect and report; never facilitate the transfer in V1.
4. **Open bidding from day one.** Race to the bottom destroys quality faster than volume helps.
5. **A rating system without transaction gating.** Fake reviews kill a trust marketplace faster
   than any competitor.
6. **Microservices.** The state machine is one transaction. Splitting it across services means
   distributed transactions around money and evidence.
7. **Native iOS.** Buy the time you need elsewhere. Android is the market.
8. **Agent self-transport of high-value items.** The single largest uninsured exposure in the
   model.
9. **Marketing before supply.** Demand you cannot serve produces the exact public failures that
   make supply unwilling to join.
10. **Anything that lets an agent contact a buyer off-platform for a side job.** It converts your
    verifier into a competitor and destroys the trust model. One-tap "rebook in app" is the
    answer.

---

## 7. Resourcing the MVP

| Role | Count | Note |
|---|---|---|
| Founder / product | 1 | Owns the agent network personally in the pilot |
| Backend engineer | 1–2 | NestJS, Postgres, money core |
| Mobile engineer | 1 | Flutter; offline-first is the hard part |
| T&S / support ops | 1–2 | Review KYC, disputes, high-value transactions, inbound support |
| Legal + accounting | Fractional | `[LEGAL REVIEW]` items in `08` §5.1 — not optional, not deferred |
| Field agent recruitment | Founder-led | The real work |

**The honest constraint:** this is not a software project with a side of agents. It is an
operations business with software. Budget for operations and trust, not just engineering, from
day one. The engines that make the money (inspection, verification, evidence) are done by people,
not code.