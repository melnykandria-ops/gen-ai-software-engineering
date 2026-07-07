'use strict';

/**
 * Deterministically generate sample data files required by the assignment:
 *   tests/fixtures/sample_tickets.csv  — 50 tickets
 *   tests/fixtures/sample_tickets.json — 20 tickets
 *   tests/fixtures/sample_tickets.xml  — 30 tickets
 *   tests/fixtures/invalid_tickets.{csv,json,xml} — records failing validation
 *   tests/fixtures/malformed.{csv,json,xml}       — files that don't parse at all
 *
 * Deterministic on purpose (index-based, no randomness) so the fixtures are
 * stable across regenerations and the tests that rely on them never flake.
 */
const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'tests', 'fixtures');
fs.mkdirSync(FIXTURES, { recursive: true });

// --- deterministic building blocks -------------------------------------------
const SUBJECTS = [
  ["Can't access my account after password reset", 'I tried to log in but my password no longer works. I am locked out and this is critical for my work.'],
  ['Application crashes on file upload', 'The app crashes with a 500 error every time I upload a PDF. Steps to reproduce: open dashboard, click upload, select file.'],
  ['Charged twice for my subscription', 'My invoice shows a double charge this month. Please process a refund for the duplicate payment.'],
  ['Please add dark mode support', 'It would be great to have a dark mode theme. This is just a suggestion but many users would love it.'],
  ['Login page returns error 500', 'Production down: the login page shows error 500 for all users. This is urgent and blocking our whole team.'],
  ['Two-factor authentication code never arrives', 'The 2FA SMS code never arrives so I cannot log in to my account. Important: I need access asap.'],
  ['Refund for cancelled order not received', 'I cancelled my order two weeks ago and the refund has not appeared on my receipt or bank statement.'],
  ['Minor typo on the pricing page', 'There is a cosmetic typo in the second paragraph of the pricing page. Very minor issue.'],
  ['Export to Excel feature request', 'Please add support for exporting reports to Excel format. This enhancement would save us hours.'],
  ['Dashboard loads very slowly', 'The analytics dashboard takes over 30 seconds to load. It fails with a timeout error on mobile.'],
  ['Security concern about session handling', 'I noticed my session stays active after logout. This is a security issue that should be reviewed.'],
  ['Regression: search stopped working', 'Search worked last week, now it is broken. Steps to reproduce: type any query, expected behavior: results, actual behavior: empty page.'],
];

const NAMES = ['Olena Shevchenko', 'Dmytro Bondarenko', 'Iryna Kovalenko', 'Taras Melnyk', 'Sofia Tkachenko', 'Andriy Boyko', 'Kateryna Kravchenko', 'Maksym Shevchuk'];
const SOURCES = ['web_form', 'email', 'api', 'chat', 'phone'];
const DEVICES = ['desktop', 'mobile', 'tablet'];
const BROWSERS = ['Chrome 126', 'Firefox 127', 'Safari 17', 'Edge 126'];
const TAGS = [['login', 'urgent-review'], ['upload', 'crash'], ['billing'], ['ux', 'enhancement'], ['outage'], ['2fa'], ['refund'], ['docs'], ['export'], ['performance']];

function makeRecord(i) {
  const [subject, description] = SUBJECTS[i % SUBJECTS.length];
  return {
    customer_id: `CUST-${String(1000 + i)}`,
    customer_email: `user${i}@example.com`,
    customer_name: NAMES[i % NAMES.length],
    subject: `${subject} (#${i})`,
    description,
    tags: TAGS[i % TAGS.length],
    source: SOURCES[i % SOURCES.length],
    browser: BROWSERS[i % BROWSERS.length],
    device_type: DEVICES[i % DEVICES.length],
  };
}

// --- CSV (50) ------------------------------------------------------------------
const csvEscape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvHeader = 'customer_id,customer_email,customer_name,subject,description,tags,source,browser,device_type';
const csvRows = Array.from({ length: 50 }, (_, i) => {
  const r = makeRecord(i);
  return [r.customer_id, r.customer_email, r.customer_name, r.subject, r.description, r.tags.join('|'), r.source, r.browser, r.device_type]
    .map(csvEscape).join(',');
});
fs.writeFileSync(path.join(FIXTURES, 'sample_tickets.csv'), [csvHeader, ...csvRows].join('\n') + '\n');

// --- JSON (20) -------------------------------------------------------------------
const jsonRecords = Array.from({ length: 20 }, (_, i) => {
  const r = makeRecord(i + 50);
  return {
    customer_id: r.customer_id,
    customer_email: r.customer_email,
    customer_name: r.customer_name,
    subject: r.subject,
    description: r.description,
    tags: r.tags,
    metadata: { source: r.source, browser: r.browser, device_type: r.device_type },
  };
});
fs.writeFileSync(path.join(FIXTURES, 'sample_tickets.json'), JSON.stringify({ tickets: jsonRecords }, null, 2) + '\n');

// --- XML (30) --------------------------------------------------------------------
const xmlEscape = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlTickets = Array.from({ length: 30 }, (_, i) => {
  const r = makeRecord(i + 70);
  return [
    '  <ticket>',
    `    <customer_id>${r.customer_id}</customer_id>`,
    `    <customer_email>${r.customer_email}</customer_email>`,
    `    <customer_name>${xmlEscape(r.customer_name)}</customer_name>`,
    `    <subject>${xmlEscape(r.subject)}</subject>`,
    `    <description>${xmlEscape(r.description)}</description>`,
    '    <tags>',
    ...r.tags.map((t) => `      <tag>${xmlEscape(t)}</tag>`),
    '    </tags>',
    '    <metadata>',
    `      <source>${r.source}</source>`,
    `      <browser>${xmlEscape(r.browser)}</browser>`,
    `      <device_type>${r.device_type}</device_type>`,
    '    </metadata>',
    '  </ticket>',
  ].join('\n');
});
fs.writeFileSync(
  path.join(FIXTURES, 'sample_tickets.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<tickets>\n${xmlTickets.join('\n')}\n</tickets>\n`
);

// --- invalid records (parse fine, fail validation) ---------------------------------
fs.writeFileSync(path.join(FIXTURES, 'invalid_tickets.csv'), [
  csvHeader,
  // bad email + short description
  'CUST-9001,not-an-email,Bad Email,Broken email row,too short,billing,web_form,Chrome 126,desktop',
  // missing customer_id + subject too long
  `,user9002@example.com,No Id,${'X'.repeat(210)},This description is long enough to pass its own check.,login,email,Firefox 127,mobile`,
  // invalid enum values
  'CUST-9003,user9003@example.com,Bad Enums,Enum test row here,This description is definitely long enough.,tag1,carrier_pigeon,Chrome 126,smartwatch',
].join('\n') + '\n');

fs.writeFileSync(path.join(FIXTURES, 'invalid_tickets.json'), JSON.stringify({
  tickets: [
    { customer_id: 'CUST-9101', customer_email: 'invalid-email', subject: 'Bad email in JSON', description: 'This description is long enough to pass.' },
    { customer_id: 'CUST-9102', customer_email: 'user9102@example.com', subject: '', description: 'Subject empty, so this record must fail validation.' },
    { customer_email: 'user9103@example.com', subject: 'Missing customer id', description: 'short' },
  ],
}, null, 2) + '\n');

fs.writeFileSync(path.join(FIXTURES, 'invalid_tickets.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<tickets>
  <ticket>
    <customer_id>CUST-9201</customer_id>
    <customer_email>broken-email</customer_email>
    <subject>Bad email in XML</subject>
    <description>This description is long enough to pass validation.</description>
  </ticket>
  <ticket>
    <customer_id>CUST-9202</customer_id>
    <customer_email>user9202@example.com</customer_email>
    <subject>Short description</subject>
    <description>too short</description>
  </ticket>
</tickets>
`);

// --- malformed files (don't parse at all) --------------------------------------------
fs.writeFileSync(path.join(FIXTURES, 'malformed.csv'), 'customer_id,customer_email\n"unclosed quote,oops\n');
fs.writeFileSync(path.join(FIXTURES, 'malformed.json'), '{ "tickets": [ { "customer_id": "CUST-1" ');
fs.writeFileSync(path.join(FIXTURES, 'malformed.xml'), '<?xml version="1.0"?>\n<tickets><ticket><subject>Unclosed');

console.log('Fixtures written to', FIXTURES);
for (const f of fs.readdirSync(FIXTURES).sort()) {
  console.log(' -', f, `(${fs.statSync(path.join(FIXTURES, f)).size} bytes)`);
}
