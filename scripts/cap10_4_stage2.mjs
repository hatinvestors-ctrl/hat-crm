import fs from 'node:fs'
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const svcKey = env.SUPABASE_SERVICE_ROLE_KEY

const leads = [
  { id: '0a4f6925-975b-49d7-983e-8d89461e2f39', address: '6446 S ISH BRANT RD' },
  { id: '901a7009-9327-44eb-ba25-0efa9f72573d', address: '3603 E LEDBURY DR' },
  { id: 'ad2e895c-6892-443d-8400-5e0fc3ef883c', address: '3562 GRASSY RIDE DR' },
  { id: '66e22810-689b-458c-b162-d7a27aad6bf9', address: '971 S 16TH AVE' },
]

for (const l of leads) {
  const res = await fetch('https://gilded-elf-31457a.netlify.app/.netlify/functions/batchdata-enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-key': svcKey },
    body: JSON.stringify({ lead_id: l.id, force: true }),
  })
  const body = await res.json()
  console.log(l.address, '->', JSON.stringify(body))
}
