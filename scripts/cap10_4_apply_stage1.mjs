// One-off: apply the already-fetched, already-paid-for Stage 1 BatchData
// responses (10200 Belle Rive Blvd) using the SAME corrected logic now in
// netlify/functions/batchdata-enrich.mjs, without re-billing the API.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { qualifyBuyBox } from '../src/lib/buyBox.js'
import { computeOpportunityScore } from '../src/lib/distressScoring.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const LEAD_ID = '4535acab-fbed-4cf6-b380-7525bc6d0f41'
const skipTraceRaw = JSON.parse(fs.readFileSync(new URL('./skiptrace_resp.json', import.meta.url), 'utf8'))
const propLookupRaw = JSON.parse(fs.readFileSync(new URL('./proplookup_resp.json', import.meta.url), 'utf8'))

function normalizeName(n) {
  if (!n) return ''
  return String(n).toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
}
function classifyPersonMatch(person, lead) {
  const returnedName = normalizeName(person?.name?.full)
  const ourOwner = normalizeName(lead.owner_name)
  if (!returnedName || !ourOwner) return 'NO_MATCH'
  if (returnedName === ourOwner) return 'VERIFIED'
  const returnedTokens = new Set(returnedName.split(' '))
  const ourTokens = ourOwner.split(' ').filter(Boolean)
  const overlap = ourTokens.filter(t => returnedTokens.has(t)).length
  if (overlap >= 2) return 'LIKELY'
  if (overlap === 1) return 'AMBIGUOUS'
  return 'NO_MATCH'
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

async function main() {
  const { data: lead } = await supabase.from('leads').select('*').eq('id', LEAD_ID).single()

  const persons = skipTraceRaw.result?.data?.[0]?.persons || []
  let contactMatchStatus = 'NO_MATCH'
  if (persons.length) {
    const ranked = persons.map(p => ({ p, match: classifyPersonMatch(p, lead) }))
      .sort((a, b) => ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(a.match) - ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(b.match))
    contactMatchStatus = ranked[0].match
  }
  const skipTraceStatus = persons.length ? 'SUCCESS' : 'NO_MATCH'

  const rec = propLookupRaw.results?.properties?.[0] || null
  const propertyStatus = rec ? 'SUCCESS' : 'NO_MATCH'
  const b = rec?.building || {}
  const g = rec?.general || {}
  const propertyFields = rec ? {
    property_type: normalizePropertyType(g.propertyTypeDetail || g.propertyTypeCategory),
    property_type_detail: g.propertyTypeDetail || null,
    year_built: b.yearBuilt || null,
    sqft: b.livingAreaSquareFeet || b.totalBuildingAreaSquareFeet || null,
    bedrooms: b.bedroomCount ?? null,
    bathrooms: b.bathroomCount ?? null,
    lot_size_sqft: rec.lot?.lotSizeSquareFeet || null,
    avm_estimate: rec.valuation?.estimatedValue || null,
  } : {}

  const leadUpdate = {
    property_type: lead.property_type || propertyFields.property_type || null,
    bedrooms: lead.bedrooms || propertyFields.bedrooms || null,
    bathrooms: lead.bathrooms || propertyFields.bathrooms || null,
    sqft: lead.sqft || propertyFields.sqft || null,
    lot_size_sqft: lead.lot_size_sqft || propertyFields.lot_size_sqft || null,
    year_built: lead.year_built || propertyFields.year_built || null,
  }
  // NO_MATCH — no phone/email written, per Section 5.

  const buyBox = qualifyBuyBox({ zip_code: lead.zip_code, property_type: leadUpdate.property_type, bedrooms: leadUpdate.bedrooms })
  const distressCategory = lead.enrichment_data?.distress_category || 'UNKNOWN'
  const hasCharacteristics = !!(leadUpdate.year_built || leadUpdate.sqft || leadUpdate.bedrooms || leadUpdate.bathrooms)
  const excluded = !!lead.enrichment_data?.excluded
  const opp = computeOpportunityScore({
    distressCategory, buyBoxFit: buyBox.fit,
    ownerMatchStatus: lead.enrichment_data?.owner_match_status || 'MATCH',
    absenteeOwner: lead.enrichment_data?.absentee_owner ?? 'unknown',
    identityVerified: true, zipCode: lead.zip_code, propertyType: leadUpdate.property_type,
    hasCharacteristics, priorPropertyIntelHistory: false, excluded,
  })

  const now = new Date().toISOString()
  leadUpdate.enrichment_data = {
    ...(lead.enrichment_data || {}),
    contact_source: 'none_connected', // NO_MATCH — nothing trustworthy to attribute to batchdata
    contact_match_status: contactMatchStatus,
    contact_enriched_at: now,
    contact_dnc: null,
    skip_trace_status: skipTraceStatus,
    property_data_source: propertyStatus === 'SUCCESS' ? 'batchdata' : null,
    property_lookup_status: propertyStatus,
    property_type_detail: propertyFields.property_type_detail || null,
    batchdata_avm_estimate: propertyFields.avm_estimate ?? null,
    buy_box_fit: buyBox.fit,
    buy_box_reasons: buyBox.reasons,
    opportunity_score: opp.score,
    opportunity_priority: opp.priority,
    opportunity_why: opp.why,
    opportunity_missing: opp.missing,
    note_batchdata_owner_mismatch: rec?.owner?.fullName || null, // real finding — kept for transparency, NOT written to lead.owner_name
  }

  const { error } = await supabase.from('leads').update(leadUpdate).eq('id', LEAD_ID)
  if (error) { console.error(error); process.exit(1) }

  console.log('Applied Stage 1 result:')
  console.log('  skipTraceStatus:', skipTraceStatus, '| contactMatchStatus:', contactMatchStatus)
  console.log('  propertyStatus:', propertyStatus, '| property_type:', propertyFields.property_type, '(' + propertyFields.property_type_detail + ')')
  console.log('  beds/baths/sqft/year:', propertyFields.bedrooms, propertyFields.bathrooms, propertyFields.sqft, propertyFields.year_built)
  console.log('  buyBox:', buyBox.fit, buyBox.reasons)
  console.log('  opportunity:', opp.score, opp.priority.key)
  console.log('  BatchData owner on file (NOT written to our record):', rec?.owner?.fullName)
}

main()
