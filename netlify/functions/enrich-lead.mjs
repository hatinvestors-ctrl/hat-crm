// Lead enrichment via RentCast.
//
// THREE invocation modes:
//
// 1. On-demand existing-lead enrich:
//    POST /.netlify/functions/enrich-lead
//    body: { lead_id: "<uuid>", force?: boolean }
//    → enriches that lead, returns the patched row.
//
// 2. Address lookup (no lead yet — used by the "Look up" button in New Lead form):
//    POST /.netlify/functions/enrich-lead
//    body: { address: "1456 W 20th St, Jacksonville, FL 32209" }
//    → returns shaped fields ready to drop into the form (no DB write).
//
// 3. Scheduled batch sweep (Netlify cron):
//    GET /.netlify/functions/enrich-lead (called by Netlify Scheduled Functions)
//    → refreshes mls_status for non-terminal leads that haven't been checked in 4h.

const RENTCAST_BASE = 'https://api.rentcast.io/v1'

// Env vars
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pyrgotfotmwazigewlke.supabase.co'
const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'pyrgotfotmwazigewlke'
const SUPABASE_PAT = process.env.SUPABASE_PAT // Management API PAT — bypasses RLS

// ── RentCast helpers ────────────────────────────────────────────────────

async function rentcastGet(path) {
  const url = `${RENTCAST_BASE}${path}`
  const r = await fetch(url, { headers: { 'X-Api-Key': RENTCAST_API_KEY, Accept: 'application/json' } })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  return { status: r.status, json, raw: text }
}

function normalizeMlsStatusRaw(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().replace(/[-_\s]+/g, '_')
  // Order matters — check more specific terms before generic ones.
  if (s.includes('inactive')) return 'inactive'        // generic "no longer active" — needs further inference
  if (s.includes('withdraw') || s.includes('cancel')) return 'withdrawn'
  if (s.includes('expire')) return 'expired'
  if (s.includes('sold') || s.includes('closed')) return 'sold'
  if (s.includes('conting')) return 'contingent'
  if (s.includes('pend')) return 'pending'
  if (s.includes('off')) return 'off_market'
  if (s.includes('active')) return 'active'
  return null
}

// RentCast collapses MLS state machine to binary Active/Inactive.
// We infer Pending vs Withdrawn vs Sold from removedDate + history context.
function inferMlsStatus(listing) {
  if (!listing) return null
  const raw = normalizeMlsStatusRaw(listing.status)
  if (raw && raw !== 'inactive') return raw   // honest status, use it

  // status is Inactive (or null) — infer from context
  const history = listing.history || {}
  const events = Object.values(history)
  // Most recent event by date
  const sortedDates = Object.keys(history).sort().reverse()
  const latest = sortedDates[0] ? history[sortedDates[0]] : null

  // Any explicit sale event in history → sold
  if (events.some(e => /sold|closed|sale_clos/i.test(e.event || ''))) return 'sold'
  // Any explicit withdraw/expire event → withdrawn
  if (events.some(e => /withdraw|expire|cancel/i.test(e.event || ''))) return 'withdrawn'

  // Look at how recently the listing was removed
  const removedDate = latest?.removedDate || listing.removedDate
  if (removedDate) {
    const ageDays = Math.floor((Date.now() - new Date(removedDate).getTime()) / 86400000)
    if (ageDays >= 0 && ageDays <= 45) return 'pending'   // recent removal with no sale event = most likely pending
    if (ageDays > 45) return 'off_market'
  }
  return 'off_market'
}

// Compute the cumulative days a property was on the market across all listing
// events (RentCast's `daysOnMarket` only reflects the most recent event).
function totalDaysOnMarket(history) {
  if (!history || typeof history !== 'object') return null
  let total = 0
  for (const evt of Object.values(history)) {
    if (evt && evt.event && /list/i.test(evt.event) && typeof evt.daysOnMarket === 'number') {
      total += evt.daysOnMarket
    }
  }
  return total > 0 ? total : null
}

function normalizePropertyType(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase()
  if (s.includes('single')) return 'single_family'
  if (s.includes('multi') || s.includes('duplex') || s.includes('triplex') || s.includes('quad')) return 'multi_family'
  if (s.includes('condo')) return 'condo'
  if (s.includes('town')) return 'townhouse'
  if (s.includes('land') || s.includes('lot')) return 'land'
  if (s.includes('commerc')) return 'commercial'
  return 'other'
}

// Fetch both endpoints in parallel and merge into a flat enrichment object.
async function fetchEnrichmentForAddress(address) {
  const enc = encodeURIComponent(address)
  const [propRes, lstRes] = await Promise.all([
    rentcastGet(`/properties?address=${enc}`),
    rentcastGet(`/listings/sale?address=${enc}`),
  ])

  const property = Array.isArray(propRes.json) ? propRes.json[0] : (propRes.status === 200 ? propRes.json : null)
  const listing = Array.isArray(lstRes.json) ? lstRes.json[0] : (lstRes.status === 200 ? lstRes.json : null)

  if (!property && !listing) {
    return { found: false, error: 'No data found for that address.' }
  }

  // Prefer listing data for the live-status fields; fall back to property for static fields.
  const src = listing || property
  const out = {
    address: src.addressLine1 || property?.addressLine1 || null,
    city: src.city || null,
    state: src.state || null,
    zip_code: src.zipCode || null,
    property_type: normalizePropertyType(src.propertyType),
    bedrooms: src.bedrooms ?? property?.bedrooms ?? null,
    bathrooms: src.bathrooms ?? property?.bathrooms ?? null,
    sqft: src.squareFootage ?? property?.squareFootage ?? null,
    lot_size_sqft: src.lotSize ?? property?.lotSize ?? null,
    year_built: src.yearBuilt ?? property?.yearBuilt ?? null,
    has_garage: property?.features?.garage ?? null,
  }

  if (listing) {
    out.mls_status      = inferMlsStatus(listing)
    // Prefer total-across-history if there are multiple listing events;
    // fall back to the API's daysOnMarket for the most recent one.
    out.days_on_market  = totalDaysOnMarket(listing.history) ?? listing.daysOnMarket ?? null
    out.list_price      = listing.price ?? null
    out.asking_price    = listing.price ?? null   // also mirror to asking_price for UX
    out.list_date       = listing.listedDate ? listing.listedDate.slice(0, 10) : null
    out.mls_number      = listing.mlsNumber ?? null
    out.listing_agent_name  = listing.listingAgent?.name ?? null
    out.listing_agent_phone = listing.listingAgent?.phone ?? null
    out.listing_agent_email = listing.listingAgent?.email ?? null
    out.listing_brokerage   = listing.listingOffice?.name ?? null
    out.rentcast_listing_id = listing.id ?? null
  } else {
    // No active listing → off-market
    out.mls_status = 'off_market'
  }

  if (property) {
    out.rentcast_property_id   = property.id ?? null
    out.owner_name             = property.owner?.names?.[0] ?? null
    out.owner_mailing_address  = property.owner?.mailingAddress?.formattedAddress ?? null
    out.owner_last_sale_date   = property.lastSaleDate ? property.lastSaleDate.slice(0, 10) : null
    out.owner_last_sale_price  = property.lastSalePrice ?? null
  }

  // Raw payload (for debugging / future fields) stored as jsonb.
  out.enrichment_data = { property: property || null, listing: listing || null, fetched_at: new Date().toISOString() }
  out.enriched_at = new Date().toISOString()
  out.mls_last_checked = new Date().toISOString()

  return { found: true, ...out }
}

// ── Supabase helpers (Management API — bypasses RLS) ───────────────────

async function sql(query) {
  if (!SUPABASE_PAT) throw new Error('SUPABASE_PAT not configured')
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch (_) { return [] }
}

function sqlString(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function sqlNumber(v) {
  if (v === null || v === undefined || v === '') return 'NULL'
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : 'NULL'
}
function sqlBool(v) {
  if (v === null || v === undefined) return 'NULL'
  return v ? 'true' : 'false'
}
function sqlJson(v) {
  if (v === null || v === undefined) return 'NULL'
  return `${sqlString(JSON.stringify(v))}::jsonb`
}

async function getLead(leadId) {
  const rows = await sql(`select * from public.leads where id = '${leadId.replace(/'/g, "''")}' limit 1`)
  return rows[0] || null
}

// Returns the mls_paused flag for the workspace (or for the lead's workspace).
// True means: do not make any RentCast calls; return early everywhere.
async function isMlsPaused(workspaceId) {
  if (!workspaceId) return false
  const safe = workspaceId.replace(/'/g, "''")
  const rows = await sql(`select (settings->>'mls_paused')::boolean as paused from public.workspaces where id = '${safe}' limit 1`)
  return !!rows[0]?.paused
}

async function patchLeadWithEnrichment(lead, e) {
  // Never overwrite manually-edited contact fields; only fill if blank.
  const updates = []
  const setIf = (col, val, mode = 'always') => {
    if (val === null || val === undefined) return
    if (mode === 'if_empty' && lead[col] != null && lead[col] !== '') return
    if (typeof val === 'number') updates.push(`${col} = ${sqlNumber(val)}`)
    else if (typeof val === 'boolean') updates.push(`${col} = ${sqlBool(val)}`)
    else updates.push(`${col} = ${sqlString(val)}`)
  }
  // Live fields — always refresh
  setIf('mls_status', e.mls_status)
  setIf('mls_last_checked', e.mls_last_checked)
  setIf('list_price', e.list_price)
  setIf('list_date', e.list_date)
  setIf('days_on_market', e.days_on_market)
  setIf('mls_number', e.mls_number)
  setIf('listing_agent_name', e.listing_agent_name)
  setIf('listing_agent_phone', e.listing_agent_phone)
  setIf('listing_agent_email', e.listing_agent_email)
  setIf('listing_brokerage', e.listing_brokerage)
  setIf('rentcast_listing_id', e.rentcast_listing_id)
  setIf('rentcast_property_id', e.rentcast_property_id)
  setIf('enriched_at', e.enriched_at)
  // Copy listing-agent contact into the primary Contact section, but ONLY
  // if those fields are still blank (preserves wholesaler / FSBO edits).
  if (e.listing_agent_name) {
    const sellerLabel = e.listing_brokerage
      ? `${e.listing_agent_name} (${e.listing_brokerage})`
      : e.listing_agent_name
    setIf('seller_name', sellerLabel, 'if_empty')
  }
  setIf('phone', e.listing_agent_phone, 'if_empty')
  setIf('email', e.listing_agent_email, 'if_empty')
  // Default lead_source to 'mls' if none set and we found a listing
  if (e.rentcast_listing_id) setIf('lead_source', 'mls', 'if_empty')

  // Static-ish fields — fill if empty (don't overwrite human edits)
  setIf('city', e.city, 'if_empty')
  setIf('state', e.state, 'if_empty')
  setIf('zip_code', e.zip_code, 'if_empty')
  setIf('property_type', e.property_type, 'if_empty')
  setIf('bedrooms', e.bedrooms, 'if_empty')
  setIf('bathrooms', e.bathrooms, 'if_empty')
  setIf('sqft', e.sqft, 'if_empty')
  setIf('lot_size_sqft', e.lot_size_sqft, 'if_empty')
  setIf('year_built', e.year_built, 'if_empty')
  setIf('has_garage', e.has_garage, 'if_empty')
  setIf('asking_price', e.asking_price, 'if_empty')
  setIf('owner_name', e.owner_name, 'if_empty')
  setIf('owner_mailing_address', e.owner_mailing_address, 'if_empty')
  setIf('owner_last_sale_date', e.owner_last_sale_date, 'if_empty')
  setIf('owner_last_sale_price', e.owner_last_sale_price, 'if_empty')

  if (e.enrichment_data) updates.push(`enrichment_data = ${sqlJson(e.enrichment_data)}`)

  if (updates.length === 0) return lead
  const setClause = updates.join(', ')
  const updated = await sql(
    `update public.leads set ${setClause} where id = '${lead.id.replace(/'/g, "''")}' returning *`
  )
  return updated[0] || lead
}

function buildActivityContent(e) {
  const parts = []
  parts.push(`mls=${e.mls_status || 'unknown'}`)
  if (typeof e.days_on_market === 'number') parts.push(`DOM=${e.days_on_market}`)
  if (e.list_price) parts.push(`list=$${Number(e.list_price).toLocaleString()}`)
  if (e.listing_agent_name) {
    const agentBlurb = e.listing_brokerage ? `${e.listing_agent_name} (${e.listing_brokerage})` : e.listing_agent_name
    parts.push(`agent=${agentBlurb}`)
  }
  if (e.listing_agent_phone) parts.push(`☎ ${e.listing_agent_phone}`)
  return `✨ Enriched from RentCast — ${parts.join(' · ')}`
}

async function logEnrichment(leadId, content) {
  const safe = content.replace(/'/g, "''")
  await sql(
    `insert into public.lead_activities (lead_id, type, content) values ('${leadId.replace(/'/g, "''")}', 'enrichment', '${safe}')`
  )
}

async function logStatusChange(leadId, oldStatus, newStatus) {
  const a = oldStatus || 'unknown'
  const b = newStatus || 'unknown'
  const safe = `🏷 MLS status changed: ${a} → ${b}`.replace(/'/g, "''")
  await sql(
    `insert into public.lead_activities (lead_id, type, content) values ('${leadId.replace(/'/g, "''")}', 'status_change', '${safe}')`
  )
}

// ── Public handlers ────────────────────────────────────────────────────

async function handleAddressLookup(address, workspaceId) {
  if (await isMlsPaused(workspaceId)) {
    return { status: 200, body: { ok: false, paused: true, error: 'RentCast enrichment is paused for this workspace. Re-enable in Settings → MLS Auto-Refresh.' } }
  }
  const e = await fetchEnrichmentForAddress(address)
  if (!e.found) {
    return { status: 404, body: { ok: false, error: e.error } }
  }
  // Strip the raw payload from the response (the form doesn't need it)
  const { enrichment_data, ...rest } = e
  return { status: 200, body: { ok: true, ...rest } }
}

async function handleLeadEnrich(leadId, force) {
  const lead = await getLead(leadId)
  if (!lead) return { status: 404, body: { ok: false, error: 'Lead not found.' } }
  if (await isMlsPaused(lead.workspace_id)) {
    return { status: 200, body: { ok: false, paused: true, error: 'RentCast enrichment is paused for this workspace. Re-enable in Settings → MLS Auto-Refresh.' } }
  }
  if (!force && lead.enriched_at) {
    const ageMs = Date.now() - new Date(lead.enriched_at).getTime()
    if (ageMs < 24 * 3600 * 1000) {
      return { status: 200, body: { ok: true, skipped: true, reason: 'Enriched within last 24h', lead } }
    }
  }
  const addr = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')
  if (!addr) return { status: 400, body: { ok: false, error: 'Lead has no address to look up.' } }

  const e = await fetchEnrichmentForAddress(addr)
  if (!e.found) {
    return { status: 200, body: { ok: false, error: e.error } }
  }
  const oldStatus = lead.mls_status
  const updated = await patchLeadWithEnrichment(lead, e)
  await logEnrichment(lead.id, buildActivityContent(e))
  if (e.mls_status && oldStatus && e.mls_status !== oldStatus) {
    await logStatusChange(lead.id, oldStatus, e.mls_status)
  }
  return { status: 200, body: { ok: true, lead: updated } }
}

async function handleScheduledSweep() {
  // Refresh non-terminal leads whose mls_last_checked is null or >4h ago.
  // Cap at 50/run to stay under timeouts and avoid burning credits.
  const rows = await sql(`
    select id from public.leads
    where status not in ('sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed')
      and (mls_last_checked is null or mls_last_checked < now() - interval '4 hours')
    order by mls_last_checked asc nulls first
    limit 50
  `)
  const results = { processed: 0, changed: 0, errors: 0 }
  for (const r of rows) {
    try {
      const res = await handleLeadEnrich(r.id, true)
      if (res.body?.ok) results.processed++
    } catch (e) {
      results.errors++
    }
  }
  return { status: 200, body: { ok: true, ...results } }
}

// Netlify functions handler
export default async (req) => {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,GET,OPTIONS' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })

  try {
    if (!RENTCAST_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'RENTCAST_API_KEY not configured' }), { status: 500, headers })
    }
    if (req.method === 'GET') {
      // Scheduled invocation
      const res = await handleScheduledSweep()
      return new Response(JSON.stringify(res.body), { status: res.status, headers })
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (body.address && !body.lead_id) {
        const res = await handleAddressLookup(body.address, body.workspace_id)
        return new Response(JSON.stringify(res.body), { status: res.status, headers })
      }
      if (body.lead_id) {
        const res = await handleLeadEnrich(body.lead_id, !!body.force)
        return new Response(JSON.stringify(res.body), { status: res.status, headers })
      }
      return new Response(JSON.stringify({ ok: false, error: 'Provide either { address } or { lead_id }' }), { status: 400, headers })
    }
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers })
  }
}

// Note: this is an HTTP-callable function — no `config.schedule` here.
// To trigger the batch sweep on a schedule, either:
//   1) add a separate scheduled function that POSTs to this endpoint, or
//   2) point an external cron (cron-job.org, Supabase pg_cron) at GET /enrich-lead.
