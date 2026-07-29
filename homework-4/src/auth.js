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
