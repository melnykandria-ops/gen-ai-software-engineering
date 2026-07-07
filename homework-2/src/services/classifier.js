'use strict';

/**
 * Rule-based auto-classification of support tickets.
 *
 * Categories are scored by keyword matches (multi-word phrases weigh more);
 * priority uses the ordered rules from TASKS.md (urgent > high > low > medium
 * default). The result carries a confidence score, human-readable reasoning
 * and the exact keywords that fired — so decisions are auditable.
 */

/** Keyword sets per category. Order matters for tie-breaking (first wins). */
const CATEGORY_KEYWORDS = {
  account_access: [
    "can't access my account", 'cannot log in', "can't log in", 'locked out',
    'login', 'log in', 'sign in', 'signin', 'password', '2fa', 'two-factor',
    'authentication', 'account access', 'reset my password',
  ],
  billing_question: [
    'payment', 'invoice', 'refund', 'charged twice', 'charge', 'billing',
    'subscription', 'receipt', 'price', 'overcharged',
  ],
  bug_report: [
    'steps to reproduce', 'expected behavior', 'actual behavior',
    'reproduce', 'reproduction', 'regression',
  ],
  technical_issue: [
    'error', 'crash', 'crashes', 'crashed', 'broken', 'not working',
    "doesn't work", 'timeout', '500', 'fails', 'failure', 'exception',
    'slow', 'unavailable', 'bug',
  ],
  feature_request: [
    'feature request', 'feature', 'enhancement', 'suggestion', 'suggest',
    'would be great', 'please add', 'add support', 'improvement', 'idea',
  ],
};

/** Ordered priority rules — first matching level wins. */
const PRIORITY_KEYWORDS = {
  urgent: ["can't access", 'cannot access', 'critical', 'production down', 'security', 'urgent', 'data loss'],
  high: ['important', 'blocking', 'asap', 'high priority'],
  low: ['minor', 'cosmetic', 'suggestion', 'nice to have', 'typo'],
};

/** Phrase weight: multi-word phrases are stronger signals than single words. */
function weightOf(phrase) {
  return phrase.trim().split(/\s+/).length;
}

/**
 * Classify a ticket by its subject + description.
 *
 * @param {{subject?: string, description?: string}} ticket
 * @returns {{category: string, priority: string, confidence: number,
 *            reasoning: string, keywords_found: string[]}}
 */
function classify(ticket = {}) {
  const text = `${ticket.subject || ''} ${ticket.description || ''}`.toLowerCase();

  // --- category scoring ------------------------------------------------------
  let bestCategory = 'other';
  let bestScore = 0;
  const categoryHits = {};

  for (const [category, phrases] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = phrases.filter((p) => text.includes(p));
    if (hits.length === 0) continue;
    const score = hits.reduce((s, p) => s + weightOf(p), 0);
    categoryHits[category] = hits;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // --- priority rules (ordered) ----------------------------------------------
  let priority = 'medium';
  let priorityHits = [];
  for (const level of ['urgent', 'high', 'low']) {
    const hits = PRIORITY_KEYWORDS[level].filter((p) => text.includes(p));
    if (hits.length > 0) {
      priority = level;
      priorityHits = hits;
      break;
    }
  }

  // --- confidence --------------------------------------------------------------
  // No category signal → low confidence 0.3; otherwise scale with evidence.
  const confidence = bestScore === 0
    ? 0.3
    : Math.min(0.95, Number((0.5 + 0.1 * bestScore).toFixed(2)));

  const keywordsFound = [...(categoryHits[bestCategory] || []), ...priorityHits];

  const reasoning = bestScore === 0
    ? `No category keywords matched; defaulting to "other". Priority "${priority}"${priorityHits.length ? ` (matched: ${priorityHits.join(', ')})` : ' by default'}.`
    : `Matched ${categoryHits[bestCategory].length} keyword(s) for "${bestCategory}": ${categoryHits[bestCategory].join(', ')}. ` +
      `Priority "${priority}"${priorityHits.length ? ` (matched: ${priorityHits.join(', ')})` : ' by default'}.`;

  return {
    category: bestCategory,
    priority,
    confidence,
    reasoning,
    keywords_found: keywordsFound,
  };
}

module.exports = { classify, CATEGORY_KEYWORDS, PRIORITY_KEYWORDS };
