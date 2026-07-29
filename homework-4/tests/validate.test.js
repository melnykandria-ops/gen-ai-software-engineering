'use strict';

/**
 * Unit tests for src/validate.js — isCouponValid().
 *
 * Covers: happy path, boundary values, and a regression test for the seeded
 * BUG-2 (inverted comparison). A fixed `now` is injected on every call so
 * the suite never touches the real system clock (Repeatable / Fast).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isCouponValid } = require('../src/validate');

// Fixed reference "now" for every test in this file — never Date.now().
const FIXED_NOW = new Date('2026-01-01T00:00:00Z');

// --- Happy path ---------------------------------------------------------

test('isCouponValid: a coupon expiring well in the future is valid', () => {
  const future = new Date('2999-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('SAVE10', future, FIXED_NOW), true);
});

test('isCouponValid: a coupon that already expired is invalid', () => {
  const past = new Date('2000-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('OLD', past, FIXED_NOW), false);
});

test('isCouponValid: an empty code is always invalid, even with a future expiry', () => {
  const future = new Date('2999-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('', future, FIXED_NOW), false);
});

// --- Boundary values -----------------------------------------------------

test('isCouponValid: expiry exactly equal to now is invalid (not strictly in the future)', () => {
  const sameInstant = FIXED_NOW.toISOString();
  assert.equal(isCouponValid('EDGE', sameInstant, FIXED_NOW), false);
});

test('isCouponValid: expiry one millisecond after now is valid', () => {
  const justAfter = new Date(FIXED_NOW.getTime() + 1).toISOString();
  assert.equal(isCouponValid('EDGE', justAfter, FIXED_NOW), true);
});

test('isCouponValid: expiry one millisecond before now is invalid', () => {
  const justBefore = new Date(FIXED_NOW.getTime() - 1).toISOString();
  assert.equal(isCouponValid('EDGE', justBefore, FIXED_NOW), false);
});

// --- Regression: BUG-2 (inverted comparison) -----------------------------

test('BUG-2 regression: a future-dated coupon is valid (was inverted to false)', () => {
  const future = new Date('2999-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('SAVE10', future, FIXED_NOW), true);
});

test('BUG-2 regression: an expired coupon is invalid (was inverted to true)', () => {
  const past = new Date('2000-01-01T00:00:00Z').toISOString();
  assert.equal(isCouponValid('OLD', past, FIXED_NOW), false);
});
