# Shared Account Access & Card Delegation — Specification

> Ingest the information from this file, implement the Low-Level Tasks, and generate the code that will satisfy the High and Mid-Level Objectives.

**Domain:** retail neobank, regulated environment (EU/UA-style).
**Feature:** an account **Owner** grants a second person (**Delegate**) scoped access to the account, including a delegated virtual card with per-delegate spending limits, and either party can end the arrangement at any time.

> **Spec provenance:** v1 was drafted, then attacked by four independent adversarial reviews (edge-case red team, compliance officer, traceability audit, "implementer without guessing" walk-through). v2 incorporates all 30+ findings. The review process itself is described in `README.md`.

---

## 1. High-Level Objective

Enable an account Owner to safely share account access and card spending with a trusted person — with **per-actor attribution of every action**, enforceable **per-delegate limits**, and **instant, friction-free exit for both sides** — so that families can share money without sharing credentials.

**Scope boundary (one sentence):** one Owner ↔ up to **5 concurrently active** Delegates on one current account; joint *ownership*, credit products, physical cards, teen accounts, and dispute resolution are **out of scope** (dispute *intake* is referenced only as an audit consumer).

---

## 2. Actors & Stakeholder Views

| Actor | View / power |
|---|---|
| **Owner** | Invite (with identity attributes), set/change tiers & limits, freeze delegate card, unfreeze **owner-initiated** freezes, revoke; sees **all activity on this account** |
| **Delegate** | Acts within granted tier (below); may **freeze own card** and **resign** (self-revoke) at any time, friction-free; sees per-tier visibility (below) |
| **Ops agent** | Read delegation state & audit trail; can freeze any delegated card (case-bound); ops/fraud freezes are lifted only by resolving the originating case — never by the Owner |
| **Compliance officer** | Read consent records, KYC evidence, audit trail; **approves/rejects `KYC_REVIEW` escalations** via a dedicated endpoint (T4); decisions audit-logged with rationale |
| **Fraud system** (automated) | Can freeze delegated cards, **suspend delegations**, and suspend in-flight invitations; every automated action carries a rule ID in audit. **Cannot revoke** (revocation is terminal and human-owned) |

**Permission tiers** (fixed enum, no custom tiers in v1). *This table is the executable fixture for O2/O6 matrix tests — it is the single source of truth for delegate visibility and powers.*

| Tier | View balance | View **all account** txns (incl. Owner's on this account) | View own card txns | Spend (card) | Freeze own card | Resign |
|---|---|---|---|---|---|---|
| `VIEWER` | ✅ | ✅ (read-only) | n/a (no card) | — | n/a | ✅ |
| `SPENDER` | ✅ | — | ✅ | ✅ within limits | ✅ | ✅ |
| `MANAGER` | ✅ | ✅ | ✅ | ✅ within limits | ✅ | ✅ |

- "View all account txns" is scoped to **this account only**. Owner data outside this account (other accounts/products) and the Delegate's KYC data are never cross-visible (O6).
- **PIN/CVV reveal is out of v1.** If added later it must use a processor-hosted session so PAN/CVV/PIN never transit this system (PCI containment, §4.2).
- Only the **Owner** invites, changes tiers/limits, and unfreezes owner-initiated freezes. Delegates cannot manage other delegates.

---

## 3. Mid-Level Objectives

Each objective is **observable**: the stated "world change" is what verification checks (§7).

| ID | Objective | Observable outcome |
|---|---|---|
| **O1** | **Invite & consent.** Owner invites a named person (phone + full name + DOB); Delegate accepts, passes KYC with an **identity match against the invite attributes**, and explicit consent of *both* parties — including a visibility disclosure to the Delegate — is recorded | A `Delegation` exists in state `ACTIVE` with two immutable `ConsentRecord`s (owner grant + delegate accept w/ visibility disclosure version); no delegation can exist without both; KYC identity mismatch can never activate |
| **O2** | **Scoped access.** Every actor (tiers **and** ops/compliance/fraud roles) can do exactly what their row allows — nothing more — across API, app, and card rails | Authorization matrix tests (**actors × endpoints**, generated from §2) pass 100%; any out-of-scope attempt returns a typed error and an audit event |
| **O3** | **Delegated card with limits.** SPENDER/MANAGER delegates receive a virtual card whose authorizations are checked against per-delegate limits (per-txn / daily / monthly) *and* account balance; limits exist from day one (mandatory at invite) | Card auths above any limit decline with reason code; approved spend never exceeds limits under concurrency (E3); a card without configured limits cannot exist |
| **O4** | **Instant, attributable exit.** Owner revokes, or Delegate resigns; new authorizations decline within a bounded propagation window; in-flight settlements still settle; the card is terminated at the processor after the settlement window | Post-revocation auth attempts decline `DELEGATION_REVOKED` ≤ 5 s after the action; pre-revocation auths settle and are attributed to the (revoked) delegation; processor card object reaches `TERMINATED` at T+30 d |
| **O5** | **Per-actor audit.** Every state change and every card authorization is attributed to exactly one actor and is reconstructible | For any transaction or state change, audit answers *who / what / when / under which delegation, tier and limit version / which rule allowed it*; daily reconciliation is green |
| **O6** | **Privacy between co-users.** Delegate never sees Owner data outside this account nor other delegates' KYC data; Owner sees all activity on this account but never the Delegate's KYC evidence | Privacy matrix tests pass; adversarial IDOR pass finds no leaks; KYC failure reasons are visible to compliance only |

---

## 4. Non-Functional Requirements & Policy

All numbers are **assumed targets** — rationale in `README.md §Rationale`. They are budgets an implementation must meet, not aspirations.

### 4.1 Performance & reliability

| # | Metric | Target | Verified / alerted by |
|---|---|---|---|
| P1 | Card authorization decision (internal budget) | **p95 ≤ 60 ms, p99 ≤ 100 ms** at 200 auth/s | T9 load test · T15 dashboard + alert |
| P2 | Limit/tier/freeze/revocation propagation to auth path | **p95 ≤ 2 s, hard max 5 s** (time-to-consistency) | T10 timed test · T15 revoke-canary |
| P3 | Invite / accept / revoke / limits API | p95 ≤ 400 ms | T3 load-test AC · T15 dashboard |
| P4 | Transaction list (paginated) | p95 ≤ 300 ms, page ≤ 50, cursor-based | T12 AC |
| P5 | Auth-path availability (fail-closed declines count as unavailability) | **99.95 %** monthly | T15 synthetic canary |
| P6 | Audit write | Same transaction as the action (**RPO = 0**) | T11 AC (E17) |
| P7 | Auth throughput | 50 auth/s sustained per account cluster, burst 200/s | T9 load test |

**Degraded-mode policy (auth path):** if **any** dependency of the authorization decision (limit engine, delegation state, card state, `ledger-svc` balance) is unreachable, **fail closed** for delegated cards — decline with `AUTH_DEPENDENCY_UNAVAILABLE`. Such declines count against the P5 availability budget (an outage is not "available"). Rationale: a Delegate's card is a *bounded-trust* instrument; availability never outranks the Owner's limit contract. Owner's own cards are out of scope.

### 4.2 Security & data handling

- **PCI DSS scope containment:** PAN/CVV/PIN never enter this system — cards are issued and stored by the processor; we hold only `card_token`, last4, expiry month/year. **PAN, CVV or PIN in any schema, log, or error message = release-blocking defect** (grep-able CI ban list).
- **Webhook authenticity:** every inbound webhook (`processor-gw`, `kyc-svc`) is verified against the sender's signing key (HMAC/signature) with timestamp-based replay protection; verification failure → reject + audit event. Idempotency alone is not authentication.
- **KYC:** Delegate must hold the same KYC tier as any account holder before activation (AMLD5-style). If the invitee is **already a verified customer** at the required tier (unexpired), verification is not re-run — the existing verified identity is bound and referenced in the `ConsentRecord`. **Ongoing due diligence:** adverse post-activation events (sanctions/PEP hit, KYC expiry) auto-suspend the delegation pending compliance review (E24).
- **Identity binding:** invites carry full name + DOB; activation requires the KYC-verified identity to match those attributes (provider match score ≥ threshold); mismatch → `KYC_FAILED(IDENTITY_MISMATCH)` (E19). Accepted delegations bind to the KYC identity, never to the phone number.
- **Authentication (Owner console):** risk-expanding actions — invite, **raise** limits, **upgrade** tier, unfreeze — require **step-up SCA** (PSD2-style). Risk-reducing actions — revoke, resign, freeze, **lower** limits, downgrade tier — must **not** require step-up.
- **Authentication (card rails):** delegated cards are **3DS-enrolled against the Delegate's identity** via `processor-gw`; challenges route to the Delegate, never the Owner (exemption logic stays at the processor).
- **Authorization:** deny-by-default; every endpoint declares required actor + tier; foreign resources return 404 (existence not leaked).
- **Data minimization between co-users:** Delegate KYC data visible only to compliance; Owner data outside this account never readable via any Delegate-scoped endpoint.

### 4.3 Audit, retention & liability

- Audit events are **append-only**, hash-chained per account, carrying actor ID, delegation ID, tier at time of action, **limit version**, request ID, and rule ID.
- `ConsentRecord`s are immutable, versioned against the exact T&C **and visibility-disclosure** text shown, retrievable by compliance ≤ 1 business day. **Material T&C changes trigger re-consent**: delegate has a 30-day grace window, then the delegation auto-`SUSPENDED` until re-accepted (E28).
- **Liability model:** delegate spend within limits is **Owner liability**; the audit trail proves "within limits at the time" via versioned limit history. **Network-forced offline overages (E10) are Owner liability**, bounded by network floor-limit rules; the `offline_overage` audit flag is the evidence artifact.
- **Retention schedule** (crypto-shred PII at expiry; rows remain):

| Record class | Retention | Legal basis |
|---|---|---|
| Audit events, consent records, limit history | 10 y after account closure | AML/audit |
| Delegate KYC evidence | 5 y after delegation ends | AMLD5 |
| Expired/cancelled invite PII (incl. invitee phone, name, DOB) | 90 d after terminal state | fraud/rate-limit window, then GDPR minimization |
| GDPR erasure requests | Recorded & fulfilled for non-mandatory data; AML-mandated data survives with the request itself logged | GDPR vs AML precedence |

---

## 5. Implementation Notes (guardrails — an agent must not violate these)

- **Money:** integer **minor units** + ISO 4217 code (`amount_minor: int64`, `currency: "EUR"`). No floats in the money path. FX spend vs limits: convert at auth-time rate, round **against** the Delegate (ceil in account currency), auth-time check is authoritative for the *decision*; settlement books actual settled amount.
- **IDs:** ULIDs for all entities (`dlg_…`, `inv_…`, `crd_…`, `aud_…`). Never expose internal sequence IDs.
- **Idempotency:** every mutating endpoint takes an `Idempotency-Key`; retries return the original result. Card auth decisions are idempotent on `(card_token, network_auth_id)`.
- **State machines, not booleans** (full transition tables; anything not listed is illegal):

| Machine | Transitions |
|---|---|
| `Invitation` | `SENT → ACCEPTED` (invitee) · `SENT → EXPIRED` (72 h timer) · `SENT/ACCEPTED/KYC_PENDING/KYC_REVIEW → CANCELLED` (Owner) · `SENT/ACCEPTED → SUSPENDED → SENT/ACCEPTED` (fraud suspend/resume) · `ACCEPTED → KYC_PENDING` (KYC started) · `KYC_PENDING → KYC_REVIEW` (provider escalation) · `KYC_PENDING/KYC_REVIEW → ACTIVE` (pass + identity match; REVIEW requires compliance approval) · `KYC_PENDING/KYC_REVIEW → KYC_FAILED(reason)` · `KYC_PENDING → KYC_FAILED(TIMEOUT)` (14 d timer; late KYC results ignored) |
| `Delegation` | `ACTIVE ⇄ SUSPENDED` (fraud/system/E8/E24/E28) · `ACTIVE/SUSPENDED → REVOKED` (Owner revoke **or** Delegate resign; terminal — new invite required) |
| `DelegatedCard` | `ACTIVE ⇄ FROZEN` (owner/delegate/ops/fraud; **freeze origin recorded**; ops/fraud freezes lifted only via case resolution) · `ACTIVE/FROZEN → TERMINATED` (revocation/resign/closure/downgrade-to-VIEWER; local declines immediate, processor termination at T+30 d after settlement window) |

- **Limit accounting:** counters per `(delegation_id, window)`; windows are **calendar-day / calendar-month in the account's timezone**. Account TZ changes take effect **at the next window boundary computed in the old TZ** (E27). Concurrency-safe flow: `reserve → capture/release` — **capture happens at settlement**, always booked against **the window of the originating reservation** (even across rollover); release on processor reversal/auth-expiry webhook, or by a **TTL reaper** (7 d default, per network auth validity). Network-permitted **over-capture** (tips, fuel) books the delta via E10 mechanics (negative counter + auto-freeze thresholds).
- **Limits are mandatory:** the invite payload carries tier + initial limits; defaults if omitted — per-txn **€200**, daily **€500**, monthly **€2 000** (assumed conservative family defaults). A card cannot be issued for a delegation without limit rows. `notification_threshold_minor` (optional, no SCA to change — it expands no risk) triggers `delegation.spend.threshold_exceeded`.
- **Error semantics:** typed codes — `PERMISSION_DENIED`, `LIMIT_EXCEEDED_{TXN|DAILY|MONTHLY}`, `DELEGATION_REVOKED`, `DELEGATION_SUSPENDED`, `AUTH_DEPENDENCY_UNAVAILABLE`, `INVITE_EXPIRED`, `SELF_DELEGATION_FORBIDDEN`, `DELEGATION_ALREADY_EXISTS`, `CARD_NOT_ALLOWED_FOR_TIER`, `RATE_LIMITED` — machine-readable, mapped to user copy in one place. Foreign resources → 404.
- **Clocks:** storage timestamps UTC ISO-8601; limit windows in account TZ; never trust client time.
- **Naming:** `snake_case` fields, `PascalCase` types, event names past-tense dot-namespaced (`delegation.card.frozen`).
- **No hard deletes:** terminal entities retained per §4.3 retention table; PII crypto-shredded at expiry.

---

## 6. Edge Cases & Failure Modes

Legend: **UX** = user-visible outcome, **A/C** = audit & compliance implication.

| # | Case | Expected behavior |
|---|---|---|
| E1 | Invite to a phone number with no app account | Invite `SENT`, deep-link onboarding; expires in 72 h. **UX:** owner sees "pending". **A/C:** invitee PII crypto-shredded 90 d after terminal state (§4.3) |
| E2 | Same invite accepted twice (double-tap / replay) | Idempotent: second accept returns the same result; one `Delegation` max. **A/C:** single consent record |
| E3 | **Two concurrent auths race one remaining €50 of daily limit** | Reservation model: exactly one wins; the loser declines `LIMIT_EXCEEDED_DAILY`. Never both approved. **A/C:** both attempts logged with reservation IDs |
| E4 | Limit lowered while an auth is in flight | Auth decides against the limit version **at reservation time**; P2 bounds the stale window. **A/C:** decision references limit version |
| E5 | Revocation/resign while auth in flight / auth'd-not-settled | If reservation predates revocation, auth may approve; settlement of pre-revocation auths **always settles** (network obligation). **UX:** "authorized payments may still complete". **A/C:** settlement flagged `post_revocation_settlement`; card → processor `TERMINATED` at T+30 d |
| E6 | Refund arrives for a delegate purchase after revocation | Credit lands on the account (money follows the account). **A/C:** refund linked to original delegation |
| E7 | Delegate fails KYC | Invitation → `KYC_FAILED`; no partial access. **UX:** owner sees neutral "could not be activated". **A/C:** full reason visible to compliance only |
| E8 | Owner's account frozen (fraud/legal) | All delegations auto-`SUSPENDED`; delegate auths decline `ACCOUNT_UNAVAILABLE` (readable reason withheld). **A/C:** cascade event links account freeze → suspensions |
| E9 | Delegate IDOR probing (foreign delegation ID, Owner's other account) | `404`. **A/C:** authz-denial event; ≥ 5/h triggers fraud review |
| E10 | Offline/deferred auth (transit, airline) exceeding limits | Network floor rules force acceptance; overage books, counter goes negative, card auto-freezes until Owner acknowledges (**ack = unfreeze = step-up SCA**, T16). **A/C:** `offline_overage` flag = liability evidence (§4.3) |
| E11 | FX spend near limit boundary | Auth-time rate, rounded against Delegate (§5); settlement at a different rate never retro-breaches (auth-time check authoritative; capture books settled amount to originating window) |
| E12 | Self-invite (owner invites own identity) | Rejected: `SELF_DELEGATION_FORBIDDEN`. **A/C:** logged (synthetic-identity probing signal) |
| E13 | Phone number recycled / SIM-swapped **before accept** | Whoever accepts must pass KYC **matching the invited name + DOB** (E19 mechanics); a different person cannot activate. Post-activation, delegation is bound to KYC identity, not phone |
| E14 | Invite/delegation fan-out abuse | ≤ 5 pending invites, ≤ 10 invites/day, **≤ 5 concurrently ACTIVE delegations** per account → `RATE_LIMITED` / `DELEGATION_ALREADY_EXISTS`. **A/C:** counter events feed fraud models (mule/structuring signal) |
| E15 | Delegate is a minor | KYC DOB gate: < 18 → `KYC_FAILED(AGE)` in v1. **A/C:** reason to compliance only |
| E16 | Owner deceased (bank notified) | Estate process (out of scope) triggers E8 cascade; nothing here may bypass estate freeze |
| E17 | Audit store write fails during an action | The action **fails** (RPO = 0): mutation returns 5xx and rolls back; auth path declines `AUTH_DEPENDENCY_UNAVAILABLE`. Money movement without audit is the one unacceptable state |
| E18 | Empty states | Zero-txn delegation, VIEWER (no card), owner with no delegations — every list endpoint defines `items: [], next_cursor: null` |
| E19 | **KYC identity mismatch** (accepted by someone other than the invited person) | `KYC_FAILED(IDENTITY_MISMATCH)`; owner notified neutrally; **A/C:** mismatch details to compliance + fraud signal |
| E20 | Approved auth never captured (merchant abandons; auth expires) | Reservation released on processor expiry webhook or 7-d TTL reaper; counters restored. **A/C:** release event links to original reservation |
| E21 | Capture exceeds reservation (tips, fuel top-up — network-permitted) | Delta books via E10 mechanics (negative counter path, auto-freeze thresholds apply). **A/C:** flagged `over_capture` |
| E22 | Second invite to an identity that already has a live delegation on this account | Activation blocked: `DELEGATION_ALREADY_EXISTS` (unique non-terminal (account, KYC identity)). Prevents double cards / doubled limits |
| E23 | **Delegate resigns** | Friction-free self-revoke → `REVOKED` (terminal); same propagation and card-termination path as owner revoke. **A/C:** GDPR Art. 7(3) — withdrawal as easy as consent |
| E24 | Adverse post-activation KYC event (sanctions/PEP hit, KYC expiry) | Auto-`SUSPENDED` + compliance case; auths decline `DELEGATION_SUSPENDED`. **A/C:** AMLD5 ongoing due diligence; resolution audit-logged with rationale |
| E25 | Owner changes tier | **Upgrade:** step-up SCA + **fresh delegate consent** (new ConsentRecord) before effect. **Downgrade:** immediate, no SCA; downgrade to VIEWER terminates the card (E5 card path). **A/C:** tier history versioned like limits |
| E26 | Owner closes the account (voluntary) | All delegations → `REVOKED` (terminal) + processor card termination **before** closure completes; closure blocks while unresolved reservations exist. **A/C:** closure cascade fully audit-linked |
| E27 | Account timezone change | Takes effect at the next window boundary computed in the **old** TZ — the current window can never shrink, extend, or replay. Fixture in §7.3 |
| E28 | Material T&C change | Re-consent flow; 30-d grace → auto-`SUSPENDED` until re-accepted; new ConsentRecord versioned against new text (§4.3) |

---

## 7. Verification

How we *know* each objective is met. Test categories are documentation of intent (no code in this homework).

### 7.1 Per-objective verification map

| Objective | Verification |
|---|---|
| **O1** | **Unit:** both state machines — every legal & illegal transition from the §5 tables, incl. timers (72 h, 14 d) and late-KYC-ignored. **Integration:** invite→accept→KYC→ACTIVE happy path; E1 E2 E7 E13 E19 E22 fixtures; KYC_REVIEW approval path with compliance actor. **Compliance checkpoint:** sample 10 delegations → 2 consent records each, T&C + visibility-disclosure versions retrievable |
| **O2** | **Matrix test: actors × endpoints** (tiers *and* ops/compliance/fraud) generated from the §2 tables — the tables are the fixture; drift fails CI. Webhook-authenticity negative tests (forged signature/replayed timestamp rejected) |
| **O3** | **Unit:** limit math incl. FX rounding (E11), window boundaries (§7.3 clock fixtures incl. E27 TZ-change), mandatory-limits guard, notification threshold. **Concurrency:** E3 exactly-one-winner, 1 000 runs in CI. **Lifecycle:** E20 release (webhook + TTL reaper), E21 over-capture. **Integration:** processor-sandbox auths incl. every decline code in §5 |
| **O4** | **Integration:** revoke & resign → auth at 0/1/2/5 s (P2); E5 settlement-after-revoke; E6 refund attribution; E8 cascade fixture (`ACCOUNT_UNAVAILABLE`); card termination at T+30 d (processor sandbox clock). **Chaos drill (documented):** kill each auth-path dependency in turn → fail-closed `AUTH_DEPENDENCY_UNAVAILABLE` (§4.1) |
| **O5** | **Reconciliation (daily):** Σ settled captures per delegation-window (booked to originating windows, E20/E21 aware) == ledger postings attributed to that delegation; mismatch pages on-call and blocks the compliance report. **Audit replay:** reconstruct a random day's delegation state purely from audit events; must equal stored state. **Chain check:** tampered-row detection |
| **O6** | **Privacy matrix test** (reads, from §2 tier table incl. per-tier txn visibility). **Adversarial review:** manual IDOR/enumeration pass on all Delegate-scoped endpoints; KYC-reason visibility checks (compliance-only) |

### 7.2 Review checkpoints (process)

1. **Spec review** — engineering + compliance sign-off on §4–§6 before build; compliance explicitly signs the liability model incl. offline-overage clause (§4.3) and E5/E10/E24 behavior.
2. **Threat-model session** — STRIDE on invite flow, auth path, and webhooks; output feeds new E-rows.
3. **Pre-launch compliance review** — consent + disclosure records, KYC evidence retrieval drill (≤ 1 business day), audit replay demo, retention-schedule walkthrough (§4.3).
4. **Post-launch** — reconciliation (O5) green 14 consecutive days before raising the default limits.

### 7.3 Data fixtures (named, reused across suites)

- `owner_olena` (account EUR, TZ Europe/Kyiv) · `delegate_dmytro` (SPENDER, 100/day, 1 000/month) · `delegate_iryna` (VIEWER, no card) · `delegate_taras` (MANAGER, card frozen by fraud — owner unfreeze must fail).
- Limit-boundary set: spend at exactly limit, ±0.01, FX at boundary; mandatory-limits-missing negative fixture.
- Clock fixtures: window rollover at account-TZ midnight; DST transition day; **E27 TZ-change day (Kyiv → Los Angeles)**.
- Identity fixtures: E19 mismatch (invited "Olena Shevchenko 1990-01-01", KYC returns different person); E22 duplicate identity.

---

## 8. Context

### 8.1 Beginning context (hypothetical but binding)

- Core ledger service (`ledger-svc`): accounts, balances, postings — **we never write postings directly**, only via its API.
- Card processor integration (`processor-gw`): virtual card issuance/termination, **signed** auth webhooks (`POST /webhooks/authorization`), reversal/expiry webhooks, settlement events, 3DS enrolment. PAN/CVV/PIN live there.
- KYC service (`kyc-svc`): async verification with **signed** result webhooks, identity-match scores, adverse-event (sanctions/PEP/expiry) notifications.
- Auth/identity platform: OAuth2 + step-up SCA primitive.
- **Nothing about delegation exists**: no tables, no endpoints, no events.

### 8.2 Ending context (deliverables of the build)

- `delegation-svc` (new): owns `Invitation`, `Delegation`, `ConsentRecord`, `DelegateLimit` (+ versioned history incl. tier changes + `notification_threshold_minor`), `LimitReservation`, `DelegatedCard` state, hash-chained `AuditEvent`.
- Auth-decision hook registered in `processor-gw` webhook chain (delegated-card path only).
- Events published: `delegation.invited/activated/suspended/resumed/revoked`, `delegation.limit.changed`, `delegation.tier.changed`, `delegation.card.frozen/unfrozen/terminated`, `delegation.auth.approved/declined`, `delegation.spend.threshold_exceeded`.
- Dashboards + alerts wired to **P1–P7** (§4.1); revoke-canary for P2; reconciliation status.
- Runbooks: propagation breach (P2), reconciliation mismatch, offline-overage spike, adverse-KYC surge (E24).

---

## 9. Low-Level Tasks

> Ordered for execution. Every task names its objective(s) and ends with acceptance criteria (**AC**) an implementer can check off.

### T1. Domain model & state machines *(O1, O5)*
- **Prompt:** "Create the delegation domain model: `Invitation`, `Delegation`, `ConsentRecord`, `DelegateLimit` + history, `LimitReservation`, `DelegatedCard`, `AuditEvent`, with the three state machines exactly as tabled in §5. Enforce transitions in code; illegal transitions throw typed errors; timers (72 h invite, 14 d KYC, 7 d reservation TTL, T+30 d card termination) are first-class."
- **File:** `src/domain/delegation/model.{lang}` · **Create:** entity types + `InvitationStateMachine`, `DelegationStateMachine`, `CardStateMachine`
- **AC:** unit tests cover every legal and illegal transition incl. timer-driven ones; late KYC result after timeout is ignored; model has zero framework imports.

### T2. Consent & disclosure records *(O1)*
- **Prompt:** "Immutable `ConsentRecord` bound to T&C version **and visibility-disclosure version** ('the Owner sees every transaction you make'); two records (owner grant + delegate accept) required before activation; re-consent flow for material T&C changes (E28: 30-d grace → SUSPENDED)."
- **File:** `src/domain/delegation/consent.{lang}` · **Create:** `recordConsent()`, activation guard, `startReconsent()`
- **AC:** activation without both consents impossible at DB-constraint level; records carry T&C hash + disclosure text version; E28 grace timer tested.

### T3. Invitation API *(O1)*
- **Prompt:** "Endpoints: create invite (owner, step-up SCA; payload = phone + **full name + DOB** + tier + initial limits + optional notification threshold), accept, cancel, get status. Enforce E1 expiry, E2 idempotency, E12 self-invite, E14 rate limits + ≤ 5 ACTIVE delegations, E22 duplicate-identity guard at activation."
- **File:** `src/api/invitations.{lang}` · **Create:** `POST/GET/DELETE /delegations/invitations`
- **AC:** E1 E2 E12 E14 E22 fixtures pass; limits mandatory (defaults applied per §5); every mutation writes audit in-transaction (E17); **p95 ≤ 400 ms under load (P3)**.

### T4. KYC integration & compliance review *(O1)*
- **Prompt:** "Start KYC on accept (short-circuit if invitee is an already-verified customer at required tier, §4.2); consume **signed** KYC webhooks (verify signature + replay protection); match verified identity against invite name+DOB (E19); route provider escalations to `KYC_REVIEW` with a compliance approve/reject endpoint; consume adverse-event webhooks → auto-SUSPEND (E24); E15 age gate."
- **File:** `src/integrations/kyc.{lang}` · **Create:** `startDelegateKyc()`, `onKycResult()`, `onKycAdverseEvent()`, `POST /compliance/kyc-reviews/{id}`
- **AC:** forged/replayed webhook rejected + audited; E19 mismatch fixture never activates; KYC reasons visible to compliance only (E7); existing-customer path binds identity without re-verification; compliance decisions logged with rationale.

### T5. Authorization middleware — actor matrix *(O2, O6)*
- **Prompt:** "Deny-by-default middleware: every route declares required actor + tier; the §2 tables load as data; matrix tests generate **actors × endpoints** (tiers + ops/compliance/fraud)."
- **File:** `src/api/authz.{lang}` · **Create:** `requireActor()`, matrix loader
- **AC:** generated matrix passes 100%; foreign resources 404 (E9); denial events audited; ops/fraud/compliance rows exercised, not only tiers.

### T6. Delegated card issuance & freeze *(O3)*
- **Prompt:** "Issue a virtual card via `processor-gw` **only for SPENDER/MANAGER** delegations with limit rows present, owner-initiated; 3DS enrolment against the Delegate; freeze by owner/delegate/ops/fraud with **origin recorded**; owner unfreeze (step-up SCA) only for owner-initiated freezes; ops/fraud freezes lift only via case resolution; termination path per card machine (§5)."
- **File:** `src/services/delegated_card.{lang}` · **Create:** `issueCard()`, `freezeCard(origin)`, `unfreezeCard()`, `terminateCard()`
- **AC:** VIEWER issuance → `CARD_NOT_ALLOWED_FOR_TIER`; no PAN/CVV/PIN anywhere (CI grep); `delegate_taras` fixture: owner unfreeze of fraud freeze fails; freeze propagates within P2; 3DS challenges route to Delegate (processor sandbox).

### T7. Limits & tier configuration *(O3)*
- **Prompt:** "Owner endpoints: `PUT /delegations/{id}/limits` (raise = step-up SCA, lower = none; includes `notification_threshold_minor`, no SCA) and `PUT /delegations/{id}/tier` (upgrade = SCA + fresh delegate consent before effect; downgrade immediate; to-VIEWER terminates card, E25). Every change versioned in history."
- **File:** `src/api/limits.{lang}` · **Create:** limits + tier endpoints
- **AC:** SCA asymmetry enforced both APIs; E25 fixtures (upgrade blocks until delegate re-consents; downgrade-to-VIEWER terminates card); history row per change with actor; E4 decision-references-version testable; propagation within P2.

### T8. Limit reservation engine *(O3)* — **the concurrency core**
- **Prompt:** "Atomic `reserve → capture/release` per `(delegation_id, window)`; calendar windows in account TZ with E27 TZ-change rule; **capture at settlement, booked to the originating reservation's window**; release on reversal/expiry webhooks and 7-d TTL reaper; over-capture delta via E10 mechanics (E21); FX rounding against delegate."
- **File:** `src/domain/limits/reservation.{lang}` · **Create:** `reserve()`, `captureAtSettlement()`, `release()`, `reaperJob()`
- **AC:** E3 (1 000-run exactly-one-winner) green; E20 both release paths green; E21 over-capture books negative counter; window rollover + E27 fixtures green; capture-after-rollover lands in originating window.

### T9. Auth decision hook *(O3, O4)* — **the latency core**
- **Prompt:** "Handler for **signed** `processor-gw` auth webhooks on delegated cards: verify signature/replay; check delegation state, card state, limits (T8), `ledger-svc` balance; decide within P1; fail closed with `AUTH_DEPENDENCY_UNAVAILABLE` if **any** dependency is unreachable (§4.1); idempotent on `(card_token, network_auth_id)`."
- **File:** `src/services/auth_decision.{lang}` · **Create:** `decideAuthorization()`
- **AC:** p99 ≤ 100 ms at 200 auth/s (P1/P7 load test); forged webhook rejected; chaos test per dependency → fail-closed (§7.1-O4); every decision audited with limit version + reservation ID; `DELEGATION_SUSPENDED` returned for suspended delegations.

### T10. Revocation, resignation & suspension *(O4)*
- **Prompt:** "Owner revoke and **delegate resign** (both → REVOKED, terminal, no step-up); fraud/system suspend/resume incl. E8 cascade `suspendAll(accountId)`; E26 account-closure cascade (revoke all + terminate cards, block closure on unresolved reservations); propagation ≤ 5 s; E5 settlements continue; E6 refund attribution."
- **File:** `src/services/revocation.{lang}` · **Create:** `revokeDelegation(actor)`, `resignDelegation()`, `suspendAll()`, `onAccountClosure()`
- **AC:** timed propagation at 0/1/2/5 s for revoke **and** resign; `post_revocation_settlement` flag; E6 refund fixture attributes to revoked delegation; E8 fixture declines `ACCOUNT_UNAVAILABLE`; E26 fixture blocks closure with open reservations; REVOKED terminal.

### T11. Audit pipeline *(O5)*
- **Prompt:** "Append-only hash-chained audit written in the same transaction as every state change and auth decision; payload: actor, delegation, tier-at-time, **limit version**, rule ID, request ID; chain verifier job."
- **File:** `src/domain/audit/audit.{lang}` · **Create:** `appendAudit()`, chain verifier
- **AC:** E17 (action fails if audit write fails) for mutations **and** auth path; tampered-row detection; replay test reconstructs a day's state (§7.1-O5).

### T12. Read APIs — per-tier visibility *(O2, O6)*
- **Prompt:** "Views per the §2 tier table: VIEWER/MANAGER see **all account transactions**; SPENDER sees own card txns; all delegates see balance; owner sees everything on this account; cursor pagination ≤ 50; E18 empty payloads."
- **File:** `src/api/views.{lang}` · **Create:** `GET /delegations`, `GET /delegations/{id}/transactions`, `GET /accounts/{id}/transactions` (delegate-scoped)
- **AC:** privacy matrix (O6) passes incl. per-tier txn visibility; E18 exact; p95 ≤ 300 ms with 10 k-txn fixture (P4); no Owner data outside this account reachable (IDOR pass).

### T13. Reconciliation job *(O5)*
- **Prompt:** "Daily: Σ settled captures per delegation-window (originating-window attribution; E20 releases and E21 over-captures accounted) vs ledger postings attributed to delegations; mismatch → page + block compliance report; clean day → signed report artifact."
- **File:** `src/jobs/reconcile_delegations.{lang}` · **Create:** `reconcileDaily()`
- **AC:** seeded-mismatch fixture pages; FX-settlement day reconciles clean (no false positives — settled amounts both sides); unsettled reservations excluded.

### T14. Notification events *(O1, O3, O4)*
- **Prompt:** "Publish the §8.2 event list (versioned schemas) incl. `delegation.spend.threshold_exceeded` driven by `notification_threshold_minor` (T7)."
- **File:** `src/events/publisher.{lang}` · **Create:** schemas + publisher
- **AC:** every §8.2 event has a versioned schema + contract test; payloads carry IDs + masked last4 only.

### T15. Observability & alerting *(NFR §4.1)*
- **Prompt:** "Dashboards + alerts for **P1–P7 exactly as tabled in §4.1** (alert at 80 % of budget); synthetic auth canary 60 s; revoke-canary measuring P2; reconciliation status panel."
- **File:** `ops/dashboards/delegation.{json}` · **Create:** dashboards + alert rules
- **AC:** each §4.1 row maps to a panel + alert (checklist in PR); alerts fire under fault injection.

### T16. Offline-overage handling *(O3 — E10, E21)*
- **Prompt:** "Consume deferred/offline settlements and over-captures: book overage, drive counter negative, auto-freeze card, notify owner; owner **acknowledge = unfreeze = step-up SCA** (§4.2)."
- **File:** `src/services/offline_overage.{lang}` · **Create:** `onDeferredSettlement()`
- **AC:** E10 fixture books overage, freezes, SCA-gated ack unfreezes; `offline_overage` / `over_capture` flags present (liability evidence §4.3).

---

## 10. Traceability Matrix

| Objective | Tasks | Edge cases | Verification |
|---|---|---|---|
| O1 Invite & consent | T1 T2 T3 T4 T14 | E1 E2 E7 E12 E13 E14 E15 E19 E22 E28 | §7.1-O1, checkpoints 1–3 |
| O2 Scoped access | T5 T12 | E9 E18 | §7.1-O2 actor matrix + webhook-auth negatives |
| O3 Card & limits | T6 T7 T8 T9 T14 T16 | E3 E4 E10 E11 E20 E21 E25 E27 | §7.1-O3, P1/P7 load test |
| O4 Exit & suspension | T9 T10 T14 | E5 E6 E8 E16 E23 E24 E26 | §7.1-O4, chaos drills, P2 canary |
| O5 Audit | T1 T11 T13 | E17 | §7.1-O5, replay + reconciliation |
| O6 Privacy | T5 T12 | E9 E18 | §7.1-O6, adversarial review |

Every task maps to ≥ 1 objective; every edge case E1–E28 is owned by ≥ 1 task; every objective has a verification row; every NFR budget P1–P7 has a named verifier (§4.1 last column). Gaps in this matrix are spec bugs.
