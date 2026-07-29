---
name: unit-tests-FIRST
description: Use when generating unit tests so every test satisfies the FIRST principles (Fast, Independent, Repeatable, Self-validating, Timely).
---

# FIRST — Unit Test Quality Principles

Every unit test the Unit Test Generator produces MUST satisfy all five. The
`test-report.md` must include a FIRST compliance checklist confirming each.

| Letter | Principle | Concrete rule for this project | How to verify |
|--------|-----------|--------------------------------|---------------|
| **F** | **Fast** | No network, disk, sleeps, or real timers; pure function calls only. Whole suite runs in well under a second. | `npm test` wall-clock; no `setTimeout`/I/O in tests |
| **I** | **Independent** | No shared mutable state or ordering between tests; each arranges its own inputs. Any test can run alone. | Tests pass when run individually and in any order |
| **R** | **Repeatable** | Deterministic — no `Date.now()`/random; inject a fixed `now` for time-dependent code. Same result every run, any machine. | Run twice, identical output |
| **S** | **Self-validating** | Each test asserts a concrete expected value and passes/fails on its own; no manual log inspection. | Boolean pass/fail, explicit `assert` |
| **T** | **Timely** | Tests target the just-changed code (the pipeline's fixes), cover happy path + boundaries + the seeded failure mode, and are written now — not deferred. | Coverage maps to changed files only |

## Generation checklist

- [ ] One test file per changed source module, named `<module>.test.js`.
- [ ] Cover: happy path, boundary values, and the exact seeded bug (regression test).
- [ ] Inject time (`now`) for anything time-dependent — never call the real clock.
- [ ] No external deps beyond the project's test runner (`node:test`).
- [ ] Run the suite and record the result in `test-report.md` with the FIRST checklist ticked.
