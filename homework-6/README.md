# Transaction Processing Pipeline

Created by **Andrii Melnyk** (@melnykandria-ops) — August 6, 2026

## System Overview

A **file-based multi-agent banking pipeline** that ingests raw transaction records from `sample-transactions.json` and routes each one through a deterministic validation → fraud scoring → compliance checking → settlement → reporting workflow. Every transaction (accepted or rejected) produces a terminal result in `shared/results/` with a full, PII-safe audit trail. All monetary arithmetic uses `decimal.Decimal` — never `float`.

The pipeline is built on a **two-layer architecture**: four **meta-agents** (specification writer, code generator, test engineer, documentation engineer) produce the system, while five **runtime agents** (the actual transaction processors) execute the pipeline. The separation ensures specification fidelity: the meta-agents follow the spec precisely, and the runtime agents can be tested, audited, and replaced independently.

## Agent Responsibilities

### Runtime agents (process transactions)
- **transaction_validator** — checks all required fields, positive amount, ISO-4217 currency; rejects invalid early.
- **fraud_detector** — scores transactions by amount, timing, geography, channel; flags ≥50 for manual review.
- **compliance_checker** — blocks watchlist accounts, generates CTR records for >$10k transactions.
- **settlement_processor** — calculates fees by type (wire 25+0.1%, transfer 0.5% capped 20, refund/deposit 0), holds flagged transactions.
- **reporting_agent** — writes terminal results to `shared/results/`, aggregates to `pipeline-summary.json`, prints masked summary.

### Meta-agents (build & maintain)
- **Agent 1 (Specification)** — produces `specification.md` via `/write-spec` skill.
- **Agent 2 (Code Generation)** — builds `integrator.py`, `agents/*.py`, `mcp/server.py`; documents ≥2 context7 research queries in `research-notes.md`.
- **Agent 3 (Testing)** — writes `tests/*` guarded by `hooks/coverage-gate.sh` (blocks push below 80% coverage).
- **Agent 4 (Documentation)** — creates `README.md` and `HOWTORUN.md` with the student's name (@melnykandria-ops).

## Architecture

```
sample-transactions.json
          |
          v
   integrator.py
          |
          +----> shared/input/ (raw messages)
                     |
                     v
          transaction_validator
                     |
                  [valid]
                     |
                     v
             shared/output/fraud_detector/
                     |
                     v
           fraud_detector
                     |
                     +---> [risk < 50] ---> shared/output/compliance_checker/
                     |
                     +---> [risk >= 50] ---> shared/output/compliance_checker/
                                            (flagged_for_review)
                                                  |
                                                  v
                                        compliance_checker
                                                  |
                                        [watchlist] --> [reject]
                                                  |
                                        [ok] --> shared/output/settlement_processor/
                                                  |
                                                  v
                                        settlement_processor
                                                  |
                                        [flagged] --> held_for_review
                                                  |
                                        [ok] --> settled
                                                  |
                                                  v
                                        shared/output/reporting_agent/
                                                  |
                                                  v
                                        reporting_agent
                                                  |
                                                  v
                                        shared/results/<TXN>.json
                                                  |
                                                  v
                                        MCP server reads (get_transaction_status)
```

**Note:** Rejections short-circuit to `shared/results/` directly from validation, compliance, or any earlier gate.

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Language** | Python 3.11+ | Runtime agents, integrator, tests |
| **Money** | `decimal.Decimal` | Exact monetary arithmetic (no float) |
| **Messaging** | JSON files | Agent-to-agent protocol in `shared/` |
| **Testing** | pytest + pytest-cov | Unit & integration tests, ≥90% target (80% gate) |
| **MCP server** | FastMCP | Query transaction status, list results, read summary |
| **MCP context** | context7 | Research library (decimal, FastMCP, pytest-cov) |
| **Audit** | ISO-8601 UTC | `shared/logs/audit.log` with PII-masked account numbers |

## Expected Results (Sample Run)

| TXN | Status | Fee | Net Amount | Reason / Notes |
|-----|--------|-----|------------|----------------|
| TXN001 | settled | $7.50 | $1492.50 | transfer (0.5% capped 20) |
| TXN002 | held_for_review | $625.00 | $24375.00 | wire >$10k, risk 50 (high_value) |
| TXN003 | rejected | — | — | watchlist_hit (ACC-9999) |
| TXN004 | settled | $2.50 | $497.50 | transfer, risk 40 (timing + cross_border + api) |
| TXN005 | held_for_review | $1875.00 | $73125.00 | wire >$10k, risk 50 (high_value) |
| TXN006 | rejected | — | — | invalid_currency (XYZ not in ISO-4217) |
| TXN007 | rejected | — | — | non_positive_amount (−100) |
| TXN008 | settled | $16.00 | $3184.00 | transfer (0.5% capped 20) |
| **TOTAL** | — | **$26.00** | — | 3 settled + 2 held + 3 rejected |

### Query via MCP Server

```bash
# Start the pipeline
python integrator.py

# List all transaction statuses (after pipeline completes)
echo '{}' | nc localhost 9000  # or via claude mcp add
```

After `python integrator.py`, the results are in `shared/results/`:
- `TXN001.json`, `TXN002.json`, … — individual transaction outcomes
- `pipeline-summary.json` — aggregated run metadata

Query example (after MCP server is running):
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_transaction_status",
    "arguments": {"transaction_id": "TXN002"}
  }
}
```

Expected response:
```json
{
  "transaction_id": "TXN002",
  "status": "held_for_review",
  "reason": "risk_score_50_ctr_filed"
}
```

## Documentation & Files

- **`specification.md`** — the spec is law; every runtime agent is defined here with exact prompts and thresholds.
- **`agents.md`** — meta-agent roles, shared rules (Decimal-only, PII masking, message protocol), and runtime agent list.
- **`research-notes.md`** — three context7 queries (Agent 2): decimal quantize, FastMCP tools/resources, pytest-cov coverage gate.
- **`HOWTORUN.md`** — step-by-step setup, pipeline run, testing, coverage gate, MCP server, slash commands.
- **`sample-transactions.json`** — 8 seed transactions (includes TXN006 invalid currency, TXN007 negative amount).

---

## Section Count

- **README.md:** 8 sections (Overview, Agent Responsibilities, Architecture, Tech Stack, Expected Results, Query via MCP, Documentation, this footer)
- **HOWTORUN.md:** 9 sections (Prerequisites, Python Setup, Run Pipeline, Dry-Run Validator, Run Tests, Coverage Gate, MCP Server, Slash Commands, Troubleshooting)
