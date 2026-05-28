const SUPABASE_PAT = 'sbp_05434f76c664e2ed394f7e128cd22eb78058bcc1'
const SUPABASE_PROJECT_REF = 'pyrgotfotmwazigewlke'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch (_) { return [] }
}

const result = await sql(`
  SELECT address, asking_price, status, created_at
  FROM public.leads
  WHERE workspace_id = '${WORKSPACE_ID}'
  ORDER BY created_at DESC
  LIMIT 50
`)

console.log('Existing leads in CRM:')
for (const row of result) {
  console.log(`  ${row.address} | $${row.asking_price} | ${row.status} | ${row.created_at?.slice(0,10)}`)
}
console.log(`Total: ${result.length}`)
