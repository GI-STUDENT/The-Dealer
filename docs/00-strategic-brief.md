# 00 — Strategic Brief

> **Precedence note.** This document analyses the *original* model from `idea.txt` and reaches
> verdicts on it. Several of those verdicts have since been **acted on**, and the resulting
> decisions are recorded in [`../DECISIONS.md`](../DECISIONS.md). Where this file and
> `DECISIONS.md` disagree, **`DECISIONS.md` wins**. The reasoning trail in §3 and §4 is kept
> deliberately, because it explains *why* the numbers moved.
>
> What changed:
> - The 10% single commission is **replaced** by buyer 5% + seller 3% (`DECISIONS.md` §2).
> - The dealer takes **no cut of the inspection bid** and a **2% bonus capped at Rs 5,000**,
>   replacing a 50/50 split of the 10%.
> - **No custody, confirmed as the design, not a fallback** (`DECISIONS.md` §7).
> - The **buyer now bids first** to hire an inspector (`DECISIONS.md` §5).
> - Platform **keeps 6%** and nets ~4.4%, not the 5% assumed in §4.2.
>
> Section numbers below are unchanged; only the conclusions have been overtaken.

## 1. Verdict

The idea is coherent, differentiated, and buildable. It is also, as specified, financially
fragile and legally exposed in its current form. The concept survives; **one part of the
money model must change**.

Three verdicts:

| Question | Verdict |
|---|---|
| Is the problem real? | **Yes.** Cross-city used-goods fraud in Pakistan is a large, unsolved, high-pain problem. Buyers routinely lose PKR 50k–500k to bait-and-switch, counterfeits, and undisclosed damage. |
| Is the model buildable in Pakistan? | **Yes**, with a modular monolith, Pakistani payment rails, NADRA KYC, and 3 courier adapters. No exotic tech required. |
| Is the model as specified viable? | **Not as specified.** The 10% commission with no floor/ceiling and the assumption that the platform holds "escrowed" purchase money are both broken. See §3 and §4. **Both are now resolved — see the precedence note above.** |

**Recommendation:** proceed, but restructure the revenue model into a
**two-fee model with a minimum charge and no custody of purchase funds at MVP.**
The Field Agent's inspection bid is the product. The success fee pays for the
platform's risk, not its main revenue. **Adopted — see `DECISIONS.md` §2.**

---

## 2. What the product actually is

Strip away "marketplace" framing. What you have built is:

> **A remote purchasing agent service with mandatory human verification, sold as per-transaction
> labour, wrapped in a two-sided listing layer.**

The listing layer is nearly incidental. The buyer already has the product. The buyer already
has the seller. The buyer needs exactly two things:

1. **A trustworthy human body** in the seller's city.
2. **A process** that makes that person's report credible (ID capture, checklist, live video,
   serial-number verification, tamper-evident evidence, courier proof-of-delivery).

The defensible assets are therefore:

- **The agent supply network per city** (hardest to build, hardest to copy). A dense Karachi
  network is 12–18 months of work. This is the moat, not the software.
- **The trust/evidence corpus** (serial numbers verified, seller entities known, fraud patterns).
- **Category inspection playbooks** that compound — a phone checklist that improves over
  500 inspections is worth more than the app.

Everything else — the request form, the matching engine, the state machine, the ledger — is
commodity and should be built boringly.

---

## 3. Contradictions and errors found in the original specification

I found eleven places where the spec contradicts itself or contradicts reality. Each is
resolved below. If you disagree with a resolution, that decision moves to
`11-open-decisions.md`.

### C1 — "The 10% commission cannot pay for a failed transaction"
*Spec says:* 10% on completion. *Also says:* task fee always payable.
*Consequence:* when a deal fails, the platform has **zero** revenue but has consumed real
support and moderation labour (dispute triage, evidence review, refund processing) and
earned nothing. Over a portfolio of transactions, failed deals are 30–45% by volume.
**Resolution:** platform revenue = task fee *service margin* + commission. See §4.

### C2 — "5% platform share is net-negative on mid-value transactions"
Worked example, Rs 100,000 iPhone:

| Line | PKR |
|---|---|
| Commission charged (10%) | 10,000 |
| Platform share (50%) | 5,000 |
| PSP processing on charge | (310) |
| Sales tax on PSP service fee (~15% on a few hundred) | (47) |
| PSP fee on task fee pass-through (~PKR 2,500 collected) | (78) |
| Dispute/fraud provision (1.2% of GMV) | (1,200) |
| Support + moderation (18 min blended @ PKR 400/hr) | (120) |
| **Contribution** | **3,245** |

That is 3.2% of GMV — survivable at scale but **negative** for the first ~2,000 transactions
because you cannot amortise a 7-person ops team over 2,000 jobs.

But re-run it at Rs 15,000 (a used phone, your single most likely early category):

| Line | PKR |
|---|---|
| Commission (10%) | 1,500 |
| Platform share | 750 |
| PSP fee | (47) |
| Provision | (180) |
| Support (18 min) | (120) |
| **Contribution** | **403** |

And at Rs 5,000 (a used phone charger, a bookshelf, a cycle): platform share PKR 250 against
~18 minutes of ops → **negative contribution**.

**Resolution:** commission needs a **floor, a tiered curve, and a ceiling.** Recommended curve
in §4.2. This directly answers your open question "Whether 10% should have a minimum/maximum."
**Answer: yes, both, and the curve should be steeper than 10% at the low end.**

### C3 — "The commission split creates a conflict of interest in the verifier"
Spec: Field Agent receives 50% of the 10% commission. The Field Agent is also the sole
witness to the product's condition and the negotiator who benefits from closing.
An agent who talks a buyer into a bad purchase earns more. This is not a hypothetical —
it is a rational response to the incentive structure.
**Resolution:** three-part fix, all mandatory.
1. Agent's commission share is **settled only after buyer confirms delivery receipt** and the
   dispute window has expired (`COMMISSION_SETTLED` is the terminal financial state).
2. A **clawback** mechanism: if a transaction is confirmed fraudulent, the agent's commission
   share is reversed and a strike is recorded.
3. The inspection report is **structurally signed before** negotiation opens, so the agent
   cannot retro-fit a rosy verdict to a closed deal.

### C4 — "Escrow is assumed but not licensed"
Spec §9 calls it "payment escrow / protected transaction" and then correctly warns not to
mislabel it as regulated escrow. The warning is the right instinct but the spec never resolves
what the mechanism actually *is*.
In Pakistan there is no general-purpose licensed escrow product you can wrap around P2P
goods. Holding buyer funds in a platform-controlled wallet across a multi-day transaction is
the activity regulators scrutinise.
**Resolution — three options, costed in `06-payments-commission.md`:**
- **Option A (recommended for MVP):** Platform never touches purchase money. Buyer pays the
  Field Agent's task fee through the platform (small, short-duration reserve). Buyer transfers
  the purchase price **directly to the seller at the point of sale**, with the Field Agent
  supervising and recording. Platform collects its commission as a separate, explicit line
  item charged *before* settlement. Nothing is escrowed, so nothing needs to be.
- **Option B:** Licensed PSP-held escrow/split settlement (requires a PSP that offers it in
  PK + legal sign-off). Deferred to V2.
- **Option C:** Platform-held internal wallet with batched payouts. Operationally easiest,
  **highest legal risk**, requires counsel. Not recommended without written advice.

### C5 — "The state machine in the spec is not executable"
The 23 states in spec §16 have four concrete defects:
- `SELLER_VERIFIED` and `PRODUCT_INSPECTION_STARTED` follow `AGENT_ARRIVED`, but there is no
  state for **negotiation occurring before or during inspection**, and negotiation can loop.
- `PURCHASE_COMPLETED` and `TRANSACTION_COMPLETED` overlap without a defined distinction,
  and neither is reachable from `PURCHASE_APPROVED` in any defined order.
- `COURIER_HANDOVER → IN_TRANSIT → DELIVERED` has no state for **agent-delivered** (spec §19
  Option B), which is a first-class path.
- There is no state for **expiry** (buyer never pays, agent never shows, seller never
  responds), which in a marketplace is where the majority of transactions actually die.

**Resolution:** 34 states with an explicit transition table and guards in
`03-state-machine.md`.

### C6 — "The Field Agent's cash-handling role is unspecified and dangerous"
Spec §9 has the buyer fund a protected transaction and the Field Agent collect the product.
It never says who physically holds money, and in every realistic flow the agent ends up
carrying PKR 100,000+ of a stranger's cash through a city.
**Resolution — hard rule:** the Field Agent never holds more than a configurable cash ceiling
(default PKR 5,000, hard cap PKR 20,000) for more than 10 minutes. Above the ceiling, the
buyer pays the seller by bank transfer or wallet transfer **at the seller's location, on
camera**. Recorded as evidence.

### C7 — "The buyer bears legal risk of possessing stolen goods"
If a Field Agent buys a stolen phone, the *buyer* now possesses stolen property. Reporting the
seller is not a remedy; the buyer is the possessor.
**Resolution:** mandatory possession/ownership evidence (original invoice or box with
matching serial, or IMEI clean-check with seller's ID recorded) is a **gate**, not a checklist
item. Without it the agent cannot progress past `POSSESSION_CONFIRMED`.

### C8 — "Ratings on a stranger marketplace are worthless without structure"
Spec §15 asks for ratings and warns against vanity metrics, but does not say how fake reviews
are prevented.
**Resolution:** ratings can only be left against a completed transaction, by a participant, once.
No review without a transaction id. This alone kills 95% of review fraud. See `07`.

### C9 — "'Buyer pays the agent even on failure' invites a race to the bottom"
If the task fee is purely buyer-set and agents bid freely, buyers will pick the cheapest agent
and quality collapses. Spec §6 offers "accept offered payment OR submit own bid" — both.
**Resolution:** MVP = platform-suggested fee band per request (derived from distance — Rs 30/km
of seller-to-dealer range, capped at 50 km = Rs 1,500) + agents accept/decline within band +
at most 2 counter-offers. Open bidding is
V2. See `11-open-decisions.md` Q2/Q3.

### C10 — "The seller is anonymous, which makes the platform a transacting party in an illegal market"
If the platform enables the purchase of a counterfeit handbag, the platform facilitated
counterfeiting regardless of intent. Liability regimes differ but exposure is real.
**Resolution:** category allow-list with a `risk_level` per category; prohibited classes are
refused at request-creation time, not at agent visit. See §7.

### C11 — "Buyer approves purchase, but nothing stops a dishonest agent"
Spec assumes the buyer's approval gate protects the buyer. It does not protect against the
agent quietly buying from a different seller or substituting goods.
**Resolution:** evidence continuity. The serial number, seller photo, and listing screenshot
captured at inspection are bound to the transaction; settlement requires the packaged-item
media to show a legible serial that **machine-matches** the serial captured at inspection. This
is the strongest single anti-substitution control available at reasonable cost.

---

## 4. Recommended revenue model

### 4.1 Two fees, clearly separated in the UI

> Confirmed shape (`DECISIONS.md` §2, §4): the buyer pays the **inspection bid** (buyer-set,
> paid in full to the dealer) plus a **5% success fee**; the **seller pays 3%**; the dealer
> earns the bid plus a **2% capped bonus**; the company keeps the rest. The purchase price is
> still paid directly to the seller and never touches us. The original diagram is kept below.

```
BUYER PAYS
├─ Inspection Bid    → buyer-set, paid at accept, released to the dealer on milestones.
│                      The platform takes NO cut of it (DECISIONS.md section 5).
├─ Success Fee       → 5% (1.5k-15k) of the ACTUAL purchase price, charged at settlement.
│                      The seller separately pays 3% (1k-8k). (Confirmed, not the old 10%.)
└─ Purchase Price    → paid DIRECTLY to seller by buyer, at the seller's location,
                       recorded on camera by the Field Agent
                       (platform does NOT custody this — confirmed design, not a fallback)

CANCELLATION
├─ Purchase price    → never charged (it never passed through us)
├─ Success fee       → not charged from buyer OR seller (charged only on completion)
└─ Inspection bid    → payable per the milestone policy in 03-state-machine.md section 6
```

The **only** thing that changes on failure is the inspection bid. That is the single clearest,
most defensible product promise: *"If the inspection fails, you only pay for the inspection."*

### 4.2 Recommended commission curve

> **SUPERSEDED.** The banded single 10% curve below was the *original* recommendation. The
> **confirmed** model is a flat two-sided fee with floors and caps:
>
> | Side | Rate | Floor | Cap | At a Rs 150,000 phone |
> |---|---|---|---|---|
> | Buyer success fee | 5% | Rs 1,500 | Rs 15,000 | Rs 7,500 |
> | Seller success fee | 3% | Rs 1,000 | Rs 8,000 | Rs 4,500 |
> | Dealer success bonus | 2% | Rs 1,000 | Rs 5,000 | Rs 3,000 |
> | Company keeps | remainder | — | — | **Rs 9,000 (6%)**, netting ~4.4% |
>
> **The inspection bid is set by the buyer, not by a price table**, and the platform takes no
> cut of it. The suggested band is **distance only** — Rs 30 per km of seller-to-dealer range,
> capped at the 50 km search range (Rs 1,500) — so the tables below are archived inputs
> (`DECISIONS.md` §5.1), no longer fees.

| Purchase price band | ~~Success fee~~ superseded | Rationale |
|---|---|---|
| ≤ PKR 25,000 | ~~Flat PKR 1,500~~ | kept as the floor input for the buyer's suggested bid |
| PKR 25,001 – PKR 500,000 | ~~10%~~ | superseded by 5% buyer + 3% seller |
| > PKR 500,000 | ~~8%, capped PKR 40,000~~ | out of v1 scope entirely |
| Prohibited / high-risk | — | No transaction. See §7 |

**Inspection bid** — the *suggested range* shown to buyers is **distance only**
(`DECISIONS.md` §5.1): `normal = Rs 30 × km`, where `km` is the seller-to-dealer range (the
search radius), capped at 50 km. The band is ±15% around it.

| Seller-to-dealer range | Normal | Suggested band (±15%) |
|---|---|---|
| 50 km (max) | PKR 1,500 | PKR 1,275 – 1,800 |
| 15 km | PKR 450 | PKR 383 – 540 |
| 10 km | PKR 300 | PKR 255 – 360 |

Plus a difficulty multiplier for after-hours/meetup-unfriendly locations.

**Archived — the old category-base input (no longer feeds the band):**

| Category | ~~Base inspection bid~~ |
|---|---|
| Phone / tablet | ~~PKR 1,200~~ |
| Laptop / computer | ~~PKR 1,500~~ |
| Camera / audio / instruments | ~~PKR 1,800~~ |
| TV / large appliance | ~~PKR 2,500~~ |
| Furniture | ~~PKR 2,000~~ |
| Motorbike (static inspection) | ~~PKR 3,500~~ |
| Car (full inspection + test drive) | ~~PKR 7,500~~ — **not in v1** |

**Dealer economics target:** a competent Lahore/Karachi dealer earns the bid in full plus a
capped 2% bonus. At the confirmed numbers (bid Rs 1,500 + bonus Rs 3,000 = **Rs 4,500** on a
typical Rs 150,000 phone, ~2.5 hours), 20 jobs/month is **Rs 90,000**. If that math does not
work, the supply side will not build, and **no software fixes it**. Model this in a
spreadsheet before writing a line of code — it is the binding constraint.

### 4.3 What the platform actually earns

> **SUPERSEDED.** The confirmed unit economics are in `DECISIONS.md` §2.2 and `06` §2.1:
> **~4.4% net contribution** at a Rs 150,000 phone, versus the 2.3% modelled below. The
> improvement comes from charging both sides and from keeping the purchase amount off our
> payment rails entirely.

| Line (original model) | % of GMV at PKR 100k avg ticket |
|---|---|
| Success fee | 10.0% |
| Platform share | 5.0% |
| PSP + tax | (0.4%) |
| Dispute/fraud provision | (1.2%) |
| Agent commission share payout | (5.0%) — already excluded above |
| Ops (at 3,000 txns/month) | (1.1%) |
| **Net contribution** | **2.3%** |

2.3% of GMV. This is a marketplace business, not a software business, and it should be
underwritten like one.

---

## 5. Where the real money is

Ranked by defensibility, not by revenue:

1. **Agent density per city.** One city with 200 vetted agents is a business. Ten cities with
   20 agents each is not. Do not launch nationally. Launch in **one city**, one category.
2. **Category playbooks.** Phone inspection is the wedge (highest volume, clearest checklist,
   best serial-number verification story, easiest buyer trust). Vehicles are the highest-value
   but highest-liability. Start with phones and laptops.
3. **Repeat buyers.** The buyer who has one good agent experience comes back 4–6 times a year
   and will refer. Build "your agent" (favourite agent, one-tap rebook).
4. **Seller-side data.** Knowing which phone numbers sell counterfeit iPhones across Lahore is
   worth more to the ecosystem than any transaction. Handle under strict privacy controls —
   it is defensible data you can never legally sell or share.

---

## 6. Launch thesis

> Launch in **one city** (Karachi or Lahore — pick by agent-supply concentration, not market
> size), **one category** (used phones and laptops), with **no purchase-fund custody**,
> **native live video**, **no custody of purchase funds at all** (`DECISIONS.md` §7 — only fees
> pass through us), and **manual human moderation of every transaction above PKR 300,000**.

The bet being tested is narrow and falsifiable: *will a Pakistani consumer pay PKR 1,200–2,500
to have a stranger verify a used phone they cannot travel to see?*

That is a small, cheap bet. Build the smallest thing that answers it, then expand.

---

## 7. Prohibited and restricted categories

**Prohibited at request creation — always refused, no exceptions, no agent discretion:**

- Weapons, ammunition, explosives, firearms, replica firearms
- Controlled substances, drugs, nicotine/cannabis products, prescription medication
- Counterfeit-likely goods: designer/luxury goods without serial + authenticity papers
- Live animals, livestock, birds, insects, seeds, plants, soil
- Human organs, blood, medical samples
- Raw food, perishables, packaged food (import/quality exposure), animal feed
- Chemicals, fuels, gas cylinders, batteries (standalone), industrial reagents
- Currency, gold/silver bullion & jewellery, gemstones (trade/valuation exposure)
- Property, land, vehicles requiring title transfer (see below)
- Cigarettes, alcohol, narcotics precursors
- Documents, passports, CNICs, SIM cards, licences (either as product or as a service)
- Scrap metal, decommissioned equipment (high theft density)
- Anything the agent, at their discretion, judges unsafe to handle — always allowed to abort

**Restricted — allowed only with a senior/verified agent plus platform pre-approval:**
Vehicles and motorcycles (title transfer requires an agent-signed inspection report the
platform should not issue as a certificate), machinery, industrial equipment, medical devices,
large appliances, high-value jewellery (visual inspection only, no custody).

---

## 8. Top 20 risk register

Scored: Likelihood (L) 1–5, Impact (I) 1–5. Exposure = L × I. Owner roles: CEO, Legal, Eng,
Ops, Trust&Safety.

| # | Risk | L | I | Mitigation | Doc |
|---|---|---|---|---|---|
| R1 | Platform taken as facilitating sale of stolen/counterfeit goods | 3 | 5 | Possession-evidence gate (C7); category allow-list; T&S review of flagged sellers; log everything | 07, 08 |
| R2 | Unlicensed custody of buyer funds / money transmission | 4 | 5 | **Option A: no purchase-fund custody in MVP.** Written legal opinion before any wallet exists | 06, 08 |
| R3 | Agent absconds with product or cash | 3 | 5 | Cash ceiling (C6); agent tiering for high value; mandatory courier + insurance above threshold; custody handoff protocol; SOS | 03, 07 |
| R4 | Agent collusion with seller (kickback) | 3 | 4 | Buyer video session required for value > PKR 100k; seller contact number captured and independently verified; collusion graph detection | 07 |
| R5 | Buyer pays commission, deal fails, demands refund, disputes | 4 | 3 | Commission charged **only at settlement**, never in advance. No advance charge = no refund fight | 06 |
| R6 | Unit economics negative at low ticket | 4 | 4 | Commission floor + tiers (§4.2); task-fee service margin; ops cost tracking per transaction | 00 §4 |
| R7 | PSP fee/compliance friction; settlement/payout failures | 4 | 3 | Two PSPs integrated; batched weekly payout run with reconciliation; ledger as source of truth | 06, 09 |
| R8 | Off-platform calls can't be evidenced or moderated | 5 | 3 | Native SFU video, recorded and evidence-linked, is the *system of record*; off-platform contact is permitted but never treated as proof | 09 |
| R9 | Evidence tampering / fabricated inspection media | 4 | 4 | Server-side re-encode, EXIF strip, pHash dedupe, capture-app attestation, upload-time hashes, chain of custody | 07 |
| R10 | NADRA/CNIC verification unavailable or legally restricted | 3 | 4 | Tiered KYC with manual fallback; contract with authorized NADRA data-sharing entity | 07, 08 |
| R11 | Courier loses/damages package; liability fight | 3 | 4 | Pre-handover media; declared-value insurance; courier adapter abstraction; buyer-facing rule disclosure | 09 |
| R12 | Agent no-show / buyer abandonment destroys trust | 4 | 3 | Expiry states with automatic partial refunds + strikes; SLA timers; one-tap rebooking | 03 |
| R13 | Counterfeit category contaminates reputation | 3 | 5 | Restrict to phones/laptops initially; authenticity gate for any luxury item | 07 |
| R14 | Safety incident to agent (physical harm) | 2 | 5 | SOS, live check-in, trusted contact, safe-location policy, agent training, incident playbook | 07 |
| R15 | Low agent supply density in launch city → long match times | 4 | 4 | Seed supply manually with founder-led recruitment; guarantee minimum payout for first 30 jobs | 09 |
| R16 | Fake reviews destroy trust model | 4 | 4 | Transaction-gated ratings only; collusion detection; new-agent ramp limits | 07 |
| R17 | Regulatory change on marketplace or PSP rules | 2 | 4 | Modular country/rail adapters; legal review before V2 | 08 |
| R18 | Refund abuse (buyer claims failure after receiving) | 3 | 3 | Evidence-based dispute adjudication; delivery-confirmation gating of commission; patterns tracked | 03, 07 |
| R19 | Data breach exposes CNIC/passport images of sellers and agents | 2 | 5 | Field-level envelope encryption for ID docs; separate PII store; strict RBAC; masking in all logs | 08 |
| R20 | Cannot recruit agents: earnings or trust too low | 3 | 5 | Guaranteed payouts, cash ceiling protection, insurance, professional status, tier progression | 00 §5 |

---

## 9. What could kill this that is not a risk — it is a fact

- **Trust is the product, and trust does not scale with software.** If the first 200 buyers
  have a bad experience, there is no funnel. There is no marketplace network effect here in the
  classic sense: a new buyer's willingness to trust the platform depends almost entirely on the
  density and reputation of the agent network in *one specific city*. This is a *supply-first*
  marketplace, and supply-first marketplaces take 12–18 months. Plan for that or do not start.
- **The Field Agent's own incentive to be honest is weak.** You cannot pay an agent enough to
  make honesty rational on a PKR 100,000 transaction by commission alone. The compensation for
  honesty must come from *reputation and repeat access to the best jobs*, not from margin on
  this one. Design the agent economy around a career ladder, not a gig.
- **Pakistan's used-goods market is partly cash-and-no-records.** The seller in your flow
  frequently cannot produce an invoice. Your most important gate (C7) is also the gate most
likely to fail in practice. **Policy: the agent captures whatever exists, the buyer is shown a
   plain warning ("no ownership proof — could not confirm this isn't stolen"), and the buyer
   decides.** A hard block would block most legitimate transactions and push them off-platform.
   Validate the wording with 20 real buyers during the pilot and tune.
- **Agent income is decided by requests-per-day, not by commission rate.** With ~2.5 hours per
  job, a confirmed earning of Rs 1,500 bid + Rs 3,000 bonus = **Rs 4,500** (`DECISIONS.md` §2)
  means roughly one job per working day to earn Rs 90,000/month. Launch with **8–12 agents** for
  one city; five daily requests against twelve agents still starves half of them, so match
  recruitment to demand as it arrives rather than to headcount targets.
- **The seller's 3% is the deal's most fragile point.** If the seller refuses, the buyer pays no
  success fee, the dealer earns no bonus and the company earns nothing — and the buyer's
  inspection is wasted. The inspector sells it as "only charged if you sell; zero risk; verified
  buyer." Instrument seller-fee refusal rate from transaction one; above **15%** the fee is
  priced wrong, not sold wrong (`DECISIONS.md` §2.4).