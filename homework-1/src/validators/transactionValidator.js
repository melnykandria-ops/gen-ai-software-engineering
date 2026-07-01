'use strict';

const {
  VALID_CURRENCIES,
  ACCOUNT_PATTERN,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  hasAtMostTwoDecimals,
} = require('../utils/helpers');

/**
 * Validate the payload for creating a transaction.
 *
 * Returns an array of { field, message } errors. An empty array means the
 * payload is valid. This keeps the route handler thin and makes the rules
 * easy to unit-test.
 *
 * @param {object} body raw request body
 * @returns {{field: string, message: string}[]}
 */
function validateTransaction(body = {}) {
  const errors = [];
  const { fromAccount, toAccount, amount, currency, type, status } = body;

  // --- amount -------------------------------------------------------------
  if (amount === undefined || amount === null) {
    errors.push({ field: 'amount', message: 'Amount is required' });
  } else if (typeof amount !== 'number' || Number.isNaN(amount)) {
    errors.push({ field: 'amount', message: 'Amount must be a number' });
  } else if (amount <= 0) {
    errors.push({ field: 'amount', message: 'Amount must be a positive number' });
  } else if (!hasAtMostTwoDecimals(amount)) {
    errors.push({ field: 'amount', message: 'Amount must have at most 2 decimal places' });
  }

  // --- type ---------------------------------------------------------------
  if (!type) {
    errors.push({ field: 'type', message: 'Type is required' });
  } else if (!TRANSACTION_TYPES.has(type)) {
    errors.push({
      field: 'type',
      message: 'Type must be one of: deposit, withdrawal, transfer',
    });
  }

  // --- currency -----------------------------------------------------------
  if (!currency) {
    errors.push({ field: 'currency', message: 'Currency is required' });
  } else if (typeof currency !== 'string' || !VALID_CURRENCIES.has(currency.toUpperCase())) {
    errors.push({ field: 'currency', message: 'Invalid currency code (expected ISO 4217, e.g. USD)' });
  }

  // --- status (optional) --------------------------------------------------
  if (status !== undefined && !TRANSACTION_STATUSES.has(status)) {
    errors.push({
      field: 'status',
      message: 'Status must be one of: pending, completed, failed',
    });
  }

  // --- accounts -----------------------------------------------------------
  // Which accounts are required depends on the transaction type.
  // Treat null / undefined / "" all as "not provided".
  const fromProvided = fromAccount !== undefined && fromAccount !== null && fromAccount !== '';
  const toProvided = toAccount !== undefined && toAccount !== null && toAccount !== '';

  if (fromProvided && !ACCOUNT_PATTERN.test(fromAccount)) {
    errors.push({ field: 'fromAccount', message: 'Account must match format ACC-XXXXX (alphanumeric)' });
  }
  if (toProvided && !ACCOUNT_PATTERN.test(toAccount)) {
    errors.push({ field: 'toAccount', message: 'Account must match format ACC-XXXXX (alphanumeric)' });
  }

  if (type === 'transfer') {
    if (!fromAccount) errors.push({ field: 'fromAccount', message: 'fromAccount is required for a transfer' });
    if (!toAccount) errors.push({ field: 'toAccount', message: 'toAccount is required for a transfer' });
    if (fromAccount && toAccount && fromAccount === toAccount) {
      errors.push({ field: 'toAccount', message: 'fromAccount and toAccount must differ for a transfer' });
    }
  } else if (type === 'deposit') {
    if (!toAccount) errors.push({ field: 'toAccount', message: 'toAccount is required for a deposit' });
  } else if (type === 'withdrawal') {
    if (!fromAccount) errors.push({ field: 'fromAccount', message: 'fromAccount is required for a withdrawal' });
  }

  return errors;
}

module.exports = { validateTransaction };
