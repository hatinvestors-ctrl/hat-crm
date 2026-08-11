// scripts/cap14_batchdata.mjs
// Capability #14 — BatchData enrichment for the top 10 recorded-lien
// candidates from scripts/cap14_lien_pipeline.mjs. Reuses the EXISTING
// hardened Netlify function (netlify/functions/batchdata-enrich.mjs) —
// preflight, unit-aware identity, wrong-owner protection, cache, duplicate-
// billing protection, provider health, error classification — nothing new
// built here. Server-to-server auth via x-service-key (same path the
// function already supports for pilot scripts, see its own header).
//
// Run: node scripts/cap14_batchdata.mjs

import fs from 'node:fs'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  })
)

const SITE_URL = 'https://gilded-elf-31457a.netlify.app'
const MAX_NEW_PAID = 10

// Top 10, ranked by absentee-owner + lien-strength (see delivery report for
// exact ranking logic run against scripts/cap14_lien_pipeline_results.json).
const CANDIDATE_LEAD_IDS = [
  'a61cd14b-3cdf-4bf3-884d-850b3ce86be5', // 8550 Touchton Rd Unit 2121
  '311ecae2-1e6c-4a49-bdfa-5c1819ef491d', // 11803 Beardgrass Wy
  '8e72297d-0f15-4b6e-b365-2c377bdba3a9', // 11764 Beardgrass Wy
  'dbe378b3-c4d3-4a3e-8f88-d31a0d19c7c3', // 2929 Justina Rd
  'ed865ecb-8ed9-4c3b-bd1e-2f3216db5f38', // 7669 Legacy Trl
  '62035ffa-a5dd-46f8-9f7d-a137e1b6a22d', // 11795 Beardgrass Wy
  'f13f3fba-5402-47db-98cf-ad9e05234004', // 7558 Grossman Ct
  '76392faa-96bc-4e47-b45d-c7be49e99e60', // 7388 Benes Trl
  'fe3d92cb-0613-41c2-8ba6-0668aeeeee6a', // 7581 Cosmo Ct
  'e8d4b364-8ffd-4eb9-a81c-ed4e12c78348', // 6333 Whitby Ct
]

async function main() {
  const out = []
  let stop = false
  for (const [i, leadId] of CANDIDATE_LEAD_IDS.entries()) {
    if (stop) { out.push({ leadId, skipped: 'STOPPED_EARLIER' }); continue }
    if (i >= MAX_NEW_PAID) break

    try {
      const res = await fetch(`${SITE_URL}/.netlify/functions/batchdata-enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-key': env.SUPABASE_SERVICE_ROLE_KEY },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const body = await res.json()
      console.log(leadId, res.status, JSON.stringify(body).slice(0, 300))

      if (!res.ok || body?.skipTraceStatus === 'AUTH_ERROR' || body?.skipTraceStatus === 'BILLING_ERROR') {
        out.push({ leadId, ok: false, status: res.status, body })
        if (body?.skipTraceStatus === 'AUTH_ERROR' || body?.skipTraceStatus === 'BILLING_ERROR' || /NO_BALANCE/i.test(JSON.stringify(body))) {
          console.error('STOP condition hit:', body?.skipTraceStatus || 'NO_BALANCE')
          stop = true
        }
        continue
      }
      out.push({ leadId, ok: true, body })
    } catch (err) {
      console.error(leadId, 'ERROR', err.message)
      out.push({ leadId, ok: false, error: err.message })
    }
  }

  fs.writeFileSync(new URL('./cap14_batchdata_results.json', import.meta.url), JSON.stringify(out, null, 2))
  console.log('\nWritten to scripts/cap14_batchdata_results.json')
}

main().catch(err => { console.error(err); process.exit(1) })
