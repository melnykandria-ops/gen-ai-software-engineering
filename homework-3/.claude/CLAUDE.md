# CLAUDE.md — Shared Account Access & Card Delegation

Retail-neobank feature: Owner grants a Delegate scoped account access + a limit-bound virtual card; either side can exit instantly. **Canonical sources: `specification.md` (the spec) and `agents.md` (agent guidelines). If this file and the spec disagree, the spec wins.**

## 1. Naming & code conventions

- Fields `snake_case`; types `PascalCase`; events past-tense dot-namespaced (`delegation.card.frozen`) — publish only names listed in spec §8.2.
- IDs are ULIDs with prefixes (`dlg_`, `inv_`, `crd_`, `aud_`). Never expose internal sequence IDs.
- Errors are typed codes from spec §5, exactly: `PERMISSION_DENIED`, `LIMIT_EXCEEDED_TXN`, `LIMIT_EXCEEDED_DAILY`, `LIMIT_EXCEEDED_MONTHLY`, `DELEGATION_REVOKED`, `DELEGATION_SUSPENDED`, `AUTH_DEPENDENCY_UNAVAILABLE`, `INVITE_EXPIRED`, `SELF_DELEGATION_FORBIDDEN`, `DELEGATION_ALREADY_EXISTS`, `CARD_NOT_ALLOWED_FOR_TIER`, `RATE_LIMITED`. Also per spec: `KYC_FAILED(reason)` (§4.2/E19), `ACCOUNT_UNAVAILABLE` (E8). Map codes to user copy in one place. Foreign/unauthorized resources return **404**, never 403.
- File layout: `src/domain/` (entities, state machines, limits) · `src/api/` (endpoints, authz middleware) · `src/services/` (card, auth decision, revocation, overage) · `src/integrations/` (kyc, processor-gw) · `src/jobs/` (reconciliation, reapers) · `src/events/` (schemas, publisher) · `ops/` (dashboards, alerts).

## 2. FinTech defaults (apply without being asked)

- **Money = integer minor units + ISO 4217 code** (`amount_minor: int64`, `currency`). Any `float`/`double`/decimal-arithmetic in a money path is a bug — flag it even if unasked. FX: convert at auth-time rate, round **against** the Delegate (ceil in account currency).
- Storage timestamps: UTC ISO-8601. Limit windows: calendar day/month in **account TZ** (TZ change per E27). Never trust client time.
- Every mutating endpoint takes an `Idempotency-Key`; retries return the original result. Auth decisions idempotent on `(card_token, network_auth_id)`.
- Audit write happens **in the same transaction** as the state change (RPO = 0); if the audit write fails, the action fails (E17).
- Routes are deny-by-default: every endpoint declares required actor + tier; matrix comes from spec §2 tables as data.
- Verify signature + timestamp replay-protection on **every** inbound webhook (`processor-gw`, `kyc-svc`) before processing; idempotency is not authentication.
- SCA asymmetry (§4.2): step-up SCA only on risk-**expanding** actions (invite, raise limits, upgrade tier, unfreeze/overage-ack). Never add SCA to revoke, resign, freeze, lower limits, downgrade, or `notification_threshold_minor` changes.

## 3. Hard prohibitions (release blockers)

- **PAN, CVV, or PIN in any schema, log, fixture, error message, or comment.** We hold only `card_token`, last4, expiry month/year. This includes PIN — no PIN reveal in v1.
- Hard deletes. Terminal entities are retained per the §4.3 retention table; PII is crypto-shredded at expiry, rows remain. Never invent a retention period.
- State booleans (`is_active`, `is_frozen`) where §5 defines a state machine (`Invitation`, `Delegation`, `DelegatedCard`). Enforce transition tables; anything not listed is illegal and throws a typed error.
- Direct ledger postings — balance/postings go through `ledger-svc` API only.
- Weakening any fail-closed path: unreachable auth-path dependency ⇒ decline `AUTH_DEPENDENCY_UNAVAILABLE` (§4.1). Never "approve on timeout", never cache past a state check, never make revocation/freeze eventually-consistent beyond P2 (p95 ≤ 2 s, hard max 5 s).
- Letting the fraud system revoke (it may only freeze/suspend), or letting the Owner lift ops/fraud freezes.

## 4. When unsure

- Cite the spec section you relied on (e.g. "§5 state table", "E10") in code comments/PR description for every non-obvious rule.
- If the spec doesn't answer it: **stop and ask.** Never invent limits, error codes, retention periods, SLO numbers, tiers, or state transitions.

## 5. Testing defaults (every PR)

- State-machine changes ship with transition tests covering every legal **and** illegal transition, including timers (72 h invite, 14 d KYC, 7 d reservation TTL, T+30 d card termination).
- Authorization/privacy matrix tests are **regenerated from the §2 tables** (actors × endpoints, incl. ops/compliance/fraud) — the tables are the fixture; drift fails CI.
- Edge-case fixtures use the exact §7.3 names: `owner_olena`, `delegate_dmytro`, `delegate_iryna`, `delegate_taras` — plus the limit-boundary, clock (DST + E27 Kyiv→LA), and identity (E19/E22) fixture sets.
- Concurrency: E3 exactly-one-winner stays green (1 000 runs in CI). CI grep for the PCI ban list (PAN/CVV/PIN patterns) blocks merge.
