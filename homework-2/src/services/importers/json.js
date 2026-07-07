'use strict';

const { ImportParseError } = require('./common');

/**
 * Parse JSON content into raw ticket records.
 *
 * Accepts either a top-level array of tickets, or `{ "tickets": [...] }`.
 *
 * @param {string} text raw JSON
 * @returns {object[]} raw records
 * @throws {ImportParseError} when the JSON is malformed or the shape is wrong
 */
function parseJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ImportParseError(`Malformed JSON: ${err.message}`);
  }

  const records = Array.isArray(data) ? data : data && Array.isArray(data.tickets) ? data.tickets : null;

  if (!records) {
    throw new ImportParseError('JSON must be an array of tickets or an object with a "tickets" array');
  }
  if (records.length === 0) {
    throw new ImportParseError('JSON contains no ticket records');
  }
  if (records.some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) {
    throw new ImportParseError('Every ticket record must be a JSON object');
  }

  return records;
}

module.exports = { parseJSON };
