'use strict';

const path = require('path');
const express = require('express');
const ticketsRouter = require('./routes/tickets');

const app = express();
const PORT = process.env.PORT || 3000;

// Dashboard UI (static, no build step) — see public/.
app.use('/ui', express.static(path.join(__dirname, '..', 'public')));

// The import endpoint receives raw file content (CSV/JSON/XML) — capture it as
// text BEFORE the JSON body parser, otherwise JSON files arrive pre-parsed.
app.use('/tickets/import', express.text({ type: () => true, limit: '10mb' }));

// Parse JSON bodies everywhere else.
app.use(express.json({ limit: '2mb' }));

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
    name: 'Intelligent Customer Support System',
    status: 'ok',
    endpoints: [
      'POST /tickets',
      'POST /tickets/import?format=csv|json|xml',
      'GET /tickets',
      'GET /tickets/:id',
      'PUT /tickets/:id',
      'DELETE /tickets/:id',
      'POST /tickets/:id/auto-classify',
      'GET /tickets/:id/classification-log',
      'GET /ui (dashboard)',
    ],
  });
});

app.use('/tickets', ticketsRouter);

// 404 for anything else.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Catch-all error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  /* istanbul ignore next -- defensive: nothing in src throws unhandled */
  console.error(err);
  /* istanbul ignore next */
  res.status(500).json({ error: 'Internal server error' });
});

// Only start listening when run directly (importable in tests).
/* istanbul ignore if -- tests import the app instead of starting it */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎧 Intelligent Customer Support System listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
