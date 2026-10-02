# 11 — Open Business Decisions

idea.txt §27: *"Do not silently make major business decisions. Clearly mark assumptions and
propose alternatives."*

This file lists every unresolved business decision. For each: the options, the consequence of
each, a recommended default for MVP, and what it blocks.

**Status key:** 🔴 blocks MVP build · 🟡 blocks a V1 feature · 🟢 can wait

---

# PART A — SETTLED

Q1–Q5 are **closed**. Full rationale and figures are in
[`../DECISIONS.md`](../DECISIONS.md), which now takes precedence over the drafts below. The
original question text is kept for the reasoning trail only.

| Q | Settled answer | Where |
|---|---|---|
| Q1 How is the inspection fee set? | **The buyer sets the bid**; we show a suggested range and the dealer sees how the bid compares to typical. Platform takes **no cut** — the dealer is paid the bid in full. | `DECISIONS.md` §5 |
| Q2 Buyer bid vs platform band? | **Buyer bid**, with the band shown as guidance on both sides. At most **1 counter** per chain in MVP. | `DECISIONS.md` §5.3 |
| Q3 Open bidding between agents? | **No.** Accept / Counter / No only. Revisit if unmatched rate >15% after 1,000 transactions. | `DECISIONS.md` §5.2 |
| Q4 Minimum and maximum on fees? | Success fees are **flat-rate with a floor and a cap, not banded**: buyer 5% (1.5k–15k), seller 3% (1k–8k), dealer bonus 2% (1k–5k). Tiered success rates were dropped — they made the buyer's closing cost unpredictable. | `DECISIONS.md` §2 |
| Q5 High-value products? | **v1 ceiling is PKR 500,000**, phones/laptops/furniture/appliances only. **No cars, no property** in v1. L2 agents to 300k, L3 to 500k. | `DECISIONS.md` §6, `07` §1.1 |

### Success-fee economics (was "the 10% commission")

The original "buyer pays 10%, split 50/50" model is **replaced**.

```
BUYER    inspection bid (full amount to dealer)  +  5% success fee  (1.5k – 15k)
SELLER                                                          3% success fee  (1k – 8k)
DEALER    full bid  +  2% success bonus        (1k – 5k)
COMPANY   the remainder  →  6% of sale price
```

Three reasons the numbers moved (`DECISIONS.md` §2.1–2.4):
1. A **flat 3% dealer cut is misaligned with effort** — identical 2.5 hours of work pays Rs 450
   on a Rs 15,000 item and Rs 15,000 on a Rs 500,000 one. The 2% bonus with a Rs 5,000 cap
   fixes it and lands the dealer at the *same* Rs 4,500 on a typical Rs 150,000 phone.
2. **The company nets 4.4% instead of 3.1%** after provider fees, ops, and the fraud reserve —
   because only fees, not the sale amount, pass through the platform.
3. **Seller fee 5% → 3%.** A seller who refuses the fee kills the deal for everyone. A lower fee
   that gets accepted beats a higher one that does not.

**Standing constraint: success fees exist only when money moves.** No sale, no 5%, no 3%, no
2% bonus. This is structurally enforced in `06` §3.2 and by a database trigger.

---

# PART B — STILL OPEN

---

## Q1 ✅ SETTLED — How should the Field Agent inspection bid be calculated?

**Why it matters:** the inspection bid is the agent's income and therefore the supply-side retention
mechanism. Get it wrong and there is no marketplace, regardless of software.

| Option | Consequence |
|---|---|
| **A. Buyer sets any price** | Maximum price sensitivity, minimum quality. Buyers pick the cheapest agent; quality collapses. Agents learn that raising prices loses the job. |
| **B. Platform suggests a band, agent accepts/declines** | Predictable income for agents, predictable cost for buyers, quality floor is enforceable (min rating/min volume gates). Requires us to price correctly. |
| **C. Free bidding** | Flexible market, but races to the bottom and creates fee-dispute volume. |
| **D. Fixed platform price** | Simple, but ignores distance and difficulty; agents resent easy jobs paying as much as hard ones. |

**Recommended: B.** Band derived from **distance only** — Rs 30/km of seller-to-dealer range,
capped at 50 km (Rs 1,500) — plus difficulty multipliers + serialisation (`06` §3.1). Agent can
accept, decline, or counter once within the band.

**Open sub-question:** do we pay the agent for *distance* or for *time*? MVP pays a per-km
travel fee (quote fixed at offer time, no meter disputes). V1 could move to time-based for jobs
over 45 minutes.

**Blocks:** offers, agent onboarding, the fee explainer copy.

---

## Q2 🔴 Should buyers set a bid or should the platform recommend?

Same axis as Q1, different subject.

| Option | Consequence |
|---|---|
| Buyer sets a price | High agent drop-off; agents see a race to the bottom |
| Platform recommends | Higher match rate, higher task-fee revenue, occasional mismatch with buyer expectations |

**Recommended:** platform recommends the band (B). Show the buyer *"typical for this category in
this city: PKR 1,400–1,800"* and let them adjust **within** the band. Full free bidding is V2,
gated behind a proven match rate.

---

## Q3 🟡 Should Field Agents compete through open bidding?

**Recommended: no in MVP.** Suggested band + accept/decline + up to 2 counters. Open bidding
introduces a quality-inversion problem that is very hard to reverse: once buyers learn that the
cheapest agent wins, quality signals stop mattering.

Revisit in V1 only if unmatched-request rate exceeds 15% after 1,000 transactions.

---

## Q4 🔴 Should the 10% have a minimum and a maximum?

**Yes, both.** See `00` §3 C2 for the arithmetic. Un-floored 10% is loss-making below ~PKR 15,000
because ops cost per transaction is roughly flat.

| Option | Consequence |
|---|---|
| Flat 10%, no floor/cap | Simple to explain; loses money on small items; unbounded liability on cars |
| 10% with floor only | Better on small items; unbounded on cars |
| Tiered (recommended) | Slightly more complex to explain; profitable in every band |

**Recommended:**

| Band | Fee |
|---|---|
| ≤ PKR 25,000 | flat PKR 1,500 |
| PKR 25,001 – 500,000 | 10% |
| > PKR 500,000 | 8%, capped at PKR 40,000 |

**Also decide:** is the fee charged on the *purchase price* or on a *headline/list price*?
**Recommendation: purchase price** (what the buyer actually paid). A fee on list price invites
gaming and inflates the number the buyer fears.

**Blocks:** pricing page, settlement screen, commission engine config.

---

## Q5 🔴 How should high-value products be handled?

| Option | Consequence |
|---|---|
| Same flow, higher fee | Simplest; highest loss severity; highest regulatory exposure |
| Restricted category + senior agent + pre-approval | Moderate complexity; bounds exposure; slows the top of the market |
| Refuse high value entirely | Zero exposure; caps TAM; forgoes the most visible marketing wins |
| High value with mandatory insurance | Best user experience; requires a licensed partner (V2) |

**Recommended (MVP):** restrict. **Platform pre-approval above PKR 200,000; L2+ agents only;
mandatory live session; mandatory recorded custody chain; no agent self-transport above
PKR 50,000.** Above PKR 500,000, require insured courier or decline.

**Decision needed from you:** what is the MVP ceiling you are willing to underwrite? My
recommendation is PKR 200,000 — roughly a good used phone/laptop, which is also the category we
understand best.

**Blocks:** risk policy, agent clearance, insurance roadmap.

---

## Q6 🔴 Who bears courier damage/loss risk?

| Option | Consequence |
|---|---|
| Buyer | Simplest; user-hostile; hurts conversion badly at the last step |
| Platform | Expensive; uninsured until V2; unacceptable at scale |
| Courier (per contract) | Realistic for in-transit claims, but courier terms cap liability and exclude certain damage |
| **Split: courier for transit, platform support for claim handling** | Honest; sets the right expectation |
| Optional insurance product (V2) | Best; needs a partner |

**Recommended:** the **courier bears in-transit risk under its own terms**, and the platform's job
is to (a) prove the package condition before handover, (b) file the claim, (c) make the buyer
whole via the refund remedy *if* the claim succeeds or the courier is unresponsive. Disclose this
plainly at the point of purchase. Sell optional insurance in V2.

The evidence chain is what makes the claim winnable: sealed-package photos, handover scan,
POD.

**Blocks:** shipment terms, dispute remedies, insurance roadmap.

---

## Q7 🔴 How should cancellations work?

Three distinct cancellations with different money outcomes (`03` §6, `06` §6):

| Type | Inspection bid | Success fee | Trigger |
|---|---|---|---|
| Pre-agreement | none | none | Buyer, expiry, no inspection bid paid |
| Pre-settlement (seller/buyer/price) | 70% to agent | 0 | Failed deal |
| Post-authorization, pre-collection | 70% to agent | 0 | Buyer breach — **flagged**, agent's commercial remedy |

**Decision needed:** for a post-authorization buyer cancellation, should the buyer bear any cost?
My recommendation: **no** at MVP (except losing the success fee they already paid, which we
refund), and flag the buyer for rate-limiting repeat breaches. Charging buyers for changing their
mind creates disputes and bad publicity; the cost of abuse is better controlled by limiting
repeat behaviour.

---

## Q8 🔴 How should refunds work?

**Recommended:**
- Inspection bid: milestone-proportional (`03` §6). Immediate to wallet; card refunds initiated
  within 24h; bank 3–5 days.
- Success fee: refunded only if the transaction failed or a dispute upheld the buyer.
- Purchase price: not our money — the buyer's recourse is the dispute process and the courier
  claim.
- Communicate the timeline at the moment of refund, not after the complaint.

**Open:** do we ever refund the success fee for a service failure (as opposed to a deal failure)?
Recommendation: no — the service was performed. Be explicit about it in the terms.

---

## Q9 🔴 How should buyer approval work?

| Option | Consequence |
|---|---|
| Approval before inspection | Pointless |
| Approval after inspection only | Default; buyer sees report + optional live call |
| Approval gated on live call | Strongest, but blocks async deals and frustrates buyers when the agent is unreachable |
| **Approval after inspection + mandatory live call above a value threshold** | Balanced |

**Recommended:** approval after inspection; live call **mandatory** when declared value >
PKR 100,000 or agent tier < L2 or category is restricted. Otherwise optional but strongly
surfaced. Approval is a **positive act** — no approval defaults to abandon, never to buy.

Also: approval must record the price shown at approval time, so a later price change cannot slip
through. That is the `CEILING_EXCEEDED` guard, enforced server-side.

---

## Q10 🔴 How is seller payment released?

This is the escrow question (`06` §1). Three options costed: A no-custody, B PSP escrow, C
platform wallet.

**Recommended: A for MVP.** The buyer pays the seller directly, on camera, at the point of
purchase. Consequences:
- We never hold purchase money → no custody, no money-transmission question, no PSP fee on the
  full value, no refund complexity.
- The residual risk (seller paid, item not delivered) is mitigated by the live session,
  cash ceiling, custody time-box, and dispute window.

**This is the single most consequential decision in the spec** and it needs a lawyer, not a vote.
See `06` §9 and `08` §5.1.

---

## Q11 🔴 What if the Field Agent disappears with the product?

Honest answer: in the current design, the buyer has a hard problem. Full mitigation in `06` §7.

**Decisions needed from you:**
1. **Do we launch agent self-transport at all?** Recommendation: **no in MVP.** Courier-only
   removes the risk almost entirely.
2. **Do we require the agent to have the item collected by a courier within N hours of
   settlement?** Recommendation: yes, 6h, with a breach flag.
3. **Do we require the agent to record a short "custody confirmation" video at handover, with
   the buyer's phone showing the package?** Recommendation: yes; cheap, and the only proof that
   the right thing is in the box.
4. **Do we hold an agent bond?** Recommendation: yes in V1 (15% rolling reserve), pending
   `[LEGAL REVIEW]` on employment classification.

---

## Q12 🔴 What if the seller refuses to cooperate?

**Recommended:** the transaction fails with a typed reason; inspection bid releases to 70% (agent did
the travel and the attempt); the seller entity is recorded and, if this is a pattern, flagged.
The agent is **not** penalised — they cannot force a seller to cooperate, and penalising them for
refusals trains them to lie about their own work.

**Open:** do we release a higher milestone if the agent had pre-called the seller and the seller
had agreed? Recommendation: yes — arrival (M2) plus a documented 30-minute wait earns M3 even
without a report.

---

## Q13 🔴 What if the product is damaged after inspection?

Three windows:

| Window | Handling |
|---|---|
| Before purchase authorization | Buyer sees it on the live call / photo; renegotiates or rejects |
| After authorization, before collection | Agent re-photographs, buyer re-approves (state returns to `buyer_decision_pending`); price renegotiation possible |
| After collection, in the agent's custody | Agent's liability; dispute; commission frozen; agent strike if negligent |
| In transit | Courier's terms (Q6) |

The state machine handles this by allowing a **re-inspection loop** rather than a one-way path.
Recommendation: allow at most 2 price revisions after authorization; after that, a re-approval
requires a recorded buyer acknowledgement.

---

## Q14 🔴 Can the Field Agent personally transport expensive products?

**Recommendation:** **yes, up to PKR 50,000 in MVP, up to the custody ceiling (default PKR
100,000) in V1, with insurance above that — or not at all until insurance exists.** Agent
self-transport is genuinely useful (faster, cheaper, better for the buyer) and is also the
platform's largest uninsured exposure. Cap it, make the cap visible to buyers at selection, and
require a recorded handover.

**Open:** is the custody ceiling uniform, or per-agent by tier? Recommendation: per-agent, set by
trust tier and ramp, capped at the category max.

---

## Q15 🔴 Which categories require specialized agents?

Clearance levels (`04`): `basic`, `phone_electronics`, `computers`, `appliances`, `furniture`,
`vehicles_static`, `machinery`, `high_value`.

**MVP: phones and laptops only** (`phone_electronics`, `computers`).

**V1: computers, cameras, TVs, furniture, appliances** — each with a playbook and a clearance.
**V2: vehicles, machinery** — these need domain knowledge, insurance, and `[LEGAL REVIEW]`.

The rule: **a category ships only when its checklist template, its clearance definition, and its
failure modes are all written down.** No checklist, no category.

---

## Q16 🔴 Which products should be prohibited?

Full list in `00` §7. **Decision needed from you:** two borderline classes.

| Class | Recommendation |
|---|---|
| Luxury/designer goods (handbags, watches, jewellery) | **Restricted, not prohibited** — but only with an authentication-service partnership, because our answer to "is it real" is a person squinting at a serial number. Until then: **decline.** |
| Vehicles | **Allowed to inspect, prohibited to facilitate transfer.** We issue a report, not a certificate. |

Prohibition is enforced at `request.publish`, so an agent is never sent somewhere illegal.

---

## Q17 🔴 How should disputes be resolved?

**Recommended:** human adjudication, evidence-based, on a fixed SLA. Reasons:
- Automated adjudication will be wrong on the cases that matter (agent misreport vs. buyer
  over-claim) and wrong in a way that destroys trust.
- The dispute corpus is the best product-research input we will ever get.

**Structure:** intake (auto-freeze commission) → triage + SLA → statements with structured forms
→ evidence review (report, recording, package media, serials, GPS) → decision with a written
rationale → 7-day appeal → root-cause tag → knowledge base.

**Decisions needed:** (a) who arbitrates — T&S staff, or a rotating senior-agent panel for
low-value cases (recommendation: staff only in MVP, cheaper and cleaner); (b) is the outcome
appealable to a third party (recommendation: no in MVP — internal appeal only, external is
expensive and legally messy).

---

## Q18 🔴 What legal structure and payment provider is appropriate in Pakistan?

**This needs a lawyer and a chartered accountant. Do not guess.** The blocking items, from
`08` §5.1:

| Question | Why it blocks |
|---|---|
| Does holding a ≤7-day task-fee reserve constitute stored value / money transmission under SBP rules? | Determines whether the whole money model is legal |
| NADRA data-sharing approval for CNIC verification | Blocks NADRA integration (V1) |
| FBR withholding + sales/service tax on the success fee | Blocks finance launch |
| Are Field Agents independent contractors or workers? | Blocks the bond, the reserve, the payout schedule, and the insurance design |
| Is the platform a "seller" or "service provider" under consumer law? | Determines liability on a bad purchase |
| Do we need insurance, and with whom? | Blocks Q6 and Q11 |

**Payment provider recommendation for MVP:** a PSP with a merchant agreement that permits holding
a short-duration customer reserve for services, chosen for (i) wallet coverage (JazzCash and
Easypaisa together are most of Pakistan), (ii) split-settlement capability for V2, (iii) reliable
webhooks and a settlement file we can reconcile against, (iv) card acceptance for higher-value
buyers.

**Decision needed from you:** are you willing to run the MVP without NADRA integration (manual
KYC only)? My recommendation is yes — it unblocks launch while the regulatory agreement is
negotiated.

---

## Decisions I have taken, and you should sanity-check

These are the assumptions I made so the spec is implementable. Push back on any of them.

| # | Assumption | If wrong |
|---|---|---|
| A1 | Purchase money never touches the platform in MVP | If you want escrow, Q10 → Option B, and add 3–4 months and a PSP dependency |
| A2 | Inspection bid, not commission, is the agent's main income | If commission is meant to dominate, the economics do not work at mid-tickets (`00` §3) |
| A3 | ~~Commission is 50/50~~ **SUPERSEDED** - replaced by the flat-rate two-sided model in `DECISIONS.md` section 2 | Success fees exist only on a closed deal, and the dealer's bonus is capped at Rs 5,000 |
| A4 | English-first UI | If Urdu-first is required, budget an extra 3–4 weeks and re-test the agent app |
| A5 | One city, phones + laptops | If national from day one, expect a 12-month liquidity problem (`09` §10) |
| A6 | Flutter, Android-first | If iOS buyers matter commercially, add an RN or Flutter iOS build in V1 |
| A7 | Modular monolith, not microservices | If you expect to hire 20+ engineers immediately, revisit; otherwise this is right |
| A8 | Live video on our own SFU; no WhatsApp integration at all | Users share a WhatsApp number in the description and coordinate off-platform; the recorded in-app session is the only evidence trail (`09` §2.3) |
| A9 | Success fee is charged at settlement, never in advance | If charged in advance, you win cashflow but create refund fights (`00` §3 C5) |
| A10 | "Not verified" is shown as a first-class state | If you hide it, you are lying to buyers, and the Claimed-vs-Verified wall collapses |
| A11 | Commission settles after the dispute window, not at purchase | If it settles earlier, agents earn from closing before the buyer can complain |
| A12 | No purchase-funded credit/BNPL in MVP | If required for conversion, it needs a licensed partner and changes the risk profile entirely |