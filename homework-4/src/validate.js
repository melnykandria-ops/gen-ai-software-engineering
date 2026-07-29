'use strict';

/**
 * Coupon validity checks.
 *
 * NOTE: ships with an intentional bug for the AI pipeline to find and fix.
 * See context/bugs/001/bug-context.md.
 */

/**
 * Is a coupon still valid at a given moment?
 *
 * @param {string} code coupon code (non-empty)
 * @param {string} expiryISO ISO-8601 expiry timestamp
 * @param {Date} [now] current time (defaults to system clock)
 * @returns {boolean} true if the coupon is non-empty and not yet expired
 */
function isCouponValid(code, expiryISO, now = new Date()) {
  if (!code) return false;
  const expiry = new Date(expiryISO);
  // A coupon is valid while its expiry is still in the future.
  return expiry.getTime() > now.getTime();
}

module.exports = { isCouponValid };
