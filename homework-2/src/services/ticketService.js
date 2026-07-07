'use strict';

const store = require('../store');
const { classify } = require('./classifier');
const { generateId, nowISO } = require('../utils/helpers');

/**
 * Build and persist a ticket from an already-validated payload.
 *
 * When `autoClassify` is on, the classifier fills category/priority — but an
 * explicitly provided value always wins (the classifier only fills gaps). The
 * full classification result is stored on the ticket and audit-logged either
 * way, so every decision is traceable.
 *
 * @param {object} payload validated request payload
 * @param {{autoClassify?: boolean}} opts
 * @returns {object} the stored ticket
 */
function createTicket(payload, { autoClassify = false } = {}) {
  const now = nowISO();

  const ticket = {
    id: generateId(),
    customer_id: payload.customer_id,
    customer_email: payload.customer_email,
    customer_name: payload.customer_name ?? null,
    subject: payload.subject,
    description: payload.description,
    category: payload.category ?? 'other',
    priority: payload.priority ?? 'medium',
    status: payload.status ?? 'new',
    created_at: now,
    updated_at: now,
    resolved_at: payload.status === 'resolved' ? now : null,
    assigned_to: payload.assigned_to ?? null,
    tags: payload.tags ?? [],
    metadata: {
      source: payload.metadata?.source ?? 'api',
      browser: payload.metadata?.browser ?? null,
      device_type: payload.metadata?.device_type ?? null,
    },
    classification: null,
  };

  if (autoClassify) {
    const result = classify(ticket);
    const appliedCategory = payload.category === undefined;
    const appliedPriority = payload.priority === undefined;
    if (appliedCategory) ticket.category = result.category;
    if (appliedPriority) ticket.priority = result.priority;

    ticket.classification = {
      ...result,
      classified_at: now,
      applied: { category: appliedCategory, priority: appliedPriority },
      overridden: false,
    };

    store.logClassification({
      ticket_id: ticket.id,
      decision: 'auto_classify_on_create',
      result,
      applied: ticket.classification.applied,
      at: now,
    });
  }

  return store.add(ticket);
}

/**
 * Re-classify an existing ticket (POST /tickets/:id/auto-classify).
 *
 * @param {object} ticket stored ticket (mutated in place)
 * @param {{apply?: boolean}} opts apply=false → dry-run (report, don't change)
 * @returns {object} classification result + what was applied
 */
function reclassifyTicket(ticket, { apply = true } = {}) {
  const now = nowISO();
  const result = classify(ticket);

  if (apply) {
    ticket.category = result.category;
    ticket.priority = result.priority;
    ticket.updated_at = now;
    ticket.classification = {
      ...result,
      classified_at: now,
      applied: { category: true, priority: true },
      overridden: false,
    };
  }

  store.logClassification({
    ticket_id: ticket.id,
    decision: apply ? 'auto_classify' : 'auto_classify_dry_run',
    result,
    applied: { category: apply, priority: apply },
    at: now,
  });

  return { ...result, applied: apply };
}

/**
 * Record a manual category/priority override so the audit trail shows a human
 * decision superseding the classifier.
 */
function recordManualOverride(ticket, changes) {
  const now = nowISO();
  if (ticket.classification) {
    ticket.classification.overridden = true;
  }
  store.logClassification({
    ticket_id: ticket.id,
    decision: 'manual_override',
    changes,
    at: now,
  });
}

module.exports = { createTicket, reclassifyTicket, recordManualOverride };
