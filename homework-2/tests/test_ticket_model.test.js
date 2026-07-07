'use strict';

const request = require('supertest');
const app = require('../src/index');
const store = require('../src/store');
const { validateTicket } = require('../src/validators/ticketValidator');

beforeEach(() => store.reset());

const validTicket = (over = {}) => ({
  customer_id: 'CUST-1',
  customer_email: 'user@example.com',
  subject: 'Test subject',
  description: 'A description that is definitely long enough.',
  ...over,
});

/** Convenience: list of error field names from a validateTicket() result. */
const fieldsOf = (errors) => errors.map((e) => e.field);

describe('ticket model validation (validator direct + POST /tickets)', () => {
  describe('required fields', () => {
    test('missing customer_id is rejected', () => {
      const payload = validTicket();
      delete payload.customer_id;
      const errors = validateTicket(payload);
      expect(fieldsOf(errors)).toEqual(['customer_id']);
      expect(errors[0].message).toMatch(/customer_id/);
    });

    test('missing customer_email is rejected', () => {
      const payload = validTicket();
      delete payload.customer_email;
      expect(fieldsOf(validateTicket(payload))).toEqual(['customer_email']);
    });

    test('missing subject is rejected', () => {
      const payload = validTicket();
      delete payload.subject;
      expect(fieldsOf(validateTicket(payload))).toEqual(['subject']);
    });

    test('missing description is rejected', () => {
      const payload = validTicket();
      delete payload.description;
      expect(fieldsOf(validateTicket(payload))).toEqual(['description']);
    });

    test('empty payload reports all four required fields at once', () => {
      const errors = validateTicket({});
      expect(fieldsOf(errors).sort()).toEqual(
        ['customer_email', 'customer_id', 'description', 'subject'],
      );
      errors.forEach((e) => {
        expect(e).toEqual({ field: expect.any(String), message: expect.any(String) });
      });
    });

    test('non-object body (array) yields a single body-level error', () => {
      expect(validateTicket([validTicket()])).toEqual([
        { field: 'body', message: 'Request body must be a JSON object' },
      ]);
    });
  });

  describe('customer_email format', () => {
    test.each([
      'not-an-email',
      'missing-at.example.com',
      'no-domain@',
      '@no-local.com',
      'no-tld@example',
      'has space@example.com',
    ])('invalid email %p is rejected', (email) => {
      expect(fieldsOf(validateTicket(validTicket({ customer_email: email }))))
        .toEqual(['customer_email']);
    });

    test.each([
      'user@example.com',
      'first.last+tag@sub.domain.co.uk',
    ])('valid email %p is accepted', (email) => {
      expect(validateTicket(validTicket({ customer_email: email }))).toEqual([]);
    });
  });

  describe('subject length boundaries (1-200)', () => {
    test('1-character subject is valid', () => {
      expect(validateTicket(validTicket({ subject: 'x' }))).toEqual([]);
    });

    test('200-character subject is valid', () => {
      expect(validateTicket(validTicket({ subject: 'a'.repeat(200) }))).toEqual([]);
    });

    test('201-character subject is rejected', () => {
      const errors = validateTicket(validTicket({ subject: 'a'.repeat(201) }));
      expect(errors).toEqual([
        { field: 'subject', message: 'subject must be 1-200 characters' },
      ]);
    });

    test('empty and whitespace-only subjects are rejected', () => {
      expect(fieldsOf(validateTicket(validTicket({ subject: '' })))).toEqual(['subject']);
      expect(fieldsOf(validateTicket(validTicket({ subject: '   ' })))).toEqual(['subject']);
    });
  });

  describe('description length boundaries (10-2000)', () => {
    test('exactly 10 characters is valid', () => {
      expect(validateTicket(validTicket({ description: 'a'.repeat(10) }))).toEqual([]);
    });

    test('9 characters is rejected', () => {
      const errors = validateTicket(validTicket({ description: 'a'.repeat(9) }));
      expect(errors).toEqual([
        { field: 'description', message: 'description must be at least 10 characters' },
      ]);
    });

    test('exactly 2000 characters is valid', () => {
      expect(validateTicket(validTicket({ description: 'a'.repeat(2000) }))).toEqual([]);
    });

    test('2001 characters is rejected', () => {
      const errors = validateTicket(validTicket({ description: 'a'.repeat(2001) }));
      expect(errors).toEqual([
        { field: 'description', message: 'description must be 10-2000 characters' },
      ]);
    });

    test('whitespace padding does not count toward the 10-char minimum', () => {
      // 5 real characters padded to length 13 — trimmed length is what matters.
      expect(fieldsOf(validateTicket(validTicket({ description: '    short    ' }))))
        .toEqual(['description']);
    });
  });

  describe('enum fields', () => {
    test.each([
      'account_access', 'technical_issue', 'billing_question',
      'feature_request', 'bug_report', 'other',
    ])('category %p is accepted', (category) => {
      expect(validateTicket(validTicket({ category }))).toEqual([]);
    });

    test('unknown category is rejected with the allowed list in the message', () => {
      const errors = validateTicket(validTicket({ category: 'sales_inquiry' }));
      expect(fieldsOf(errors)).toEqual(['category']);
      expect(errors[0].message).toContain('account_access');
    });

    test.each(['urgent', 'high', 'medium', 'low'])('priority %p is accepted', (priority) => {
      expect(validateTicket(validTicket({ priority }))).toEqual([]);
    });

    test('unknown priority is rejected', () => {
      expect(fieldsOf(validateTicket(validTicket({ priority: 'critical' }))))
        .toEqual(['priority']);
    });

    test.each([
      'new', 'in_progress', 'waiting_customer', 'resolved', 'closed',
    ])('status %p is accepted', (status) => {
      expect(validateTicket(validTicket({ status }))).toEqual([]);
    });

    test('unknown status is rejected', () => {
      expect(fieldsOf(validateTicket(validTicket({ status: 'open' })))).toEqual(['status']);
    });
  });

  describe('tags', () => {
    test('array of non-empty strings is accepted', () => {
      expect(validateTicket(validTicket({ tags: ['billing', 'vip'] }))).toEqual([]);
      expect(validateTicket(validTicket({ tags: [] }))).toEqual([]);
    });

    test.each([
      ['a plain string', 'billing'],
      ['an array containing an empty string', ['ok', '']],
      ['an array containing whitespace-only', ['ok', '   ']],
      ['an array containing a non-string', ['ok', 42]],
    ])('tags as %s is rejected', (_label, tags) => {
      const errors = validateTicket(validTicket({ tags }));
      expect(errors).toEqual([
        { field: 'tags', message: 'tags must be an array of non-empty strings' },
      ]);
    });
  });

  describe('metadata', () => {
    test('valid metadata (source, device_type, browser) is accepted', () => {
      const metadata = { source: 'web_form', device_type: 'desktop', browser: 'Firefox 140' };
      expect(validateTicket(validTicket({ metadata }))).toEqual([]);
    });

    test('metadata must be an object — null and array are rejected', () => {
      expect(fieldsOf(validateTicket(validTicket({ metadata: null })))).toEqual(['metadata']);
      expect(fieldsOf(validateTicket(validTicket({ metadata: ['web_form'] })))).toEqual(['metadata']);
    });

    test('metadata.source outside the enum is rejected', () => {
      const errors = validateTicket(validTicket({ metadata: { source: 'carrier_pigeon' } }));
      expect(fieldsOf(errors)).toEqual(['metadata.source']);
      expect(errors[0].message).toContain('web_form');
    });

    test.each(['web_form', 'email', 'api', 'chat', 'phone'])(
      'metadata.source %p is accepted',
      (source) => {
        expect(validateTicket(validTicket({ metadata: { source } }))).toEqual([]);
      },
    );

    test('metadata.device_type outside the enum is rejected', () => {
      const errors = validateTicket(validTicket({ metadata: { device_type: 'smartwatch' } }));
      expect(fieldsOf(errors)).toEqual(['metadata.device_type']);
      expect(errors[0].message).toContain('desktop');
    });

    test.each(['desktop', 'mobile', 'tablet'])(
      'metadata.device_type %p is accepted',
      (deviceType) => {
        expect(validateTicket(validTicket({ metadata: { device_type: deviceType } }))).toEqual([]);
      },
    );

    test('metadata.browser must be a string', () => {
      expect(fieldsOf(validateTicket(validTicket({ metadata: { browser: 140 } }))))
        .toEqual(['metadata.browser']);
      expect(validateTicket(validTicket({ metadata: { browser: 'Safari' } }))).toEqual([]);
    });
  });

  describe('assigned_to', () => {
    test('null is explicitly allowed (unassigned)', () => {
      expect(validateTicket(validTicket({ assigned_to: null }))).toEqual([]);
    });

    test('a non-empty string is allowed', () => {
      expect(validateTicket(validTicket({ assigned_to: 'agent-7' }))).toEqual([]);
    });

    test('empty string and non-string values are rejected', () => {
      expect(fieldsOf(validateTicket(validTicket({ assigned_to: '' })))).toEqual(['assigned_to']);
      expect(fieldsOf(validateTicket(validTicket({ assigned_to: 42 })))).toEqual(['assigned_to']);
    });
  });

  describe('partial mode (PUT semantics)', () => {
    test('empty body is valid — nothing provided means nothing to check', () => {
      expect(validateTicket({}, { partial: true })).toEqual([]);
    });

    test('only provided fields are validated; missing required fields are ignored', () => {
      const errors = validateTicket({ customer_email: 'nope' }, { partial: true });
      expect(fieldsOf(errors)).toEqual(['customer_email']);
    });

    test('provided fields still enforce their constraints', () => {
      expect(fieldsOf(validateTicket({ subject: 'a'.repeat(201) }, { partial: true })))
        .toEqual(['subject']);
      expect(fieldsOf(validateTicket({ description: 'too short' }, { partial: true })))
        .toEqual(['description']);
      expect(fieldsOf(validateTicket({ category: 'bogus' }, { partial: true })))
        .toEqual(['category']);
    });

    test('valid partial update payload passes', () => {
      expect(validateTicket({ status: 'resolved', priority: 'high' }, { partial: true }))
        .toEqual([]);
    });
  });

  describe('validation through the API', () => {
    test('POST /tickets with a valid payload returns 201 and echoes the fields', async () => {
      const res = await request(app).post('/tickets').send(validTicket());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        customer_id: 'CUST-1',
        customer_email: 'user@example.com',
        subject: 'Test subject',
      });
      expect(res.body.id).toBeDefined();
    });

    test('POST /tickets with an invalid payload returns the 400 error shape', async () => {
      const res = await request(app)
        .post('/tickets')
        .send(validTicket({ customer_email: 'bad', description: 'short' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(fieldsOf(res.body.details).sort()).toEqual(['customer_email', 'description']);
      res.body.details.forEach((d) => {
        expect(d).toEqual({ field: expect.any(String), message: expect.any(String) });
      });
      // Nothing was stored.
      const list = await request(app).get('/tickets');
      expect(list.body.count).toBe(0);
    });

    test('PUT /tickets/:id uses partial validation — a lone valid field updates, a lone invalid field 400s', async () => {
      const created = await request(app).post('/tickets').send(validTicket());
      const id = created.body.id;

      const ok = await request(app).put(`/tickets/${id}`).send({ status: 'in_progress' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('in_progress');

      const bad = await request(app).put(`/tickets/${id}`).send({ priority: 'severe' });
      expect(bad.status).toBe(400);
      expect(fieldsOf(bad.body.details)).toEqual(['priority']);
    });
  });
});
