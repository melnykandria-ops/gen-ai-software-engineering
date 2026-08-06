# Transaction Processing Pipeline — Specification

> Produced by **Agent 1 (Specification meta-agent)** via the `/write-spec` skill
> (`.claude/commands/write-spec.md`), following `specification-TEMPLATE-hint.md`
> and the Homework-3 layered-spec approach.

---

## 1. High-Level Objective

Build a file-based multi-agent banking pipeline that takes raw transactions from
`sample-transactions.json` and routes each one through **validation → fraud
scoring → compliance checks → settlement → reporting**, landing every
transaction (accepted or rejected) in `shared/results/` with a full,
PII-safe audit trail.

## 2. Mid-Level Objectives

1. **Every input transaction reaches `shared/results/`** — exactly one result
   file per transaction, with terminal status `settled`, `rejected`, or
   `flagged_for_review`, and a `reason` field on every rejection.
2. **Invalid transactions never pass validation** — missing required fields,
   non-positive amounts, or non-ISO-4217 currencies (e.g. `XYZ`) are rejected
   at the Validator with a machine-readable reason (seeded: TXN006, TXN007).
3. **Transactions above $10,000 are flagged for fraud review with a numeric
   risk score**; structuring (just-under-threshold amounts), unusual timing
   (00:00–06:00 UTC), and cross-border transfers add to the score
   (seeded: TXN002, TXN003, TXN004, TXN005).
4. **Compliance produces CTR records for transactions > $10,000** and holds
   anything touching the account watchlist (seeded: ACC-9999 in TXN003).
5. **All agent operations are logged with ISO-8601 timestamps** to
   `shared/logs/audit.log` — agent name, transaction ID, outcome — with
   **account numbers masked** (PII never appears in plaintext).

## 3. Implementation Notes

- **Language/stack:** Python 3.11+, standard library only for the pipeline
  (`decimal`, `json`, `uuid`, `pathlib`, `datetime`); `fastmcp` for the MCP
  server; `pytest` + `pytest-cov` for tests.
- **Money:** `decimal.Decimal` everywhere — **never `float`**. Parse amounts
  from JSON strings; serialize back as strings. Rounding: `ROUND_HALF_UP`,
  2 decimal places (fee math in the Settlement agent).
- **Currency codes:** ISO 4217 whitelist (`USD, EUR, GBP, JPY, CHF, CAD, AUD,
  UAH, PLN, SEK, NOK, DKK`); anything else → validation reject.
- **Message protocol:** JSON files, one message per transaction hop:
  `{message_id (uuid4), timestamp (ISO-8601 UTC), source_agent, target_agent,
  message_type, data{...}}`. `data` always carries `transaction_id`.
- **Shared directories:** `shared/input/` (integrator drops initial messages)
  → `shared/processing/` (agent moves a message here while working) →
  `shared/output/<target_agent>/` (result for the next agent) →
  `shared/results/` (terminal outcomes). Rejections short-circuit directly to
  `shared/results/`.
- **PII:** account numbers are masked to the last 2 characters
  (`ACC-1001` → `ACC-***01`) in every log line and report; full numbers exist
  only inside message payloads on disk under `shared/` (git-ignored).
- **Audit:** every agent appends one line per decision to
  `shared/logs/audit.log`: `<ISO ts> | <agent> | <txn id> | <outcome>`.
- **Determinism for tests:** agents accept an injectable `now` and base
  directory; tests run against `tmp_path`, never the real `shared/`.

## 4. Context

**Beginning state:** `sample-transactions.json` — 8 raw records (strings for
amounts; `metadata.country` / `metadata.channel`; seeded invalids TXN006 XYZ
currency, TXN007 negative amount). No `shared/` tree, no results.

**Ending state:** `shared/results/` holds 8 result JSONs + a
`pipeline-summary.json`; `shared/logs/audit.log` holds the masked audit trail;
`python integrator.py` exits 0; test coverage **≥ 90 %** (hard gate at 80 % via
the coverage hook); MCP server can answer `get_transaction_status("TXN002")`.

## 5. Low-Level Tasks

```
Task: Transaction Validator
Prompt: "Implement agents/transaction_validator.py per specification.md §2.2/§3.
         Read messages from shared/input/, move to shared/processing/ while
         working. Validate: required fields (transaction_id, amount, currency,
         source_account, destination_account, transaction_type, timestamp);
         amount parses as Decimal and > 0; currency in the ISO-4217 whitelist.
         Valid → message to shared/output/fraud_detector/ with status
         'validated'. Invalid → terminal reject message to shared/results/ with
         a 'reason'. Support --dry-run CLI mode that only prints a validation
         table without writing. Audit-log every decision."
File to CREATE: agents/transaction_validator.py
Function to CREATE: process_message(message: dict, ctx: PipelineContext) -> dict
Details: rejects TXN006 (currency XYZ) and TXN007 (amount <= 0); passes the
         other six downstream; never uses float.

Task: Fraud Detector
Prompt: "Implement agents/fraud_detector.py per specification.md §2.3. Consume
         from shared/output/fraud_detector/. Score: amount > 10000 → +50
         (high_value); 9000 ≤ amount ≤ 9999.99 → +30 (structuring); UTC hour
         in [0,6) → +15 (unusual_timing); metadata.country != 'US' → +20
         (cross_border); channel == 'api' → +5. risk_score ≥ 50 →
         status 'flagged_for_review' (still forwarded, marked for manual
         review); else 'cleared'. Forward everything to
         shared/output/compliance_checker/ with risk_score and risk_factors[]."
File to CREATE: agents/fraud_detector.py
Function to CREATE: process_message(message: dict, ctx: PipelineContext) -> dict
Details: TXN002 → 50 (high_value), TXN003 → 30 (structuring), TXN004 → 40
         (timing+cross_border+api), TXN005 → 50; deterministic scoring table.

Task: Compliance Checker
Prompt: "Implement agents/compliance_checker.py per specification.md §2.4.
         Consume from shared/output/compliance_checker/. Rules: destination or
         source in WATCHLIST {'ACC-9999'} → status 'rejected'
         (reason 'watchlist_hit'); amount > 10000 → generate CTR record into
         data.compliance.ctr_filed = true; risk_score ≥ 50 → require review
         flag stays. Rejections → shared/results/; the rest →
         shared/output/settlement_processor/."
File to CREATE: agents/compliance_checker.py
Function to CREATE: process_message(message: dict, ctx: PipelineContext) -> dict
Details: TXN003 dies here (watchlist ACC-9999); TXN002/TXN005 get CTR records.

Task: Settlement Processor
Prompt: "Implement agents/settlement_processor.py per specification.md §2.1/§3.
         Consume from shared/output/settlement_processor/. Fees (Decimal,
         ROUND_HALF_UP): wire_transfer = 25.00 + 0.1% of amount; transfer =
         0.5% capped at 20.00; refund/deposit = 0.00. net_amount = amount -
         fee. flagged_for_review transactions are NOT settled — forwarded with
         status 'held_for_review'. Everything → shared/output/reporting_agent/
         with settlement block {fee, net_amount, batch_id, settled_at}."
File to CREATE: agents/settlement_processor.py
Function to CREATE: process_message(message: dict, ctx: PipelineContext) -> dict
Details: TXN001 fee 7.50 → net 1492.50; TXN008 fee 16.00 → net 3184.00;
         TXN004 held (flagged? no — score 40 < 50 → settled, fee 2.50 → 497.50);
         TXN002/TXN005 held_for_review (score 50).

Task: Reporting Agent
Prompt: "Implement agents/reporting_agent.py per specification.md §2.1/§2.5.
         Consume from shared/output/reporting_agent/. Write one terminal result
         JSON per transaction to shared/results/<TXN>.json (status: settled |
         held_for_review), then aggregate ALL of shared/results/ into
         pipeline-summary.json {run_at, total, settled, rejected,
         held_for_review, total_fees, by_status{}} and print a masked summary
         table to stdout."
File to CREATE: agents/reporting_agent.py
Function to CREATE: process_message(message: dict, ctx: PipelineContext) -> dict
Details: summary counts for the sample run: 8 total = 3 settled (TXN001,
         TXN004, TXN008), 2 held_for_review (TXN002, TXN005), 3 rejected
         (TXN003 watchlist, TXN006 currency, TXN007 amount).

Task: Integrator
Prompt: "Implement integrator.py per specification.md §4: create the shared/
         tree, load sample-transactions.json, wrap each record in a protocol
         message into shared/input/, run the five agents in order
         (validator → fraud → compliance → settlement → reporting), then print
         the pipeline summary and exit 0 iff every input transaction has a
         terminal result."
File to CREATE: integrator.py
Function to CREATE: run_pipeline(base_dir: Path, transactions_file: Path) -> Summary
Details: single command `python integrator.py`; idempotent (clears shared/
         stage dirs, preserves logs); exit code 1 if any transaction is lost.

Task: MCP server
Prompt: "Implement mcp/server.py with FastMCP per specification.md §4 ending
         state: tool get_transaction_status(transaction_id) → status+reason
         from shared/results/; tool list_pipeline_results() → per-transaction
         summary list; resource pipeline://summary → pipeline-summary.json
         rendered as text."
File to CREATE: mcp/server.py
Function to CREATE: get_transaction_status(transaction_id: str) -> dict
Details: reads only shared/results/ (never stages); friendly error for unknown
         transaction IDs.
```

---

### Traceability

| Mid-level objective | Owned by | Verified by |
|---|---|---|
| 1 — everything reaches results | Integrator + Reporting | integration test `test_full_pipeline` |
| 2 — invalid never passes | Validator | unit tests (TXN006/TXN007 fixtures) |
| 3 — >$10k flagged w/ score | Fraud Detector | unit tests (scoring table) |
| 4 — CTR + watchlist | Compliance Checker | unit tests (TXN002/TXN003 fixtures) |
| 5 — ISO-8601 masked audit | base.PipelineContext | unit tests (log format + masking) |
