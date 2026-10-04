# 06 — Payments, Commission Engine & Protected Transactions

> **Superseded in part.** The confirmed business model, pricing, and bid mechanic are in
> [`../DECISIONS.md`](../DECISIONS.md) and take precedence over this file where they disagree.
> This file remains authoritative for: the escrow option analysis (§1), the ledger mechanics
> (§3.2, §3.3, §4), the custody/cash ceilings (§5.1), and the refund matrix (§6).
>
> **Confirmed changes vs. this document:**
> - Company keeps **6%** of sale value, not 7%. Dealer gets a **4% success bonus** (= 40% of the
>   10% fee pool), not a flat 3%. (A flat 3% pays Rs 15,000 for a Rs 500,000 laptop and Rs 450
>   for a Rs 15,000 item — misaligned with effort.)
> - **Buyer pays 5%. Seller pays 5%**, collected on the spot by the dealer. **Pure rates: no
>   floor, no cap** — the same 5% · 5% · 4% · 6% split at every item price, so the fee
>   calculator always shows the real percentage.
> - The **inspection fee is set by the buyer's bid** and is paid in full to the dealer — the
>   platform takes no cut of it.
> - Only fees pass through the platform. The sale amount goes buyer → seller directly.
> - Success fees exist **only when money moves**. Failure outcomes are in `DECISIONS.md` §3.

This is the highest-risk document in the spec. It has three jobs:

1. Explain the three escrow options and pick one.
2. Make the commission calculation structurally impossible to apply to a failed deal.
3. Specify every money edge case in idea.txt §27.

---

## 1. The money question, honestly

idea.txt §9 asks for "payment escrow / protected transaction" and correctly warns against
mislabelling it. The unresolved question underneath is:

> **Does the buyer's money pass through the platform's balance sheet?**

In Pakistan, holding customer money in a platform-controlled wallet across a multi-day
transaction is the activity regulators scrutinise. Fintechs operate under SBP oversight when
they store value; a marketplace that is not a bank should not casually become one. There is also
no general-purpose licensed escrow product in Pakistan you can wrap around P2P goods.

So the design question becomes: **can we deliver the buyer's *outcome* without holding the
buyer's *money*?**

Yes. And this is the key insight: what the buyer is buying is **evidence and a process**, not
custody. Once the Field Agent is physically at the seller with the buyer watching on video,
the trust gap is closed by *observation*. The money can move directly, buyer → seller, in that
moment, with the transfer captured. There is no window in which the platform holding the money
would have added safety.

### 1.1 Option analysis

| | **A. No custody (recommended MVP)** | **B. PSP-held escrow** | **C. Platform wallet** |
|---|---|---|---|
| Who holds purchase money | Nobody — buyer pays seller live | PSP in escrow | Platform |
| Platform collects success fee | Yes, separate charge at settlement | Yes, from escrow release | Yes |
| Regulatory exposure | Low — no custody, no stored value | Low-medium — depends on PSP product | **High — money transmission** |
| Needs a licensed partner | No | Yes | Yes |
| Buyer trust at settlement | Medium — depends on live session quality | High | Highest |
| PSP fee cost | ~0.4% of the 10% only | ~2.5–3% of full value | ~2.5–3% + tax |
| Refund complexity | Low — nothing to refund | High — escrow return SLA | Medium |
| Ops burden | Low | Medium (SLA tracking) | High (reconciliation, float) |
| Failure mode | Buyer pays seller, agent then fails to deliver | PSP dispute window | Platform insolvency risk |
| Time to ship | **Weeks** | Months (commercial negotiation) | Months + legal |

### 1.2 Recommendation

**MVP = Option A. Target Option B for V2, negotiated with a PSP that offers held/split
settlement for marketplace use. Do not build Option C.**

Option A's weakness is real and must be disclosed honestly: between settlement and delivery,
the buyer's money is with the seller and the item is with the agent. Mitigation is mandatory,
not optional:

1. **Live session required** at settlement for any transaction above PKR 100,000.
2. **Cash ceiling** — the agent never holds more than PKR 5,000 for more than 10 minutes.
3. **Seller payment proof** captured as evidence, in-app, with the transaction reference.
4. **Money transfer is buyer → seller's own account**, in the app, so the buyer sees the
   recipient identity before confirming. The agent cannot redirect it.
5. **Dispute window + frozen commission** gives recourse after delivery.
6. Where the buyer insists on a guarantee, sell them **optional third-party courier insurance**
   (V2+) and say plainly that we do not underwrite the purchase.

The product copy must never imply a guarantee we do not provide. `escrow`, `guaranteed`, and
`buyer protection` are banned words (`02` §6).

---

## 2. Recommended money flow (Option A, MVP)

```
BID ACCEPTED (state: awaiting_bid_payment ──► request_published)
  Buyer ──► Platform   Inspection Bid                [PSP: card / easypaisa / jazzcash / bank]
  Platform ──► Ledger  Dr 1000 Clearing           PKR 1,500
                       Cr 2000 Bid Reserved        PKR 1,500
  The dealer is paid this amount IN FULL. The platform takes no cut of the bid, which is why
  the dealer's income is a function of how many jobs he takes, not of our margin.
  State: agent_selected ──► bid_paid_at set. The dealer may now travel.

MILESTONES (per 03 §6)
  Platform ──► Ledger  Dr 2000 Bid Reserved      /  Cr 2200 Dealer Payable
  The buyer's bid is held and released to the dealer at each milestone; paid out on the weekly run.
  The platform takes no cut of it.

SETTLEMENT (state: purchase_authorized ──► settlement_pending)
  Step 1  Platform computes the two success fees from the ACTUAL purchase price. Server-side only.
  Step 2  Buyer ──► Seller   Purchase Price        [bank / easypaisa / jazzcash, in-app]
          *** The Rs 150,000 never touches us. Only the fees below move through the PSP. ***
          Dealer records the transaction ref and captures it on video.
  Step 3  Buyer  ──► Platform  Buyer Success Fee    5%  [PSP]
          Seller ──► Platform  Seller Success Fee   5%  [PSP, collected by the dealer on site, on camera]
          Platform ──► Ledger   Dr 1000 Clearing / Cr 4000 Success Fee Revenue
          *** TRIGGER FIRES HERE: only reachable from state purchase_completed ***
  Step 4  Dealer: settlement.seller_paid (evidence ≥1) ──► settlement_verified
  Step 5  purchase.complete ──► purchase_completed   (success fees now postable)

CUSTODY & DELIVERY
  No platform money movement at any point. Courier collects.

CLOSE (state: buyer_confirmed_receipt ──► dispute_window_elapsed)
  Platform ──► Ledger  Dr 4000 Revenue        PKR 15,000   ← both success fees
                     Cr 2200 Dealer Payable   PKR  6,000   ← 4% bonus
                     Cr 3000 Equity           PKR  9,000   ← company take, 6%
  State: commission_settled
  Weekly payout run transfers 2200 balances to verified IBANs.

FAILURE AT ANY PRE-SETTLEMENT POINT
  Dr 2000 Reserved / Cr 1000 Clearing   (refund of unearned bid milestones)
  Success fees: never posted → Cr 4000 never touched → PKR 0 revenue. Structurally.
```

### 2.1 Worked examples (the numbers idea.txt §7/§8/§20 asked for)

All figures use the confirmed rates in `DECISIONS.md` §2. Fees are per the worked example:
bid Rs 1,500, PSP ~3.5% of platform-collected fees, ops Rs 120, fraud reserve 1.2% of sale.

**Example A — deal closes. Rs 150,000 phone.**
| Line | PKR |
|---|---|
| Buyer pays seller directly | 150,000 |
| Buyer success fee (5%) | 7,500 |
| Seller success fee (5%, deducted on site) | 7,500 |
| Inspection bid (buyer → dealer, in full) | 1,500 |
| **Buyer pays in total** | **159,000** (6% over sticker) |
| Seller receives | 142,500 |
| Dealer receives | 1,500 bid + 6,000 bonus (4%) = **7,500** — ~Rs 3,000/hour |
| Platform keeps (6% of sale) | 9,000 |
| PSP cost (on the 15,000 of fees only) | ≈ 525 + tax |
| Ops | 120 |
| Fraud / dispute reserve (1.2%) | 1,800 |
| **Platform contribution** | **≈ 6,555 — 4.4% of sale** |

**Example B — deal fails. Product is counterfeit.**
| Line | PKR |
|---|---|
| Bid secured | 1,500 |
| Bid released to dealer (M1+M2+M3 = 70%) | 1,050 |
| Refunded to buyer | 450 |
| Buyer success fee | **0** |
| Seller success fee | **0** |
| Dealer bonus | **0** |
| Purchase price | **0 — never charged** |
| Platform revenue | **0** |
| Dealer receives | **1,050** |

**Example C — low-ticket item, Rs 15,000. The rates never change shape.**
| Line | PKR |
|---|---|
| Buyer success fee (5%) | 750 |
| Seller success fee (5%) | 750 |
| Fees collected | 1,500 |
| Dealer bonus (4% = 40% of the pool) | 600 |
| Company take | 900 (6%) |
| PSP + ops + reserve (1.2%) | ≈ 355 |
| **Platform contribution** | **≈ 545 — 3.6%** |

**Example D — expensive laptop, Rs 500,000. No cap: the rates hold.**
| Line | PKR |
|---|---|
| Buyer success fee (5%) | 25,000 |
| Seller success fee (5%) | 25,000 |
| Dealer bonus (4%) | 20,000 |
| Company take | 30,000 (6%) |
| PSP + ops + reserve (1.2%) | ≈ 7,900 |
| **Platform contribution** | **≈ 22,100 — 4.4%** |

Note Example D: the dealer earns Rs 7,500 in Example A and Rs 21,500 here (bid + bonus) —
proportionate to the sale, which is why the bonus is a pure 4% of price rather than a capped
amount. The same 5% / 5% / 4% / 6% split applies to every price, including Example C.

---

## 3. Commission calculation system

### 3.1 Pure, total, side-effect-free

```ts
// packages/commission/pricing.ts
type Money = number; // integer paisa

export type PriceBand =
  | { kind: 'flat';  amount: Money }
  | { kind: 'pct';   rateBps: number };

export type PricingConfig = {
  bands: { upTo: Money | null; band: PriceBand }[]; // ordered, upTo:null = top band
  bidPerKm: Money;        // 3_000 = Rs 30 per km
  maxDistanceKm: number;  // 50 - the product's maximum search range
  difficultyMultipliers: Record<string, number>;
  // Confirmed economics — see ../DECISIONS.md §2. Pure rates: no floor, no cap.
  // 5% buyer + 5% seller = the 10% fee pool; dealer 40% of it, platform 60%.
  buyerFeeBps: number;   // 500  = 5%
  sellerFeeBps: number;  // 500  = 5%
  dealerBonusBps: number;// 400  = 4%
};

/** One-sided percentage of the sale price. No floor, no cap — the rate is the rate. */
export function sideFee(priceMinor: Money, bps: number): Money {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw new DomainError('INVALID_AMOUNT');
  if (priceMinor === 0) return 0;   // a PKR 0 sale is a fraud signal, flagged upstream
  // Half-up at paisa. Round in the platform's favour only on charge,
  // never in the platform's favour on refund.
  return Math.floor((priceMinor * bps + 5000) / 10_000);
}

export const buyerSuccessFee  = (p: Money, c: PricingConfig): Money =>
  sideFee(p, c.buyerFeeBps);   // 5%

export const sellerSuccessFee = (p: Money, c: PricingConfig): Money =>
  sideFee(p, c.sellerFeeBps);  // 5%

/**
 * The dealer's 4% of price — 40% of the 10% fee pool the buyer (5%) and the seller (5%)
 * contribute — plus the inspection bid in full. A flat 3% pays Rs 15,000 for a Rs 500,000
 * laptop and Rs 450 for a Rs 15,000 item for the same 2.5 hours of work; 4% is
 * proportional and its shape never changes with the item price.
 */
export const dealerSuccessBonus = (p: Money, c: PricingConfig): Money =>
  sideFee(p, c.dealerBonusBps); // 4% = 40% of the fee pool

/** The company's own take: the remainder after the dealer's bonus. */
export const companyTake = (p: Money, c: PricingConfig): Money =>
  buyerSuccessFee(p, c) + sellerSuccessFee(p, c) - dealerSuccessBonus(p, c);

/**
 * The buyer's inspection bid. The platform takes no cut — the dealer is paid in full.
 * Distance is the ONLY input: Rs 30 per km of seller-to-dealer range, capped at 50 km,
 * so the full range is a Rs 1,500 normal bid and a 10 km job is a Rs 300 normal bid.
 */
export function taskFeeBand(req: {
  distanceKm: number; difficulty: string[]; hasSerial: boolean; cfg: PricingConfig;
}): { min: Money; mid: Money; max: Money } {
  const { distanceKm, difficulty, hasSerial, cfg } = req;
  const km = Math.min(cfg.maxDistanceKm, Math.max(1, Math.ceil(distanceKm)));
  let mid = cfg.bidPerKm * km;
  for (const d of difficulty) mid = Math.round(mid * (cfg.difficultyMultipliers[d] ?? 1));
  if (hasSerial) mid = Math.round(mid * 1.1);
  return { min: Math.round(mid * 0.85), mid, max: Math.round(mid * 1.2) };
}
```

> The band ladder (`bands`) is retained for the **inspection bid** only — the buyer picks from
> the suggested band and may bid inside or below it (`DECISIONS.md` §5.3). Success fees are a
> flat rate with no floor and no cap, not a banded ladder; tiered success rates were dropped
> because they made the buyer's final cost unpredictable at the moment of closing.

Properties that must hold, and are covered by unit tests:
- `buyerSuccessFee`, `sellerSuccessFee`, `dealerSuccessBonus` are **total** — every non-negative
  integer maps to a non-negative integer.
- Each returns `0` at price `0`, and is **monotone non-decreasing** in purchase price.
- `buyerSuccessFee + sellerSuccessFee - dealerSuccessBonus === companyTake`, exactly, always.
- `f(p)` is exactly `round(p × rate)` for every `p > 0` — no floors, no caps, so the fee
  calculator can state the rate itself at any price.
- `taskFeeBand.min <= mid <= max`, and the normal is exactly `bidPerKm × km` (Rs 30 × 50 =
  Rs 1,500 at the cap, Rs 30 × 10 = Rs 300 at 10 km).
- **No success fee of any kind is computed on a transaction that has not closed** — this is
  enforced in `evaluateCommission` (§3.2) and again in the database trigger (§3.2).

### 3.2 The eligibility guard

```ts
// packages/commission/guard.ts
export type CommissionEligibility =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      salePrice: Money;
      buyerFee: Money;
      sellerFee: Money;
      totalFees: Money;
      dealerBonus: Money;
      companyTake: Money;
    };

export function evaluateCommission(txn: TransactionSnapshot): CommissionEligibility {
  if (txn.purchase_completed_at === null)
    return { eligible: false, reason: 'PURCHASE_NOT_COMPLETED' };
  if (txn.purchase_price_minor <= 0)
    return { eligible: false, reason: 'ZERO_PURCHASE_PRICE' };
  if (txn.state === 'deal_failed' || txn.state === 'purchase_cancelled')
    return { eligible: false, reason: 'TRANSACTION_NOT_CLOSED' };
  if (txn.has_open_dispute)
    return { eligible: false, reason: 'OPEN_DISPUTE' };
  if (txn.dispute_window_ends_at === null)
    return { eligible: false, reason: 'NO_DISPUTE_WINDOW' };
  if (now() < txn.dispute_window_ends_at)
    return { eligible: false, reason: 'DISPUTE_WINDOW_OPEN' };
  if (txn.buyer_confirmed_at === null)
    return { eligible: false, reason: 'BUYER_HAS_NOT_CONFIRMED' };

  const cfg = pricing(txn);
  const salePrice = txn.purchase_price_minor;
  const buyerFee  = buyerSuccessFee(salePrice, cfg);
  const sellerFee = sellerSuccessFee(salePrice, cfg);
  const dealerBonus = dealerSuccessBonus(salePrice, cfg);
  return {
    eligible: true, salePrice, buyerFee, sellerFee,
    totalFees: buyerFee + sellerFee,
    dealerBonus,
    companyTake: buyerFee + sellerFee - dealerBonus,
  };
}
```

Note what is **not** in the function: the sale amount itself. It never touches our ledger — it
goes buyer → seller directly (`DECISIONS.md` §4). Only the two success fees are revenue.

**Defence in depth — three independent layers**, so a single bug in one does not leak money:

1. **Application guard** (`evaluateCommission`) — unit-tested, above.
2. **Database trigger** `ledger_commission_guard` on `ledger_postings` — rejects any revenue
   posting when `purchase_completed_at IS NULL`, a dispute is open, or the window is running.
   Even a rogue admin script cannot post commission on a cancelled deal.
3. **Nightly reconciliation** — `v_commission_anomaly` must return zero rows; alert if not, and
   auto-reverse.

This is the direct answer to idea.txt §20: *"Create the database/payment architecture so this
calculation cannot accidentally charge the 10% commission for cancelled deals."*

### 3.3 Posting service

```ts
// packages/commission/post.ts  — the ONLY code path allowed to write commission rows
export async function postCommission(txnId: string, actorId: string) {
  return db.tx(async (t) => {
    const txn = await lockTransaction(t, txnId);          // SELECT ... FOR UPDATE

    if (txn.commission_settled_at) return { skipped: 'ALREADY_SETTLED' };

    const decision = evaluateCommission(txn);
    if (!decision.eligible) throw new DomainError('COMMISSION_INELIGIBLE', decision.reason);

    // Double-entry, in the same transaction as the state change.
    // NOTE: the sale amount is absent by design — it never reached us (DECISIONS.md §4).
    const entry = await t.insert('ledger_entries', {
      reference: `COMM-${txn.public_ref}`,
      transaction_id: txnId,
      kind: 'success_fee_split',
      posted_by: actorId,
    });
    await t.insert('ledger_postings', [
      { entry_id: entry.id, account: '4000', direction: 'debit',
        amount_minor: decision.totalFees, account_kind: 'revenue' },
      { entry_id: entry.id, account: '2200', direction: 'credit',
        amount_minor: decision.dealerBonus, account_kind: 'liability' },
      { entry_id: entry.id, account: '3000', direction: 'credit',
        amount_minor: decision.companyTake, account_kind: 'equity' },
    ]);

    await transition(t, txnId, 'commission.settle', actorId,
      { purchase_completed_at: txn.purchase_completed_at });

    return decision;
  });
}
```

Rejections from the DB trigger are caught, logged as a `P0_integrity` metric, and paged. A
trigger firing is a bug in this service, not a business event.

---

## 4. Inspection bid: reserve, milestone release, refund

```ts
export const MILESTONES = [
  { id: 'M1', pct: 10, state: 'agent_en_route' },
  { id: 'M2', pct: 20, state: 'seller_identity_verified' },
  { id: 'M3', pct: 40, state: 'inspection_reported' },
  { id: 'M4', pct: 20, state: 'packaged' },
  { id: 'M5', pct: 10, state: 'delivered' },
] as const;

export function releasedAmount(totalTaskFee: Money, reachedState: txn_state): Money {
  const idx = MILESTONES.findIndex(m => m.state === reachedState);
  if (idx < 0) return 0;
  // Walk the milestone ladder, not a single index — states may be re-entered.
  return MILESTONES.slice(0, idx + 1).reduce((a, m) => a + Math.floor(totalTaskFee * m.pct / 100), 0);
}

export function refundAmount(totalTaskFee: Money, reachedState: txn_state): Money {
  return Math.max(0, totalTaskFee - releasedAmount(totalTaskFee, reachedState));
}
```

Special rules overriding the ladder:
- `aborted_unsafe` → 100% released regardless of state.
- `agent_no_show` → 0% released, 100% refunded.
- A dispute that upholds the agent → 100% released.
- A dispute that upholds the buyer for `product_not_as_inspected` → released amount stays at
  M3 (70%); the success fee is then refunded per the remedy, and the agent's commission share
  is clawed back (`Cr 4900` contra-revenue).

**Refund SLA:** in-app wallet credit is immediate. Card refunds are initiated within 24h of
the decision; the actual credit is the PSP's, typically 5–10 business days. Say this to the
buyer at the moment of refund, not after they complain.

---

## 5. Payment providers & routing

```
                     ┌─ JazzCash     (dominant PK wallet, strong)
Inspection bid / success ──┼─ Easypaisa    (dominant PK wallet)
fee collection        ├─ PayFast      (aggregator, good for cards)
                     ├─ HBL / Meezan  (bank gateway, high-value)
                     └─ Card (Visa/MC via aggregator)

Seller payment  ────  performed BY the buyer directly: bank transfer, JazzCash,
                      Easypaisa, or cash (within agent ceiling). Recorded as evidence,
                      not processed by us.

Agent payout   ────  Bank transfer to verified IBAN, weekly batch, via a payout
                      partner or direct bank API (HBL/Meezan bulk transfer).
                      FBR withholding considerations for individuals — `[LEGAL REVIEW]`.
```

Requirements for a provider integration:
1. **Webhooks are signature-verified and idempotent** — `provider_event_id` unique constraint.
2. **Reconciliation daily** — provider settlement file vs. our ledger. Mismatch alerts ops.
3. **Two providers minimum for task/success-fee collection** before public launch, so a single
   PSP outage does not stop the marketplace.
4. **No stored card data.** Tokenise at the PSP; we hold only the token.
5. **Payout holds:** new agents (tier < 2) have `payout_hold_until = last_job + 7 days`.

### 5.1 Cash handling rules (server-enforced)

| Rule | Value | Enforcement |
|---|---|---|
| Max cash the agent may hold > 10 min | PKR 5,000 | `settlement.cash.record` guard |
| Absolute ceiling | PKR 20,000 | Ops override, logged, risk-flagged |
| Max personal-transport value | PKR 100,000 | `handover.agent_deliver` guard |
| Above that | Insured courier required | `handover.courier` guard |
| Time to hand over purchased item after settlement | 6 hours | SLA breach → task flagged |

---

## 6. Refund and cancellation matrix

| Situation | Inspection bid | Success fee | Purchase price | Who pays courier back | Timeline |
|---|---|---|---|---|---|
| Buyer cancels before agent selection | — | — | — | — | Instant |
| Buyer abandons before task-fee payment | — | — | — | — | Instant |
| Agent no-show | 100% refund | 0 | 0 | — | Instant to wallet, ≤24h to card |
| Seller unavailable/refused | 70% to agent | 0 | 0 | — | Instant |
| Buyer rejects after inspection | 70% to agent | 0 | 0 | — | Instant |
| Price exceeds authorization | 70% to agent | 0 | 0 | — | Instant |
| Safety abort | 100% to agent | 0 | 0 | — | Instant |
| Buyer cancels after authorization, before payment | 70% to agent | 0 | 0 | — | Instant |
| Buyer paid seller, then agent fails to deliver | 70% to agent | 0 | **buyer's problem — see §7** | n/a | Dispute |
| Dispute: product not as inspected | 70% to agent | refunded per remedy | buyer's | — | ≤72h |
| Dispute: agent fraud confirmed | 0 to agent + clawback | refunded | buyer's | — | ≤72h |
| Dispute: courier loss/damage | 100% to agent | refunded | buyer's | **courier's, per terms** | ≤7 days |
| Dispute: platform fee error | unaffected | refunded | buyer's | — | ≤72h |

---

## 7. "What happens if the Field Agent disappears with the product?"

idea.txt §27 asks this directly. It is the correct question to ask, and the honest answer is
that the buyer has a hard problem in every option. Choose the least-bad one.

| Mitigation | Layer |
|---|---|
| Cash ceiling means the agent almost never holds money | §5.1 |
| Item custody is time-boxed: 6h from settlement to handover | SLA |
| Live session required above PKR 100,000 — the buyer's last look | `03` BR-023 |
| Agent tier gating: only L2 agents may handle value > PKR 50,000; L3 required > PKR 300,000 | `07` |
| Serial re-verified at collection; package media geotagged | `03` BR-037 |
| Seller payment made by buyer, so the seller can also act if the agent vanishes | §1.1 |
| SOS + trusted contact + live location | `07` |
| Agent bond / insurance reserve held against payouts | **V2** — see below |
| Courier contract requires declaration; courier liability for loss in transit | `09` |
| Criminal report + T&S escalation | ops playbook |

**The gap that remains:** between settlement and courier handover, the item is with the agent
and unsupervised. For items above PKR 100,000 this must be covered by insurance, not by policy
language. **Recommendation: do not enable agent self-transport above PKR 100,000 at all until
an insurance partner exists.** For MVP: **no agent self-transport above PKR 50,000**; above
that, mandatory insured courier with in-person pickup scheduled *before* the agent releases
the item.

**V2 hardening — agent bond:** hold back 15% of an agent's weekly earnings as a rolling
reserve, releasable after 30 days dispute-free. It does not cover a PKR 300,000 loss, but it
creates real financial skin in the game, and it lets you offer deeper insurance later without
retro-fitting. `[LEGAL REVIEW]` — a withheld-earnings scheme may have employment-law
implications if agents are effectively employees.

---

## 8. Financial controls

| Control | Implementation |
|---|---|
| Separation of duties | Ops cannot post payouts. Finance cannot approve disputes. Neither can alone approve a manual refund > PKR 20,000. |
| Double-entry everywhere | DB trigger enforces balanced entries. |
| Append-only ledger | `CREATE RULE ... DO INSTEAD NOTHING` on UPDATE/DELETE. Reversals only. |
| Daily reconciliation | PSP settlement file ↔ ledger ↔ `payments`. Break > PKR 50 alerts. |
| Payout approval | Two-person approval above PKR 500,000 aggregate per run. |
| Commission anomaly | `v_commission_anomaly` must be empty; scheduled hourly. |
| Refund ceiling | Per-agent per-day refund cap; breaches alert fraud. |
| Negative-balance guard | `2200` agent payable may not go below zero without a manual adjustment entry. |
| Immutable money audit | Every posting has a correlated `audit_log` row in the same transaction. |

---

## 9. What still needs a decision or a lawyer

| Item | Why it is unresolved |
|---|---|
| Whether a short-duration task-fee reserve is "stored value" | Needs `[LEGAL REVIEW]` — SBP perimeter opinion. Mitigated by 7-day maximum hold and disclosure to users. |
| FBR withholding on agent commissions and inspection bids | Individual vs. freelancer classification; rate and reporting. `[LEGAL REVIEW]` + chartered accountant. |
| Sales tax on the success fee | Service tax registration and rate in Pakistan, plus provincial variations. `[LEGAL REVIEW]` |
| Whether the platform is a "marketplace" under consumer law | Affects disclosure duties and liability. `[LEGAL REVIEW]` |
| Whether escrow can be obtained from a PK PSP, and at what cost | Determines whether V2 Option B is viable. |
| Card acquiring and chargeback exposure | Chargebacks on the success fee are a real loss vector; age the success fee capture until after `settlement_verified`. |

**Recommended sequencing:** capture the success fee at `purchase.complete` (money must not be
left on the table) but **treat a chargeback as a dispute**, and set the PSP's capture window to
7 days, which is longer than a buyer's typical chargeback window and covers the agent's
inspection period.

---

## 10. Reconciliation job (the thing nobody writes until it is too late)

Nightly, for the previous day (PKT):

1. Pull PSP settlement file → normalise to `payments` by `provider_txn_id`.
2. Mark `captured` where the PSP says settled and we still say `pending`. Alert on divergence.
3. Verify: sum(`payments.net_minor` where `status='settled'`, grouped by day) equals the PSP's
   reported net. Tolerance PKR 0.
4. Verify: every transaction in state `commission_settled` has exactly one `commission_split`
   ledger entry, balanced, and matching the recomputed `successFee`. Recompute independently
   (not from stored fields).
5. Verify: every transaction in a failure state has **no** `4000` postings. This is the
   cancelled-deal commission test, run nightly against production data.
6. Verify: sum of `payout_items` per run equals sum of `2200` credits cleared for those agents.
7. Emit a signed daily finance report; store in WORM.

Step 5 is the automated regression test for the central promise of this platform.