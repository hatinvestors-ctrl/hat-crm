// scripts/cap10_3_reprocess.mjs
// Capability #10.3 — Property + Owner Contact Enrichment V1.
//
// For each existing Capability #10 pilot lead (19, verified live):
//   1. Attempts RentCast (already-integrated provider) for property
//      characteristics (property type/beds/baths/sqft/year built) via the
//      real deployed Netlify function — never fabricated if it fails.
//   2. Applies attemptContactEnrichment() — honestly returns NO_MATCH for
//      all 19 today; no paid skip-trace provider is connected yet.
//   3. Updates the existing lead row in place (zero new leads/properties).

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { attemptContactEnrichment } from '../src/lib/contactEnrichment.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const ENRICH_LEAD_FN = 'https://gilded-elf-31457a.netlify.app/.netlify/functions/enrich-lead'

async function tryRentCast(address, city, zip) {
  try {
    const full = [address, city ? `${city}, FL` : 'FL', zip].filter(Boolean).join(', ')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(ENRICH_LEAD_FN, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: full }), signal: controller.signal,
    })
    clearTimeout(timer)
    const json = await res.json()
    if (!json.ok) return { found: false, error: json.error || 'unknown' }
    return {
      found: true,
      property_type: json.property_type ?? null,
      bedrooms: json.bedrooms ?? null,
      bathrooms: json.bathrooms ?? null,
      sqft: json.sqft ?? null,
      lot_size_sqft: json.lot_size_sqft ?? null,
      year_built: json.year_built ?? null,
    }
  } catch (err) {
    return { found: false, error: err.message }
  }
}

async function main() {
  const { data: leads } = await supabase.from('leads').select('*').ilike('notes', '⚠ DISTRESSED OPPORTUNITY%')
  console.log(`Pilot leads found: ${leads.length}`)

  const results = []
  let rentcastFound = 0
  let rentcastBlocked = 0

  for (const lead of leads) {
    const rc = await tryRentCast(lead.address, lead.city || 'Jacksonville', lead.zip_code)
    if (rc.found) rentcastFound++
    else rentcastBlocked++

    const contact = attemptContactEnrichment()

    const updatedEnrichmentData = {
      ...(lead.enrichment_data || {}),
      property_data_source: rc.found ? 'rentcast' : (lead.enrichment_data?.property_data_source || null),
      property_data_attempted_at: new Date().toISOString(),
      property_data_error: rc.found ? null : rc.error,
      contact_source: contact.contact_source,
      contact_match_status: contact.contact_match_status,
      contact_enriched_at: new Date().toISOString(),
    }

    const leadUpdate = {
      property_type: rc.found ? (rc.property_type ?? lead.property_type) : lead.property_type,
      bedrooms: rc.found ? (rc.bedrooms ?? lead.bedrooms) : lead.bedrooms,
      bathrooms: rc.found ? (rc.bathrooms ?? lead.bathrooms) : lead.bathrooms,
      sqft: rc.found ? (rc.sqft ?? lead.sqft) : lead.sqft,
      lot_size_sqft: rc.found ? (rc.lot_size_sqft ?? lead.lot_size_sqft) : lead.lot_size_sqft,
      year_built: rc.found ? (rc.year_built ?? lead.year_built) : lead.year_built,
      phone: contact.owner_phone ?? lead.phone,
      email: contact.owner_email ?? lead.email,
      enrichment_data: updatedEnrichmentData,
    }

    const { error: updErr } = await supabase.from('leads').update(leadUpdate).eq('id', lead.id)
    if (updErr) console.warn('Update failed for', lead.address, updErr.message)

    results.push({
      address: lead.address,
      rentcastFound: rc.found,
      rentcastError: rc.error || null,
      propertyType: rc.property_type || null,
      beds: rc.bedrooms || null,
      baths: rc.bathrooms || null,
      sqft: rc.sqft || null,
      yearBuilt: rc.year_built || null,
      phone: contact.owner_phone,
      email: contact.owner_email,
      contactMatchStatus: contact.contact_match_status,
      opportunityScore: lead.enrichment_data?.opportunity_score ?? null,
      opportunityPriority: lead.enrichment_data?.opportunity_priority ?? null,
      distressCategory: lead.enrichment_data?.distress_category ?? null,
      buyBoxFit: lead.enrichment_data?.buy_box_fit ?? null,
    })
    console.log(lead.address, '-> RentCast:', rc.found ? 'FOUND' : `BLOCKED (${rc.error})`, '| contact:', contact.contact_match_status)
  }

  console.log(`\nRentCast found: ${rentcastFound}/${leads.length}, blocked: ${rentcastBlocked}/${leads.length}`)
  fs.writeFileSync(new URL('./cap10_3_results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log('Results written to scripts/cap10_3_results.json')
}

main().catch(err => { console.error(err); process.exit(1) })
