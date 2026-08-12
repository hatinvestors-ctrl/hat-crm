// scripts/cap15_audit_sample.mjs
// Capability #15 — READ-ONLY audit sample puller. Selects real on-market and
// off-market leads from production for the decision-engine audit. No writes,
// no scoring changes, no BatchData calls.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data: onMarket, error: onErr } = await supabase
    .from('leads')
    .select('id,address,zip_code,lead_source,status,asking_price,arv,renovation_cost,mao,rent_estimate,ai_notes,deal_analysis,is_distressed,enrichment_data,created_at')
    .not('ai_notes', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80)
  if (onErr) console.error('onMarket error:', onErr)

  const { data: offMarket, error: offErr } = await supabase
    .from('leads')
    .select('id,address,zip_code,lead_source,status,owner_name,notes,distress_data,is_distressed,enrichment_data,phone,email,created_at')
    .eq('is_distressed', true)
    .order('created_at', { ascending: false })
    .limit(60)
  if (offErr) console.error('offMarket error:', offErr)

  fs.writeFileSync(new URL('./cap15_audit_raw.json', import.meta.url), JSON.stringify({ onMarket, offMarket }, null, 2))
  console.log('On-market pulled:', onMarket?.length, '| Off-market pulled:', offMarket?.length)
}
main().catch(e => { console.error(e); process.exit(1) })
