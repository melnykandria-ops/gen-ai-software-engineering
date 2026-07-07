'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const importCSV = (body) =>
  request(app).post('/tickets/import?format=csv').set('Content-Type', 'text/csv').send(body);

const CSV_HEADER =
  'customer_id,customer_email,customer_name,subject,description,tags,source,browser,device_type';

beforeEach(() => store.reset());

describe('POST /tickets/import (CSV)', () => {
  describe('valid fixture file', () => {
    test('imports all 50 rows of sample_tickets.csv with a full success summary', async () => {
      const res = await importCSV(fixture('sample_tickets.csv'));

      expect(res.status).toBe(201);
      expect(res.body.format).toBe('csv');
      expect(res.body.total).toBe(50);
      expect(res.body.successful).toBe(50);
      expect(res.body.failed).toBe(0);
      expect(res.body.errors).toEqual([]);
      expect(res.body.created_ids).toHaveLength(50);
    });

    test('persists imported tickets so they are retrievable via GET /tickets', async () => {
      const res = await importCSV(fixture('sample_tickets.csv'));
      expect(res.status).toBe(201);

      const list = await request(app).get('/tickets');
      expect(list.status).toBe(200);
      expect(list.body.count).toBe(50);
      const listedIds = list.body.tickets.map((t) => t.id).sort();
      expect(listedIds).toEqual([...res.body.created_ids].sort());
    });
  });

  describe('CSV parsing details', () => {
    test('parses quoted fields containing commas correctly', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-1,user@example.com,Jane Doe,"Subject, with a comma","Description, with commas, that is definitely long enough.",,,,',
      ].join('\n');

      const res = await importCSV(csv);
      expect(res.status).toBe(201);
      expect(res.body.successful).toBe(1);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.subject).toBe('Subject, with a comma');
      expect(ticket.body.description).toBe('Description, with commas, that is definitely long enough.');
    });

    test('splits pipe-separated tags column into an array of tags', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-2,tags@example.com,,Tag splitting test,A description that is definitely long enough.,alpha|beta|gamma,,,',
      ].join('\n');

      const res = await importCSV(csv);
      expect(res.status).toBe(201);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.tags).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('defaults tags to an empty array when the tags column is empty', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-3,notags@example.com,,No tags here at all,A description that is definitely long enough.,,,,',
      ].join('\n');

      const res = await importCSV(csv);
      expect(res.status).toBe(201);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.tags).toEqual([]);
    });

    test('maps source, browser and device_type columns into ticket metadata', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-4,meta@example.com,,Metadata mapping test,A description that is definitely long enough.,,web_form,Chrome 126,desktop',
      ].join('\n');

      const res = await importCSV(csv);
      expect(res.status).toBe(201);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.metadata).toEqual({
        source: 'web_form',
        browser: 'Chrome 126',
        device_type: 'desktop',
      });
    });

    test('detects CSV from the Content-Type header when ?format= is omitted', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-5,ct@example.com,,Content type detection,A description that is definitely long enough.,,,,',
      ].join('\n');

      const res = await request(app)
        .post('/tickets/import')
        .set('Content-Type', 'text/csv')
        .send(csv);

      expect(res.status).toBe(201);
      expect(res.body.format).toBe('csv');
      expect(res.body.successful).toBe(1);
    });
  });

  describe('per-record validation failures', () => {
    test('invalid_tickets.csv fails every record with field-level errors', async () => {
      const res = await importCSV(fixture('invalid_tickets.csv'));

      expect(res.status).toBe(400); // nothing imported successfully
      expect(res.body.total).toBe(3);
      expect(res.body.successful).toBe(0);
      expect(res.body.failed).toBe(3);
      expect(res.body.created_ids).toEqual([]);
      expect(res.body.errors).toHaveLength(3);

      const errorFields = (record) =>
        res.body.errors.find((e) => e.record === record).errors.map((e) => e.field);

      // Record 1: bad email + too-short description.
      expect(errorFields(1)).toEqual(expect.arrayContaining(['customer_email', 'description']));
      // Record 2: missing customer_id + 210-char subject.
      expect(errorFields(2)).toEqual(expect.arrayContaining(['customer_id', 'subject']));
      // Record 3: invalid metadata enums.
      expect(errorFields(3)).toEqual(
        expect.arrayContaining(['metadata.source', 'metadata.device_type'])
      );

      // Every error detail carries both a field and a message.
      for (const entry of res.body.errors) {
        for (const detail of entry.errors) {
          expect(typeof detail.field).toBe('string');
          expect(typeof detail.message).toBe('string');
        }
      }
    });

    test('mixed valid/invalid rows import the valid ones and report the rest', async () => {
      const csv = [
        CSV_HEADER,
        'CUST-OK,ok@example.com,,A perfectly valid row,A description that is definitely long enough.,,,,',
        'CUST-BAD,not-an-email,,Row with a broken email,A description that is definitely long enough.,,,,',
      ].join('\n');

      const res = await importCSV(csv);

      expect(res.status).toBe(201); // at least one success
      expect(res.body.total).toBe(2);
      expect(res.body.successful).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(res.body.created_ids).toHaveLength(1);
      expect(res.body.errors).toHaveLength(1);
      expect(res.body.errors[0].record).toBe(2);
      expect(res.body.errors[0].subject).toBe('Row with a broken email');
      expect(res.body.errors[0].errors.map((e) => e.field)).toContain('customer_email');

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(1);
      expect(list.body.tickets[0].customer_id).toBe('CUST-OK');
    });
  });

  describe('unparseable input', () => {
    test('malformed.csv (unclosed quote) returns 400 with a parse error', async () => {
      const res = await importCSV(fixture('malformed.csv'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('csv');
      expect(typeof res.body.message).toBe('string');
    });

    test('empty request body returns 400 with a parse error', async () => {
      const res = await importCSV('');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('csv');
    });

    test('header-only CSV with no data rows returns 400', async () => {
      const res = await importCSV(`${CSV_HEADER}\n`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('csv');
      expect(res.body.message).toMatch(/no data rows/i);
    });
  });
});
