# Codebase Research — Bug 001 (giftcard demo)

## Summary

`src/` is a 4-file Node.js CommonJS mini-app (`discount.js`, `validate.js`,
`auth.js`, `index.js`) implementing giftcard price discounting, coupon
expiry checks, and admin-token verification. Per
`context/bugs/001/bug-context.md`, the app ships with 3 seeded logic bugs and
1 seeded security issue. All four were located, and their referenced source
lines were opened and confirmed. Each defect was additionally confirmed by
direct execution (`node -e`) against the current code, and by running
`node --test tests/` against `tests/behavior.test.js`, which encodes the
correct expected behavior.

**Observed run of `tests/behavior.test.js` against current (unfixed) code:**
`# tests 5 / # pass 0 / # fail 5` — every characterization test fails, matching
the bug-context's stated "Before" state.

Two of the three logic bugs (BUG-1 and BUG-3) live on the **same single
return statement** in `discount.js` (line 20), so a fix there must address
rounding and clamping together. BUG-2 is a single inverted comparison in
`validate.js`. SEC-1 has two parts (hardcoded secret + non-constant-time
compare) in `auth.js`, both inside/adjacent to `verifyAdminToken()`.

No additional undocumented defects were found in `src/index.js` (a thin CLI
wrapper with no independent logic bugs) or elsewhere in `src/`.

---

## Findings

### BUG-1 — fractional minor units not rounded

- **File:line:** `src/discount.js:20` (function `calculatePrice`, declared line 17; bug flagged in comment at line 18)
- **Verbatim snippet:**
  ```js
  function calculatePrice(priceMinor, percentOff) {
    // BUG-1: no rounding — returns fractional minor units (e.g. 849.15 cents).
    // BUG-3: percentOff is not clamped to 0..100, so 150 yields a negative price.
    return priceMinor - (priceMinor * percentOff) / 100;
  }
  ```
- **Observed:** Executed directly — `calculatePrice(999, 15)` → `849.15` (confirmed via `node -e`, matches bug-context example exactly). Money is documented as "integer minor units (cents)" (file header comment, `src/discount.js:4`), so a fractional cent value is invalid output. Corresponding characterization test `tests/behavior.test.js:18-21` asserts `calculatePrice(999, 15) === 849` and currently fails (`849.15 !== 849`).
- **Root cause:** The return expression `priceMinor - (priceMinor * percentOff) / 100` performs plain floating-point division with no rounding step (no `Math.round`/`Math.floor` applied to the final result), so any `percentOff`/`priceMinor` pair that doesn't divide evenly by 100 yields a non-integer minor-unit amount.

### BUG-2 — inverted expiry comparison

- **File:line:** `src/validate.js:23` (function `isCouponValid`, declared line 18; bug flagged in comment at lines 21-22)
- **Verbatim snippet:**
  ```js
  function isCouponValid(code, expiryISO, now = new Date()) {
    if (!code) return false;
    const expiry = new Date(expiryISO);
    // BUG-2: comparison is inverted — this returns true for EXPIRED coupons
    // (expiry in the past) and false for still-valid ones.
    return expiry.getTime() < now.getTime();
  }
  ```
- **Observed:** Executed directly — for a coupon expiring `2999-01-01` evaluated `now = 2026-01-01` (still valid, expiry in the future), the function returns `false`; for a coupon that expired `2000-01-01` evaluated at the same `now`, it returns `true`. Both are backwards versus the JSDoc contract at `src/validate.js:16` ("`true` if ... not yet expired"). Corresponding characterization tests `tests/behavior.test.js:27-30` (future coupon expects `true`) and `tests/behavior.test.js:32-35` (expired coupon expects `false`) both currently fail with the exact opposite boolean.
- **Root cause:** The comparison operator is inverted: `expiry.getTime() < now.getTime()` is true precisely when `expiry` is in the past (i.e., **expired**), so the function returns `true` for expired coupons and `false` for valid ones — the logical negation of the intended check, which should be `expiry.getTime() > now.getTime()` (or `>=`, per spec discussion).

### BUG-3 — percentOff not clamped, allows negative price

- **File:line:** `src/discount.js:20` (same line/function as BUG-1; bug flagged in comment at line 19)
- **Verbatim snippet:** identical statement to BUG-1 above:
  ```js
  return priceMinor - (priceMinor * percentOff) / 100;
  ```
  (JSDoc at `src/discount.js:14` documents the contract: `@param {number} percentOff percentage off, 0..100` — the parameter is never validated or clamped against this documented range before use.)
- **Observed:** Executed directly — `calculatePrice(1000, 150)` → `-500` (confirmed via `node -e`, matches bug-context example exactly). Corresponding characterization test `tests/behavior.test.js:23-25` asserts `calculatePrice(1000, 150) === 0` (price should floor at zero) and currently fails (`-500 !== 0`).
- **Root cause:** `percentOff` is used directly in the arithmetic with no bounds check; there is no `Math.min`/`Math.max` clamp to the documented `0..100` range, so values `> 100` push the subtraction past zero into negative territory.

---

## SEC-1 — hardcoded admin secret + non-constant-time comparison

- **File:line:** `src/auth.js:11` (hardcoded secret) and `src/auth.js:22` (insecure comparison, inside `verifyAdminToken`, declared line 19)
- **Verbatim snippet:**
  ```js
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
  ```
- **Observed:**
  - Part (a): `ADMIN_TOKEN` is a plaintext literal `'s3cr3t-admin-2024'` committed directly in `src/auth.js:11`, not sourced from `process.env` anywhere in the file — confirmed by inspection (no `process.env` reference exists in `src/auth.js`). Executed directly — `verifyAdminToken('s3cr3t-admin-2024')` → `true`, i.e. the value visible in source control is a live working credential.
  - Part (b): `provided === ADMIN_TOKEN` (`src/auth.js:22`) is a standard JS strict-equality string comparison, which short-circuits on the first mismatched character — this leaks timing information proportional to the length of the correct-prefix match, enabling a timing attack to recover `ADMIN_TOKEN` byte-by-byte. No use of `crypto.timingSafeEqual` (or equivalent constant-time primitive) exists anywhere in `src/auth.js` or `src/`.
  - Corresponding characterization test `tests/behavior.test.js:37-41` asserts `verifyAdminToken('s3cr3t-admin-2024') === false` (i.e., after the fix, the old hardcoded literal must no longer authenticate because the real secret should come from the environment) — currently fails (`true !== false`).
- **Root cause:** (a) The secret is a compile-time constant baked into version-controlled source rather than read from an environment variable (e.g. `process.env.ADMIN_TOKEN`), so anyone with source access has the working credential. (b) The comparison uses JavaScript's native `===` on raw strings instead of a length-independent, constant-time comparison (e.g. `crypto.timingSafeEqual` on equal-length buffers), exposing an oracle for a timing side-channel attack against the token value.

---

## References

Every `file:line` touched during this investigation:

- `src/discount.js:1` — file header / `'use strict'`
- `src/discount.js:4` — doc comment: "All money is in integer minor units (cents)"
- `src/discount.js:14` — JSDoc: `@param {number} percentOff percentage off, 0..100`
- `src/discount.js:17` — `function calculatePrice(priceMinor, percentOff) {`
- `src/discount.js:18` — `// BUG-1` comment
- `src/discount.js:19` — `// BUG-3` comment
- `src/discount.js:20` — `return priceMinor - (priceMinor * percentOff) / 100;` (BUG-1 and BUG-3, same statement)
- `src/discount.js:23` — `module.exports = { calculatePrice };`
- `src/validate.js:16` — JSDoc: `@returns {boolean} true if the coupon is non-empty and not yet expired`
- `src/validate.js:18` — `function isCouponValid(code, expiryISO, now = new Date()) {`
- `src/validate.js:19` — `if (!code) return false;`
- `src/validate.js:20` — `const expiry = new Date(expiryISO);`
- `src/validate.js:21-22` — `// BUG-2` comment
- `src/validate.js:23` — `return expiry.getTime() < now.getTime();` (BUG-2)
- `src/auth.js:11` — `const ADMIN_TOKEN = 's3cr3t-admin-2024';` (SEC-1 part a)
- `src/auth.js:19` — `function verifyAdminToken(provided) {`
- `src/auth.js:20-21` — `// SEC-1 (part b)` comment
- `src/auth.js:22` — `return provided === ADMIN_TOKEN;` (SEC-1 part b)
- `src/index.js:12-14` — module wiring (`require('./discount')`, `require('./validate')`, `require('./auth')`); no independent logic bugs found here
- `src/index.js:19-22` — `price` CLI command invoking `calculatePrice` (surfaces BUG-1/BUG-3 to CLI callers)
- `src/index.js:23-26` — `valid` CLI command invoking `isCouponValid` (surfaces BUG-2 to CLI callers)
- `src/index.js:27-30` — `admin` CLI command invoking `verifyAdminToken` (surfaces SEC-1 to CLI callers)
- `tests/behavior.test.js:18-21` — characterization test for BUG-1 (currently failing)
- `tests/behavior.test.js:23-25` — characterization test for BUG-3 (currently failing)
- `tests/behavior.test.js:27-30` — characterization test for BUG-2, future coupon (currently failing)
- `tests/behavior.test.js:32-35` — characterization test for BUG-2, expired coupon (currently failing)
- `tests/behavior.test.js:37-41` — characterization test for SEC-1 (currently failing)
- `context/bugs/001/bug-context.md:10-18` — seeded bug/issue table (source of truth for expected IDs and behavior)
