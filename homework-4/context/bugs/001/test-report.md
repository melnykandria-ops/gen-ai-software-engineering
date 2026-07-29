# Test Report — Bug 001 (giftcard demo)

*Stage 6 — Unit Test Generator. Applies `skills/unit-tests-FIRST.md`. Generates
FIRST-compliant unit tests for the code changed in
`context/bugs/001/fix-summary.md` (Stage 4 — Bug Fixer) and runs them.*

`tests/behavior.test.js` (the characterization suite from Stage 5) was **not
modified** — only read for context. Three new files were added, one per
changed module.

---

## Tests Added

| File | Covers | Changed module |
|---|---|---|
| `tests/discount.test.js` | Happy path (0%, 50%, 100% off); boundaries (percentOff exactly 0 and exactly 100, `priceMinor` = 0, negative `percentOff` below the documented range); **BUG-1 regression** — fractional results (999¢ @ 15% → 849, plus a `Number.isInteger` assertion and a half-up rounding case) are rounded to whole minor units; **BUG-3 regression** — `percentOff` above 100 (150, 500) is clamped so the price floors at 0 and never goes negative. 11 tests. | `src/discount.js` → `calculatePrice()` |
| `tests/validate.test.js` | Happy path (far-future expiry valid, far-past expiry invalid, empty code always invalid); boundaries (expiry exactly equal to `now`, one ms after, one ms before — a strict `>` comparison); **BUG-2 regression** — the previously-inverted comparison: a future-dated coupon must be valid, an expired one must be invalid. A **fixed `now`** (`new Date('2026-01-01T00:00:00Z')`) is injected into every call — the real system clock is never touched. 8 tests. | `src/validate.js` → `isCouponValid()` |
| `tests/auth.test.js` | Happy path (correct `ADMIN_TOKEN` from env matches, wrong token is rejected); boundaries (`ADMIN_TOKEN` unset, `ADMIN_TOKEN` set to empty string, non-string `provided` values — `undefined`/number/`null` — must return `false` instead of throwing, and length-mismatched strings); **SEC-1 regression** — the old hardcoded literal `'s3cr3t-admin-2024'` no longer authenticates, both when `ADMIN_TOKEN` is unset and when it's set to a different value. Each test saves/restores `process.env.ADMIN_TOKEN` itself via a local `withAdminToken()` helper (no shared mutable state across tests), plus a final cleanup test that restores the pre-suite env value. 9 tests. | `src/auth.js` → `verifyAdminToken()` |

`src/index.js` was intentionally **not** given its own test file — per
`fix-summary.md`, it is a thin CLI dispatcher with no independent defect and
was not touched by the Bug Fixer, so it is out of scope for "changed code
only" per the FIRST skill's Timely rule.

**Total new tests: 28** (11 + 8 + 9), added alongside the 5 pre-existing
characterization tests in `tests/behavior.test.js` for **33 tests overall**.

---

## FIRST Compliance

| Letter | Principle | Evidence |
|---|---|---|
| **F — Fast** | No network, disk, sleeps, or real timers anywhere in the three new files; every test calls a pure function (`calculatePrice`, `isCouponValid`, `verifyAdminToken`) directly with in-memory arguments. Full 33-test suite ran in `duration_ms: 257.5` (run 1) and `246.2` (run 2) — well under a second. |
| **I — Independent** | No test depends on another's outcome or run order. `auth.test.js` is the only file touching shared state (`process.env.ADMIN_TOKEN`); every test there uses a local `withAdminToken(value, fn)` helper that saves the prior value and restores it in a `finally` block, so tests can run alone or in any order without leaking state. Verified: each of the three new files was run individually (`node --test tests/discount.test.js`, `tests/validate.test.js`, `tests/auth.test.js`) and each passed in full isolation (11/11, 8/8, 9/9 — see Run Result). |
| **R — Repeatable** | No test calls `Date.now()` or `Math.random()`. `validate.test.js` injects a single fixed reference instant, `FIXED_NOW = new Date('2026-01-01T00:00:00Z')`, into every `isCouponValid()` call instead of relying on the function's default (`new Date()`). The full suite was run twice back-to-back; both runs report identical `# tests 33 / # pass 33 / # fail 0`. |
| **S — Self-validating** | Every test ends in an explicit `assert.equal(...)` (or `assert.equal(Number.isInteger(...), true)`) from `node:assert/strict` — a boolean pass/fail with no manual log inspection required. `node --test` exit status and the TAP `ok`/`not ok` lines are the sole verdict. |
| **T — Timely** | Coverage maps 1:1 onto the three files the Bug Fixer changed (`src/discount.js`, `src/validate.js`, `src/auth.js`), written immediately in this stage rather than deferred. Each file contains an explicit regression test named after its seeded bug (`BUG-1 regression`, `BUG-3 regression`, `BUG-2 regression` ×2, `SEC-1 regression` ×2) in addition to happy-path and boundary coverage. |

---

## Run Result

Command: `cd /Users/Andrew/Desktop/gen-ai-software-engineering/homework-4 && node --test tests/`

```
1..33
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 257.541583
```

Re-run for repeatability (`R` check): second invocation also reported
`# tests 33 / # pass 33 / # fail 0` (`duration_ms 246.245167`) — identical
pass/fail outcome, confirming determinism.

Per-file isolation runs (`I` check):

- `node --test tests/discount.test.js` → `# tests 11 / # pass 11 / # fail 0` (`duration_ms 168.348`)
- `node --test tests/validate.test.js` → `# tests 8 / # pass 8 / # fail 0` (`duration_ms 166.585`)
- `node --test tests/auth.test.js` → `# tests 9 / # pass 9 / # fail 0` (`duration_ms 162.268`)

`tests/behavior.test.js` (the 5 pre-existing characterization tests from
Stage 5) continues to pass unchanged and unmodified as part of the combined
run.

**Overall: PASS. 33/33 tests green, 0 failures, 0 skipped.**

---

## References

Changed files covered (from `context/bugs/001/fix-summary.md`):
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/discount.js` → `tests/discount.test.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/validate.js` → `tests/validate.test.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/auth.js` → `tests/auth.test.js`

Read, not changed:
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/index.js` (no independent defect per plan; out of scope)
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/tests/behavior.test.js` (pre-existing characterization suite; read for context only, not modified)
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/context/bugs/001/fix-summary.md` (input)
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/skills/unit-tests-FIRST.md` (applied skill)

Output written:
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/tests/discount.test.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/tests/validate.test.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/tests/auth.test.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/context/bugs/001/test-report.md` (this file)
