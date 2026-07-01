'use strict';

const { roundMoney } = require('./utils/helpers');

/**
 * In-memory transaction store.
 *
 * The whole dataset lives in a single array — no database, as required by the
 * assignment. Everything is process-local and resets on restart.
 */
const transactions = [];

/** Insert a transaction record and return it. */
function add(transaction) {
  transactions.push(transaction);
  return transaction;
}

/** Return all transactions (newest first). */
function all() {
  return [...transactions].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Find a single transaction by id, or undefined. */
function findById(id) {
  return transactions.find((t) => t.id === id);
}

/**
 * Filter transactions by account, type and/or an inclusive date range.
 * Any filter left undefined is ignored.
 *
 * @param {object} f
 * @param {string} [f.accountId] match either fromAccount or toAccount
 * @param {string} [f.type] deposit | withdrawal | transfer
 * @param {string} [f.from] ISO date (inclusive lower bound)
 * @param {string} [f.to] ISO date (inclusive upper bound)
 */
function filter({ accountId, type, from, to } = {}) {
  return all().filter((t) => {
    if (accountId && t.fromAccount !== accountId && t.toAccount !== accountId) return false;
    if (type && t.type !== type) return false;
    if (from && t.timestamp < new Date(from).toISOString()) return false;
    if (to) {
      // `to` is inclusive for the whole day when no time component is supplied.
      const upper = to.length <= 10 ? `${to}T23:59:59.999Z` : new Date(to).toISOString();
      if (t.timestamp > upper) return false;
    }
    return true;
  });
}

/**
 * Compute the balance for an account from all *completed* transactions.
 *
 * deposits & incoming transfers credit the account; withdrawals & outgoing
 * transfers debit it.
 */
function balanceFor(accountId) {
  let balance = 0;
  for (const t of transactions) {
    if (t.status !== 'completed') continue;
    if (t.toAccount === accountId && (t.type === 'deposit' || t.type === 'transfer')) {
      balance += t.amount;
    }
    if (t.fromAccount === accountId && (t.type === 'withdrawal' || t.type === 'transfer')) {
      balance -= t.amount;
    }
  }
  return roundMoney(balance);
}

/** Clear everything — used by the seed script and tests. */
function reset() {
  transactions.length = 0;
}

module.exports = { add, all, findById, filter, balanceFor, reset };
