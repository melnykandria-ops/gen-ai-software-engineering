'use strict';

/**
 * Performance / throughput benchmarks for the support-ticket API.
 *
 * These are smoke-level benchmarks with GENEROUS thresholds — they exist to
 * catch order-of-magnitude regressions (accidental O(n²) hot paths, sync I/O
 * in request handlers), not to measure absolute speed. Durations are printed
 * so CI logs double as a small benchmarks table.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');
const { classify } = require('../src/services/classifier');
const { createTicket } = require('../src/services/ticketService');

const validTicket = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

/** Milliseconds elapsed since a process.hrtime.bigint() start mark. */
const msSince = (startNs) => Number(process.hrtime.bigint() - startNs) / 1e6;

const results = [];

/** Record a benchmark result, log it, and assert the threshold. */
function expectUnder(name, durationMs, thresholdMs) {
  results.push({ benchmark: name, 'duration (ms)': Math.round(durationMs), 'threshold (ms)': thresholdMs });
  console.log(`[perf] ${name}: ${durationMs.toFixed(1)} ms (threshold ${thresholdMs} ms)`);
  expect(durationMs).toBeLessThan(thresholdMs);
}

/**
 * Seed `n` tickets straight through the service layer (bypasses HTTP so the
 * benchmark measures only the code path under test). Deterministic cycling
 * over enum values gives every filter a predictable subset to match.
 */
function seedTickets(n) {
  const categories = ['account_access', 'technical_issue', 'billing_question', 'feature_request', 'bug_report', 'other'];
  const priorities = ['urgent', 'high', 'medium', 'low'];
  const statuses = ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'];
  const specs = [];
  for (let i = 0; i < n; i += 1) {
    specs.push({
      customer_id: `CUST-${i % 25}`,
      customer_email: `user${i}@example.com`,
      subject: `Seeded ticket #${i}`,
      description: `Deterministic seeded description for ticket number ${i}.`,
      category: categories[i % categories.length],
      priority: priorities[i % priorities.length],
      status: statuses[i % statuses.length],
      tags: i % 3 === 0 ? ['perf', 'seed'] : ['seed'],
    });
  }
  specs.forEach((spec) => createTicket(spec));
  return specs;
}

describe('Performance benchmarks', () => {
  beforeEach(() => store.reset());

  afterAll(() => {
    console.log('\n=== Benchmark summary ===');
    console.table(results);
  });

  test('creates 200 tickets sequentially via POST /tickets in under 5s', async () => {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 200; i += 1) {
      const res = await request(app)
        .post('/tickets')
        .send(validTicket({ customer_id: `CUST-${i}`, subject: `Sequential ticket ${i}` }));
      expect(res.status).toBe(201);
    }
    const duration = msSince(start);

    const list = await request(app).get('/tickets');
    expect(list.body.count).toBe(200);

    expectUnder('200 sequential POST /tickets', duration, 5000);
  }, 20000);

  test('bulk-imports the 50-row sample_tickets.csv in under 2s', async () => {
    const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample_tickets.csv'), 'utf8');

    const start = process.hrtime.bigint();
    const res = await request(app)
      .post('/tickets/import?format=csv')
      .set('Content-Type', 'text/csv')
      .send(csv);
    const duration = msSince(start);

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(50);
    expect(res.body.successful).toBe(50);
    expect(res.body.failed).toBe(0);
    expect(res.body.created_ids).toHaveLength(50);

    expectUnder('CSV import of 50 rows', duration, 2000);
  }, 10000);

  test('filters 600 seeded tickets with combined status+priority+tag query in under 1s', async () => {
    const specs = seedTickets(600);
    const matches = (s) => s.status === 'in_progress' && s.priority === 'high' && s.tags.includes('perf');
    const expected = specs.filter(matches).length;
    expect(expected).toBeGreaterThan(0); // guard: the query must actually select something

    const start = process.hrtime.bigint();
    const res = await request(app).get('/tickets?status=in_progress&priority=high&tag=perf');
    const duration = msSince(start);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(expected);
    res.body.tickets.forEach((t) => {
      expect(t.status).toBe('in_progress');
      expect(t.priority).toBe('high');
      expect(t.tags).toContain('perf');
    });

    expectUnder('combined-filter GET over 600 tickets', duration, 1000);
  }, 10000);

  test('handles 25 concurrent POST /tickets in under 3s with all succeeding', async () => {
    const start = process.hrtime.bigint();
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        request(app)
          .post('/tickets')
          .send(validTicket({ customer_id: `CONC-${i}`, subject: `Concurrent ticket ${i}` }))),
    );
    const duration = msSince(start);

    responses.forEach((res) => expect(res.status).toBe(201));
    const ids = new Set(responses.map((res) => res.body.id));
    expect(ids.size).toBe(25); // every ticket got a unique id

    const list = await request(app).get('/tickets');
    expect(list.body.count).toBe(25);

    expectUnder('25 concurrent POST /tickets', duration, 3000);
  }, 10000);

  test('classify() sustains 1000 calls in under 1s (pure-function throughput)', () => {
    const samples = [
      { subject: "Can't access my account", description: 'I am locked out after the password reset, this is urgent.' },
      { subject: 'Charged twice for subscription', description: 'My invoice shows a duplicate payment, please refund.' },
      { subject: 'App crashes on upload', description: 'The dashboard crashes with a 500 error. Steps to reproduce included.' },
      { subject: 'Please add dark mode', description: 'A feature request: dark mode would be great, just a suggestion.' },
      { subject: 'Weather is nice today', description: 'Nothing matches any keyword dictionary in this text at all.' },
    ];
    // Sanity-check determinism before timing the loop.
    expect(classify(samples[0]).category).toBe('account_access');
    expect(classify(samples[4]).category).toBe('other');

    const start = process.hrtime.bigint();
    for (let i = 0; i < 1000; i += 1) {
      const result = classify(samples[i % samples.length]);
      expect(typeof result.category).toBe('string');
    }
    const duration = msSince(start);

    expectUnder('1000 classify() calls', duration, 1000);
  }, 10000);

  test('auto-classifies 100 tickets on create via ?autoClassify=true in under 3s', async () => {
    const subjects = [
      'Cannot log in to my account',
      'Refund for duplicate charge',
      'Crash with error on save',
      'Feature request: export to CSV',
    ];

    const start = process.hrtime.bigint();
    for (let i = 0; i < 100; i += 1) {
      const res = await request(app)
        .post('/tickets?autoClassify=true')
        .send(validTicket({
          customer_id: `AC-${i}`,
          subject: subjects[i % subjects.length],
          description: `Auto-classified benchmark ticket number ${i} with enough length.`,
        }));
      expect(res.status).toBe(201);
      expect(res.body.classification).not.toBeNull();
    }
    const duration = msSince(start);

    expectUnder('100 auto-classified creates', duration, 3000);
  }, 15000);

  test('fetches 100 tickets by id against a 500-ticket store in under 2s', async () => {
    seedTickets(500);
    const ids = store.all().slice(0, 100).map((t) => t.id);

    const start = process.hrtime.bigint();
    for (const id of ids) {
      const res = await request(app).get(`/tickets/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
    }
    const duration = msSince(start);

    expectUnder('100 GET /tickets/:id over 500 tickets', duration, 2000);
  }, 15000);
});
