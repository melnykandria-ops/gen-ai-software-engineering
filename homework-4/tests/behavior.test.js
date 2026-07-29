'use strict';

/**
 * Characterization tests — they encode the CORRECT expected behavior of the
 * app. They FAIL against the seeded-bug version and PASS once the pipeline's
 * fixes are applied, so they demonstrate the before/after state (Task 5).
 *
 * The Unit Test Generator agent adds its own FIRST-compliant suites alongside
 * this file (see context/bugs/001/test-report.md).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculatePrice } = require('../src/discount');
const { isCouponValid } = require('../src/validate');
const { verifyAdminToken } = require('../src/auth');

test('BUG-1: discounted price is a whole number of minor units', () => {
  // 999 cents, 15% off -> 849.15 -> must be rounded to 849
  assert.equal(calculatePrice(999, 15), 849);
});

test('BUG-3: percentOff above 100 never yields a negative price', () => {
  assert.equal(calculatePrice(1000, 150), 0);
});

test('BUG-2: a future-dated coupon is valid', () => {
  const future = new Date('2999-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('SAVE10', future, new Date('2026-01-01T00:00:00Z')), true);
});

test('BUG-2: an expired coupon is invalid', () => {
  const past = new Date('2000-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('OLD', past, new Date('2026-01-01T00:00:00Z')), false);
});

test('SEC-1: admin token is not the hardcoded literal in source', () => {
  // After the fix the token comes from the environment; the old hardcoded
  // literal must no longer authenticate.
  assert.equal(verifyAdminToken('s3cr3t-admin-2024'), false);
});
