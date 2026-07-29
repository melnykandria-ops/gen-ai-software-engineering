# Bug Context — 001 (giftcard demo)

The `giftcard` mini-app (`src/`) ships with intentionally seeded defects for the
4-agent pipeline to research, verify, fix, security-review, and test.

## Seeded logic bugs

| ID | File | Symptom | Correct behavior |
|----|------|---------|------------------|
| **BUG-1** | `src/discount.js` → `calculatePrice()` | Returns fractional minor units (e.g. `calculatePrice(999, 15)` → `849.15`) | Round to a whole number of minor units → `849` |
| **BUG-2** | `src/validate.js` → `isCouponValid()` | Comparison inverted — **expired** coupons return `true`, valid ones return `false` | Valid (future expiry) → `true`; expired → `false` |
| **BUG-3** | `src/discount.js` → `calculatePrice()` | `percentOff > 100` produces a **negative** price (e.g. `calculatePrice(1000, 150)` → `-500`) | Clamp `percentOff` to `0..100`; result never negative |

## Seeded security issue

| ID | File | Issue | Correct behavior |
|----|------|-------|------------------|
| **SEC-1** | `src/auth.js` → `verifyAdminToken()` | (a) hardcoded secret `ADMIN_TOKEN` in source; (b) non-constant-time `===` comparison (timing attack) | Read the secret from an environment variable; compare with a constant-time function (`crypto.timingSafeEqual`) |

## How the pipeline should demonstrate before/after

- **Before:** `npm test` fails all 5 characterization tests in `tests/behavior.test.js`.
- **After:** the Bug Fixer applies the plan, the same tests pass, the Security Verifier confirms SEC-1 is remediated, and the Unit Test Generator adds FIRST-compliant suites for the changed code.
