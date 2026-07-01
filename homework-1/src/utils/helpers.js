'use strict';

const { randomUUID } = require('crypto');

/**
 * A pragmatic subset of ISO 4217 currency codes. Enough to cover the
 * assignment's examples (USD, EUR, GBP, JPY, ...) plus common majors.
 */
const VALID_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD',
  'CNY', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'HUF', 'UAH', 'TRY', 'INR', 'BRL', 'ZAR', 'MXN', 'AED',
]);

/** Account numbers must look like ACC-XXXXX (X = alphanumeric, at least 4). */
const ACCOUNT_PATTERN = /^ACC-[A-Za-z0-9]{4,}$/;

const TRANSACTION_TYPES = new Set(['deposit', 'withdrawal', 'transfer']);
const TRANSACTION_STATUSES = new Set(['pending', 'completed', 'failed']);

/** Generate a unique transaction id. */
function generateId() {
  return `txn_${randomUUID()}`;
}

/** True if the value is a finite number with at most 2 decimal places. */
function hasAtMostTwoDecimals(value) {
  return Math.round(value * 100) === value * 100;
}

/** Round monetary values to 2 decimals, avoiding float drift. */
function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

module.exports = {
  VALID_CURRENCIES,
  ACCOUNT_PATTERN,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  generateId,
  hasAtMostTwoDecimals,
  roundMoney,
};
