#!/usr/bin/env node
// scripts/enrich-property-cli.mjs
// Capability #9 — manual test harness for src/lib/propertyEnrichment.js.
//
// Usage:
//   npm run enrich-property -- "123 Main St, Jacksonville, FL"
//   npm run enrich-property -- --parcel 1234560000
//
// Does a live lookup only (no Supabase caching) — this is a development
// tool, not production UI, per the mission's explicit instruction.

import { enrichProperty } from '../src/lib/propertyEnrichment.js'

const args = process.argv.slice(2)
let address = null
let parcelId = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--parcel') {
    parcelId = args[i + 1]
    i++
  } else if (!address) {
    address = args[i]
  }
}

if (!address && !parcelId) {
  console.error('Usage: npm run enrich-property -- "123 Main St, Jacksonville, FL"')
  console.error('   or: npm run enrich-property -- --parcel <parcel_id>')
  process.exit(1)
}

console.log(`Looking up: ${address ? `address="${address}"` : ''}${parcelId ? ` parcel="${parcelId}"` : ''}\n`)

const result = await enrichProperty({ address, parcel_id: parcelId })

const fmt = (v) => (v === null || v === undefined ? '—' : v)
const fmtMoney = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString()}`)

console.log(`MATCH STATUS:      ${result.match_confidence}${result.matched ? '' : ' (no enrichment data)'}`)
if (result.error) console.log(`ERROR:             ${result.error}`)
console.log(`PARCEL:            ${fmt(result.parcel_id)}`)
console.log(`OWNER:             ${fmt(result.owner_name)}`)
console.log(`OWNER MAILING:     ${fmt(result.owner_mailing_address)}`)
console.log(`PROPERTY ADDRESS:  ${fmt(result.property_address)}`)
console.log(`PROPERTY TYPE:     ${fmt(result.property_type)} (land_use code: ${fmt(result.land_use)})`)
console.log(`YEAR BUILT:        ${fmt(result.year_built)}`)
console.log(`LIVING AREA:       ${result.living_area != null ? `${result.living_area} sqft` : '—'}`)
console.log(`VALUATION:         Just ${fmtMoney(result.just_value)} | Assessed ${fmtMoney(result.assessed_value)} | Taxable ${fmtMoney(result.taxable_value)}`)
console.log(`LAST SALE:         ${fmtMoney(result.last_sale_price)} on ${fmt(result.last_sale_date)}`)
console.log(`PREVIOUS SALE:     ${fmtMoney(result.previous_sale_price)} on ${fmt(result.previous_sale_date)}`)
console.log(`ABSENTEE OWNER:    ${result.absentee_owner}`)
console.log(`SOURCE:            ${result.enrichment_source} (enriched ${result.enriched_at})`)
