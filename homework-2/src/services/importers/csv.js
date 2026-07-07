'use strict';

const { parse } = require('csv-parse/sync');
const { ImportParseError, splitTags, buildMetadata } = require('./common');

/**
 * Parse CSV content into raw ticket records.
 *
 * Expected headers: customer_id, customer_email, customer_name, subject,
 * description, category, priority, status, assigned_to, tags (pipe-separated),
 * source, browser, device_type. Quoted fields (commas/newlines) are supported.
 *
 * @param {string} text raw CSV
 * @returns {object[]} raw records (validated later, one by one)
 * @throws {ImportParseError} when the CSV itself is malformed
 */
function parseCSV(text) {
  let rows;
  try {
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw new ImportParseError(`Malformed CSV: ${err.message}`);
  }

  if (rows.length === 0) {
    throw new ImportParseError('CSV contains no data rows');
  }

  return rows.map((row) => {
    const record = {
      customer_id: row.customer_id,
      customer_email: row.customer_email,
      customer_name: row.customer_name || undefined,
      subject: row.subject,
      description: row.description,
      category: row.category || undefined,
      priority: row.priority || undefined,
      status: row.status || undefined,
      assigned_to: row.assigned_to || undefined,
      tags: splitTags(row.tags),
      metadata: buildMetadata(row.source, row.browser, row.device_type),
    };
    return record;
  });
}

module.exports = { parseCSV };
