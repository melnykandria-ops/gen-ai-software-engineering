'use strict';

const { parseCSV } = require('./csv');
const { parseJSON } = require('./json');
const { parseXML } = require('./xml');
const { ImportParseError } = require('./common');

const SUPPORTED_FORMATS = ['csv', 'json', 'xml'];

/**
 * Work out the import format from the explicit ?format= query parameter
 * (preferred) or the request Content-Type.
 *
 * @param {string|undefined} formatParam ?format= value
 * @param {string|undefined} contentType Content-Type header
 * @returns {string|null} 'csv' | 'json' | 'xml' | null when undetectable
 */
function detectFormat(formatParam, contentType = '') {
  if (formatParam) {
    const f = String(formatParam).toLowerCase();
    return SUPPORTED_FORMATS.includes(f) ? f : null;
  }
  const ct = contentType.toLowerCase();
  if (ct.includes('text/csv') || ct.includes('application/csv')) return 'csv';
  if (ct.includes('application/json') || ct.includes('text/json')) return 'json';
  if (ct.includes('application/xml') || ct.includes('text/xml')) return 'xml';
  return null;
}

/**
 * Parse raw file content in the given format into raw ticket records.
 * @throws {ImportParseError}
 */
function parseContent(format, text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ImportParseError('Import body is empty');
  }
  switch (format) {
    case 'csv': return parseCSV(text);
    case 'json': return parseJSON(text);
    case 'xml': return parseXML(text);
    /* istanbul ignore next -- guarded by detectFormat */
    default: throw new ImportParseError(`Unsupported format: ${format}`);
  }
}

module.exports = { detectFormat, parseContent, SUPPORTED_FORMATS, ImportParseError };
