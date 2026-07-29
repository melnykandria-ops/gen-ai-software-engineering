# Security Report — Bug 001 (giftcard demo)

*Stage 5 — Security Vulnerabilities Verifier. Adversarial review of the code
changed by the Bug Fixer. **Report only — no code was edited.***

**Inputs read**
- `context/bugs/001/fix-summary.md`
- `src/auth.js`, `src/discount.js`, `src/validate.js` (changed)
- `src/index.js` (unchanged; reviewed for the privileged auth path)

**Method** — Read each changed file and compared it byte-for-byte to the
fix-summary "After" snippets (all match). Grepped the whole repo for the seeded
literal and for secret-shaped tokens. Re-ran `node --test tests/` (5 pass / 0
fail). Reasoned adversarially about injection, hardcoded secrets, non-constant-
time comparison, input validation, and fail-open behaviour.

---

## SEC-1 status: **REMEDIATED (both parts a + b), verified.**

- **SEC-1(a) hardcoded secret** — RESOLVED. The literal
  `const ADMIN_TOKEN = 's3cr3t-admin-2024';` is gone from `src/auth.js`. A
  repo-wide grep finds the literal only in intentional demo/fixture files
  (`tests/behavior.test.js`, `context/bugs/001/*`, `HOWTORUN.md`) — never in
  `src/`. The expected secret is now sourced from `process.env.ADMIN_TOKEN`
  (`src/auth.js:24`) with **no hardcoded fallback**, so it fails closed when
  the env var is unset/empty (`src/auth.js:25`).
- **SEC-1(b) timing-unsafe comparison** — RESOLVED. The plain `===` compare is
  replaced by `crypto.timingSafeEqual` over UTF-8 buffers (`src/auth.js:33`),
  preceded by a `typeof provided !== 'string'` input-validation guard
  (`src/auth.js:25`) and a length guard (`src/auth.js:30`, required because
  `timingSafeEqual` throws on unequal-length buffers).

No new vulnerability was introduced by the SEC-1, BUG-1, BUG-2, or BUG-3 edits.
The four findings below are all **LOW / INFO** residuals — none blocks the fix.

---

## Findings

### F-1 · LOW · `src/auth.js:30`
**Secret length leaks via early-return timing side-channel.**
`if (providedBuf.length !== expectedBuf.length) return false;` returns before
the constant-time compare, so response time reveals whether the caller guessed
the correct token *length*. This is the standard/accepted idiom (because
`crypto.timingSafeEqual` throws on unequal lengths), and it does **not**
reintroduce SEC-1(b) — the byte comparison itself remains constant-time.
Residual, low-impact information disclosure only.
**Remediation:** Acceptable as-is for this threat model. If the token length
must also be hidden, hash both inputs to a fixed width before comparing, e.g.
`timingSafeEqual(sha256(provided), sha256(expected))`, which makes both buffers
32 bytes regardless of input length.

### F-2 · LOW · `HOWTORUN.md:12` (and git history, commit `de9b4fc`)
**Previously-committed secret not rotated / still shown in docs.**
The now-defunct literal `s3cr3t-admin-2024` was committed to source control and
remains recoverable from git history and is printed verbatim as example usage
in `HOWTORUN.md:12` (`node src/index.js admin s3cr3t-admin-2024`). Removing a
secret from `HEAD` does not un-leak it. In this demo the value is an
intentional fixture and the live code path no longer trusts any hardcoded
value, so real-world impact is low; the principle still applies.
**Remediation:** Treat any once-committed secret as compromised — rotate
`ADMIN_TOKEN` at the real service, and scrub/replace the `HOWTORUN.md` example
with a placeholder (e.g. `ADMIN_TOKEN=... node src/index.js admin "$TOKEN"`).
In a production repo, purge the value from history and rotate.

### F-3 · INFO · `src/index.js:27-29`
**Admin token passed as a CLI argument.**
The `admin` command reads the token from `argv` (`const [token] = args`), so
the secret appears in process listings (`ps`), shell history, and any command
logging. Pre-existing (this line was not changed by the fix) but it is the
privileged auth path, so it is in scope for review.
**Remediation:** Read the token from `process.env.ADMIN_TOKEN` or from stdin
rather than from `argv` for the `admin` subcommand.

### F-4 · INFO · `src/auth.js:23` / `src/index.js:27`
**No rate-limiting, lockout, or audit logging on admin verification.**
`verifyAdminToken` can be invoked without any throttling, so an online
brute-force of the admin token is unthrottled at this layer. Out of scope of
the SEC-1 function change, noted because it is a privileged authentication
surface.
**Remediation:** Add attempt throttling / lockout and audit logging at the
caller (the `index.js` `admin` dispatch or an auth middleware) if this path is
ever exposed beyond a local CLI.

---

## Other changed files — no security findings

- **`src/discount.js` (BUG-1, BUG-3, lines 17-23)** — Pure arithmetic; no
  secrets, no injection, no user-controlled sink. `Math.min(100, Math.max(0,
  percentOff))` clamps out the negative-price vector. Non-numeric input yields
  `NaN` (a robustness/logic concern, not a security one). No finding.
- **`src/validate.js` (BUG-2, lines 18-23)** — `new Date(expiryISO)` on a
  malformed string yields `Invalid Date` → `getTime()` is `NaN` → `NaN > now`
  is `false`, i.e. the function **fails closed** (treats an unparseable expiry
  as invalid). No injection, no secret. No finding.
- **`src/index.js`** — Unchanged by the fix; the two INFO items above (F-3,
  F-4) concern the pre-existing admin dispatch, not a regression from this fix.

---

## Summary (counts by severity)

| Severity | Count | IDs |
|----------|:-----:|-----|
| CRITICAL | 0 | — |
| HIGH     | 0 | — |
| MEDIUM   | 0 | — |
| LOW      | 2 | F-1, F-2 |
| INFO     | 2 | F-3, F-4 |
| **Total open findings** | **4** | all LOW/INFO |

**SEC-1:** both parts (hardcoded secret + timing-unsafe comparison) are
remediated and verified. No CRITICAL/HIGH/MEDIUM issues. The fix is clear to
ship; F-1–F-4 are hardening recommendations, not blockers.

---

## Evidence

```
$ grep -rn "s3cr3t-admin-2024" src/          # → no matches (secret gone from source)
$ node --test tests/                          # → # tests 5 / # pass 5 / # fail 0
src/auth.js:24   const expected = process.env.ADMIN_TOKEN;   # env-sourced, no fallback
src/auth.js:33   return crypto.timingSafeEqual(providedBuf, expectedBuf);  # constant-time
```
