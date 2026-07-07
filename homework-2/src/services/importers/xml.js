'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { ImportParseError, splitTags, buildMetadata } = require('./common');

/**
 * Parse XML content into raw ticket records.
 *
 * Expected shape:
 *   <tickets>
 *     <ticket>
 *       <customer_id>…</customer_id> … <tags><tag>a</tag><tag>b</tag></tags>
 *       <metadata><source>…</source><browser>…</browser><device_type>…</device_type></metadata>
 *     </ticket>
 *   </tickets>
 *
 * @param {string} text raw XML
 * @returns {object[]} raw records
 * @throws {ImportParseError} when the XML is malformed or the shape is wrong
 */
function parseXML(text) {
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new ImportParseError(`Malformed XML: ${validation.err.msg} (line ${validation.err.line})`);
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    // Always treat <ticket> and <tag> as arrays, even when there is one.
    isArray: (name, jpath) => jpath === 'tickets.ticket' || jpath === 'tickets.ticket.tags.tag',
    parseTagValue: false, // keep everything as strings; the validator decides
    trimValues: true,
  });

  const doc = parser.parse(text);
  const list = doc && doc.tickets && doc.tickets.ticket;

  if (!Array.isArray(list) || list.length === 0) {
    throw new ImportParseError('XML must contain <tickets> with at least one <ticket> element');
  }

  return list.map((t) => ({
    customer_id: t.customer_id,
    customer_email: t.customer_email,
    customer_name: t.customer_name || undefined,
    subject: t.subject,
    description: t.description,
    category: t.category || undefined,
    priority: t.priority || undefined,
    status: t.status || undefined,
    assigned_to: t.assigned_to || undefined,
    tags: t.tags && t.tags.tag ? splitTags(t.tags.tag) : undefined,
    metadata: t.metadata
      ? buildMetadata(t.metadata.source, t.metadata.browser, t.metadata.device_type)
      : undefined,
  }));
}

module.exports = { parseXML };
