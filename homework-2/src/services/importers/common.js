'use strict';

/** Error type for "the file itself is broken" (vs per-record validation). */
class ImportParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** "a|b|c" → ["a","b","c"]; empty/missing → undefined (validator-friendly). */
function splitTags(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  return String(value)
    .split('|')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Assemble a metadata object only from the parts that are present. */
function buildMetadata(source, browser, deviceType) {
  const metadata = {};
  if (source) metadata.source = source;
  if (browser) metadata.browser = browser;
  if (deviceType) metadata.device_type = deviceType;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

module.exports = { ImportParseError, splitTags, buildMetadata };
