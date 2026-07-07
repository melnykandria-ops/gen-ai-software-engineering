'use strict';

const express = require('express');
const store = require('../store');
const { validateTicket } = require('../validators/ticketValidator');
const { createTicket, reclassifyTicket, recordManualOverride } = require('../services/ticketService');
const { detectFormat, parseContent, SUPPORTED_FORMATS, ImportParseError } = require('../services/importers');
const { nowISO } = require('../utils/helpers');

const router = express.Router();

const flag = (v) => v === true || v === 'true' || v === '1';

/**
 * POST /tickets — create a ticket.
 * Optional auto-classification: ?autoClassify=true or body auto_classify: true.
 */
router.post('/', (req, res) => {
  const errors = validateTicket(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  const autoClassify = flag(req.query.autoClassify) || flag(req.body.auto_classify);
  const ticket = createTicket(req.body, { autoClassify });
  return res.status(201).json(ticket);
});

/**
 * POST /tickets/import — bulk import from CSV / JSON / XML.
 * Body: raw file content. Format from ?format= or Content-Type.
 * Optional ?autoClassify=true classifies every successfully imported ticket.
 */
router.post('/import', (req, res) => {
  const format = detectFormat(req.query.format, req.headers['content-type']);
  if (!format) {
    return res.status(400).json({
      error: 'Unknown import format',
      message: `Specify ?format= or a Content-Type header. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
    });
  }

  let records;
  try {
    records = parseContent(format, req.body);
  } catch (err) {
    if (err instanceof ImportParseError) {
      return res.status(400).json({ error: 'Import file could not be parsed', format, message: err.message });
    }
    /* istanbul ignore next -- unexpected parser failure */
    throw err;
  }

  const autoClassify = flag(req.query.autoClassify);
  const summary = {
    format,
    total: records.length,
    successful: 0,
    failed: 0,
    errors: [],
    created_ids: [],
  };

  records.forEach((record, index) => {
    const errors = validateTicket(record);
    if (errors.length > 0) {
      summary.failed += 1;
      summary.errors.push({ record: index + 1, subject: record && record.subject, errors });
      return;
    }
    const ticket = createTicket(record, { autoClassify });
    summary.successful += 1;
    summary.created_ids.push(ticket.id);
  });

  return res.status(summary.successful > 0 ? 201 : 400).json(summary);
});

/**
 * GET /tickets — list with combinable filters:
 * status, category, priority, customer_id, assigned_to, source, tag, q, from, to.
 */
router.get('/', (req, res) => {
  const { status, category, priority, customer_id, assigned_to, source, tag, q, from, to } = req.query;
  const tickets = store.filter({ status, category, priority, customer_id, assigned_to, source, tag, q, from, to });
  return res.status(200).json({ count: tickets.length, tickets });
});

/** GET /tickets/:id — one ticket. */
router.get('/:id', (req, res) => {
  const ticket = store.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found', id: req.params.id });
  return res.status(200).json(ticket);
});

/** GET /tickets/:id/classification-log — audit trail of decisions. */
router.get('/:id/classification-log', (req, res) => {
  const ticket = store.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found', id: req.params.id });
  return res.status(200).json({ ticket_id: ticket.id, entries: store.getClassificationLog(ticket.id) });
});

/**
 * POST /tickets/:id/auto-classify — (re)run classification.
 * ?apply=false → dry-run: returns the result without changing the ticket.
 */
router.post('/:id/auto-classify', (req, res) => {
  const ticket = store.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found', id: req.params.id });

  const apply = req.query.apply === undefined ? true : flag(req.query.apply);
  const result = reclassifyTicket(ticket, { apply });

  return res.status(200).json({
    ticket_id: ticket.id,
    category: result.category,
    priority: result.priority,
    confidence: result.confidence,
    reasoning: result.reasoning,
    keywords_found: result.keywords_found,
    applied: result.applied,
  });
});

/**
 * PUT /tickets/:id — update mutable fields. Manual category/priority changes
 * are treated as overrides of the classifier and audit-logged.
 */
router.put('/:id', (req, res) => {
  const ticket = store.findById(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found', id: req.params.id });

  const errors = validateTicket(req.body, { partial: true });
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const updatable = [
    'customer_id', 'customer_email', 'customer_name', 'subject', 'description',
    'category', 'priority', 'status', 'assigned_to', 'tags',
  ];

  const overrideChanges = {};
  for (const field of ['category', 'priority']) {
    if (req.body[field] !== undefined && req.body[field] !== ticket[field]) {
      overrideChanges[field] = { from: ticket[field], to: req.body[field] };
    }
  }

  for (const field of updatable) {
    if (req.body[field] !== undefined) ticket[field] = req.body[field];
  }
  if (req.body.metadata !== undefined) {
    ticket.metadata = { ...ticket.metadata, ...req.body.metadata };
  }

  ticket.updated_at = nowISO();
  if (req.body.status === 'resolved' && !ticket.resolved_at) {
    ticket.resolved_at = ticket.updated_at;
  }

  if (Object.keys(overrideChanges).length > 0) {
    recordManualOverride(ticket, overrideChanges);
  }

  return res.status(200).json(ticket);
});

/** DELETE /tickets/:id — remove a ticket. */
router.delete('/:id', (req, res) => {
  const deleted = store.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Ticket not found', id: req.params.id });
  return res.status(204).send();
});

module.exports = router;
