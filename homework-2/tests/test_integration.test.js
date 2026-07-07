'use strict';

/**
 * End-to-end integration tests — full workflows across create, import,
 * classification, filtering, updates, audit trail and deletion.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const validTicket = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

beforeEach(() => store.reset());

describe('Integration: full ticket lifecycle', () => {
  test('create → auto-classify → assign → waiting_customer → resolve → close → delete → 404', async () => {
    // 1. Create (no auto-classification yet → defaults).
    const created = await request(app)
      .post('/tickets')
      .send(validTicket({
        subject: 'Cannot log in after password reset',
        description: 'I am locked out of my account and cannot access anything, please help.',
      }))
      .expect(201);

    const id = created.body.id;
    expect(id).toEqual(expect.any(String));
    expect(created.body.status).toBe('new');
    expect(created.body.category).toBe('other');
    expect(created.body.priority).toBe('medium');
    expect(created.body.resolved_at).toBeNull();
    expect(created.body.classification).toBeNull();

    // 2. Auto-classify: account-access keywords + "cannot access" → urgent.
    const classified = await request(app).post(`/tickets/${id}/auto-classify`).expect(200);
    expect(classified.body).toMatchObject({
      ticket_id: id,
      category: 'account_access',
      priority: 'urgent',
      applied: true,
    });
    expect(classified.body.confidence).toBeGreaterThan(0.5);
    expect(classified.body.keywords_found).toContain('cannot log in');

    // 3. Assign an agent and start work.
    const inProgress = await request(app)
      .put(`/tickets/${id}`)
      .send({ assigned_to: 'agent-007', status: 'in_progress' })
      .expect(200);
    expect(inProgress.body.assigned_to).toBe('agent-007');
    expect(inProgress.body.status).toBe('in_progress');
    expect(inProgress.body.category).toBe('account_access'); // classification stuck
    expect(inProgress.body.resolved_at).toBeNull();

    // 4. Wait on the customer.
    const waiting = await request(app)
      .put(`/tickets/${id}`)
      .send({ status: 'waiting_customer' })
      .expect(200);
    expect(waiting.body.status).toBe('waiting_customer');
    expect(waiting.body.resolved_at).toBeNull();

    // 5. Resolve — resolved_at gets stamped.
    const resolved = await request(app)
      .put(`/tickets/${id}`)
      .send({ status: 'resolved' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolved_at).toBe(resolved.body.updated_at);

    // 6. Close — resolved_at is preserved, not re-stamped.
    const closed = await request(app)
      .put(`/tickets/${id}`)
      .send({ status: 'closed' })
      .expect(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.resolved_at).toBe(resolved.body.resolved_at);

    // Status-only updates never create manual_override entries.
    const log = await request(app).get(`/tickets/${id}/classification-log`).expect(200);
    expect(log.body.entries).toHaveLength(1);
    expect(log.body.entries[0].decision).toBe('auto_classify');

    // 7. Delete, then the ticket is gone.
    await request(app).delete(`/tickets/${id}`).expect(204);
    const gone = await request(app).get(`/tickets/${id}`).expect(404);
    expect(gone.body).toEqual({ error: 'Ticket not found', id });
  });
});

describe('Integration: bulk CSV import with auto-classification', () => {
  test('imports all 50 fixture rows and stores an applied classification on every ticket', async () => {
    const res = await request(app)
      .post('/tickets/import?format=csv&autoClassify=true')
      .set('Content-Type', 'text/csv')
      .send(fixture('sample_tickets.csv'))
      .expect(201);

    expect(res.body).toMatchObject({ format: 'csv', total: 50, successful: 50, failed: 0 });
    expect(res.body.errors).toEqual([]);
    expect(res.body.created_ids).toHaveLength(50);

    const list = await request(app).get('/tickets').expect(200);
    expect(list.body.count).toBe(50);

    // Every imported ticket carries a stored classification, fully applied
    // (the CSV fixture has no category/priority columns → classifier fills both).
    for (const ticket of list.body.tickets) {
      expect(ticket.classification).not.toBeNull();
      expect(ticket.classification.applied).toEqual({ category: true, priority: true });
      expect(ticket.category).toBe(ticket.classification.category);
      expect(ticket.priority).toBe(ticket.classification.priority);
      expect(ticket.classification.confidence).toBeGreaterThanOrEqual(0.3);
    }

    // Spot-check known rows via GET (created_ids preserve file order).
    const expectations = [
      { index: 0, category: 'account_access', priority: 'urgent' }, // "Can't access my account…" + "critical"
      { index: 2, category: 'billing_question', priority: 'medium' }, // "Charged twice…refund…invoice"
      { index: 3, category: 'feature_request', priority: 'low' }, // "Please add dark mode…suggestion"
      { index: 4, category: 'technical_issue', priority: 'urgent' }, // "error 500…production down"
      { index: 7, category: 'other', priority: 'low' }, // "Minor typo…cosmetic" — no category keywords
    ];
    for (const { index, category, priority } of expectations) {
      const one = await request(app).get(`/tickets/${res.body.created_ids[index]}`).expect(200);
      expect(one.body.category).toBe(category);
      expect(one.body.priority).toBe(priority);
      expect(one.body.classification.reasoning).toEqual(expect.any(String));
    }
  });
});

describe('Integration: concurrent ticket creation', () => {
  test('25 simultaneous POSTs all succeed with unique ids and nothing is lost', async () => {
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        request(app)
          .post('/tickets')
          .send(validTicket({ customer_id: `CUST-C${i}`, subject: `Concurrent ticket ${i}` }))),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.id).toEqual(expect.any(String));
    }

    const ids = responses.map((r) => r.body.id);
    expect(new Set(ids).size).toBe(25);

    const list = await request(app).get('/tickets').expect(200);
    expect(list.body.count).toBe(25);
    expect(new Set(list.body.tickets.map((t) => t.id))).toEqual(new Set(ids));
  });
});

describe('Integration: combined filtering over a mixed import + create seed', () => {
  const seedCSV = [
    'customer_id,customer_email,subject,description,category,priority,status',
    'FILT-1,f1@example.com,Seed alpha,A neutral seed description for filtering tests.,technical_issue,high,new',
    'FILT-2,f2@example.com,Seed bravo,A neutral seed description for filtering tests.,technical_issue,high,in_progress',
    'FILT-3,f3@example.com,Seed charlie,A neutral seed description for filtering tests.,technical_issue,low,new',
    'FILT-4,f4@example.com,Seed delta,A neutral seed description for filtering tests.,billing_question,high,new',
  ].join('\n');

  test('category+priority (and +status) filters return exactly the matching set', async () => {
    const imported = await request(app)
      .post('/tickets/import?format=csv')
      .set('Content-Type', 'text/csv')
      .send(seedCSV)
      .expect(201);
    expect(imported.body).toMatchObject({ successful: 4, failed: 0 });

    await request(app)
      .post('/tickets')
      .send(validTicket({ customer_id: 'FILT-5', subject: 'Seed echo', category: 'technical_issue', priority: 'high' }))
      .expect(201);
    await request(app)
      .post('/tickets')
      .send(validTicket({ customer_id: 'FILT-6', subject: 'Seed foxtrot' })) // defaults: other/medium
      .expect(201);

    // category AND priority.
    const filtered = await request(app)
      .get('/tickets?category=technical_issue&priority=high')
      .expect(200);
    expect(filtered.body.count).toBe(3);
    expect(filtered.body.tickets).toHaveLength(3);
    for (const t of filtered.body.tickets) {
      expect(t.category).toBe('technical_issue');
      expect(t.priority).toBe('high');
    }
    expect(new Set(filtered.body.tickets.map((t) => t.customer_id)))
      .toEqual(new Set(['FILT-1', 'FILT-2', 'FILT-5']));

    // Adding status narrows further (AND semantics across three filters).
    const narrowed = await request(app)
      .get('/tickets?category=technical_issue&priority=high&status=in_progress')
      .expect(200);
    expect(narrowed.body.count).toBe(1);
    expect(narrowed.body.tickets[0]).toMatchObject({
      customer_id: 'FILT-2',
      category: 'technical_issue',
      priority: 'high',
      status: 'in_progress',
    });

    // Sanity: single filter is a superset of the combined one.
    const byCategory = await request(app).get('/tickets?category=technical_issue').expect(200);
    expect(byCategory.body.count).toBe(4);
  });
});

describe('Integration: import → manual override → audit trail', () => {
  test('classification log shows auto_classify_on_create then manual_override, in order', async () => {
    const payload = JSON.stringify({
      tickets: [{
        customer_id: 'AUDIT-1',
        customer_email: 'audit@example.com',
        subject: 'Refund never arrived',
        description: 'I was charged twice and my refund invoice never arrived for this payment.',
      }],
    });

    const imported = await request(app)
      .post('/tickets/import?format=json&autoClassify=true')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);
    expect(imported.body).toMatchObject({ format: 'json', successful: 1, failed: 0 });

    const id = imported.body.created_ids[0];
    const beforeOverride = await request(app).get(`/tickets/${id}`).expect(200);
    expect(beforeOverride.body.category).toBe('billing_question');
    expect(beforeOverride.body.priority).toBe('medium');
    expect(beforeOverride.body.classification.overridden).toBe(false);

    // A human disagrees with the classifier.
    const overridden = await request(app)
      .put(`/tickets/${id}`)
      .send({ category: 'technical_issue', priority: 'high' })
      .expect(200);
    expect(overridden.body.category).toBe('technical_issue');
    expect(overridden.body.priority).toBe('high');
    expect(overridden.body.classification.overridden).toBe(true);

    const log = await request(app).get(`/tickets/${id}/classification-log`).expect(200);
    expect(log.body.ticket_id).toBe(id);
    expect(log.body.entries).toHaveLength(2);
    expect(log.body.entries.map((e) => e.decision))
      .toEqual(['auto_classify_on_create', 'manual_override']);
    expect(log.body.entries[0].result.category).toBe('billing_question');
    expect(log.body.entries[0].applied).toEqual({ category: true, priority: true });
    expect(log.body.entries[1].changes).toEqual({
      category: { from: 'billing_question', to: 'technical_issue' },
      priority: { from: 'medium', to: 'high' },
    });
  });
});

describe('Integration: explicit values win over the classifier during import', () => {
  test('autoClassify fills only the gaps a record leaves open', async () => {
    const payload = JSON.stringify([{
      customer_id: 'GAP-1',
      customer_email: 'gap@example.com',
      subject: 'Dashboard crashes with error',
      description: 'The dashboard crashes with an error and this is really important for us.',
      category: 'billing_question', // explicit — must survive classification
      // priority omitted — classifier should fill it ("important" → high)
    }]);

    const imported = await request(app)
      .post('/tickets/import?format=json&autoClassify=true')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(201);

    const ticket = (await request(app).get(`/tickets/${imported.body.created_ids[0]}`).expect(200)).body;
    expect(ticket.category).toBe('billing_question'); // explicit value kept
    expect(ticket.priority).toBe('high'); // gap filled by the classifier
    expect(ticket.classification.applied).toEqual({ category: false, priority: true });
    expect(ticket.classification.category).toBe('technical_issue'); // raw result still auditable
  });
});
