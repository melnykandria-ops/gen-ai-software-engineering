'use strict';

const express = require('express');
const store = require('../store');
const { validateTransaction } = require('../validators/transactionValidator');
const { generateId } = require('../utils/helpers');

const router = express.Router();

/**
 * POST /transactions — create a new transaction.
 */
router.post('/', (req, res) => {
  const errors = validateTransaction(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { fromAccount, toAccount, amount, currency, type, status } = req.body;
  const transaction = {
    id: generateId(),
    fromAccount: fromAccount ?? null,
    toAccount: toAccount ?? null,
    amount,
    currency: currency.toUpperCase(),
    type,
    timestamp: new Date().toISOString(),
    status: status ?? 'completed',
  };

  store.add(transaction);
  return res.status(201).json(transaction);
});

/**
 * GET /transactions — list transactions with optional filters:
 *   ?accountId=ACC-12345 &type=transfer &from=2024-01-01 &to=2024-01-31
 */
router.get('/', (req, res) => {
  const { accountId, type, from, to } = req.query;
  const results = store.filter({ accountId, type, from, to });
  return res.status(200).json({ count: results.length, transactions: results });
});

/**
 * GET /transactions/export?format=csv — export transactions.
 * (Task 4, Option C.) Declared BEFORE `/:id` so "export" is not treated as an id.
 */
router.get('/export', (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  const rows = store.all();

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.json"');
    return res.status(200).json(rows);
  }

  if (format !== 'csv') {
    return res.status(400).json({ error: 'Unsupported format', details: [{ field: 'format', message: 'Supported formats: csv, json' }] });
  }

  const columns = ['id', 'fromAccount', 'toAccount', 'amount', 'currency', 'type', 'timestamp', 'status'];
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    columns.join(','),
    ...rows.map((t) => columns.map((c) => escape(t[c])).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  return res.status(200).send(csv);
});

/**
 * GET /transactions/:id — fetch a single transaction.
 */
router.get('/:id', (req, res) => {
  const transaction = store.findById(req.params.id);
  if (!transaction) {
    return res.status(404).json({ error: 'Transaction not found', id: req.params.id });
  }
  return res.status(200).json(transaction);
});

module.exports = router;
