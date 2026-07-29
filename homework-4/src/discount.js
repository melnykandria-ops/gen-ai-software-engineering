'use strict';

/**
 * Giftcard discount math. All money is in integer minor units (cents).
 *
 * NOTE: this file ships with intentional, documented bugs for the AI pipeline
 * to find and fix. See context/bugs/001/bug-context.md.
 */

/**
 * Apply a percentage discount to a price.
 *
 * @param {number} priceMinor price in minor units (e.g. cents)
 * @param {number} percentOff percentage off, 0..100
 * @returns {number} discounted price in minor units
 */
function calculatePrice(priceMinor, percentOff) {
  // BUG-3 fix: clamp percentOff into the documented 0..100 range so values
  // above 100 can no longer drive the price negative.
  const pct = Math.min(100, Math.max(0, percentOff));
  // BUG-1 fix: round to a whole number of minor units (money is integer cents).
  return Math.round(priceMinor - (priceMinor * pct) / 100);
}

module.exports = { calculatePrice };
