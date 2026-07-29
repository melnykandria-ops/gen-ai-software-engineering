# ▶️ How to Run

## Prerequisites
- **Node.js ≥ 18** (uses the built-in `node --test` runner and `crypto`; zero npm dependencies).
- For running the live pipeline: the **`claude` CLI**, authenticated (`claude` ≥ 2.x).

## Run the sample app
```bash
cd homework-4
node src/index.js price 999 15     # discounted price of 999 cents, 15% off
node src/index.js valid SAVE10 2999-01-01T00:00:00Z
ADMIN_TOKEN=change-me node src/index.js admin change-me   # OK  (token from env, after the SEC-1 fix)
node src/index.js admin whatever                          # DENIED (no ADMIN_TOKEN set → fails closed)
```

## Run the tests (before/after demonstration)
```bash
node --test tests/
```
- **Before the pipeline** (seeded-bug code): all 5 characterization tests in `tests/behavior.test.js` **fail**.
- **After the pipeline**: they **pass**, plus the agent-generated suites (`tests/discount.test.js`, `tests/validate.test.js`, `tests/auth.test.js`).

## Run the 4-agent pipeline (single command)
```bash
npm run pipeline          # == bash run-pipeline.sh
# or preview the ordered stages + per-agent model without running anything:
bash run-pipeline.sh --plan
```

`run-pipeline.sh` executes each agent in order via `claude -p`, selecting the
**model declared in that agent's frontmatter** and auto-loading its **skill**
(as an appended system prompt) where one is declared. Order:

```
bug-researcher → research-verifier → bug-planner → bug-fixer → security-verifier → unit-test-generator
```

It runs the tests before (red) and after (green) and lists the produced
artifacts in `context/bugs/001/`.

> The artifacts committed to this repo (`verified-research.md`, `fix-summary.md`,
> `security-report.md`, `test-report.md`, the applied fixes, and the generated
> tests) were produced by a real run of this pipeline with Claude agents. See the
> README for the model-per-agent rationale.

## Environment
| Variable | Used by | Notes |
|----------|---------|-------|
| `ADMIN_TOKEN` | `src/auth.js` (after fix) | admin secret; unset → all admin checks deny |
