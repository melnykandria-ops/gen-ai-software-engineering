'use strict';

const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');

const validTicket = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

/** Busy-spin until Date.now() advances so a subsequent nowISO() differs. */
const tickClock = () => {
  const start = Date.now();
  while (Date.now() === start) {
    /* spin ~1ms */
  }
};

beforeEach(() => store.reset());

describe('GET / (health check)', () => {
  test('returns 200 with service name, ok status and endpoint list', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Intelligent Customer Support System');
    expect(res.body.status).toBe('ok');
    expect(res.body.endpoints).toEqual(expect.arrayContaining(['POST /tickets', 'GET /tickets']));
  });
});

describe('POST /tickets', () => {
  test('creates a ticket with 201 and server-generated fields and defaults', async () => {
    const res = await request(app).post('/tickets').send(validTicket());

    expect(res.status).toBe(201);
    const t = res.body;
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
    // Timestamps are valid ISO 8601 and equal at creation.
    expect(new Date(t.created_at).toISOString()).toBe(t.created_at);
    expect(t.updated_at).toBe(t.created_at);
    expect(t.resolved_at).toBeNull();
    // Defaults.
    expect(t.status).toBe('new');
    expect(t.priority).toBe('medium');
    expect(t.category).toBe('other');
    expect(t.customer_name).toBeNull();
    expect(t.assigned_to).toBeNull();
    expect(t.tags).toEqual([]);
    expect(t.metadata).toEqual({ source: 'api', browser: null, device_type: null });
    expect(t.classification).toBeNull();
  });

  test('honors explicitly provided optional fields instead of defaults', async () => {
    const res = await request(app).post('/tickets').send(validTicket({
      category: 'billing_question',
      priority: 'high',
      status: 'in_progress',
      customer_name: 'Jane Doe',
      tags: ['billing', 'vip'],
      metadata: { source: 'email', device_type: 'mobile' },
    }));

    expect(res.status).toBe(201);
    expect(res.body.category).toBe('billing_question');
    expect(res.body.priority).toBe('high');
    expect(res.body.status).toBe('in_progress');
    expect(res.body.customer_name).toBe('Jane Doe');
    expect(res.body.tags).toEqual(['billing', 'vip']);
    expect(res.body.metadata).toEqual({ source: 'email', browser: null, device_type: 'mobile' });
  });

  test('returns 400 with Validation failed shape when required fields are missing', async () => {
    const res = await request(app).post('/tickets').send({ subject: 'Only a subject' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    for (const detail of res.body.details) {
      expect(detail).toEqual({ field: expect.any(String), message: expect.any(String) });
    }
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['customer_id', 'customer_email', 'description']));
    // Nothing was persisted.
    expect(store.all()).toHaveLength(0);
  });

  test('returns 400 for an invalid customer_email', async () => {
    const res = await request(app).post('/tickets').send(validTicket({ customer_email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual([
      { field: 'customer_email', message: 'customer_email must be a valid email address' },
    ]);
  });
});

describe('GET /tickets', () => {
  test('returns count 0 and an empty array when no tickets exist', async () => {
    const res = await request(app).get('/tickets');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, tickets: [] });
  });

  test('returns all created tickets with a matching count', async () => {
    const a = await request(app).post('/tickets').send(validTicket({ subject: 'First' }));
    const b = await request(app).post('/tickets').send(validTicket({ subject: 'Second' }));

    const res = await request(app).get('/tickets');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.tickets).toHaveLength(2);
    const ids = res.body.tickets.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
  });

  test('applies the status filter', async () => {
    await request(app).post('/tickets').send(validTicket({ subject: 'Open one' }));
    const resolved = await request(app)
      .post('/tickets')
      .send(validTicket({ subject: 'Done one', status: 'resolved' }));

    const res = await request(app).get('/tickets').query({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.tickets[0].id).toBe(resolved.body.id);
  });
});

describe('GET /tickets/:id', () => {
  test('returns the ticket by id', async () => {
    const created = await request(app).post('/tickets').send(validTicket());

    const res = await request(app).get(`/tickets/${created.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);
  });

  test('returns 404 with the requested id for an unknown ticket', async () => {
    const res = await request(app).get('/tickets/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Ticket not found', id: 'does-not-exist' });
  });
});

describe('PUT /tickets/:id', () => {
  test('updates fields and bumps updated_at', async () => {
    const created = await request(app).post('/tickets').send(validTicket());
    tickClock();

    const res = await request(app)
      .put(`/tickets/${created.body.id}`)
      .send({ subject: 'Updated subject', assigned_to: 'agent-7' });

    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Updated subject');
    expect(res.body.assigned_to).toBe('agent-7');
    expect(res.body.created_at).toBe(created.body.created_at);
    expect(res.body.updated_at > created.body.updated_at).toBe(true);
  });

  test('returns 400 for an invalid priority enum value', async () => {
    const created = await request(app).post('/tickets').send(validTicket());

    const res = await request(app).put(`/tickets/${created.body.id}`).send({ priority: 'ludicrous' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toHaveLength(1);
    expect(res.body.details[0].field).toBe('priority');
    // Ticket is untouched.
    const after = await request(app).get(`/tickets/${created.body.id}`);
    expect(after.body.priority).toBe('medium');
  });

  test('returns 404 when updating an unknown ticket', async () => {
    const res = await request(app).put('/tickets/nope').send({ subject: 'Whatever it takes' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Ticket not found', id: 'nope' });
  });

  test('setting status to resolved stamps resolved_at equal to the new updated_at', async () => {
    const created = await request(app).post('/tickets').send(validTicket());
    expect(created.body.resolved_at).toBeNull();
    tickClock();

    const res = await request(app).put(`/tickets/${created.body.id}`).send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
    expect(res.body.resolved_at).toBe(res.body.updated_at);
    expect(res.body.resolved_at > created.body.created_at).toBe(true);
  });

  test('manual category change is audit-logged as a manual_override', async () => {
    const created = await request(app).post('/tickets').send(validTicket());

    const put = await request(app).put(`/tickets/${created.body.id}`).send({ category: 'bug_report' });
    expect(put.status).toBe(200);
    expect(put.body.category).toBe('bug_report');

    const log = await request(app).get(`/tickets/${created.body.id}/classification-log`);
    expect(log.status).toBe(200);
    expect(log.body.ticket_id).toBe(created.body.id);
    expect(log.body.entries).toHaveLength(1);
    expect(log.body.entries[0].decision).toBe('manual_override');
    expect(log.body.entries[0].changes).toEqual({ category: { from: 'other', to: 'bug_report' } });
  });
});

describe('DELETE /tickets/:id', () => {
  test('deletes a ticket with 204 and an empty body, then GET returns 404', async () => {
    const created = await request(app).post('/tickets').send(validTicket());

    const del = await request(app).delete(`/tickets/${created.body.id}`);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');

    const after = await request(app).get(`/tickets/${created.body.id}`);
    expect(after.status).toBe(404);
    expect(after.body).toEqual({ error: 'Ticket not found', id: created.body.id });
  });

  test('returns 404 when deleting an unknown ticket', async () => {
    const res = await request(app).delete('/tickets/ghost-id');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Ticket not found', id: 'ghost-id' });
  });
});

describe('Unknown routes', () => {
  test('returns 404 with the requested path for a route that does not exist', async () => {
    const res = await request(app).get('/no-such-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', path: '/no-such-route' });
  });
});
