'use strict';

/* ============================================================
   GR8 Support dashboard — vanilla JS client for the ticket API.
   Talks to the same origin the page is served from (/tickets…).
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const API = ''; // same origin

const CATEGORIES = ['account_access', 'technical_issue', 'billing_question', 'feature_request', 'bug_report', 'other'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const STATUSES = ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'];

let allTickets = [];       // unfiltered snapshot (drives tiles + charts)
let currentTickets = [];   // filtered list (drives the table)
let openTicketId = null;

/* ===================== API helpers ===================== */

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = body && body.error
      ? `${body.error}${body.details ? ': ' + body.details.map((d) => `${d.field} — ${d.message}`).join('; ') : ''}${body.message ? ': ' + body.message : ''}`
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

const fetchTickets = (qs = '') => api(`/tickets${qs}`);

/* ===================== Rendering ===================== */

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function priorityBadge(p) {
  return `<span class="badge p-${p}"><span class="dot"></span>${p}</span>`;
}

function statusChip(s) {
  return `<span class="chip status-${s}">${s.replace('_', ' ')}</span>`;
}

function renderStats() {
  $('#stat-total').textContent = allTickets.length;
  $('#stat-urgent').textContent = allTickets.filter((t) => t.priority === 'urgent').length;
  $('#stat-open').textContent = allTickets.filter((t) => ['new', 'in_progress', 'waiting_customer'].includes(t.status)).length;
  $('#stat-resolved').textContent = allTickets.filter((t) => ['resolved', 'closed'].includes(t.status)).length;
}

/** Horizontal single-measure bar chart with direct value labels + hover tip. */
function renderBars(el, keys, counter) {
  const counts = keys.map((k) => ({ key: k, n: counter(k) }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  el.innerHTML = counts.map(({ key, n }) => `
    <div class="bar-row" data-key="${key}" data-n="${n}">
      <span class="bar-name">${key.replace('_', ' ')}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%"></div></div>
      <span class="bar-val">${n}</span>
    </div>`).join('') || '<div class="empty-note">No data yet</div>';
}

function renderCharts() {
  renderBars($('#chart-category'), CATEGORIES, (k) => allTickets.filter((t) => t.category === k).length);
  renderBars($('#chart-priority'), PRIORITIES, (k) => allTickets.filter((t) => t.priority === k).length);
}

function renderTable() {
  const rows = $('#ticket-rows');
  $('#table-count').textContent = currentTickets.length;
  $('#table-empty').hidden = currentTickets.length > 0;
  rows.innerHTML = currentTickets.map((t) => `
    <tr data-id="${t.id}">
      <td class="td-subject"><span class="subj">${esc(t.subject)}</span><span class="cust-mail">${esc(t.customer_email)}</span></td>
      <td class="td-muted">${esc(t.customer_name || t.customer_id)}</td>
      <td><span class="chip">${t.category.replace('_', ' ')}</span></td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${statusChip(t.status)}</td>
      <td class="td-muted">${fmtDate(t.created_at)}</td>
    </tr>`).join('');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ===================== Data refresh ===================== */

function filterQuery() {
  const parts = [];
  const q = $('#f-q').value.trim();
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  for (const f of ['category', 'priority', 'status']) {
    const v = $(`#f-${f}`).value;
    if (v) parts.push(`${f}=${v}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function refresh() {
  try {
    const [all, filtered] = await Promise.all([fetchTickets(), fetchTickets(filterQuery())]);
    allTickets = all.tickets;
    currentTickets = filtered.tickets;
    renderStats();
    renderCharts();
    renderTable();
  } catch (err) {
    toast(`Load failed: ${err.message}`, true);
  }
}

/* ===================== Drawer ===================== */

async function openDrawer(id) {
  openTicketId = id;
  try {
    const [t, log] = await Promise.all([
      api(`/tickets/${id}`),
      api(`/tickets/${id}/classification-log`),
    ]);
    $('#drawer-body').innerHTML = drawerHTML(t, log.entries);
    $('#drawer').hidden = false;
    $('#scrim').hidden = false;
    bindDrawerActions(t);
  } catch (err) {
    toast(err.message, true);
  }
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  openTicketId = null;
}

function drawerHTML(t, logEntries) {
  const clf = t.classification;
  return `
    <h2>${esc(t.subject)}</h2>
    <div class="drawer-actions">
      <button class="btn btn-primary btn-sm" id="act-classify">AUTO-CLASSIFY</button>
      <button class="btn btn-ghost btn-sm" id="act-dryrun">DRY-RUN</button>
      ${t.status !== 'resolved' ? '<button class="btn btn-ghost btn-sm" id="act-resolve">RESOLVE</button>' : ''}
      <button class="btn btn-danger btn-sm" id="act-delete">DELETE</button>
    </div>
    <dl class="kv">
      <dt>Customer</dt><dd>${esc(t.customer_name || '—')} · ${esc(t.customer_id)} · ${esc(t.customer_email)}</dd>
      <dt>Category</dt><dd><span class="chip">${t.category.replace('_', ' ')}</span></dd>
      <dt>Priority</dt><dd>${priorityBadge(t.priority)}</dd>
      <dt>Status</dt><dd>${statusChip(t.status)}</dd>
      <dt>Assigned to</dt><dd>${esc(t.assigned_to || '—')}</dd>
      <dt>Tags</dt><dd>${t.tags.length ? t.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ') : '—'}</dd>
      <dt>Source</dt><dd>${esc(t.metadata.source)}${t.metadata.device_type ? ' · ' + esc(t.metadata.device_type) : ''}${t.metadata.browser ? ' · ' + esc(t.metadata.browser) : ''}</dd>
      <dt>Created</dt><dd>${fmtDate(t.created_at)}</dd>
      <dt>Updated</dt><dd>${fmtDate(t.updated_at)}</dd>
      <dt>Resolved</dt><dd>${fmtDate(t.resolved_at)}</dd>
      <dt>ID</dt><dd>${t.id}</dd>
    </dl>
    <div class="drawer-desc">${esc(t.description)}</div>

    ${clf ? `
    <div class="drawer-section-title">Classification ${clf.overridden ? '· manually overridden' : ''}</div>
    <div class="clf-card">
      <div><b>${clf.category.replace('_', ' ')}</b> · ${priorityBadge(clf.priority)} · confidence <span class="conf">${clf.confidence}</span></div>
      <div>${esc(clf.reasoning)}</div>
      <div class="clf-kw">${clf.keywords_found.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>
    </div>` : ''}

    <div class="drawer-section-title">Manual override</div>
    <div class="override-row">
      <select id="ov-category">${CATEGORIES.map((c) => `<option ${c === t.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select id="ov-priority">${PRIORITIES.map((p) => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="ov-status">${STATUSES.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" id="act-save">SAVE</button>
    </div>

    <div class="drawer-section-title">Decision log (${logEntries.length})</div>
    <div class="log-list">
      ${logEntries.length ? logEntries.slice().reverse().map((e) => `
        <div class="log-item">
          <span class="log-type">${e.decision}</span>
          ${e.result ? ` → ${e.result.category} / ${e.result.priority} (conf ${e.result.confidence})` : ''}
          ${e.changes ? ` → ${Object.entries(e.changes).map(([f, c]) => `${f}: ${c.from} → ${c.to}`).join(', ')}` : ''}
          <time>${fmtDate(e.at)}</time>
        </div>`).join('') : '<div class="empty-note td-muted">No decisions logged yet</div>'}
    </div>`;
}

function bindDrawerActions(t) {
  $('#act-classify').onclick = async () => {
    try {
      const r = await api(`/tickets/${t.id}/auto-classify`, { method: 'POST' });
      toast(`Classified: ${r.category} / ${r.priority} (conf ${r.confidence})`);
      await refresh(); openDrawer(t.id);
    } catch (err) { toast(err.message, true); }
  };
  $('#act-dryrun').onclick = async () => {
    try {
      const r = await api(`/tickets/${t.id}/auto-classify?apply=false`, { method: 'POST' });
      toast(`Dry-run: ${r.category} / ${r.priority} (conf ${r.confidence}) — not applied`);
      openDrawer(t.id);
    } catch (err) { toast(err.message, true); }
  };
  const resolveBtn = $('#act-resolve');
  if (resolveBtn) {
    resolveBtn.onclick = async () => {
      try {
        await api(`/tickets/${t.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'resolved' }),
        });
        toast('Ticket resolved');
        await refresh(); openDrawer(t.id);
      } catch (err) { toast(err.message, true); }
    };
  }
  $('#act-delete').onclick = async () => {
    if (!confirm('Delete this ticket?')) return;
    try {
      await api(`/tickets/${t.id}`, { method: 'DELETE' });
      toast('Ticket deleted');
      closeDrawer(); refresh();
    } catch (err) { toast(err.message, true); }
  };
  $('#act-save').onclick = async () => {
    try {
      await api(`/tickets/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: $('#ov-category').value,
          priority: $('#ov-priority').value,
          status: $('#ov-status').value,
        }),
      });
      toast('Ticket updated');
      await refresh(); openDrawer(t.id);
    } catch (err) { toast(err.message, true); }
  };
}

/* ===================== Create & import ===================== */

async function submitNew(form) {
  const f = new FormData(form);
  const payload = {
    customer_id: f.get('customer_id'),
    customer_email: f.get('customer_email'),
    subject: f.get('subject'),
    description: f.get('description'),
    metadata: { source: f.get('source') },
  };
  const name = (f.get('customer_name') || '').trim();
  if (name) payload.customer_name = name;
  const tags = (f.get('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (tags.length) payload.tags = tags;

  const auto = f.get('auto_classify') ? '?autoClassify=true' : '';
  const t = await api(`/tickets${auto}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  toast(t.classification
    ? `Created + classified: ${t.category} / ${t.priority}`
    : 'Ticket created');
  form.reset();
  await refresh();
}

async function submitImport(form) {
  const f = new FormData(form);
  const format = f.get('format');
  const file = f.get('file');
  let content = (f.get('content') || '').trim();

  if (file && file.size > 0) content = await file.text();
  if (!content) throw new Error('Choose a file or paste content first');

  const auto = f.get('autoClassify') ? '&autoClassify=true' : '';
  const summary = await api(`/tickets/import?format=${format}${auto}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });

  const box = $('#import-summary');
  box.hidden = false;
  box.innerHTML = `
    <div>Format <b>${summary.format}</b> · total ${summary.total} ·
      <span class="ok">imported ${summary.successful}</span> ·
      <span class="fail">failed ${summary.failed}</span></div>
    ${summary.errors.length ? `<ul>${summary.errors.slice(0, 8).map((e) =>
      `<li>#${e.record} ${esc(e.subject || '')}: ${e.errors.map((x) => `${x.field} — ${x.message}`).join('; ')}</li>`).join('')}
      ${summary.errors.length > 8 ? `<li>… and ${summary.errors.length - 8} more</li>` : ''}</ul>` : ''}`;
  toast(`Imported ${summary.successful}/${summary.total}`);
  await refresh();
}

/* ===================== Toasts & chart tooltip ===================== */

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = `toast${isErr ? ' err' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function bindChartTips() {
  const tip = $('#chart-tip');
  document.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.bar-row');
    if (!row) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${row.dataset.key.replace('_', ' ')}</b> — ${row.dataset.n} ticket(s)`;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 180)}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.hidden = false;
  });
}

/* ===================== Wire-up ===================== */

function init() {
  refresh();
  bindChartTips();

  // filters
  for (const id of ['#f-category', '#f-priority', '#f-status']) {
    $(id).addEventListener('change', refresh);
  }
  let qTimer;
  $('#f-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(refresh, 250); });
  $('#btn-reset').addEventListener('click', () => {
    $('#f-q').value = ''; $('#f-category').value = ''; $('#f-priority').value = ''; $('#f-status').value = '';
    refresh();
  });

  // table → drawer
  $('#ticket-rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openDrawer(tr.dataset.id);
  });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  // modals
  $('#btn-new').addEventListener('click', () => $('#modal-new').showModal());
  $('#btn-import').addEventListener('click', () => {
    $('#import-summary').hidden = true;
    $('#modal-import').showModal();
  });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => b.closest('dialog').close()));

  $('#form-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitNew(e.target); $('#modal-new').close(); }
    catch (err) { toast(err.message, true); }
  });

  $('#form-import').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await submitImport(e.target); }
    catch (err) { toast(err.message, true); }
  });
}

document.addEventListener('DOMContentLoaded', init);
