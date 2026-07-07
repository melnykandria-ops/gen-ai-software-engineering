'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const importJSON = (body) =>
  request(app).post('/tickets/import?format=json').set('Content-Type', 'application/json').send(body);

const validRecord = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

beforeEach(() => store.reset());

describe('POST /tickets/import (JSON)', () => {
  describe('successful imports', () => {
    test('imports all 20 records from sample_tickets.json ({tickets:[...]} form)', async () => {
      const res = await importJSON(fixture('sample_tickets.json'));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        format: 'json',
        total: 20,
        successful: 20,
        failed: 0,
        errors: [],
      });
      expect(res.body.created_ids).toHaveLength(20);

      const list = await request(app).get('/tickets');
      expect(list.status).toBe(200);
      expect(list.body.count).toBe(20);
    });

    test('persists record fields and applies server defaults for a created ticket', async () => {
      const res = await importJSON(fixture('sample_tickets.json'));
      expect(res.status).toBe(201);

      const list = await request(app).get('/tickets?customer_id=CUST-1050');
      expect(list.body.count).toBe(1);
      const ticket = list.body.tickets[0];

      expect(res.body.created_ids).toContain(ticket.id);
      expect(ticket).toMatchObject({
        customer_id: 'CUST-1050',
        customer_email: 'user50@example.com',
        customer_name: 'Iryna Kovalenko',
        subject: 'Charged twice for my subscription (#50)',
        category: 'other', // no autoClassify → default
        priority: 'medium',
        status: 'new',
        assigned_to: null,
        tags: ['login', 'urgent-review'],
        metadata: { source: 'web_form', browser: 'Safari 17', device_type: 'tablet' },
        classification: null,
      });
    });

    test('accepts a top-level JSON array of tickets', async () => {
      const body = JSON.stringify([
        validRecord({ customer_id: 'ARR-1', subject: 'Array record one' }),
        validRecord({ customer_id: 'ARR-2', subject: 'Array record two' }),
      ]);
      const res = await importJSON(body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ format: 'json', total: 2, successful: 2, failed: 0 });
      expect(res.body.created_ids).toHaveLength(2);

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(2);
    });

    test('detects json format from Content-Type when ?format= is absent', async () => {
      const res = await request(app)
        .post('/tickets/import')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify([validRecord()]));

      expect(res.status).toBe(201);
      expect(res.body.format).toBe('json');
      expect(res.body.successful).toBe(1);
    });

    test('?format=json wins over a conflicting Content-Type header', async () => {
      const res = await request(app)
        .post('/tickets/import?format=json')
        .set('Content-Type', 'text/csv')
        .send(JSON.stringify([validRecord()]));

      expect(res.status).toBe(201);
      expect(res.body.format).toBe('json');
      expect(res.body.successful).toBe(1);
    });
  });

  describe('parse errors (400, nothing imported)', () => {
    test('malformed.json → 400 with parse error', async () => {
      const res = await importJSON(fixture('malformed.json'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('json');
      expect(res.body.message).toMatch(/Malformed JSON/);

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(0);
    });

    test('JSON object without a "tickets" array → 400 wrong-shape parse error', async () => {
      const res = await importJSON('{"a":1}');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.message).toMatch(/array of tickets|"tickets" array/);
    });

    test('non-object records ([1,2]) → 400 parse error', async () => {
      const res = await importJSON('[1,2]');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.message).toMatch(/must be a JSON object/);
    });

    test('empty tickets array → 400 "no ticket records"', async () => {
      const res = await importJSON('{"tickets":[]}');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.message).toMatch(/no ticket records/);
    });

    test('empty body → 400 parse error', async () => {
      const res = await importJSON('');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.message).toMatch(/empty/i);
    });
  });

  describe('per-record validation failures', () => {
    test('invalid_tickets.json → 400 with all 3 records failed and detailed errors', async () => {
      const res = await importJSON(fixture('invalid_tickets.json'));

      expect(res.status).toBe(400); // successful === 0
      expect(res.body).toMatchObject({ format: 'json', total: 3, successful: 0, failed: 3 });
      expect(res.body.created_ids).toEqual([]);
      expect(res.body.errors).toHaveLength(3);

      // Record 1: bad email
      expect(res.body.errors[0]).toMatchObject({ record: 1, subject: 'Bad email in JSON' });
      expect(res.body.errors[0].errors).toEqual([
        expect.objectContaining({ field: 'customer_email' }),
      ]);

      // Record 2: empty subject
      expect(res.body.errors[1]).toMatchObject({ record: 2, subject: '' });
      expect(res.body.errors[1].errors).toEqual([
        expect.objectContaining({ field: 'subject' }),
      ]);

      // Record 3: missing customer_id + too-short description
      expect(res.body.errors[2].record).toBe(3);
      const fields = res.body.errors[2].errors.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(['customer_id', 'description']));

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(0);
    });

    test('mixed valid + invalid records → 201 partial success with accurate summary', async () => {
      const body = JSON.stringify({
        tickets: [
          validRecord({ customer_id: 'MIX-OK', subject: 'Good record' }),
          validRecord({ customer_id: 'MIX-BAD', customer_email: 'not-an-email', subject: 'Bad record' }),
        ],
      });
      const res = await importJSON(body);

      expect(res.status).toBe(201); // at least one succeeded
      expect(res.body).toMatchObject({ format: 'json', total: 2, successful: 1, failed: 1 });
      expect(res.body.created_ids).toHaveLength(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0]).toMatchObject({ record: 2, subject: 'Bad record' });
      expect(res.body.errors[0].errors[0].field).toBe('customer_email');

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(1);
      expect(list.body.tickets[0].customer_id).toBe('MIX-OK');
    });
  });
});
