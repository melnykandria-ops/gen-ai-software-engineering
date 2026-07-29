---
name: research-quality-measurement
description: Use when writing verified-research.md to assign a standard, comparable Research Quality level to a Bug Researcher's codebase-research output.
---

# Research Quality Measurement

A rubric for grading the **quality of bug research** so every `verified-research.md`
reports quality in one comparable vocabulary. The Research Verifier MUST assign
exactly one level and justify it against the criteria below.

## Levels

| Level | Label | Meaning |
|-------|-------|---------|
| **R4** | Verified-Complete | 100% of `file:line` references resolve and every quoted snippet matches source byte-for-byte; root cause identified for every claimed bug; no unsupported claims; enough detail for a planner to act without re-reading the code. |
| **R3** | Verified-Minor-Gaps | All references resolve and snippets match, but ≤ 20% of claims lack a stated root cause or miss a secondary location; still safe to plan from. |
| **R2** | Partially-Verified | 1–2 broken/stale references **or** a mismatched snippet, **or** a claimed bug that could not be located; planner must re-check flagged items first. |
| **R1** | Unreliable | > 2 broken references, multiple mismatches, or a fabricated finding (a bug/line that does not exist); research must be redone before planning. |

## Scoring procedure

1. **Reference check** — resolve every `file:line`; mark each `resolved` / `broken`.
2. **Snippet check** — compare each quoted snippet to the current source; mark `match` / `mismatch`.
3. **Claim check** — for each claimed bug, confirm it is real and locatable; note missing root cause.
4. **Compute:**
   - any fabricated finding → **R1**;
   - > 2 broken refs or ≥ 2 snippet mismatches → **R1**;
   - 1–2 broken refs / 1 mismatch / 1 unlocatable claim → **R2**;
   - all resolve & match, minor root-cause gaps (≤ 20%) → **R3**;
   - all resolve & match, complete root causes → **R4**.
5. **Overall pass/fail:** `pass` iff level ≥ **R3** (safe to plan from); otherwise `fail`.

## Required output vocabulary

State it exactly as: `Research Quality: R<n> (<Label>) — <one-line reason>`
e.g. `Research Quality: R4 (Verified-Complete) — all 3 refs resolved, snippets matched, root causes stated.`
