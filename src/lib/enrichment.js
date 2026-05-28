// Client helper for calling the enrichment Netlify function.
// During `netlify dev`, the function is served at /.netlify/functions/enrich-lead
// on the same origin as the Vite app. In production it's the same path.

const ENDPOINT = '/.netlify/functions/enrich-lead'

async function postJson(payload) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) {}
  if (!r.ok || !json?.ok) {
    return { ok: false, error: (json && json.error) || text || `HTTP ${r.status}` }
  }
  return json
}

// Look up by address (used by the "Look up" autofill button in New Lead form).
// Returns the enrichment object ready to drop into form fields.
export async function lookupAddress(address) {
  if (!address || !address.trim()) return { ok: false, error: 'Address required' }
  return postJson({ address: address.trim() })
}

// Enrich an existing lead in place (writes to DB, logs activity).
// Returns the updated lead row on success.
export async function enrichLead(leadId, { force = false } = {}) {
  if (!leadId) return { ok: false, error: 'Lead id required' }
  return postJson({ lead_id: leadId, force })
}
