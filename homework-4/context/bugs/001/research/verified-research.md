# Verified Research — Bug 001 (giftcard demo)

*Stage 2 — Research Verifier. Fact-checks `research/codebase-research.md` against
the current `src/` (and the `tests/` + `context/` files it cites), resolving every
`file:line` reference, comparing every quoted snippet byte-for-byte, and rating
research quality with the `research-quality-measurement` skill.*

## Verification Summary

**Result: PASS.**

`Research Quality: R4 (Verified-Complete) — all 25 file:line refs resolve, all 4 quoted snippets match source byte-for-byte, all 3 logic bugs + 1 security issue are real/locatable with stated root causes, and both execution claims reproduced independently.`

- **References:** every `file:line` in the research (findings + References section) resolves to the current source. 0 broken.
- **Snippets:** all 4 verbatim code blocks (BUG-1, BUG-2, BUG-3, SEC-1) match the source byte-for-byte, including em-dashes and the `s3cr3t-admin-2024` literal. 0 mismatches.
- **Claims:** BUG-1, BUG-2, BUG-3, SEC-1 (parts a & b) are all real, locatable, and carry an actionable root cause. 0 fabricated/unlocatable findings.
- **Independent re-execution:** `node --test tests/behavior.test.js` → `# tests 5 / # pass 0 / # fail 5` (matches the research exactly). Direct calls reproduce `calculatePrice(999,15)=849.15`, `calculatePrice(1000,150)=-500`, future coupon→`false`, expired coupon→`true`, `verifyAdminToken('s3cr3t-admin-2024')=true` — all as the research reported.

The Bug Planner can act on this research without re-reading the source.

## Verified Claims

| # | Claim | file:line | Resolved? | Snippet match? |
|---|-------|-----------|-----------|----------------|
| 1 | `calculatePrice` declared | `src/discount.js:17` | resolved | match |
| 2 | BUG-1 comment (no rounding) | `src/discount.js:18` | resolved | match |
| 3 | BUG-3 comment (no clamp) | `src/discount.js:19` | resolved | match |
| 4 | BUG-1 & BUG-3 shared return stmt `priceMinor - (priceMinor * percentOff) / 100` | `src/discount.js:20` | resolved | match |
| 5 | "money is integer minor units (cents)" header | `src/discount.js:4` | resolved | match |
| 6 | JSDoc `percentOff percentage off, 0..100` | `src/discount.js:14` | resolved | match |
| 7 | `module.exports = { calculatePrice };` | `src/discount.js:23` | resolved | match |
| 8 | `isCouponValid` declared | `src/validate.js:18` | resolved | match |
| 9 | BUG-2 comment (inverted comparison) | `src/validate.js:21-22` | resolved | match |
| 10 | BUG-2 inverted return `expiry.getTime() < now.getTime()` | `src/validate.js:23` | resolved | match |
| 11 | JSDoc "true if ... not yet expired" | `src/validate.js:16` | resolved | match |
| 12 | `if (!code) return false;` | `src/validate.js:19` | resolved | match |
| 13 | `const expiry = new Date(expiryISO);` | `src/validate.js:20` | resolved | match |
| 14 | SEC-1(a) hardcoded secret `const ADMIN_TOKEN = 's3cr3t-admin-2024';` | `src/auth.js:11` | resolved | match |
| 15 | `verifyAdminToken` declared | `src/auth.js:19` | resolved | match |
| 16 | SEC-1(b) comment (non-constant-time) | `src/auth.js:20-21` | resolved | match |
| 17 | SEC-1(b) return `provided === ADMIN_TOKEN` | `src/auth.js:22` | resolved | match |
| 18 | require wiring (discount/validate/auth) | `src/index.js:12-14` | resolved | match |
| 19 | `price` CLI command → `calculatePrice` | `src/index.js:19-22` | resolved | match |
| 20 | `valid` CLI command → `isCouponValid` | `src/index.js:23-26` | resolved | match |
| 21 | `admin` CLI command → `verifyAdminToken` | `src/index.js:27-30` | resolved | match |
| 22 | BUG-1 test asserts `calculatePrice(999,15)===849` | `tests/behavior.test.js:18-21` | resolved | match |
| 23 | BUG-3 test asserts `calculatePrice(1000,150)===0` | `tests/behavior.test.js:23-25` | resolved | match |
| 24 | BUG-2 future-coupon test expects `true` | `tests/behavior.test.js:27-30` | resolved | match |
| 25 | BUG-2 expired-coupon test expects `false` | `tests/behavior.test.js:32-35` | resolved | match |
| 26 | SEC-1 test asserts `verifyAdminToken('s3cr3t-admin-2024')===false` | `tests/behavior.test.js:37-41` | resolved | match |
| 27 | seeded bug/issue table (source of truth) | `context/bugs/001/bug-context.md:10-18` | resolved | match |

**Snippet detail (byte-for-byte):**

- **BUG-1 / BUG-3 block** (`src/discount.js:17-21`) — matches, including the em-dash `—` in both comments and the exact spacing `- (priceMinor * percentOff) / 100`.
- **BUG-2 block** (`src/validate.js:18-24`) — matches, including `now = new Date()`, `if (!code) return false;`, both comment lines, and the `<` operator.
- **SEC-1 block** (`src/auth.js:10-22`) — matches, including the literal `'s3cr3t-admin-2024'`, the JSDoc, both SEC-1(b) comment lines, and `provided === ADMIN_TOKEN`.

## Discrepancies Found

**None.** No broken references, no snippet mismatches, no unlocatable or fabricated claims.

Two observations (not discrepancies — both are correct and non-blocking):

1. The research states line ranges for BUG-2/SEC-1 comments as `21-22` and `20-21` respectively; these are two-line comments and the ranges are accurate. Where a finding header additionally names a single "flagged in comment at line N" (e.g. BUG-1 at 18, BUG-3 at 19, BUG-2 at 21-22, SEC-1(b) at 20-21), each points at the correct line.
2. `context/bugs/001/bug-context.md:10-18` is cited as one range spanning both the logic-bug table (rows at 10-12) and the security table (row at 18). The cited content matches the file; the range simply brackets both tables. Acceptable.

## Research Quality Assessment

Applying the `research-quality-measurement` scoring procedure:

1. **Reference check** — 27 distinct `file:line`(range) references resolved; **0 broken**.
2. **Snippet check** — 4 quoted code blocks compared to current source; **0 mismatches** (all byte-for-byte, em-dashes and literals included).
3. **Claim check** — 3 logic bugs (BUG-1, BUG-2, BUG-3) + 1 two-part security issue (SEC-1 a/b) each confirmed real, locatable, and paired with a concrete root cause:
   - BUG-1: no `Math.round`/`Math.floor` on the final expression → fractional minor units.
   - BUG-2: operator inverted (`<` where `>`/`>=` is required) → boolean negation of intended contract.
   - BUG-3: `percentOff` never clamped to `0..100` (no `Math.min`/`Math.max`) → negative price for `>100`.
   - SEC-1(a): secret is a source-committed literal, never read from `process.env`.
   - SEC-1(b): raw `===` string compare instead of a constant-time primitive (`crypto.timingSafeEqual`) → timing side-channel.
   No unsupported claims; the "no undocumented bugs in `index.js`/elsewhere" claim was checked and holds (`index.js` is a pure dispatch wrapper).
4. **Compute** — 0 fabricated findings; 0 broken refs; 0 snippet mismatches; 0 unlocatable claims; every claimed bug has a stated root cause and enough fix-direction detail for the planner to act without reopening the code → satisfies the **R4** definition (all refs resolve, all snippets match, root cause for every claim, no unsupported claims, planner-actionable).
5. **Overall pass/fail** — level ≥ R3 → **pass**.

`Research Quality: R4 (Verified-Complete) — all 25 file:line refs resolved, all 4 snippets matched byte-for-byte, all 4 defects located with root causes, execution claims reproduced.`

## References

Every `file:line` checked during verification (all resolved against current source):

**`src/discount.js`** — :1 (`'use strict'`), :4 (minor-units header), :14 (`percentOff … 0..100` JSDoc), :17 (`calculatePrice` decl), :18 (BUG-1 comment), :19 (BUG-3 comment), :20 (BUG-1/BUG-3 return), :23 (`module.exports`).

**`src/validate.js`** — :16 ("not yet expired" JSDoc), :18 (`isCouponValid` decl), :19 (`if (!code) return false;`), :20 (`const expiry = …`), :21-22 (BUG-2 comment), :23 (BUG-2 inverted return).

**`src/auth.js`** — :11 (SEC-1a hardcoded `ADMIN_TOKEN`), :19 (`verifyAdminToken` decl), :20-21 (SEC-1b comment), :22 (SEC-1b `provided === ADMIN_TOKEN`).

**`src/index.js`** — :12-14 (module wiring), :19-22 (`price` case), :23-26 (`valid` case), :27-30 (`admin` case). Confirmed: thin CLI dispatch, no independent logic defects.

**`tests/behavior.test.js`** — :18-21 (BUG-1), :23-25 (BUG-3), :27-30 (BUG-2 future), :32-35 (BUG-2 expired), :37-41 (SEC-1). Independently re-run: `# tests 5 / # pass 0 / # fail 5`.

**`context/bugs/001/bug-context.md`** — :10-18 (seeded bug/issue tables; expected IDs and behavior).
