# 08 — Security, Privacy & Compliance

> Everything in this file marked `[LEGAL REVIEW]` requires a Pakistani technology/media lawyer
> and a chartered accountant before launch. This document is engineering guidance, not legal
> advice, and should not be presented to anyone as legal advice.

---

## 1. Threat model

| # | Threat | Asset at risk | Likelihood | Control summary |
|---|---|---|---|---|
| T1 | Credential stuffing / OTP bombing | Accounts | High | Per-number rate limit, SIM-swap detection, device binding (`05` §4) |
| T2 | Agent account resale (L2 agent sold to a stranger) | Trust, buyer funds | Medium | Device binding, IBAN title match, operationally impossible if payout account + face + city all enforced |
| T3 | Account takeover to redirect payout IBAN | Money | Medium | Step-up OTP, 24h cooling period on IBAN change, notification to old number, 2 micro-deposits or small-verification charge |
| T4 | Fabricated inspection evidence | Core product value | High | Hash + pHash + attestation + WORM (`07` §6) |
| T5 | Ledger tampering / commission mis-posting | Revenue, agent pay | Low | Double-entry DB trigger, append-only rules, reconciliation |
| T6 | Evidence exfiltration (sellers' CNICs) | PII | Medium | Restricted schema, separate DB role, RBAC, T&S brokered access with logging |
| T7 | Insider abuse by staff | Everything | Medium | Two-person approvals on money, audit chain, quarterly access review |
| T8 | API abuse / scraping the agent supply | Competitive position | Medium | Rate limits, anti-scraping on `GET /agents/:id`, signed terms |
| T9 | Media upload malware / zip bombs | Availability | Medium | Content-type allowlist, size caps, server re-encode (which also neutralises payloads), AV scan |
| T10 | SSRF via courier/PSP webhook URLs | Infrastructure | Low | No outbound fetches from user input; signed webhooks only |
| T11 | Business email compromise on ops accounts | Full platform | Medium | SSO + TOTP, no SMS-only MFA for staff, device-bound sessions |
| T12 | GPS spoofing by a malicious agent | Safety | Medium | Play Integrity + `low_accuracy_spoof` signal + impossible-travel |
| T13 | Denial of wallet by insider refund abuse | Money | Low | Refund ceilings, two-person approval above PKR 20,000, daily refund anomaly report |
| T14 | DoS during a viral buyer surge | Availability | Medium | WAF, autoscaling, queue-based side effects, graceful degradation |

---

## 2. Application security

| Layer | Control |
|---|---|
| Transport | TLS 1.3 everywhere; HSTS; certificate pinning in the mobile client (with rotation path) |
| Auth | Short-lived JWT + rotating device-bound refresh (`05` §4); step-up for sensitive ops |
| Authorisation | Server-side RBAC + ABAC. `role` plus resource ownership plus KYC tier plus clearance plus `state`. **Never trust a client-supplied role or tier.** |
| Input validation | Schema validation at the edge (JSON Schema / class-validator); parameterised SQL only; 10MB body cap |
| Injection | No string-built SQL anywhere. CSP with nonces. Output encoding in any server-rendered surface. |
| Object storage | Private buckets, presigned URLs scoped to one object and one operation, 15-minute expiry |
| Secrets | AWS Secrets Manager / Vault. No secrets in code, env files, or CI logs. Rotation quarterly. |
| Dependencies | Lockfile committed, `npm audit` + OSV + licence check in CI, weekly forced rebuilds |
| SAST/DAST** | CI on every PR; container scanning on build |
| Admin console | Separate subdomain, separate IdP, IP allowlist, session recording |
| Rate limiting | `05` §8 |

### 2.1 Step-up authentication triggers
- Payout account create/change
- KYC resubmission after rejection
- Cash-collect override above the ceiling
- Dispute above PKR 300,000
- Any finance admin operation
- Disabling a risk signal or unblocking a seller entity

---

## 3. Data security

| Data class | Storage | Access |
|---|---|---|
| CNIC/passport images | S3 with per-object KMS CMK, bucket policy denies non-TLS | Only the KYC service; T&S via time-limited brokered URL |
| CNIC numbers | Field-level envelope encryption (`pgcrypto` + KMS-wrapped data key) | KYC service only |
| Seller identity | Field-level encryption | Agent-captured, T&S-visible |
| IBAN | Field-level encryption; `iban_hash` for dedupe | Finance + payout service only |
| Evidence media | S3, private, server-managed keys | Signed, short-TTL, role-checked |
| Live recordings | S3, private, encrypted | Buyer, agent, T&S, and courts |
| Transaction state | Postgres, encrypted at rest | Application only |

- **Key rotation:** CMK rotation annually; data-key re-wrap quarterly; crypto-shredding for
  consent-based deletion of ID media.
- **Production data never leaves the production account.** Staging uses synthetic data. This
  is the single most effective control against accidental PII leakage and it is free.

---

## 4. Privacy architecture

### 4.1 Data minimisation

| Principle | Implementation |
|---|---|
| Collect only what the service needs | No address from buyers (delivery is to a courier drop or the agent's handover), no DOB beyond CNIC verification, no contacts beyond the emergency contact |
| Separated identities | Buyers' contact details are never shared with sellers. Sellers' details are shown to the agent and the buyer only as masked values. |
| Short-lived PII | Transaction contact blobs are purged 90 days after closure |
| Hash, don't keep | Seller phones are stored as HMACs; only the last 4 digits are retained in clear |
| No secondary use | Seller risk data is never sold, shared, or used for advertising |
| Purpose limitation | Evidence is retained for dispute and legal purposes only |

### 4.2 Data subject rights

Implement as self-service flows, not an email address:

| Right | Implementation |
|---|---|
| Access | `GET /me/data-export` → JSON + a human-readable summary; async job, 30-day SLA |
| Portability | Same export, machine-readable |
| Correction | Profile fields editable; legal-name correction routed to KYC re-verify |
| Deletion | `POST /me/deletion-request` → soft delete + crypto-shredding of ID media, with two exceptions (ledger and audit records, retained for legal/financial retention; transaction evidence retained where a dispute or legal hold applies) |
| Consent withdrawal | Per-channel notification consent; per-party evidence visibility |
| Objection | Automated for any processing not covered by contract |

Deletion must be honest about the exceptions. Silently retaining everything and claiming
compliance is worse than a clear explanation.

### 4.3 Retention

See `04` §14. Retention is enforced by a scheduled job with legal-hold overrides, and the job
itself writes audit rows.

### 4.4 Cross-border

- All production data in-region. Choose AWS `ap-south-1` (Mumbai) or a UAE region; Pakistan has
  no cloud region. `[LEGAL REVIEW]` — confirm that in-region-to-in-region processing avoids any
  transfer question, and document it.
- Some vendors operate outside the region (support tooling, analytics, crash reporting). Either
  self-host those in-region (recommended for analytics: Metabase over a read replica, Sentry
  self-hosted) or obtain contractual transfer safeguards. **Do not ship Google Analytics.**
  This is not a stylistic preference; it is the difference between a defensible privacy posture
  and an indefensible one.
- LiveKit: self-host the SFU in-region. Do not use a foreign managed SFU for recorded
  verification sessions involving CNIC images.

---

## 5. Compliance checklist

### 5.1 Pakistan — must be resolved before launch

| Area | Item | Status |
|---|---|---|
| Data protection | Personal Data Protection legislation status and obligations; whether any registration is required | `[LEGAL REVIEW]` |
| CNIC data | NADRA Ordinance 1980 s.4(2) approval for any CNIC verification data sharing; written data-sharing agreement required before NADRA integration | `[LEGAL REVIEW]` — **hard blocker for NADRA** |
| Sensitive personal data | CNIC, biometrics, ID images, precise location — treat as highest-sensitivity; restrict, encrypt, log access | Engineering |
| Payments | SBP perimeter: does holding a short-duration task-fee reserve constitute stored value or money transmission? Written opinion | `[LEGAL REVIEW]` — **hard blocker** |
| Payments licensing | Merchant agreements with each PSP; who is merchant of record | `[LEGAL REVIEW]` |
| Tax | Sales/service tax on the success fee; provincial variation | `[LEGAL REVIEW]` |
| Tax | FBR withholding on agent inspection bids and commission; individual vs. classification | `[LEGAL REVIEW]` |
| Tax | Withholding on refunds | `[LEGAL REVIEW]` |
| Consumer protection | Federal and provincial consumer protection acts; disclosure duties; whether the platform is a "service provider" or "seller" | `[LEGAL REVIEW]` |
| Electronic transactions | Electronic Transactions Act 2002; evidentiary value of records | `[LEGAL REVIEW]` |
| E-money | Payment Systems Act; PSP obligations we inherit by contract | `[LEGAL REVIEW]` |
| Anti-money-laundering | Proceeds of Crime Act; suspicious-transaction reporting; seller payment is buyer→seller so the direct flow materially reduces our exposure — another argument for Option A | `[LEGAL REVIEW]` |
| Telecom | PTA licensing — confirm that facilitating user-to-user video does not constitute a regulated telecom service | `[LEGAL REVIEW]` |
| Photography | Photographing people and premises; consent for seller ID capture and presence selfies | `[LEGAL REVIEW]` |
| Employment | Whether Field Agents are independent contractors or workers; withholding, benefits, and the payout-hold mechanism | `[LEGAL REVIEW]` — **risk of the earnings-reserve design in `06` §7** |
| Contracts | Buyer–platform, agent–platform, seller consent at visit, courier terms, dispute resolution, governing law (Lahore/Karachi), arbitration clause | `[LEGAL REVIEW]` |
| Insurance | Third-party liability for agents; product-in-transit cover | `[LEGAL REVIEW]` |
| IP | Listing screenshots uploaded by buyers may be third-party content; takedown process | `[LEGAL REVIEW]` |

### 5.2 International expansion

Expansion is not a technical problem; it is a licensing problem. Before entering a market:

- [ ] Local payments licensing or an authorised local PSP with marketplace settlement
- [ ] Local consumer protection and distance-selling/cooling-off rules
- [ ] Local KYC/identity regime (e.g. UAE Emirates ID, UAEPASS; India Aadhaar requires a
      registered aggregator and is legally sensitive; Nigeria BVN; Saudi Nafath)
- [ ] Local PDPL and cross-border transfer rules
- [ ] Local courier API partners and COD norms
- [ ] Local insurance partner for in-transit cover
- [ ] Local tax registration for the success fee
- [ ] Local employment classification for agents

The country pack in `09` §10 exists to make this a checklist rather than a rewrite.

---

## 6. Safety, insurance, and the honest limits of liability

State plainly in the Terms and in the UI:

- A Field Agent is an independent contractor, not an employee of the platform.
- A live video session and inspection report are **evidence of what was observed at a point in
  time**, not a guarantee of authenticity.
- The platform does not guarantee that a product is genuine, unencumbered, or as described.
- The platform's liability for a failed verification is contractually capped, subject to
  applicable law and excluding gross negligence.
- The buyer remains responsible for legal ownership of anything purchased, including exposure to
  claims that an item was stolen (`00` §3 C7).

Banned marketing language: `guaranteed`, `100% verified`, `fraud-proof`, `buyer protection`,
`escrow`, `insured purchase` (unless a real policy is bound).

---

## 7. Incident response

| Incident | Detection | Response target |
|---|---|---|
| Data breach (PII) | DLP alerts, anomaly detection | Contain < 1h; legal notified per applicable law; affected users notified |
| Credential dump / mass account take-over | Impossible-travel + login anomaly | Force re-auth, block, notify |
| Fabricated evidence wave | pHash cluster detection | Freeze affected transactions, T&S review, seller block |
| Commission mis-post | DB trigger alert (`06` §3.2) | Auto-reverse, page finance, hotfix |
| Payment provider breach | PSP notification | Migrate to secondary PSP, user notification |
| Agent safety incident | SOS | Ops playbook within 15 min, liaison within 1h |
| Courier systemic loss (region) | Tracking anomaly | Bulk claim, user comms |
| Insider compromise | Access anomaly, audit chain break | Revoke, investigate, notify |

Runbook discipline: every incident gets a postmortem within 5 working days, with a tracked
action item. The audit chain makes the postmortem factual.

---

## 8. Secure development lifecycle

```
Threat model per module (this document is the baseline)
  ↓
Design review for anything touching money, KYC, evidence, or permissions
  ↓
SAST + secret scan + licence check + dependency audit in CI (blocking)
  ↓
Automated tests: property tests on pricing (`06`), transition-table coverage (every guard must
  have both a pass and a fail test), idempotency tests, authz tests per role
  ↓
Staged rollout by install_id hash; auto-rollback on error-rate threshold
  ↓
Post-deploy: audit chain verification, reconciliation, risk-signal volume watch
```

Non-negotiable CI gates: **100% coverage of the state-transition guard table**, **100% coverage
of the commission eligibility function**, **zero high/critical SAST findings**, **zero known
secret leaks**, **signed SBOM per release**.