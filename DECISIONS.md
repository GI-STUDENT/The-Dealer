# CONFIRMED — business model and pricing

Settled. These replace the earlier drafts in `docs/06-payments-commission.md` and
`docs/03-state-machine.md`.

---

## 1. What the company is

A **hiring service for inspectors** — not a product marketplace.

- The deliverable is a person going and checking something.
- The inspector travels **to the seller**, or **the seller comes to the inspector**.
- The inspection report is the service product. After that, the deal closes as a separate step.
- There is no seller account, no seller app, no listings page, no browsing.
- The buyer posts a **bid** to hire an inspector. The inspector accepts, and the buyer pays the
  bid directly in the app.

---

## 2. Pricing

```
BUYER pays                              SELLER pays
├─ inspection bid (buyer sets it)       └─ 5% of the sale price
└─ 5% of the sale price                (collected on the spot by the dealer,
   charged at settlement                only when the sale actually happens)

DEALER gets
├─ 100% of the inspection bid — we take no cut of it
└─ 4% of the sale price   (= 40% of the 10% fee pool)

COMPANY keeps 6% of the sale price   (= 60% of the 10% fee pool)

Pure rates — no floor, no cap. The shape is identical at every price:

  Rs 10,000 item:  buyer pays 10,500 (+500) · seller hands over 500 →
                   dealer 400, platform 600, seller keeps 9,400.
                   The same 5% / 5% / 4% / 6% on a Rs 100 item or a Rs 500,000 laptop.
```

| | Earlier draft (10% model) | Confirmed |
|---|---|---|
| Company keeps, Rs 150,000 sale | 7% | 6% |
| Company net after provider, ops, reserve | 3.1% | **4.4%** |
| Seller gives up | 5% | **5%** |
| Dealer gets on a Rs 500,000 item | Rs 15,000 | **Rs 20,000** (4%, uncapped) |
| Buyer overpay on a Rs 150,000 phone | 6% | **6%** |

### 2.1 Why the dealer bonus is 4% of price (40% of the fees), not a flat 3%

The inspection is the same 2.5 hours whether the item is worth Rs 15,000 or Rs 500,000, so a
flat 3% pays Rs 450 or Rs 15,000 for identical work. 4% of price — 40% of the 10% fee pool the
buyer and seller contribute — keeps the dealer proportional to the sale, and it is a pure rate:
no floor, no cap, so the fee calculator shows the same percentages at every item price.

```
Rs  10,000 item:   bid + 400 bonus                    (40% of the 1,000 fee pool)
Rs 150,000 phone:  1,500 bid + 6,000 bonus = Rs 7,500 (40% of the 15,000 fee pool)
Rs 500,000 laptop: 1,500 bid + 20,000 bonus = Rs 21,500 (40% of the 50,000 fee pool)
```

### 2.2 Worked example — Rs 150,000 phone

```
Buyer pays   150,000 to seller
            +   7,500  5% buyer success fee
            +   1,500  inspection bid
            = 159,000                                   (6% over sticker)

Seller gets  142,500                                   (after 5%)

Dealer gets    7,500   for ~2.5 hrs  = Rs 3,000/hour
                      20 jobs/month   = Rs 150,000/month

Company keeps  9,000  (6%)
              −   525  payment provider, 3.5% on the 15,000 we actually handle
              −   120  support and ops
              − 1,800  fraud and dispute reserve
              = 6,555 net  (4.4% of sale value)
```

### 2.3 Why 6% is defensible to the buyer

Buying blind on a Pakistani classified, the expected loss is roughly **9% of the item** — a 15%
chance of a problem at an average loss of 60% of value. Paying 6% to remove that is cheap. This
is the sentence to put in the pitch and in the fee explainer.

### 2.4 Why the seller fee is 5%

Sellers are individuals with thin margins. A seller who refuses the fee stops the deal for
everyone — no sale, no buyer fee, no dealer bonus, no company revenue. 5% matches the buyer side
and keeps the arithmetic the buyer sees honest: 5% + 5% − 4% = the 6% the platform keeps.

**The argument that works, and that the inspector makes on the spot:** *the 5% is only charged if
you actually sell. Zero risk. And the buyer is verified and will definitely pay you.*

If seller collection proves difficult in the pilot, the fallback is **0% seller fee in MVP**,
with the company taking ~1% net — thin but survivable. Raise it again once sellers see the
value. Do not raise it above 5% before 500 completed sales.

---

## 3. Success fees only exist when money moves

| Outcome | Buyer pays | Seller pays | Dealer gets | Company gets |
|---|---|---|---|---|
| Sale completes | bid + 5% | 5% | bid + 4% bonus | 6% |
| Inspector is honest, buyer rejects the item | bid only | 0 | **70% of bid** | inspection share only |
| Seller is a fraud / refuses to cooperate | bid only | 0 | **70% of bid** | inspection share only |
| Price exceeds buyer's limit | bid only | 0 | **70% of bid** | inspection share only |
| Inspector did not show up | nothing | 0 | 0 | 0 |
| Inspector felt unsafe and left | bid only | 0 | **100% of bid** | inspection share only |
| **Anything where no money moves** | — | — | **no 4% bonus** | **no 5%, no 5%** |

The last row is the one that matters. If there is no sale, there is no success fee from either
side and no dealer bonus. Structurally enforced in the database — see `docs/06` §3.

---

## 4. How money moves

Only the **fees** pass through the platform. The purchase amount goes directly from buyer to
seller, with the inspector watching.

```
Buyer  ── Rs 150,000 ──────────────────►  Seller     (inspector present, on camera)
Buyer  ── Rs   1,500  inspection bid ──►  Platform   (direct to dealer, full amount)
Buyer  ── Rs   7,500  5% fee ──────────►  Platform
Seller ── Rs   7,500  5% fee ──────────►  Platform   (inspector collects on-site)

Platform pays dealer the 1,500 bid + 6,000 bonus. Keeps 9,000 of the 15,000 in fees.
```

The platform provider costs ~3.5% of the Rs 15,000 in fees, not of the Rs 150,000 sale. That is
the whole reason the purchase amount does not come to us.

The inspector collects the seller's fee at the visit. That is workable because the inspector is
standing there anyway.

---

## 5. The bid mechanic

### 5.1 Buyer side

The buyer sets the bid. Before they commit, we show the range so they neither lowball nor
overspend.

**The suggested range is distance only** (`packages/domain/src/bid.ts`):

```
normal = Rs 30 × km          (km = seller-to-dealer range = the search radius, max 50 km)
band   = normal ±15%

 50 km → Rs 1,500 normal → Rs 1,275 – Rs 1,800
 15 km → Rs   450 normal → Rs   383 – Rs   540
 10 km → Rs   300 normal → Rs   255 – Rs   360
```

One rate, no category or declared-value maths: what the item *is* never changes the fair range,
only how far the dealer has to travel.

```
┌─────────────────────────────────────────┐
│  What will you pay the inspector?       │
│                                         │
│      Rs 1,500                            │
│      ──────────────●────                 │
│                                         │
│  Typical for this check in Lahore:       │
│  Rs 1,400 – Rs 1,800                     │
│                                         │
│  Includes:                               │
│    Visit seller · 14-point inspection    │
│    Photos + video of every check         │
│    Live video call with you              │
│    Written report                        │
└─────────────────────────────────────────┘
```

The buyer also sets, separately:
- The maximum price they will pay the **seller** (hard ceiling — the inspector cannot go above it)
- Optionally, the price they want to negotiate down to

### 5.2 Dealer side

The dealer sees everything needed to decide before accepting:

```
┌──────────────────────────────────────────┐
│  Rs 1,500 · 2.3 km away · Johar Town     │
│  Typical: Rs 1,400 – Rs 1,800           │
├──────────────────────────────────────────┤
│  Used iPhone 15 Pro 256GB               │
│  Seller listed at Rs 150,000             │
│  Buyer's ceiling: Rs 145,000             │
│  Negotiation: enabled, target Rs 140,000 │
├──────────────────────────────────────────┤
│  Check these 14:                         │
│  ✓ IMEI read + matches box               │
│  ✓ Battery health                        │
│  ✓ Both cameras                          │
│  ✓ Display, dead pixels                  │
│  ✓ Face ID                               │
│  ✓ Speakers and mic                      │
│  ✓ Charging port                         │
│  ✓ Physical damage, all sides            │
│  ✓ Parts replaced?                       │
│  ✓ Accessories present                   │
│  ✓ Compare against the listing photos    │
├──────────────────────────────────────────┤
│   [ Accept ]   [ Counter ]   [ No ]      │
└──────────────────────────────────────────┘
```

- **Accept** → the buyer is charged the Rs 1,500 in the app → the dealer sees a **paid** job and
  the go-ahead.
- **Counter** → one counter-offer allowed, inside the suggested band.
- **No** → pick a reason. Declining for safety or qualification is never penalised.

### 5.3 Guardrails against a race to the bottom

Two, both light:
1. The buyer always sees the suggested range before bidding.
2. The dealer always sees how the bid compares to typical.

If we later see a median bid below the band floor, we raise the floor rather than letting the
market find it.

---

## 6. Value limit for version 1

Phones, laptops, furniture and appliances up to **Rs 500,000**.

No cars, no property. Both need a different product — registration transfer, tenancy
agreements, much larger liability per rupee — and both need a lawyer-reviewed flow before we
touch them. Cars come in version 2.

---

## 7. No custody

The platform never holds the buyer's purchase money. It handles only the inspection bid and the
two success fees. This is deliberate: it keeps the platform outside money transmission, and it
means the provider charges us 3.5% of Rs 15,000 instead of 3.5% of Rs 150,000.

---

## 8. What still needs a lawyer (does not block the build)

| Question | Blocks |
|---|---|
| Is a short task-fee hold "stored value" under SBP rules? | Finance go-live |
| Does charging both sides of a transaction make us a marketplace under consumer law? | Marketing claims, liability wording |
| FBR withholding on dealer bids and bonuses | Finance |
| Sales tax on the success fee | Finance |
| Are the dealers contractors or workers? | Bond, reserve, payout design |

Build the product. Get these answered in parallel. `docs/08` §5.1 has the full list.