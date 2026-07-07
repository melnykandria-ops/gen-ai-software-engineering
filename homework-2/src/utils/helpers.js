'use strict';

const { randomUUID } = require('crypto');

/** Allowed enum values from the ticket model in TASKS.md. */
const CATEGORIES = [
  'account_access',
  'technical_issue',
  'billing_question',
  'feature_request',
  'bug_report',
  'other',
];

const PRIORITIES = ['urgent', 'high', 'medium', 'low'];

const STATUSES = ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

const SOURCES = ['web_form', 'email', 'api', 'chat', 'phone'];

const DEVICE_TYPES = ['desktop', 'mobile', 'tablet'];

/** Pragmatic email check: local@domain.tld, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Generate a unique ticket id. */
function generateId() {
  return randomUUID();
}

/** Current timestamp in ISO 8601. */
function nowISO() {
  return new Date().toISOString();
}

module.exports = {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  SOURCES,
  DEVICE_TYPES,
  EMAIL_PATTERN,
  generateId,
  nowISO,
};
