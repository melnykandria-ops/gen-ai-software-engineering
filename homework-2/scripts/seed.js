'use strict';

/**
 * Seed the running API with the three sample fixture files (100 tickets total)
 * using the bulk-import endpoint, with auto-classification enabled.
 *
 * Usage: node scripts/seed.js   (API must be running on PORT, default 3000)
 */
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures');

const FILES = [
  { file: 'sample_tickets.csv', type: 'text/csv' },
  { file: 'sample_tickets.json', type: 'application/json' },
  { file: 'sample_tickets.xml', type: 'application/xml' },
];

async function main() {
  for (const { file, type } of FILES) {
    const body = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
    const res = await fetch(`${BASE}/tickets/import?autoClassify=true`, {
      method: 'POST',
      headers: { 'Content-Type': type },
      body,
    });
    const summary = await res.json();
    console.log(`${res.status} ${file}: total=${summary.total} ok=${summary.successful} failed=${summary.failed}`);
  }
  const list = await (await fetch(`${BASE}/tickets`)).json();
  console.log(`Total tickets in store: ${list.count}`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
