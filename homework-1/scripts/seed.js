'use strict';

/**
 * Seed the running API with the sample data in demo/sample-data.json.
 * Usage: node scripts/seed.js   (API must be running on PORT, default 3000)
 */
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = `http://localhost:${PORT}`;
const dataPath = path.join(__dirname, '..', 'demo', 'sample-data.json');

async function main() {
  const samples = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const tx of samples) {
    const res = await fetch(`${BASE}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tx),
    });
    const body = await res.json();
    console.log(`${res.status} ${res.ok ? '✓' : '✗'} ${tx.type} ${tx.amount} ${tx.currency} -> ${body.id || JSON.stringify(body)}`);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
