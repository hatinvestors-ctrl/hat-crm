// Parses the imported Podio SQL and the current Supabase state to build a
// beautiful HTML email of the "Today" view.
// Outputs to stdout: { subject, html_body, plain_text }

import fs from 'node:fs'

// Compute today's date in Israel local time (the scheduler runs at 3pm IL).
// Override via env: TODAY=2026-05-17 node scripts/build_today_email.mjs
const TODAY = process.env.TODAY || (() => {
  const now = new Date()
  const il = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
  return `${il.getFullYear()}-${String(il.getMonth() + 1).padStart(2, '0')}-${String(il.getDate()).padStart(2, '0')}`
})()
const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const ANON_KEY = process.env.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NDI3OTEsImV4cCI6MjA5NDAxODc5MX0.jjwkXSl2AOY6KSd-yUQULEEj06yTQnm8hfNNttTp66w'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const APP_URL = 'https://gilded-elf-31457a.netlify.app'

// ── Parse the bulk INSERT from podio_import.sql ─────────────────────────
function parseSqlLeads(sqlPath) {
  const sql = fs.readFileSync(sqlPath, 'utf8')
  // Find the column list
  const colMatch = sql.match(/INSERT INTO leads \(([^)]+)\) VALUES/i)
  if (!colMatch) return []
  const cols = colMatch[1].split(',').map(s => s.trim())

  // Extract each value tuple. Tuples are wrapped in (...) and separated by ,
  // We need a tokenizer that respects quoted strings.
  const after = sql.slice(sql.indexOf('VALUES') + 'VALUES'.length)
  const rows = []
  let i = 0
  while (i < after.length) {
    while (i < after.length && after[i] !== '(') i++
    if (i >= after.length) break
    i++
    const values = []
    let cur = ''
    let inStr = false
    let depth = 1
    while (i < after.length && depth > 0) {
      const c = after[i]
      if (inStr) {
        if (c === "'" && after[i + 1] === "'") { cur += "'"; i += 2; continue }
        if (c === "'") { inStr = false; i++; continue }
        cur += c; i++; continue
      }
      if (c === "'") { inStr = true; i++; continue }
      if (c === '(') { depth++; cur += c; i++; continue }
      if (c === ')') {
        depth--
        if (depth === 0) { values.push(cur.trim()); i++; break }
        cur += c; i++; continue
      }
      if (c === ',' && depth === 1) { values.push(cur.trim()); cur = ''; i++; continue }
      cur += c; i++
    }
    if (values.length === cols.length) {
      const row = {}
      cols.forEach((c, idx) => {
        let v = values[idx]
        if (v === 'NULL') v = null
        // Strings come back without the outer quotes already because we tokenized them
        // But unquoted numbers stay as strings — convert
        else if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v)
        else if (v === 'TRUE') v = true
        else if (v === 'FALSE') v = false
        row[c] = v
      })
      rows.push(row)
    }
  }
  return rows
}

// ── Categorize per the Today view rules ─────────────────────────────────
function daysSince(iso) {
  if (!iso) return Infinity
  return Math.floor((new Date(TODAY) - new Date(iso)) / 86400000)
}

const BUCKETS = [
  {
    id: 'overdue',
    label: '🔴 Overdue Follow-Up',
    color: '#dc2626',
    bg: '#fee2e2',
    match: l => l.status === 'follow_up' && l.follow_up_date && l.follow_up_date < TODAY,
    action: l => `${Math.max(1, Math.floor((new Date(TODAY) - new Date(l.follow_up_date)) / 86400000))} day(s) overdue — follow up NOW`,
  },
  {
    id: 'today',
    label: '🟠 Follow-Up Today',
    color: '#f59e0b',
    bg: '#fef3c7',
    match: l => l.status === 'follow_up' && l.follow_up_date === TODAY,
    action: () => 'Scheduled for today — make the call',
  },
  {
    id: 'signed_not_sent',
    label: '🔵 Signed — Send Offer to Seller',
    color: '#2563eb',
    bg: '#dbeafe',
    match: l => l.status === 'offer_signed' && daysSince(l.updated_at) > 1,
    action: l => `Signed ${daysSince(l.contract_signed_date || l.updated_at)} day(s) ago — send to seller`,
  },
  {
    id: 'awaiting_response',
    label: '🟠 Awaiting Seller Response',
    color: '#f59e0b',
    bg: '#fef3c7',
    match: l => l.status === 'offer_sent' && daysSince(l.updated_at) > 2,
    action: l => `${daysSince(l.updated_at)} day(s) since offer sent — chase`,
  },
  {
    id: 'awaiting_signature',
    label: '🔵 Awaiting HAT Signature',
    color: '#2563eb',
    bg: '#dbeafe',
    match: l => l.status === 'offer_pending_hat_signing' && daysSince(l.updated_at) > 2,
    action: l => `${daysSince(l.updated_at)} day(s) waiting on HAT signature`,
  },
  {
    id: 'stalled',
    label: '🟠 Stalled Negotiation',
    color: '#f59e0b',
    bg: '#fef3c7',
    match: l => l.status === 'negotiating' && daysSince(l.updated_at) > 3,
    action: l => `${daysSince(l.updated_at)} day(s) quiet — push forward or close`,
  },
  {
    id: 'mao',
    label: '⚪ MAO Calculated — Decide',
    color: '#64748b',
    bg: '#f1f5f9',
    match: l => l.status === 'mao_calculated' && daysSince(l.updated_at) > 2,
    action: l => `${daysSince(l.updated_at)} day(s) on MAO — draft offer or pass`,
  },
  {
    id: 'new',
    label: '⚪ New Lead Untouched',
    color: '#64748b',
    bg: '#f1f5f9',
    match: l => l.status === 'new_lead' && daysSince(l.created_at) > 1,
    action: l => `${daysSince(l.created_at)} day(s) old — qualify and run MAO`,
  },
]

const fmt$ = v => v ? '$' + Number(v).toLocaleString('en-US') : '—'

// ── Build HTML email ────────────────────────────────────────────────────
function buildHtml(buckets, totalCount, hotCount) {
  const css = `
    body { margin:0; padding:0; background:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
    .wrap { max-width:680px; margin:0 auto; background:#ffffff; }
    .hdr { background:#0d1a30; color:#ffffff; padding:24px 28px; }
    .hdr h1 { margin:0; font-size:20px; font-weight:600; letter-spacing:-0.01em; }
    .hdr p  { margin:6px 0 0; color:#94a3b8; font-size:13px; }
    .summary { padding:20px 28px; border-bottom:1px solid #e2e8f0; }
    .summary .big { font-size:32px; font-weight:700; color:#0f172a; letter-spacing:-0.02em; }
    .summary .sub { font-size:13px; color:#64748b; margin-top:2px; }
    .bucket { padding:18px 28px; border-bottom:1px solid #e2e8f0; }
    .bucket:last-child { border-bottom:none; }
    .bhdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .bhdr .title { font-size:14px; font-weight:600; }
    .bhdr .count { font-size:11px; font-weight:600; padding:2px 8px; border-radius:99px; color:#ffffff; }
    .lead { padding:10px 12px; border-radius:6px; background:#f8fafc; margin-bottom:6px; }
    .lead .addr { font-size:14px; font-weight:600; color:#0f172a; }
    .lead .meta { font-size:12px; color:#64748b; margin-top:2px; }
    .lead .action { font-size:12px; font-weight:600; margin-top:4px; }
    .lead a.open { font-size:11px; color:#2563eb; text-decoration:none; margin-left:6px; }
    .empty { padding:36px 28px; text-align:center; color:#64748b; font-size:14px; }
    .ftr { padding:20px 28px; background:#f8fafc; color:#64748b; font-size:12px; text-align:center; }
    .ftr a { color:#2563eb; text-decoration:none; }
    .hot-flag { display:inline-block; padding:2px 6px; border-radius:99px; font-size:10px; font-weight:700; color:#fff; background:#dc2626; margin-right:6px; }
  `

  const today = new Date(TODAY).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  let body = ''
  if (totalCount === 0) {
    body = `<div class="empty">✓ Inbox zero. Every active lead is moving. Nice work.</div>`
  } else {
    body = buckets.map(({bucket, leads}) => `
      <div class="bucket" style="border-left:4px solid ${bucket.color};">
        <div class="bhdr">
          <div class="title" style="color:${bucket.color};">${bucket.label}</div>
          <div class="count" style="background:${bucket.color};">${leads.length}</div>
        </div>
        ${leads.map(l => `
          <div class="lead" style="border-left:3px solid ${bucket.color};">
            <div class="addr">${l.is_hot ? '<span class="hot-flag">🔥 HOT</span>' : ''}${escapeHtml(l.address)}</div>
            <div class="meta">${escapeHtml(l.city || 'Jacksonville')}${l.mao ? ` · MAO ${fmt$(l.mao)}` : ''}${l.offer_price ? ` · Offer ${fmt$(l.offer_price)}` : ''}${l.follow_up_date ? ` · follow-up ${l.follow_up_date}` : ''}</div>
            <div class="action" style="color:${bucket.color};">→ ${bucket.action(l)}${l.id ? ` <a class="open" href="${APP_URL}/w/${WORKSPACE_ID}/leads/${l.id}">Open →</a>` : ''}</div>
          </div>
        `).join('')}
      </div>
    `).join('')
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HAT CRM — Today</title><style>${css}</style></head><body>
    <div class="wrap">
      <div class="hdr">
        <h1>HAT CRM · Today</h1>
        <p>${today}</p>
      </div>
      <div class="summary">
        <div class="big">${totalCount === 0 ? '✓ Caught up' : totalCount + ' lead' + (totalCount===1?'':'s') + ' need attention'}</div>
        <div class="sub">Sorted top-down by priority. Tackle the red section first.${hotCount > 0 ? ` &nbsp; · &nbsp; <span style="color:#dc2626;font-weight:600;">🔥 ${hotCount} hot</span>` : ''}</div>
      </div>
      ${body}
      <div class="ftr">
        Sent from HAT CRM — <a href="${APP_URL}">${APP_URL.replace('https://','')}</a><br>
        <a href="${APP_URL}/w/${WORKSPACE_ID}/today">Open Today view →</a>
      </div>
    </div>
  </body></html>`
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
}

function buildPlainText(buckets, totalCount) {
  const today = new Date(TODAY).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
  let out = `HAT CRM — Today\n${today}\n\n`
  if (totalCount === 0) {
    out += '✓ Inbox zero. Every active lead is moving.\n'
    return out
  }
  out += `${totalCount} lead(s) need attention.\n\n`
  for (const {bucket, leads} of buckets) {
    out += `── ${bucket.label} (${leads.length}) ──\n`
    for (const l of leads) {
      out += `  • ${l.address}${l.is_hot ? ' 🔥 HOT' : ''}\n`
      out += `    → ${bucket.action(l)}\n`
      out += `    Open: ${APP_URL}/w/${WORKSPACE_ID}/leads/${l.id}\n`
    }
    out += '\n'
  }
  return out
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  // 1. Prefer Supabase Management API (bypasses RLS — freshest data).
  // 2. Then anon REST (works only if leads policies are public, which they aren't).
  // 3. Fall back to the stale podio_import.sql so we still send *something*.
  let leads = []
  const PAT = process.env.SUPABASE_PAT
  const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'pyrgotfotmwazigewlke'
  if (PAT) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `select * from public.leads where workspace_id = '${WORKSPACE_ID}' limit 2000;` }),
      })
      if (r.ok) leads = await r.json()
    } catch (_) {}
  }
  if (leads.length === 0) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?workspace_id=eq.${WORKSPACE_ID}&select=*&limit=500`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      })
      if (r.ok) leads = await r.json()
    } catch (_) {}
  }
  if (leads.length === 0) {
    leads = parseSqlLeads('podio_import.sql')
    leads.forEach(l => {
      if (!l.created_at) l.created_at = TODAY
      if (!l.updated_at) l.updated_at = TODAY
    })
  }

  const byBucket = []
  const assigned = new Set()
  for (const bucket of BUCKETS) {
    const matches = leads.filter(l => !assigned.has(l.id || l.address) && bucket.match(l))
    if (matches.length) {
      matches.forEach(l => assigned.add(l.id || l.address))
      byBucket.push({ bucket, leads: matches })
    }
  }
  const totalCount = assigned.size
  const hotCount = leads.filter(l => l.is_hot).length

  const subject = totalCount === 0
    ? '✓ HAT CRM Today — All caught up'
    : `🔔 HAT CRM Today — ${totalCount} lead${totalCount === 1 ? '' : 's'} need${totalCount === 1 ? 's' : ''} action`

  console.log(JSON.stringify({
    subject,
    html_body: buildHtml(byBucket, totalCount, hotCount),
    plain_text: buildPlainText(byBucket, totalCount),
    stats: { totalCount, hotCount, bucketCount: byBucket.length },
  }))
}

main().catch(e => { console.error(e); process.exit(1) })
