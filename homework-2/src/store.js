'use strict';

/**
 * In-memory ticket store — no database, resets on restart (and between tests
 * via reset()). Also keeps an audit log of every classification decision.
 */
const tickets = [];
const classificationLog = [];

/** Insert a ticket record and return it. */
function add(ticket) {
  tickets.push(ticket);
  return ticket;
}

/** All tickets, newest first. */
function all() {
  return [...tickets].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Find one ticket by id, or undefined. */
function findById(id) {
  return tickets.find((t) => t.id === id);
}

/** Remove a ticket by id; returns true if something was deleted. */
function remove(id) {
  const idx = tickets.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tickets.splice(idx, 1);
  return true;
}

/**
 * Filter tickets. Every filter is optional; all provided filters must match
 * (AND semantics) so combined filtering "category + priority" works.
 */
function filter(f = {}) {
  return all().filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.customer_id && t.customer_id !== f.customer_id) return false;
    if (f.assigned_to && t.assigned_to !== f.assigned_to) return false;
    if (f.source && t.metadata.source !== f.source) return false;
    if (f.tag && !t.tags.includes(f.tag)) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const text = `${t.subject} ${t.description}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    if (f.from && t.created_at < new Date(f.from).toISOString()) return false;
    if (f.to) {
      const upper = f.to.length <= 10 ? `${f.to}T23:59:59.999Z` : new Date(f.to).toISOString();
      if (t.created_at > upper) return false;
    }
    return true;
  });
}

/** Append a classification decision to the audit log. */
function logClassification(entry) {
  classificationLog.push(entry);
  return entry;
}

/** Classification decisions for one ticket (or all when no id given). */
function getClassificationLog(ticketId) {
  return ticketId
    ? classificationLog.filter((e) => e.ticket_id === ticketId)
    : [...classificationLog];
}

/** Clear everything — used by tests and the seed script. */
function reset() {
  tickets.length = 0;
  classificationLog.length = 0;
}

module.exports = { add, all, findById, remove, filter, logClassification, getClassificationLog, reset };
