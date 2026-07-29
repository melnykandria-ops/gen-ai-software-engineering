# Implementation Plan — Bug 001 (giftcard demo)

*Stage 3 — Bug Planner. Converts `research/verified-research.md` (Quality **R4**,
PASS — proceed) into an executable, per-file fix plan. Each block gives the exact
edit the Bug Fixer applies verbatim: **ID · file · location · before · after ·
rationale**. Snippets below were re-read byte-for-byte from current `src/`.*

Scope: 3 logic bugs (BUG-1, BUG-2, BUG-3) + 1 two-part security issue (SEC-1),
across `src/discount.js`, `src/validate.js`, `src/auth.js`. `src/index.js` is a
thin CLI dispatcher with no independent defect — **no edit**.

---

## BUG-1 + BUG-3 — `src/discount.js` → `calculatePrice()`

Both defects live in the same function body and are fixed by one edit.

- **File:** `src/discount.js`
- **Location:** lines 17–21 (function `calculatePrice`)

**Before:**
```js
function calculatePrice(priceMinor, percentOff) {
  // BUG-1: no rounding — returns fractional minor units (e.g. 849.15 cents).
  // BUG-3: percentOff is not clamped to 0..100, so 150 yields a negative price.
  return priceMinor - (priceMinor * percentOff) / 100;
}
```

**After:**
```js
function calculatePrice(priceMinor, percentOff) {
  // BUG-3 fix: clamp percentOff into the documented 0..100 range so values
  // above 100 can no longer drive the price negative.
  const pct = Math.min(100, Math.max(0, percentOff));
  // BUG-1 fix: round to a whole number of minor units (money is integer cents).
  return Math.round(priceMinor - (priceMinor * pct) / 100);
}
```

**Rationale:**
- **BUG-3** — `Math.min(100, Math.max(0, percentOff))` clamps `percentOff` to
  `0..100` (the range promised by the JSDoc at line 14). With `percentOff = 150`
  it becomes `100`, so `1000 - (1000 * 100)/100 = 0`; the result can never go
  negative. Clamp is applied **before** the arithmetic and rounding.
- **BUG-1** — wrapping the final expression in `Math.round(...)` returns whole
  minor units. `999 - (999 * 15)/100 = 849.15 → Math.round → 849`.
- **Verifies against tests:** `calculatePrice(999, 15) === 849` (BUG-1 test,
  lines 18–21) and `calculatePrice(1000, 150) === 0` (BUG-3 test, lines 23–25).

---

## BUG-2 — `src/validate.js` → `isCouponValid()`

- **File:** `src/validate.js`
- **Location:** lines 21–23 (comment + return inside `isCouponValid`)

**Before:**
```js
  // BUG-2: comparison is inverted — this returns true for EXPIRED coupons
  // (expiry in the past) and false for still-valid ones.
  return expiry.getTime() < now.getTime();
```

**After:**
```js
  // A coupon is valid while its expiry is still in the future.
  return expiry.getTime() > now.getTime();
```

**Rationale:** The JSDoc (line 16) promises `true` when the coupon is "not yet
expired" — i.e. the expiry instant is strictly in the future. The seeded code
used `<`, which returns `true` only for already-expired coupons (the exact
inversion the research identified). Flipping `<` → `>` restores the contract.
- **Verifies against tests:** future expiry (`2999` vs `now = 2026`) → `2999 >
  2026` → `true` (lines 27–30); expired (`2000` vs `2026`) → `2000 > 2026` →
  `false` (lines 32–35).
- The guard `if (!code) return false;` (line 19) and `const expiry = new
  Date(expiryISO);` (line 20) are correct and remain untouched.

---

## SEC-1 (parts a + b) — `src/auth.js` → `verifyAdminToken()`

Two coupled security defects — (a) hardcoded secret; (b) non-constant-time
compare — remediated by replacing the whole module. Presented as a full-file
before/after so the Fixer applies it unambiguously.

- **File:** `src/auth.js`
- **Location:** whole file (lines 1–25)

**Before (current full file):**
```js
'use strict';

/**
 * Admin authentication for privileged giftcard operations.
 *
 * NOTE: ships with an intentional SECURITY issue for the AI pipeline to find
 * and fix. See context/bugs/001/bug-context.md.
 */

// SEC-1 (part a): hardcoded secret committed to source control.
const ADMIN_TOKEN = 's3cr3t-admin-2024';

/**
 * Verify an admin token.
 *
 * @param {string} provided token supplied by the caller
 * @returns {boolean} true if the token is correct
 */
function verifyAdminToken(provided) {
  // SEC-1 (part b): plain === comparison is not constant-time (timing attack),
  // and the secret is hardcoded above instead of read from the environment.
  return provided === ADMIN_TOKEN;
}

module.exports = { verifyAdminToken };
```

**After (full file):**
```js
'use strict';

/**
 * Admin authentication for privileged giftcard operations.
 *
 * The expected admin secret is read from the ADMIN_TOKEN environment variable.
 * See context/bugs/001/bug-context.md.
 */

const crypto = require('crypto');

/**
 * Verify an admin token.
 *
 * The expected token comes from process.env.ADMIN_TOKEN — there is NO hardcoded
 * fallback. Returns false when ADMIN_TOKEN is unset/empty, when `provided` is
 * not a string, or when the two values differ in length; otherwise the compare
 * is constant-time via crypto.timingSafeEqual (no timing side-channel).
 *
 * @param {string} provided token supplied by the caller
 * @returns {boolean} true only if `provided` equals process.env.ADMIN_TOKEN
 */
function verifyAdminToken(provided) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || typeof provided !== 'string') {
    return false;
  }
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

module.exports = { verifyAdminToken };
```

**Rationale:**
- **SEC-1 (a) — secret from env, no fallback:** the source-committed literal
  `const ADMIN_TOKEN = 's3cr3t-admin-2024';` is deleted entirely. The expected
  value is now read at call time from `process.env.ADMIN_TOKEN` with **no
  hardcoded fallback**. When the env var is unset or empty, `!expected` short-
  circuits to `return false`.
- **SEC-1 (b) — constant-time compare:** `provided === ADMIN_TOKEN` is replaced
  with `crypto.timingSafeEqual`, which compares in constant time and removes the
  timing side-channel. `crypto.timingSafeEqual` throws if the two buffers differ
  in length, so a length check runs first and returns `false` on mismatch (this
  length check is itself the documented required behavior, not a leak of secret
  content beyond its length). `typeof provided !== 'string'` guards `Buffer.from`
  against non-string input.
- **Verifies against test (lines 37–41):** `node --test tests/` runs with
  `ADMIN_TOKEN` unset, so `verifyAdminToken('s3cr3t-admin-2024')` hits the
  `!expected` guard → `false`. The old hardcoded literal no longer authenticates.
- `require('crypto')` is added once at the top (after `'use strict';`); the
  `module.exports = { verifyAdminToken };` line is preserved so `src/index.js`
  wiring (line 14) stays intact.

---

## Test command

Run after **each** file edit (and once more after all edits):

```
node --test tests/
```

- **Before any fix:** `# tests 5 / # pass 0 / # fail 5`.
- **After all fixes:** all 5 characterization tests in `tests/behavior.test.js`
  pass (`# fail 0`). Do not set `ADMIN_TOKEN` in the environment when running —
  the SEC-1 test depends on it being unset.

---

## Order of application

1. **`src/discount.js`** — apply the BUG-1 + BUG-3 edit (single function
   rewrite). Run `node --test tests/`; BUG-1 and BUG-3 tests flip to pass.
2. **`src/validate.js`** — flip `<` → `>` (BUG-2). Run `node --test tests/`;
   both BUG-2 tests flip to pass.
3. **`src/auth.js`** — replace the whole file (SEC-1 a + b). Run
   `node --test tests/`; the SEC-1 test flips to pass. All 5 now pass.

The three edits are independent (different files, no shared symbols), so the
order is for incremental verification only — any order reaches the same green
state. `src/index.js` is **not** modified.
