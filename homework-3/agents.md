# agents.md — Agent Configuration for `delegation-svc`

> Rules of engagement for any AI coding partner implementing [`specification.md`](specification.md). The spec is the single source of truth; this file tells the agent **how to behave** while executing it. On any conflict, `specification.md` wins.

## 1. Mission & scope

The agent builds **`delegation-svc`** exactly as specified: Shared Account Access & Card Delegation for a regulated retail neobank — invitations, consent, KYC-gated activation, tiered access (`VIEWER`/`SPENDER`/`MANAGER`), delegated virtual cards with per-delegate limits, the auth-decision hook, revocation/resignation, hash-chained audit, and reconciliation (spec §8.2, tasks T1–T16). Hard boundaries the agent must never cross: **never write ledger postings directly** (balance effects go only through `ledger-svc`'s API, spec §8.1); **never handle, store, log, or transmit PAN, CVV, or PIN** (cards live at `processor-gw`; this system holds only `card_token`, last4, expiry month/year — spec §4.2); never widen scope beyond one Owner ↔ ≤ 5 active Delegates on one current account (spec §1).

## 2. Tech stack assumptions

The spec is language-agnostic. These are **replaceable assumed defaults** — swap them if the host repo dictates otherwise, but every guarantee in the right column must survive the swap.

| Layer | Assumed default | Non-negotiable guarantee it must provide |
|---|---|---|
| Service runtime | TypeScript / Node.js LTS (alt: Kotlin/JVM) | Typed domain model; state machines enforceable in code (T1) |
| Database | PostgreSQL | ACID transactions (audit-in-same-transaction, E17); DB-level constraints (two consents before activation, T2); row-level locking or serializable isolation for the reservation engine (T8/E3) |
| Event bus | Kafka or NATS | Versioned schemas + contract tests for every §8.2 event (T14) |
| API style | REST + OpenAPI, `snake_case` fields, `PascalCase` types | Typed error codes from spec §5; cursor pagination ≤ 50 (P4) |
| Webhooks in | HTTP handlers for `processor-gw` / `kyc-svc` | HMAC/signature verification + timestamp replay protection (§4.2) |
| AuthN platform | Existing OAuth2 + step-up SCA primitive (spec §8.1) | Do not build auth; consume it |
| Observability | Prometheus/Grafana-style dashboards + alerting | One panel + alert per P1–P7 row, alert at 80 % of budget (T15) |

## 3. Domain rules the agent must internalize

These are spec §5 guardrails restated as agent reflexes. Violating any one is a defect, not a style choice.

| Rule | Concretely |
|---|---|
| Money = integer minor units + ISO 4217 | `amount_minor: int64` + `currency: "EUR"`. **No floats anywhere in the money path.** |
| FX rounds **against** the Delegate | Convert at auth-time rate, **ceil** in account currency; auth-time check is authoritative for the decision; settlement books the actual settled amount (E11) |
| IDs are ULIDs | Prefixed: `dlg_…`, `inv_…`, `crd_…`, `aud_…`. Never expose internal sequence IDs |
| State machines, not booleans | `Invitation`, `Delegation`, `DelegatedCard` per the §5 transition tables; any transition not listed is illegal and throws a typed error; timers (72 h invite, 14 d KYC, 7 d reservation TTL, T+30 d card termination) are first-class |
| Limit windows = calendar day/month in **account TZ** | Storage timestamps UTC ISO-8601; never trust client time; TZ change takes effect at the next window boundary computed in the **old** TZ (E27) |
| Reservation model for limits | `reserve → capture/release`; capture at settlement, always booked to the **originating reservation's window** even across rollover (T8) |
| Idempotency everywhere | `Idempotency-Key` on every mutating endpoint; auth decisions idempotent on `(card_token, network_auth_id)` |
| No hard deletes | Terminal entities retained per the §4.3 retention table; PII crypto-shredded at expiry, rows remain |
| Limits are mandatory | A card cannot exist without limit rows; defaults per-txn €200 / daily €500 / monthly €2 000 |
| Events | Past-tense, dot-namespaced (`delegation.card.frozen`), versioned schemas, payloads carry IDs + masked last4 only |

## 4. Security & compliance constraints

| Constraint | Agent obligation |
|---|---|
| **PCI ban list** | `PAN`, `CVV`, `PIN` in any schema, log, error message, fixture, or comment = **release-blocking defect**. Maintain a grep-able CI ban list and keep it green (§4.2, T6 AC) |
| **Webhook authenticity** | Every inbound webhook (`processor-gw`, `kyc-svc`) verified against the sender's signing key with timestamp-based replay protection; failure → reject + audit event. **Idempotency alone is not authentication** (§4.2) |
| **SCA asymmetry** | Raising risk = step-up SCA (invite, raise limits, upgrade tier, unfreeze, E10 overage ack). Reducing risk = friction-free, **must not** prompt SCA (revoke, resign, freeze, lower limits, downgrade). `notification_threshold_minor` changes need no SCA — they expand no risk (§4.2, §5, T7) |
| **Deny-by-default authz** | Every route declares required actor + tier; the §2 tables load as data and generate the actors × endpoints matrix tests (T5) |
| **404, never 403** | Foreign resources return 404 — existence is not leaked (E9); every denial writes an audit event |
| **KYC data visibility** | Delegate KYC evidence and failure reasons visible to **compliance only**; Owner gets a neutral "could not be activated" (E7, O6). Owner data outside this account never readable via any Delegate-scoped endpoint |
| **Fail-closed auth path** | Any unreachable dependency (limit engine, delegation state, card state, `ledger-svc` balance) → decline `AUTH_DEPENDENCY_UNAVAILABLE`; such declines count against the P5 availability budget (§4.1) |
| **Retention** | Follow the §4.3 retention table verbatim (audit/consent/limit history 10 y; KYC evidence 5 y; invite PII 90 d after terminal state; GDPR erasure vs AML precedence). Never invent a shorter or longer period |

## 5. Testing & verification expectations

Every task ships with its tests; **the task's AC is the definition of done** — quote it, satisfy it, check it off. Spec §7 is the verification contract.

| Deliverable with every task | Requirement |
|---|---|
| State-machine unit tests | Every **legal and illegal** transition from the §5 tables, including timer-driven ones and late-KYC-ignored (T1 AC) |
| Matrix tests | **Generated from the §2 tables** (actors × endpoints; tiers *and* ops/compliance/fraud rows). The tables are the fixture — drift fails CI (O2, T5) |
| Concurrency tests | E3 exactly-one-winner at 1 000 runs in CI for the reservation engine; window rollover + E27 fixtures (T8 AC) |
| Audit-in-same-transaction proof | E17 test: if the audit write fails, the mutation returns 5xx and rolls back; auth path declines `AUTH_DEPENDENCY_UNAVAILABLE` (P6, RPO = 0) |
| Negative security tests | Forged / replay-stale webhook rejected + audited; PCI CI grep green; IDOR probes return 404 |
| NFR evidence | Where a task's AC names a budget (P1–P7), attach the load-test or timed-test result, not an assertion |
| Fixtures | Reuse the named §7.3 fixtures (`owner_olena`, `delegate_dmytro`, `delegate_iryna`, `delegate_taras`, clock/identity sets) — do not invent parallel ones |

## 6. How to treat edge cases

The **E1–E28 table (spec §6) is binding** — expected behavior there overrides any "reasonable" alternative the agent prefers. When a situation is not covered by §5/§6: **STOP and ask the human. Never guess, never silently pick a default.** A wrong guess in this domain moves money or leaks data.

Never-do list (non-exhaustive, all release-blocking):

1. **Never log PAN** (or CVV/PIN) — not in errors, not in debug output, not in test fixtures (§4.2).
2. **Never approve an authorization on dependency timeout** — fail closed with `AUTH_DEPENDENCY_UNAVAILABLE`; a decline is the correct outage behavior (§4.1).
3. **Never hard-delete** any entity — terminal states + retention + crypto-shred only (§5, §4.3).
4. **Never bypass the audit write** — money movement without audit is "the one unacceptable state" (E17); no batching, no async fallback, same transaction or the action fails.
5. **Never let availability outrank the limit contract** — a Delegate's card is a bounded-trust instrument; no cached-approve, no "temporary limit bypass", no degraded-mode allowlist (§4.1 rationale).

## 7. Working agreement

| # | Rule |
|---|---|
| 1 | **Read before build:** re-read the relevant spec section(s) plus the task's row in the §10 traceability matrix before starting any task; the task prompt in §9 names its objectives and files |
| 2 | **Quote the AC:** every PR description quotes the exact acceptance criteria being satisfied and shows the evidence (test names, load-test numbers) per item |
| 3 | **One task per PR:** T1–T16 map 1:1 to PRs; no drive-by changes to other tasks' files |
| 4 | **Traceability is live:** if scope shifts (new edge case, changed AC, new endpoint), update the §10 traceability matrix in the same PR — a gap in that matrix is a spec bug |
| 5 | **Spec conflicts are stop events:** if two spec statements appear to conflict, or an AC seems untestable, raise it — do not resolve it unilaterally |
