'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const importXML = (raw) =>
  request(app).post('/tickets/import?format=xml').set('Content-Type', 'application/xml').send(raw);

beforeEach(() => store.reset());

describe('POST /tickets/import (XML)', () => {
  describe('sample_tickets.xml fixture', () => {
    test('imports all 30 records successfully with a 201 summary', async () => {
      const res = await importXML(fixture('sample_tickets.xml'));

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        format: 'xml',
        total: 30,
        successful: 30,
        failed: 0,
        errors: [],
      });
      expect(res.body.created_ids).toHaveLength(30);

      const list = await request(app).get('/tickets');
      expect(list.status).toBe(200);
      expect(list.body.count).toBe(30);
    });
  });

  describe('single <ticket> element', () => {
    test('is still treated as a one-record list, with a singleton <tag> as an array', async () => {
      const xml = `<?xml version="1.0"?>
<tickets>
  <ticket>
    <customer_id>CUST-XML-1</customer_id>
    <customer_email>solo@example.com</customer_email>
    <subject>Only one ticket in this file</subject>
    <description>A single-ticket XML import that is long enough.</description>
    <tags>
      <tag>solo</tag>
    </tags>
  </ticket>
</tickets>`;

      const res = await importXML(xml);

      expect(res.status).toBe(201);
      expect(res.body.total).toBe(1);
      expect(res.body.successful).toBe(1);
      expect(res.body.failed).toBe(0);
      expect(res.body.created_ids).toHaveLength(1);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.subject).toBe('Only one ticket in this file');
      expect(ticket.body.tags).toEqual(['solo']);
    });
  });

  describe('tags and metadata mapping', () => {
    test('<tags><tag> children become an array and <metadata> fields land in ticket.metadata', async () => {
      const xml = `<?xml version="1.0"?>
<tickets>
  <ticket>
    <customer_id>CUST-XML-2</customer_id>
    <customer_email>meta@example.com</customer_email>
    <customer_name>Meta Tester</customer_name>
    <subject>Tags and metadata round-trip</subject>
    <description>Checking that nested XML structures map onto the ticket model.</description>
    <tags>
      <tag>login</tag>
      <tag>urgent-review</tag>
    </tags>
    <metadata>
      <source>web_form</source>
      <browser>Safari 17</browser>
      <device_type>mobile</device_type>
    </metadata>
  </ticket>
</tickets>`;

      const res = await importXML(xml);
      expect(res.status).toBe(201);
      expect(res.body.successful).toBe(1);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.tags).toEqual(['login', 'urgent-review']);
      expect(ticket.body.metadata).toEqual({
        source: 'web_form',
        browser: 'Safari 17',
        device_type: 'mobile',
      });
      expect(ticket.body.customer_name).toBe('Meta Tester');
    });

    test('omitted tags and metadata fall back to server defaults', async () => {
      const xml = `<?xml version="1.0"?>
<tickets>
  <ticket>
    <customer_id>CUST-XML-3</customer_id>
    <customer_email>bare@example.com</customer_email>
    <subject>No tags or metadata here</subject>
    <description>Bare-minimum ticket exercising the default values.</description>
  </ticket>
</tickets>`;

      const res = await importXML(xml);
      expect(res.status).toBe(201);

      const ticket = await request(app).get(`/tickets/${res.body.created_ids[0]}`);
      expect(ticket.status).toBe(200);
      expect(ticket.body.tags).toEqual([]);
      expect(ticket.body.metadata).toEqual({ source: 'api', browser: null, device_type: null });
    });
  });

  describe('malformed.xml fixture', () => {
    test('returns 400 with a parse error and creates nothing', async () => {
      const res = await importXML(fixture('malformed.xml'));

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('xml');
      expect(res.body.message).toMatch(/Malformed XML/);

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(0);
    });
  });

  describe('invalid_tickets.xml fixture', () => {
    test('reports per-record validation failures and returns 400 when nothing imports', async () => {
      const res = await importXML(fixture('invalid_tickets.xml'));

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ format: 'xml', total: 2, successful: 0, failed: 2 });
      expect(res.body.created_ids).toEqual([]);
      expect(res.body.errors).toHaveLength(2);

      const [first, second] = res.body.errors;
      expect(first.record).toBe(1);
      expect(first.subject).toBe('Bad email in XML');
      expect(first.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'customer_email' })]),
      );

      expect(second.record).toBe(2);
      expect(second.subject).toBe('Short description');
      expect(second.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'description' })]),
      );

      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(0);
    });
  });

  describe('wrong document shape', () => {
    test('well-formed XML without <tickets>/<ticket> returns 400 parse error', async () => {
      const res = await importXML('<foo/>');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.format).toBe('xml');
      expect(res.body.message).toMatch(/<tickets>.*<ticket>/);
    });

    test('an empty <tickets/> element returns 400 parse error', async () => {
      const res = await importXML('<tickets></tickets>');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Import file could not be parsed');
      expect(res.body.message).toMatch(/at least one <ticket>/);
    });
  });
});
