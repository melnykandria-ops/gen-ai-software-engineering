'use strict';

const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');
const { classify } = require('../src/services/classifier');

const validTicket = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

beforeEach(() => store.reset());

// ---------------------------------------------------------------------------
// classify() — direct unit tests
// ---------------------------------------------------------------------------

describe('classify() — category detection', () => {
  test('detects account_access from password/login language', () => {
    const result = classify({
      subject: 'Password reset not arriving',
      description: 'I cannot log in to the portal after requesting a password reset.',
    });
    expect(result.category).toBe('account_access');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['cannot log in', 'password']));
  });

  test('detects technical_issue from crash/error language', () => {
    const result = classify({
      subject: 'App crash on startup',
      description: 'The app crashes with an error message every time it starts.',
    });
    expect(result.category).toBe('technical_issue');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['error', 'crash', 'crashes']));
    // 3 single-word hits -> 0.5 + 0.1*3
    expect(result.confidence).toBeCloseTo(0.8, 5);
  });

  test('detects billing_question from refund/invoice language', () => {
    const result = classify({
      subject: 'Refund request',
      description: 'Kindly refund the invoice; the amount was wrong.',
    });
    expect(result.category).toBe('billing_question');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['refund', 'invoice']));
    // 2 single-word hits -> 0.5 + 0.1*2
    expect(result.confidence).toBeCloseTo(0.7, 5);
  });

  test("detects feature_request from 'please add' / 'would be great'", () => {
    const result = classify({
      subject: 'Dark mode',
      description: 'Please add a dark theme, it would be great for night use.',
    });
    expect(result.category).toBe('feature_request');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['please add', 'would be great']));
  });

  test("detects bug_report from 'steps to reproduce' and behavior phrases", () => {
    const result = classify({
      subject: 'Regression in export',
      description:
        'Steps to reproduce: open a report and export. Expected behavior: file downloads. Actual behavior: nothing happens.',
    });
    expect(result.category).toBe('bug_report');
    expect(result.keywords_found).toEqual(
      expect.arrayContaining(['steps to reproduce', 'expected behavior', 'actual behavior', 'regression'])
    );
  });

  test("falls back to 'other' with confidence 0.3 and no keywords when nothing matches", () => {
    const result = classify({
      subject: 'Quick note',
      description: 'Wanted to share how much the team enjoys the product.',
    });
    expect(result.category).toBe('other');
    expect(result.confidence).toBe(0.3);
    expect(result.keywords_found).toEqual([]);
    expect(result.priority).toBe('medium');
  });
});

describe('classify() — priority rules', () => {
  test("assigns urgent for 'production down' / 'critical'", () => {
    const result = classify({
      subject: 'Production down',
      description: 'Critical outage: production down for all users.',
    });
    expect(result.priority).toBe('urgent');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['critical', 'production down']));
  });

  test("assigns high for 'blocking' / 'asap'", () => {
    const result = classify({
      subject: 'Deployment held up',
      description: 'This is blocking the release, need help asap.',
    });
    expect(result.priority).toBe('high');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['blocking', 'asap']));
  });

  test("assigns low for 'minor' / 'cosmetic'", () => {
    const result = classify({
      subject: 'Small visual nit',
      description: 'A minor cosmetic misalignment on the settings screen.',
    });
    expect(result.priority).toBe('low');
    expect(result.keywords_found).toEqual(expect.arrayContaining(['minor', 'cosmetic']));
  });

  test('defaults to medium when no priority keywords match', () => {
    const result = classify({
      subject: 'Question about exports',
      description: 'How do I schedule the weekly export to my email?',
    });
    expect(result.priority).toBe('medium');
  });

  test('urgent outranks high when keywords from both levels are present', () => {
    const result = classify({
      subject: 'Release',
      description: 'This critical problem is blocking everyone.',
    });
    expect(result.priority).toBe('urgent');
    expect(result.keywords_found).toContain('critical');
    expect(result.keywords_found).not.toContain('blocking');
  });
});

describe('classify() — confidence and explainability', () => {
  test('confidence is always within [0, 1]', () => {
    const samples = [
      {},
      { subject: 'Hello', description: 'Nothing relevant here at all.' },
      { subject: 'Refund', description: 'I would like a refund.' },
      { subject: 'Crash', description: 'It crashes with an error and a timeout, broken and slow.' },
      { subject: 'Login', description: "I can't log in, password rejected, locked out, urgent." },
    ];
    for (const sample of samples) {
      const { confidence } = classify(sample);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  test('confidence grows with more keyword evidence and is capped at 0.95', () => {
    const one = classify({ subject: 'x', description: 'I would like a refund.' });
    const two = classify({ subject: 'x', description: 'I would like a refund for this invoice.' });
    expect(one.category).toBe('billing_question');
    expect(two.category).toBe('billing_question');
    expect(two.confidence).toBeGreaterThan(one.confidence);

    const many = classify({
      subject: 'billing',
      description: 'payment invoice refund charge billing subscription receipt price',
    });
    expect(many.confidence).toBe(0.95);
  });

  test('keywords_found lists the exact matched category and priority phrases', () => {
    const result = classify({
      subject: 'Refund needed urgent',
      description: 'The invoice was wrong and this is urgent.',
    });
    expect(result.category).toBe('billing_question');
    expect(result.priority).toBe('urgent');
    expect([...result.keywords_found].sort()).toEqual(['invoice', 'refund', 'urgent']);
  });

  test('reasoning is a non-empty string mentioning the chosen category', () => {
    const matched = classify({ subject: 'Refund', description: 'A refund for my invoice, thank you.' });
    expect(typeof matched.reasoning).toBe('string');
    expect(matched.reasoning.length).toBeGreaterThan(0);
    expect(matched.reasoning).toContain('billing_question');

    const fallback = classify({ subject: 'Note', description: 'Sharing some kind words with the team.' });
    expect(typeof fallback.reasoning).toBe('string');
    expect(fallback.reasoning).toContain('other');
  });
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/auto-classify
// ---------------------------------------------------------------------------

describe('POST /tickets/:id/auto-classify', () => {
  test('applies classification to the ticket and returns the full result', async () => {
    const created = await request(app)
      .post('/tickets')
      .send(validTicket({
        subject: 'Cannot log in',
        description: 'I cannot log in even after a password reset, please help.',
      }));
    expect(created.status).toBe(201);
    expect(created.body.category).toBe('other'); // default, not yet classified
    expect(created.body.classification).toBeNull();

    const res = await request(app).post(`/tickets/${created.body.id}/auto-classify`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ticket_id: created.body.id,
      category: 'account_access',
      priority: 'medium',
      applied: true,
    });
    expect(typeof res.body.confidence).toBe('number');
    expect(typeof res.body.reasoning).toBe('string');
    expect(res.body.keywords_found).toContain('cannot log in');

    const fetched = await request(app).get(`/tickets/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.category).toBe('account_access');
    expect(fetched.body.priority).toBe('medium');
    expect(fetched.body.classification).toMatchObject({
      category: 'account_access',
      applied: { category: true, priority: true },
      overridden: false,
    });
  });

  test('?apply=false is a dry-run: result returned, ticket untouched, dry-run logged', async () => {
    const created = await request(app)
      .post('/tickets')
      .send(validTicket({
        subject: 'Refund',
        description: 'I want a refund for invoice INV-42, thank you.',
      }));
    expect(created.status).toBe(201);

    const res = await request(app).post(`/tickets/${created.body.id}/auto-classify?apply=false`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.category).toBe('billing_question');

    const fetched = await request(app).get(`/tickets/${created.body.id}`);
    expect(fetched.body.category).toBe('other');
    expect(fetched.body.priority).toBe('medium');
    expect(fetched.body.classification).toBeNull();
    expect(fetched.body.updated_at).toBe(created.body.updated_at);

    const log = await request(app).get(`/tickets/${created.body.id}/classification-log`);
    expect(log.status).toBe(200);
    expect(log.body.entries).toHaveLength(1);
    expect(log.body.entries[0].decision).toBe('auto_classify_dry_run');
  });

  test('returns 404 for an unknown ticket id', async () => {
    const res = await request(app).post('/tickets/no-such-id/auto-classify');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Ticket not found', id: 'no-such-id' });
  });
});

// ---------------------------------------------------------------------------
// Auto-classification on create
// ---------------------------------------------------------------------------

describe('POST /tickets with auto-classification on create', () => {
  test('?autoClassify=true fills category and priority gaps and stores classification', async () => {
    const res = await request(app)
      .post('/tickets?autoClassify=true')
      .send(validTicket({
        subject: 'App crash',
        description: 'The app crashes with an error every time I open settings.',
      }));
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('technical_issue');
    expect(res.body.priority).toBe('medium');
    expect(res.body.classification).toMatchObject({
      category: 'technical_issue',
      priority: 'medium',
      applied: { category: true, priority: true },
      overridden: false,
    });
    expect(typeof res.body.classification.confidence).toBe('number');
    expect(res.body.classification.classified_at).toEqual(expect.any(String));
  });

  test('body flag auto_classify:true also triggers classification on create', async () => {
    const res = await request(app)
      .post('/tickets')
      .send(validTicket({
        auto_classify: true,
        subject: 'Broken export',
        description: 'The export is broken and fails with a timeout.',
      }));
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('technical_issue');
    expect(res.body.classification).not.toBeNull();
  });

  test('explicit category wins over the classifier; priority gap is still filled', async () => {
    const res = await request(app)
      .post('/tickets?autoClassify=true')
      .send(validTicket({
        category: 'feature_request',
        subject: 'Refund needed urgently',
        description: 'I was charged twice and want a refund.',
      }));
    expect(res.status).toBe(201);
    // classifier says billing_question/urgent, but the explicit category wins
    expect(res.body.category).toBe('feature_request');
    expect(res.body.priority).toBe('urgent');
    expect(res.body.classification.category).toBe('billing_question');
    expect(res.body.classification.applied).toEqual({ category: false, priority: true });
  });

  test('explicit priority wins over the classifier; category gap is still filled', async () => {
    const res = await request(app)
      .post('/tickets?autoClassify=true')
      .send(validTicket({
        priority: 'low',
        subject: 'Billing question',
        description: 'Kindly refund the invoice for my subscription.',
      }));
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('billing_question');
    expect(res.body.priority).toBe('low');
    expect(res.body.classification.applied).toEqual({ category: true, priority: false });
  });
});

// ---------------------------------------------------------------------------
// Classification log + manual overrides
// ---------------------------------------------------------------------------

describe('classification audit log and manual overrides', () => {
  test('every decision is appended to GET /tickets/:id/classification-log in order', async () => {
    const created = await request(app)
      .post('/tickets?autoClassify=true')
      .send(validTicket({
        subject: 'Crash report',
        description: 'The dashboard crashes with an error after login.',
      }));
    expect(created.status).toBe(201);
    const id = created.body.id;

    await request(app).post(`/tickets/${id}/auto-classify`);
    await request(app).post(`/tickets/${id}/auto-classify?apply=false`);

    const log = await request(app).get(`/tickets/${id}/classification-log`);
    expect(log.status).toBe(200);
    expect(log.body.ticket_id).toBe(id);
    expect(log.body.entries.map((e) => e.decision)).toEqual([
      'auto_classify_on_create',
      'auto_classify',
      'auto_classify_dry_run',
    ]);
    for (const entry of log.body.entries) {
      expect(entry.ticket_id).toBe(id);
      expect(entry.result).toMatchObject({ category: 'technical_issue' });
      expect(entry.at).toEqual(expect.any(String));
    }
  });

  test('manual PUT category/priority change sets classification.overridden and logs manual_override', async () => {
    const created = await request(app)
      .post('/tickets?autoClassify=true')
      .send(validTicket({
        subject: 'Refund',
        description: 'I want a refund for invoice INV-9 as agreed.',
      }));
    expect(created.status).toBe(201);
    expect(created.body.category).toBe('billing_question');
    expect(created.body.priority).toBe('medium');

    const updated = await request(app)
      .put(`/tickets/${created.body.id}`)
      .send({ category: 'technical_issue', priority: 'low' });
    expect(updated.status).toBe(200);
    expect(updated.body.category).toBe('technical_issue');
    expect(updated.body.priority).toBe('low');
    expect(updated.body.classification.overridden).toBe(true);

    const log = await request(app).get(`/tickets/${created.body.id}/classification-log`);
    expect(log.body.entries.map((e) => e.decision)).toEqual(['auto_classify_on_create', 'manual_override']);
    expect(log.body.entries[1].changes).toEqual({
      category: { from: 'billing_question', to: 'technical_issue' },
      priority: { from: 'medium', to: 'low' },
    });
  });

  test('manual override on a never-classified ticket is still audit-logged', async () => {
    const created = await request(app).post('/tickets').send(validTicket());
    expect(created.status).toBe(201);
    expect(created.body.classification).toBeNull();

    const updated = await request(app)
      .put(`/tickets/${created.body.id}`)
      .send({ category: 'bug_report' });
    expect(updated.status).toBe(200);
    expect(updated.body.classification).toBeNull();

    const log = await request(app).get(`/tickets/${created.body.id}/classification-log`);
    expect(log.body.entries).toHaveLength(1);
    expect(log.body.entries[0].decision).toBe('manual_override');
    expect(log.body.entries[0].changes).toEqual({ category: { from: 'other', to: 'bug_report' } });
  });

  test('PUT with unchanged category/priority does not log a manual_override', async () => {
    const created = await request(app).post('/tickets').send(validTicket());
    expect(created.status).toBe(201);

    const updated = await request(app)
      .put(`/tickets/${created.body.id}`)
      .send({ category: 'other', priority: 'medium' }); // same as defaults
    expect(updated.status).toBe(200);

    const log = await request(app).get(`/tickets/${created.body.id}/classification-log`);
    expect(log.body.entries).toHaveLength(0);
  });
});
