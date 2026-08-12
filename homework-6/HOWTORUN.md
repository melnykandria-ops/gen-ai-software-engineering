# HOWTORUN.md — Setup & Execution Guide

## 1. Prerequisites

- **Python 3.11+** (check with `python3 --version`)
- **Node.js 16+** (for `npx` to run context7 MCP queries; `node --version`)
- **pip** (Python package manager, bundled with Python 3.11+)
- **git** (for the coverage-gate hook; `git --version`)
- A shell supporting bash (macOS, Linux, Windows WSL2)

## 2. Python Virtual Environment Setup

Create and activate a virtual environment:

```bash
cd /Users/Andrew/Desktop/gen-ai-software-engineering/homework-6

# Create .venv
python3 -m venv .venv

# Activate (macOS/Linux)
source .venv/bin/activate

# OR on Windows:
.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Expected output:
```
Successfully installed fastmcp pytest pytest-cov
```

## 3. Run the Full Pipeline

Execute the transaction processing pipeline:

```bash
python integrator.py
```

**Expected output:**

```
=== Pipeline run complete ===
total=8  settled=3  held_for_review=2  rejected=3  total_fees=26.00
OK: every input transaction reached a terminal result in shared/results/.
```

**What happened:**
- `shared/input/` ingested all 8 transactions from `sample-transactions.json`.
- Each agent processed its inbox in order: validator → fraud → compliance → settlement → reporting.
- 3 transactions settled (`TXN001`, `TXN004`, `TXN008`).
- 2 flagged for review (`TXN002`, `TXN005` — risk score ≥ 50).
- 3 rejected early (`TXN003` watchlist, `TXN006` bad currency, `TXN007` negative amount).
- Results written to `shared/results/<TXN>.json` and aggregated into `pipeline-summary.json`.
- Audit trail appended to `shared/logs/audit.log` (account numbers masked).

**Files created:**
- `shared/input/` — cleared (reusable per next run)
- `shared/processing/` — cleared
- `shared/output/` — cleared
- `shared/results/` — **8 result JSONs + pipeline-summary.json** (persists)
- `shared/logs/audit.log` — appended (persists across runs)

## 4. Dry-Run Validator (No I/O)

Validate `sample-transactions.json` without touching `shared/`:

```bash
python agents/transaction_validator.py --dry-run
```

**Expected output:** A validation table printed to stdout showing each transaction's validity and rejection reason (if invalid).

```
transaction_id | status    | reason
TXN001         | PASS      |
TXN002         | PASS      |
TXN003         | PASS      |
TXN004         | PASS      |
TXN005         | PASS      |
TXN006         | FAIL      | invalid_currency
TXN007         | FAIL      | non_positive_amount
TXN008         | PASS      |
```

## 5. Run Tests with Coverage

Run the full test suite and print coverage:

```bash
pytest tests/ -v --cov=agents --cov=integrator --cov-report=term-missing
```

**Expected output (after coverage gate passes):**

```
============ test session starts ============
...
---------- coverage: platform darwin, pytest-cov X.Y ----------
Name                                Stmts   Miss  Cover   Missing
agents/base.py                          40      2    95%
agents/transaction_validator.py         25      0   100%
agents/fraud_detector.py                30      1    97%
...
TOTAL                                  200      8    96%
============ passed in 0.25s ============
```

Coverage target: **≥ 90 %** (soft goal). Coverage gate: **≥ 80 %** (blocks `git push` below this).

### 5a. Coverage Report with HTML

Generate an HTML coverage report:

```bash
pytest tests/ --cov=agents --cov=integrator --cov-report=html
open htmlcov/index.html  # macOS; on Linux use xdg-open
```

## 6. Coverage Gate Hook

The coverage gate is a **pre-push hook** that blocks `git push` when test coverage falls below 80%.

### How it works

1. **Claude Code mode:** The hook is registered in `.claude/settings.json` as a `PreToolUse` hook on the `Bash` tool. Every `git push` command triggers it; if coverage < 80%, the push is blocked (exit code 2).

2. **Native git mode:** Link the hook as a git pre-push hook (optional):
   ```bash
   ln -s ../../hooks/coverage-gate.sh .git/hooks/pre-push
   chmod +x .git/hooks/pre-push
   ```

### Testing the hook (Claude Code mode)

Simulate what Claude Code does when you run `git push`:

```bash
# Create a mock tool call and pipe it to the hook
echo '{"tool_input":{"command":"git push origin main"}}' | bash hooks/coverage-gate.sh
```

**If coverage ≥ 80%:** Exit code 0, message "✅ Coverage gate passed…"

**If coverage < 80%:** Exit code 2, message "⛔ PUSH BLOCKED…" (Claude Code hook mode) or exit 1 (native git).

### Adjust the coverage threshold

Set the environment variable `COVERAGE_MIN` (default 80):

```bash
COVERAGE_MIN=85 pytest tests/ --cov-fail-under=85
```

Or for the hook directly:

```bash
COVERAGE_MIN=85 bash hooks/coverage-gate.sh
```

## 7. MCP Server Setup

The MCP server exposes three tools to query the pipeline results in real time:

### 7a. Add the server to Claude Code

Add `mcp.json` to your MCP configuration:

```bash
# Option 1: Via mcp.json (already created in this project)
# The file is at /Users/Andrew/Desktop/gen-ai-software-engineering/homework-6/mcp.json

# Option 2: Manual claude mcp add (alternative)
claude mcp add pipeline-status \
  --command "python3" \
  --args "mcp/server.py"
```

### 7b. Start the MCP server

```bash
cd /Users/Andrew/Desktop/gen-ai-software-engineering/homework-6
python3 mcp/server.py
```

The server listens on **stdin/stdout** (MCP transport).

### 7c. Query the server (via Claude Code)

After the pipeline has run and results are in `shared/results/`:

```json
Tool call: get_transaction_status
Input: {"transaction_id": "TXN002"}

Response:
{
  "transaction_id": "TXN002",
  "status": "held_for_review",
  "reason": "risk_score_50_ctr_filed"
}
```

Other available tools:

| Tool | Input | Output |
|------|-------|--------|
| `get_transaction_status` | `{"transaction_id": "TXN001"}` | `{"transaction_id": "TXN001", "status": "settled", "reason"?: "..."}` |
| `list_pipeline_results` | `{}` | `[{"transaction_id": "TXN001", "status": "settled", "fee": "7.50"}, …]` |
| `pipeline_summary` resource | (read `pipeline://summary`) | Text rendering of `pipeline-summary.json` |

Example queries:

```bash
# List all settled transactions
# Tool: list_pipeline_results
# Filter by status === "settled" client-side

# Check TXN003 rejection reason
# Tool: get_transaction_status
# Input: {"transaction_id": "TXN003"}
# Expected: {"transaction_id": "TXN003", "status": "rejected", "reason": "watchlist_hit"}
```

## 8. Slash Commands

Three slash commands are available in Claude Code (defined in `.claude/commands/`):

### `/write-spec`

Regenerate the specification from templates:

```
/write-spec
```

Invokes Agent 1 (Specification meta-agent) via `.claude/commands/write-spec.md`. Produces `specification.md`.

### `/run-pipeline`

Run the full pipeline and report results:

```
/run-pipeline
```

Invokes the integrator, runs all five agents, and summarizes the run.

### `/validate-transactions`

Validate `sample-transactions.json` without side effects:

```
/validate-transactions
```

Runs the validator in `--dry-run` mode, printing a table of valid/invalid transactions.

---

## 9. Troubleshooting

### Q: "ModuleNotFoundError: No module named 'fastmcp'"

**A:** Run `pip install -r requirements.txt` to install dependencies.

```bash
pip install -r requirements.txt
```

### Q: "PUSH BLOCKED — coverage X% is below the 80% gate"

**A:** Your tests don't cover enough code. Run:

```bash
pytest tests/ -v --cov=agents --cov=integrator --cov-report=term-missing
```

Look at the "Missing" column to find untested lines. Add test cases.

### Q: "python3: command not found"

**A:** Install Python 3.11+ or update your `PATH`. On macOS with Homebrew:

```bash
brew install python@3.11
# Then use: python3.11 instead of python3
```

### Q: "No result found for transaction_id 'TXN002'"

**A:** The pipeline hasn't run yet, or `shared/results/` is empty. Run:

```bash
python integrator.py
```

Then query again.

### Q: "pipeline-summary.json not found"

**A:** The MCP server reads from `shared/results/pipeline-summary.json`, which is only created after `python integrator.py` completes. Run the pipeline first.

### Q: "npx: command not found" (for context7 queries)

**A:** Install Node.js 16+ from https://nodejs.org/. Then `npx` will work.

```bash
node --version  # should be v16 or higher
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Setup venv | `python3 -m venv .venv && source .venv/bin/activate` |
| Install deps | `pip install -r requirements.txt` |
| Run pipeline | `python integrator.py` |
| Run tests | `pytest tests/ -v --cov=agents --cov=integrator` |
| Test coverage gate | `echo '{"tool_input":{"command":"git push"}}' \| bash hooks/coverage-gate.sh` |
| Validate txns (dry-run) | `python agents/transaction_validator.py --dry-run` |
| Start MCP server | `python3 mcp/server.py` |
| Query MCP | `get_transaction_status({"transaction_id": "TXN001"})` |

---

## Next Steps

1. **Understand the system:** Read `specification.md` §1–3 for the mid-level objectives and implementation notes.
2. **Build agents:** Agent 2 (Code Generation) implements `agents/*.py` per `specification.md` §5.
3. **Write tests:** Agent 3 (Testing) adds test cases to `tests/` targeting ≥90% coverage (80% gate).
4. **Run the pipeline:** `python integrator.py` and verify the expected results (README.md).
5. **Query results:** Use the MCP server or read `shared/results/` directly to inspect transaction outcomes.
