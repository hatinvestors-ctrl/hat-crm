// Daily MLS enrichment sweep.
//
// Runs every hour. For each workspace where settings.mls_sweep_enabled is true,
// and the workspace-local hour matches settings.mls_sweep_hour, refresh
// MLS status for all non-terminal leads that haven't been checked in 12h+.
//
// This makes the sweep configurable per-workspace WITHOUT redeploying:
// the user picks the hour + timezone from the Settings page and it just works.

const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'pyrgotfotmwazigewlke'
const SUPABASE_PAT = process.env.SUPABASE_PAT
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY
const RENTCAST_BASE = 'https://api.rentcast.io/v1'

const TERMINAL_STATUSES = "('sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed')"

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`)
  return JSON.parse(text)
}

function workspaceCurrentHour(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone || 'Asia/Jerusalem' })
    const parts = fmt.formatToParts(new Date())
    const hourPart = parts.find(p => p.type === 'hour')
    return Number(hourPart?.value ?? new Date().getUTCHours())
  } catch (_) {
    return new Date().getUTCHours()
  }
}

// Tiny inline enrichment — same shape as the on-demand function, but called
// directly here to avoid an extra HTTP hop.
async function enrichOne(leadId) {
  const r = await fetch(`https://${process.env.URL?.replace(/^https?:\/\//, '') || 'localhost:8888'}/.netlify/functions/enrich-lead`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lead_id: leadId, force: true }),
  })
  return r.ok
}

export default async () => {
  if (!SUPABASE_PAT || !RENTCAST_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing env vars' }), { status: 500 })
  }

  // Pull workspaces with sweep enabled AND not paused
  const workspaces = await sql(`select id, name, settings from public.workspaces where (settings->>'mls_sweep_enabled')::boolean = true and coalesce((settings->>'mls_paused')::boolean, false) = false`)
  const results = []

  for (const w of workspaces) {
    const tz = w.settings?.mls_sweep_timezone || 'Asia/Jerusalem'
    const targetHour = Number(w.settings?.mls_sweep_hour ?? 5)  // default 5am
    const currentHour = workspaceCurrentHour(tz)
    if (currentHour !== targetHour) {
      results.push({ workspace: w.name, skipped: true, reason: `current ${tz} hour ${currentHour} ≠ target ${targetHour}` })
      continue
    }

    // Pick leads to refresh — non-terminal, stale (or never-checked)
    const cap = Number(w.settings?.mls_sweep_max_leads ?? 100)
    const rows = await sql(`
      select id from public.leads
      where workspace_id = '${w.id}'
        and status not in ${TERMINAL_STATUSES}
        and (mls_last_checked is null or mls_last_checked < now() - interval '12 hours')
      order by mls_last_checked asc nulls first
      limit ${cap}
    `)

    let ok = 0, fail = 0
    for (const r of rows) {
      try {
        const success = await enrichOne(r.id)
        if (success) ok++; else fail++
      } catch (_) { fail++ }
    }
    results.push({ workspace: w.name, processed: ok, failed: fail, total: rows.length })
  }

  return new Response(JSON.stringify({ ok: true, ran_at: new Date().toISOString(), results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// Run every hour at minute :07 (offset from the on-demand to spread API load)
export const config = {
  schedule: '7 * * * *',
}
