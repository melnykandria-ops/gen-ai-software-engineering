'use strict';

/**
 * Unit tests for src/discount.js — calculatePrice().
 *
 * Covers: happy path, boundary values, and regression tests for the two
 * seeded bugs fixed in this module (BUG-1 rounding, BUG-3 clamping).
 * Pure function, no I/O, no clock — FIRST-compliant by construction.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calculatePrice } = require('../src/discount');

// --- Happy path ---------------------------------------------------------

test('calculatePrice: 0% off returns the original price unchanged', () => {
  assert.equal(calculatePrice(1000, 0), 1000);
});

test('calculatePrice: 50% off halves an even price', () => {
  assert.equal(calculatePrice(2000, 50), 1000);
});

test('calculatePrice: 100% off returns 0', () => {
  assert.equal(calculatePrice(1000, 100), 0);
});

// --- Boundary values -----------------------------------------------------

test('calculatePrice: percentOff exactly 0 is a no-op (lower boundary)', () => {
  assert.equal(calculatePrice(500, 0), 500);
});

test('calculatePrice: percentOff exactly 100 is the upper documented boundary', () => {
  assert.equal(calculatePrice(500, 100), 0);
});

test('calculatePrice: priceMinor of 0 stays 0 regardless of discount', () => {
  assert.equal(calculatePrice(0, 25), 0);
});

test('calculatePrice: negative percentOff is clamped to 0 (no discount applied)', () => {
  // Boundary just below the documented 0..100 range.
  assert.equal(calculatePrice(1000, -10), 1000);
});

// --- Regression: BUG-1 (missing rounding) --------------------------------

test('BUG-1 regression: fractional minor units are rounded to a whole number', () => {
  // 999 cents at 15% off = 849.15 -> must round to 849, never returned as a float.
  const result = calculatePrice(999, 15);
  assert.equal(result, 849);
  assert.equal(Number.isInteger(result), true);
});

test('BUG-1 regression: another fractional case rounds correctly (round-half-up)', () => {
  // 100 cents at 33% off = 67.0 exactly -> sanity check for a case landing on .0
  assert.equal(calculatePrice(100, 33), 67);
  // 101 cents at 50% off = 50.5 -> Math.round rounds half away from zero -> 51
  assert.equal(calculatePrice(101, 50), 51);
});

// --- Regression: BUG-3 (missing clamp, negative price) -------------------

test('BUG-3 regression: percentOff above 100 never yields a negative price', () => {
  assert.equal(calculatePrice(1000, 150), 0);
});

test('BUG-3 regression: a large percentOff (e.g. 500) still floors at 0, not negative', () => {
  assert.equal(calculatePrice(1000, 500), 0);
});
