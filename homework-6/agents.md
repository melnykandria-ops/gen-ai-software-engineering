# agents.md — Meta-Agent Configuration (Capstone)

Four **meta-agents** build and maintain this project. They are AI workflows
(Claude Code sessions/subagents) with distinct roles, models, and guardrails.
The *runtime* pipeline agents they produce live in `agents/*.py` and are
specified in `specification.md` §5.

## The four meta-agents

| # | Meta-agent | Produces | Model | Special requirement |
|---|-----------|----------|-------|---------------------|
| 1 | **Specification** | `specification.md` | claude-opus-4-8 | invoked via the **`/write-spec` skill** (`.claude/commands/write-spec.md`) |
| 2 | **Code generation** | `integrator.py`, `agents/*.py`, `mcp/server.py` | claude-sonnet-5 | must consult **MCP context7** for framework/API docs; ≥ 2 queries documented in `research-notes.md` |
| 3 | **Unit tests** | `tests/*` | claude-sonnet-5 | guarded by the **coverage-gate hook** (`hooks/coverage-gate.sh`): push is blocked below 80 % |
| 4 | **Documentation** | `README.md`, `HOWTORUN.md` | claude-haiku-4-5 | README **must include the student's name** (Andrii Melnyk / @melnykandria-ops) |

## Shared rules (all meta-agents)

- **Spec is law.** `specification.md` §5 gives the exact prompt, file, and
  function for every runtime agent; do not invent scope.
- **Money:** `decimal.Decimal` only. A `float` touching an amount is a
  release-blocking defect.
- **PII:** account numbers are masked (`ACC-***01`) in every log line, report,
  test fixture name, and doc example.
- **Timestamps:** ISO-8601 UTC everywhere; agents accept an injectable `now`
  for deterministic tests.
- **Message protocol:** never change field names (`message_id`, `timestamp`,
  `source_agent`, `target_agent`, `message_type`, `data`) — three agents and
  the MCP server parse them.
- **Tests:** isolate from the real `shared/` via `tmp_path`; target ≥ 90 %
  coverage (hard gate 80 %).
- **When unsure:** stop and re-read the spec section; never guess thresholds
  (fraud scores, fees, watchlists are all defined in §5).

## Runtime agents produced by Agent 2

`transaction_validator` → `fraud_detector` → `compliance_checker` →
`settlement_processor` → `reporting_agent`, communicating via JSON messages in
`shared/` (see `specification.md` §3 for the protocol and directory layout).
