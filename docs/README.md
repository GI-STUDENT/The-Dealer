# Field Agent Marketplace — Product & Technical Specification

Pakistan-first service where a buyer **posts a bid to hire a verified local Field Agent** to
physically visit a seller (or meet the seller at the agent), verify and inspect the product,
and report back with evidence. The buyer and seller then close the deal as a separate step.

**Core proposition:** *"Can't visit the seller? Hire someone there to check it for you."*

This is **not** a product marketplace and **not** a delivery app. There are no listings, no
seller accounts, and no seller app. The product is **buyer-side physical representation**:
verification, inspection, live buyer participation, and an evidence-backed report. Delivery, if
the buyer wants it, is the last step.

---

## How to read this

**`../DECISIONS.md` is the source of truth.** It holds the confirmed business model, pricing,
and the bid mechanic. Everything in `docs/` is implementation detail, and where any file here
disagrees with `DECISIONS.md`, `DECISIONS.md` wins.

Then read `00-strategic-brief.md` (analysis and risks), then `11-open-decisions.md` — **Part A
is settled, Part B is still open.**

| # | File | Contents (maps to idea.txt §24) |
|---|---|---|
| 00 | [Strategic brief](./00-strategic-brief.md) | Verdict, unit economics, contradictions found, top-20 risk register, MVP thesis |
| 01 | [Product specification](./01-product-spec.md) | Roles & permissions, domain glossary, 8 user journeys, functional requirements, non-goals |
| 02 | [UX, screens & navigation](./02-ux-screens-navigation.md) | Information architecture, 117-screen inventory, nav map, Buyer/Agent/Admin/Transaction dashboards, copy, empty & error states |
| 03 | [State machine & business rules](./03-state-machine.md) | 34 states, transition table with guards, corrected ordering, 60 business rules, pricing rules |
| 04 | [Data model](./04-data-model.md) | Full PostgreSQL DDL: 61 tables + partitions, 33 enums, constraints, indexes, PostGIS, hash-chained audit, double-entry ledger, deferred-FK section |
| 05 | [API architecture](./05-api.md) | REST v1 surface, auth/OAuth, idempotency, error catalogue, realtime, webhook contracts |
| 06 | [Payments & commission engine](./06-payments-commission.md) | Money flows, double-entry ledger, success-fee engine pseudocode, custody option analysis, refunds, payouts |
| 07 | [Trust, fraud & safety](./07-trust-fraud-safety.md) | 4-tier KYC, ratings, 22 fraud signals, SOS, GPS/impossible-travel, offline evidence capture |
| 08 | [Security, privacy & compliance](./08-security-privacy-compliance.md) | Threat model, controls, PIPL/GDPR posture, PK legal review checklist |
| 09 | [Ops, launch & analytics](./09-ops-launch-analytics.md) | Pakistan-first deployment, courier + KYC + payment adapters, notification policy, moderation, event taxonomy, 30 edge cases |
| 10 | [Roadmap](./10-roadmap.md) | MVP / V1 / V2 / Future, explicit do-not-build list, sequencing, resourcing |
| 11 | [Open business decisions](./11-open-decisions.md) | Part A: settled. Part B: the remaining open questions, options, recommended default, consequence of each |

---

## Status of this document

- **Decided** — locked in `DECISIONS.md`, safe to build against.
- **Recommended** — my default where you have not specified; override freely.
- **Needs decision** — see `11-open-decisions.md` Part B. Blocks a specific build item.

Nothing in this spec should be read as legal, tax, or financial advice. Items marked
`[LEGAL REVIEW]` are in `08-security-privacy-compliance.md` and need a Pakistani
technology/media lawyer and a chartered accountant before launch.

### → [`../DECISIONS.md`](../DECISIONS.md)

The confirmed model, in one page: who pays what, the bid mechanic, failure outcomes, and the
five things that still need a lawyer. **Read that first.**

### → [`../tools/check_ddl.py`](../tools/check_ddl.py)

Static validator for the SQL in `04`. Run `python tools/check_ddl.py` from the repo root. It
fails on unbalanced parentheses, `REFERENCES` to a table defined later in the file, a conditional
`UNIQUE` table constraint, and a `CHECK` that names a column the table does not have. **All four
of those were present in earlier drafts and all four are real PostgreSQL errors.**

---

## The single most important conflict

The platform's hard problem is **not** technology. It is that the Field Agent is both
(a) the only verifier of the product's truth and (b) a paid participant in the deal closing,
while the buyer's success fee, the dealer's bonus, and the seller's good name all depend on the
same inspection.

The confirmed model sharpens this: **the dealer now earns more from a closed sale than from an
honest "no."** A Rs 150,000 phone pays the dealer Rs 3,000 to close and Rs 1,050 to walk away.
Every design decision in this spec — the 72-hour dispute window, the capped bonus, the
evidence immutability, the deferred success-fee trigger — is subordinate to managing that
conflict. Do not weaken any of them.