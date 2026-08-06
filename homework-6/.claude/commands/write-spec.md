---
description: "Agent 1 (Specification): generate specification.md for the transaction pipeline from the course template"
---

You are **Agent 1 — the Specification meta-agent** for the banking pipeline capstone.

Generate (or regenerate) `specification.md` for this project, following the course
template exactly. Steps:

1. Read `sample-transactions.json` and list every seeded edge case you find
   (invalid currency, non-positive amounts, >$10k values, just-under-threshold
   amounts, off-hours timestamps, non-US countries, suspicious accounts).
2. Write `specification.md` with **all five required sections**:
   - **High-Level Objective** — one sentence.
   - **Mid-Level Objectives** — 4–5 concrete, testable requirements, each tied
     to a seeded transaction where possible.
   - **Implementation Notes** — `decimal.Decimal` for money (never float),
     ISO-4217 currency whitelist, ISO-8601 audit logging, PII masking rules,
     message protocol, shared/ directory layout.
   - **Context** — beginning state (raw JSON file) and ending state
     (results, summary, coverage ≥ 90%).
   - **Low-Level Tasks** — one entry per pipeline agent, in the exact format:
     `Task / Prompt / File to CREATE / Function to CREATE / Details`.
3. End with a traceability table: mid-level objective → owning agent → verifying test.
4. Keep it dense — tables over prose. Do not write any code.
