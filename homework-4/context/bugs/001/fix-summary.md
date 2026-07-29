# Fix Summary — Bug 001 (giftcard demo)

*Stage 4 — Bug Fixer. Applies `context/bugs/001/implementation-plan.md` verbatim
to `src/`, running `node --test tests/` after each file edit.*

Scope: 3 logic bugs (BUG-1, BUG-2, BUG-3) + 1 two-part security issue (SEC-1),
across `src/discount.js`, `src/validate.js`, `src/auth.js`. `src/index.js` was
not touched (thin CLI dispatcher, no independent defect, per plan).

---

## Changes Made

### 1. `src/discount.js` — `calculatePrice()` (BUG-1 + BUG-3)

**File:** `src/discount.js`
**Location:** lines 17–21 (function body)

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

**Test result after this edit:** `node --test tests/` → BUG-1 and BUG-3 tests
flip to `ok`; BUG-2 and SEC-1 tests still failing at this point (expected,
not yet fixed).

### 2. `src/validate.js` — `isCouponValid()` (BUG-2)

**File:** `src/validate.js`
**Location:** lines 21–23 (comment + return inside `isCouponValid`)

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

**Test result after this edit:** `node --test tests/` → both BUG-2 tests flip
to `ok`; SEC-1 test still failing at this point (expected, not yet fixed).

### 3. `src/auth.js` — `verifyAdminToken()` (SEC-1, parts a + b)

**File:** `src/auth.js`
**Location:** whole file (lines 1–25 → 1–29)

**Before (full file):**
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

**Test result after this edit:** `node --test tests/` → SEC-1 test flips to
`ok`. All 5 tests now pass.

---

## Overall Status

**PASS.** All three edits applied exactly as specified in the implementation
plan, in the plan's prescribed order (discount.js → validate.js → auth.js),
with `node --test tests/` run after each file and once more at the end. No
deviations from the plan were needed — every "before" snippet matched the
live source byte-for-byte prior to editing.

Final `node --test tests/` summary:

```
TAP version 13
# Subtest: BUG-1: discounted price is a whole number of minor units
ok 1 - BUG-1: discounted price is a whole number of minor units
# Subtest: BUG-3: percentOff above 100 never yields a negative price
ok 2 - BUG-3: percentOff above 100 never yields a negative price
# Subtest: BUG-2: a future-dated coupon is valid
ok 3 - BUG-2: a future-dated coupon is valid
# Subtest: BUG-2: an expired coupon is invalid
ok 4 - BUG-2: an expired coupon is invalid
# Subtest: SEC-1: admin token is not the hardcoded literal in source
ok 5 - SEC-1: admin token is not the hardcoded literal in source
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 230.042458
```

5/5 characterization tests in `tests/behavior.test.js` pass. `ADMIN_TOKEN` was
left unset in the environment while testing, per the plan's note.

---

## Manual Verification

Exact commands a human can run to see before/after behavior:

```bash
cd /Users/Andrew/Desktop/gen-ai-software-engineering/homework-4

# 1. Run the full characterization suite (should show 5 pass / 0 fail).
node --test tests/

# 2. BUG-1 — rounding: 999 cents at 15% off should be 849, not 849.15.
node -e "console.log(require('./src/discount').calculatePrice(999, 15))"
# → 849

# 3. BUG-3 — clamp: 150% off should floor at 0, never go negative.
node -e "console.log(require('./src/discount').calculatePrice(1000, 150))"
# → 0

# 4. BUG-2 — a future-dated coupon should be valid (true), an expired one
#    should be invalid (false).
node -e "
const { isCouponValid } = require('./src/validate');
console.log(isCouponValid('CODE', '2999-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))); // → true
console.log(isCouponValid('CODE', '2000-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))); // → false
"

# 5. SEC-1 — with ADMIN_TOKEN unset, the old hardcoded literal must NOT
#    authenticate; with ADMIN_TOKEN set, only the matching value authenticates.
node -e "console.log(require('./src/auth').verifyAdminToken('s3cr3t-admin-2024'))"
# → false (ADMIN_TOKEN unset)

ADMIN_TOKEN=my-secret node -e "
const { verifyAdminToken } = require('./src/auth');
console.log(verifyAdminToken('my-secret'));      // → true
console.log(verifyAdminToken('wrong'));           // → false
console.log(verifyAdminToken('s3cr3t-admin-2024')); // → false (old literal no longer works)
"
```

---

## References

Files touched:
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/discount.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/validate.js`
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/auth.js`

Files read (not modified):
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/src/index.js` (thin CLI dispatcher, no independent defect per plan — no edit)
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/context/bugs/001/implementation-plan.md` (input plan, applied verbatim)

Output written:
- `/Users/Andrew/Desktop/gen-ai-software-engineering/homework-4/context/bugs/001/fix-summary.md` (this file)
