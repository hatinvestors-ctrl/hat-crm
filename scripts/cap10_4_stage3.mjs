import fs from 'node:fs'
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const svcKey = env.SUPABASE_SERVICE_ROLE_KEY

const leads = JSON.parse(fs.readFileSync(new URL('./cap10_4_remaining.json', import.meta.url), 'utf8'))
const results = []

for (const l of leads) {
  try {
    const res = await fetch('https://gilded-elf-31457a.netlify.app/.netlify/functions/batchdata-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-key': svcKey },
      body: JSON.stringify({ lead_id: l.id, force: true }),
    })
    const body = await res.json()
    results.push({ address: l.address, ...body })
    console.log(l.address, '->', body.skipTraceStatus, '|', body.contactMatchStatus, '| phone:', body.phoneFound, '| email:', body.emailFound, '| prop:', body.propertyStatus, '| buybox:', body.buyBoxFit, '| score:', body.opportunityScore, body.opportunityPriority?.key)
  } catch (err) {
    results.push({ address: l.address, ok: false, error: err.message })
    console.log(l.address, '-> THROWN', err.message)
  }
}

fs.writeFileSync(new URL('./cap10_4_stage3_results.json', import.meta.url), JSON.stringify(results, null, 2))
console.log('\nDone.')
