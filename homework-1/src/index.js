'use strict';

const express = require('express');
const transactionsRouter = require('./routes/transactions');
const accountsRouter = require('./routes/accounts');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies.
app.use(express.json());

// Reject malformed JSON with a clean 400 instead of an HTML stack trace.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

// Health check / landing.
app.get('/', (req, res) => {
  res.json({
    name: 'Banking Transactions API',
    status: 'ok',
    endpoints: [
      'POST /transactions',
      'GET /transactions',
      'GET /transactions/:id',
      'GET /transactions/export?format=csv',
      'GET /accounts/:accountId/balance',
      'GET /accounts/:accountId/summary',
    ],
  });
});

// Feature routers.
app.use('/transactions', transactionsRouter);
app.use('/accounts', accountsRouter);

// 404 for anything else.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Catch-all error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Only start listening when run directly (so the app can be imported in tests).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🏦 Banking Transactions API listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
