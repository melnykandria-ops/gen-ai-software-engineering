'use strict';

const express = require('express');
const store = require('../store');
const { ACCOUNT_PATTERN, roundMoney } = require('../utils/helpers');

const router = express.Router();

/**
 * GET /accounts/:accountId/balance — current balance from completed transactions.
 */
router.get('/:accountId/balance', (req, res) => {
  const { accountId } = req.params;
  if (!ACCOUNT_PATTERN.test(accountId)) {
    return res.status(400).json({ error: 'Invalid account format', details: [{ field: 'accountId', message: 'Account must match format ACC-XXXXX' }] });
  }
  return res.status(200).json({ accountId, balance: store.balanceFor(accountId) });
});

/**
 * GET /accounts/:accountId/summary — account summary. (Task 4, Option A.)
 * Totals count only completed transactions.
 */
router.get('/:accountId/summary', (req, res) => {
  const { accountId } = req.params;
  if (!ACCOUNT_PATTERN.test(accountId)) {
    return res.status(400).json({ error: 'Invalid account format', details: [{ field: 'accountId', message: 'Account must match format ACC-XXXXX' }] });
  }

  const related = store.filter({ accountId });

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const t of related) {
    if (t.status !== 'completed') continue;
    if (t.toAccount === accountId && (t.type === 'deposit' || t.type === 'transfer')) {
      totalDeposits += t.amount;
    }
    if (t.fromAccount === accountId && (t.type === 'withdrawal' || t.type === 'transfer')) {
      totalWithdrawals += t.amount;
    }
  }

  // `related` is already sorted newest-first by the store.
  const mostRecentTransactionDate = related.length > 0 ? related[0].timestamp : null;

  return res.status(200).json({
    accountId,
    totalDeposits: roundMoney(totalDeposits),
    totalWithdrawals: roundMoney(totalWithdrawals),
    currentBalance: store.balanceFor(accountId),
    transactionCount: related.length,
    mostRecentTransactionDate,
  });
});

module.exports = router;
