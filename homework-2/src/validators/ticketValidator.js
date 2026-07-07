'use strict';

const {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  SOURCES,
  DEVICE_TYPES,
  EMAIL_PATTERN,
} = require('../utils/helpers');

/** Fields a client may set; everything else (id, timestamps) is server-managed. */
const MUTABLE_FIELDS = new Set([
  'customer_id', 'customer_email', 'customer_name',
  'subject', 'description', 'category', 'priority', 'status',
  'assigned_to', 'tags', 'metadata', 'auto_classify',
]);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate a ticket payload.
 *
 * @param {object} body raw request body
 * @param {{partial?: boolean}} opts partial=true validates only provided fields (PUT)
 * @returns {{field: string, message: string}[]} empty array when valid
 */
function validateTicket(body = {}, { partial = false } = {}) {
  const errors = [];
  const has = (f) => body[f] !== undefined;

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }];
  }

  // --- required on create ---------------------------------------------------
  if (!partial || has('customer_id')) {
    if (!isNonEmptyString(body.customer_id)) {
      errors.push({ field: 'customer_id', message: 'customer_id is required and must be a non-empty string' });
    }
  }

  if (!partial || has('customer_email')) {
    if (!isNonEmptyString(body.customer_email) || !EMAIL_PATTERN.test(body.customer_email)) {
      errors.push({ field: 'customer_email', message: 'customer_email must be a valid email address' });
    }
  }

  if (!partial || has('subject')) {
    if (!isNonEmptyString(body.subject)) {
      errors.push({ field: 'subject', message: 'subject is required' });
    } else if (body.subject.length > 200) {
      errors.push({ field: 'subject', message: 'subject must be 1-200 characters' });
    }
  }

  if (!partial || has('description')) {
    if (typeof body.description !== 'string' || body.description.trim().length < 10) {
      errors.push({ field: 'description', message: 'description must be at least 10 characters' });
    } else if (body.description.length > 2000) {
      errors.push({ field: 'description', message: 'description must be 10-2000 characters' });
    }
  }

  // --- optional fields -------------------------------------------------------
  if (has('customer_name') && !isNonEmptyString(body.customer_name)) {
    errors.push({ field: 'customer_name', message: 'customer_name must be a non-empty string when provided' });
  }

  if (has('category') && !CATEGORIES.includes(body.category)) {
    errors.push({ field: 'category', message: `category must be one of: ${CATEGORIES.join(', ')}` });
  }

  if (has('priority') && !PRIORITIES.includes(body.priority)) {
    errors.push({ field: 'priority', message: `priority must be one of: ${PRIORITIES.join(', ')}` });
  }

  if (has('status') && !STATUSES.includes(body.status)) {
    errors.push({ field: 'status', message: `status must be one of: ${STATUSES.join(', ')}` });
  }

  if (has('assigned_to') && body.assigned_to !== null && !isNonEmptyString(body.assigned_to)) {
    errors.push({ field: 'assigned_to', message: 'assigned_to must be a non-empty string or null' });
  }

  if (has('tags')) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => !isNonEmptyString(t))) {
      errors.push({ field: 'tags', message: 'tags must be an array of non-empty strings' });
    }
  }

  if (has('metadata')) {
    const m = body.metadata;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      errors.push({ field: 'metadata', message: 'metadata must be an object' });
    } else {
      if (m.source !== undefined && !SOURCES.includes(m.source)) {
        errors.push({ field: 'metadata.source', message: `metadata.source must be one of: ${SOURCES.join(', ')}` });
      }
      if (m.device_type !== undefined && !DEVICE_TYPES.includes(m.device_type)) {
        errors.push({ field: 'metadata.device_type', message: `metadata.device_type must be one of: ${DEVICE_TYPES.join(', ')}` });
      }
      if (m.browser !== undefined && typeof m.browser !== 'string') {
        errors.push({ field: 'metadata.browser', message: 'metadata.browser must be a string' });
      }
    }
  }

  return errors;
}

module.exports = { validateTicket, MUTABLE_FIELDS };
