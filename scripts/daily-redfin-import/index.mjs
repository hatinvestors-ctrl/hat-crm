/**
 * HAT-AI Daily Redfin Import
 * Reads today's Redfin emails → Claude filters leads → inserts into HatCRM → sends summary email
 * Runs via Windows Task Scheduler daily at 10am Israel time.
 */

import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import 'dotenv/config'
// Capability #15.5.1 — this script writes leads directly via raw REST
// (sbPost), bypassing src/lib/leadImport.js entirely, so it needs its own
// explicit V2 recalculation call after insert. Pure JS, no browser deps.
import { computeDecisionV2 } from '../../src/lib/decisionEngineV2.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pyrgotfotmwazigewlke.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const SUMMARY_RECIPIENTS = ['tom@hatinvestors.com', 'hemi@hatinvestors.com']

// ─── ZIP utilities ────────────────────────────────────────────────────────────

const BLOCKED_ZIPS = new Set(['32206', '32209', '32254'])

// Extract ZIP from address string using regex (e.g. "123 Main St, Jacksonville, FL 32210")
function extractZipFromText(text) {
  if (!text) return null
  const match = text.match(/\bFL\s+(\d{5})\b/i) || text.match(/Jacksonville[^0-9]*(\d{5})/i) || text.match(/\b(3\d{4})\b/)
  return match ? match[1] : null
}

// Lookup ZIP — tries US Census Bureau first, falls back to OpenStreetMap (both free, no API key)
async function lookupZip(address) {
  const fullAddr = address.includes('FL') ? address : `${address}, Jacksonville, FL`

  // Layer 1: US Census Bureau geocoder
  try {
    const encoded = encodeURIComponent(fullAddr)
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (r.ok) {
      const data = await r.json()
      const match = data?.result?.addressMatches?.[0]
      if (match) {
        const zip = extractZipFromText(match.matchedAddress)
        if (zip) return zip
      }
    }
  } catch { /* fall through */ }

  // Layer 2: OpenStreetMap Nominatim
  try {
    const encoded = encodeURIComponent(fullAddr)
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'HAT-Investors-CRM/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (r.ok) {
      const data = await r.json()
      const zip = data?.[0]?.address?.postcode
      if (zip) return String(zip).slice(0, 5)
    }
  } catch { /* fall through */ }

  return null
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

function sbHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() })
  const text = await r.text()
  if (!r.ok) throw new Error(`Supabase GET error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch { return [] }
}

async function sbPost(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Supabase POST error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch { return [] }
}

// Normalize address for dedup — handles "Lane" vs "Ln", "Street" vs "St", etc.
function normalizeAddress(addr) {
  if (!addr) return ''
  return addr
    .toLowerCase()
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\bboulevard\b/g, 'blvd').replace(/\bdrive\b/g, 'dr')
    .replace(/\blane\b/g, 'ln').replace(/\broad\b/g, 'rd')
    .replace(/\bcourt\b/g, 'ct').replace(/\bplace\b/g, 'pl')
    .replace(/\bcircle\b/g, 'cir').replace(/\bterrace\b/g, 'ter')
    .replace(/\btrail\b/g, 'trl').replace(/\bway\b/g, 'wy')
    .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w')
    .replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim()
}

async function addressExists(address) {
  const wsFilter = `workspace_id=eq.${WORKSPACE_ID}`
  // Strategy 1: exact ilike match
  const exact = await sbGet(`leads?${wsFilter}&address=ilike.${encodeURIComponent(address)}&select=id&limit=1`)
  if (exact.length > 0) return true

  // Strategy 2: house number + first street word (catches Ln vs Lane, St vs Street)
  const parts = address.trim().split(/\s+/)
  if (parts.length >= 2) {
    const prefix = `${parts[0]} ${parts[1]}`
    const fuzzy = await sbGet(`leads?${wsFilter}&address=ilike.${encodeURIComponent(prefix + '*')}&select=id&limit=1`)
    if (fuzzy.length > 0) return true
  }

  return false
}

async function insertLead(lead) {
  const now = new Date().toISOString()
  const row = {
    workspace_id: WORKSPACE_ID,
    address: lead.address,
    city: 'Jacksonville',
    state: 'FL',
    zip_code: lead.zip_code || null,
    property_type: 'single_family',
    bedrooms: lead.bedrooms || null,
    bathrooms: lead.bathrooms || null,
    sqft: lead.sqft || null,
    asking_price: lead.asking_price || null,
    list_price: lead.list_price || null,
    lead_source: 'redfin_auto',
    redfin_trigger_type: lead.redfin_trigger_type || null,
    status: 'triage',
    auto_imported: true,
    mls_status: 'active',
    is_hot: lead.is_hot || false,
    notes: lead.notes || null,
    listing_agent_name: lead.listing_agent_name || null,
    listing_agent_phone: lead.listing_agent_phone || null,
    listing_agent_email: lead.listing_agent_email || null,
    assigned_to: '6d551c7a-6191-4f33-9d48-e7fd3a985fad',
    created_at: now,
    updated_at: now,
  }
  const created = await sbPost('leads', row)
  await recalculateDecisionV2ForNewLead(created?.[0])
  return created
}

// Capability #15.5.1 — Section 4: trigger deterministic V2 immediately on
// ingestion, never delayed waiting for AI. Never blocks/fails the real
// insert above (already returned) — errors here are caught and logged
// only, including the expected "column does not exist" case until the
// #15.2/#15.5 migrations are applied.
async function recalculateDecisionV2ForNewLead(lead) {
  if (!lead?.id) return
  try {
    const decision = computeDecisionV2(lead, 'on_market', { trigger: 'NEW_LEAD' })
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify({ decision_v2: decision, decision_v2_updated_at: decision.calculated_at }),
    })
    if (!r.ok) {
      const text = await r.text()
      if (!/decision_v2/i.test(text)) console.warn('[daily-redfin-import] V2 write failed (non-fatal):', text)
    }
  } catch (err) {
    console.warn('[daily-redfin-import] V2 recalculation failed (non-fatal):', err.message)
  }
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

function buildGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3737/oauth/callback'
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

// Extract plaintext body from Gmail message payload (handles nested parts)
function extractPlaintext(payload) {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlaintext(part)
      if (text) return text
    }
  }
  return ''
}

async function fetchTodayRedfinEmails(gmail) {
  const query = 'from:redfin.com newer_than:1d'
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 100,
  })

  const messages = listRes.data.messages || []
  if (messages.length === 0) return []

  const emails = []
  for (const msg of messages) {
    // Fetch full message to get body content
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    })

    const headers = full.data.payload.headers
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const snippet = full.data.snippet || ''

    // Quick skip on subject: clearly not SFR
    const subjectLower = subject.toLowerCase()
    if (
      subjectLower.includes('luxury') ||
      subjectLower.includes('commercial') ||
      subjectLower.includes('condo') ||
      subjectLower.includes('townhome') ||
      subjectLower.includes('townhouse') ||
      subjectLower.includes('new construction homes for you') ||
      subjectLower.includes('see what you can afford') ||
      subjectLower.includes('prices just dipped on these')
    ) continue

    // Extract plaintext body — cap at 3000 chars to stay within token budget
    const bodyFull = extractPlaintext(full.data.payload)
    const body = bodyFull.slice(0, 3000)

    emails.push({ id: msg.id, subject, snippet, body })
  }

  return emails
}

// ─── Claude filtering ─────────────────────────────────────────────────────────

const HAT_CRITERIA = `
You are a real estate acquisition filter for HAT Investors (Jacksonville, FL).
We are fix-and-flip and BRRRR investors. We ONLY want distressed, unrenovated properties where we can add value.
We do NOT want retail-ready, renovated, or move-in ready homes — those have no margin for investors.

Read the full listing description carefully before making any decision.

══════════════════════════════════════════════
STEP 1 — HARD PROPERTY TYPE SKIPS (always exclude)
══════════════════════════════════════════════
• Condo, townhome, townhouse, apartment, or any HOA/gated community
• New construction or newly built
• Commercial, land-only, or multi-family (unless clearly a duplex investment play)
• Luxury, waterfront estate, golf community
• ZIP 32206, 32209, or 32254 — HARD SKIP all three, no exceptions, no matter how good the deal looks

══════════════════════════════════════════════
STEP 2 — CONDITION FILTER (read the description carefully)
══════════════════════════════════════════════
SKIP if the listing clearly describes a retail-ready or recently renovated home with NO investor distress signals.

❌ SKIP keywords (if these appear and NO investor keywords present — skip it):
fully renovated, fully remodeled, beautifully renovated, beautifully remodeled, completely renovated,
completely remodeled, move-in ready, move in ready, turnkey, updated kitchen, updated bathrooms,
new kitchen, new bathrooms, new roof, new AC, new HVAC, new flooring, new appliances,
immaculate, pristine, meticulously maintained, recently updated, recently renovated,
designer finishes, like new, luxury finishes, ready to move in, no repairs needed,
brand new, newly renovated, fresh paint and carpet, updated throughout

✅ KEEP keywords (any of these = import regardless of other signals):
investor special, fixer upper, fixer-upper, needs TLC, handyman special, needs updating,
needs renovation, needs work, needs repairs, cosmetic updates, great bones, value add,
sweat equity, as-is, as is, estate sale, probate, motivated seller, bring all offers,
cash only, cash buyer, cash offer, rehab, flip opportunity, rental opportunity,
fire damage, water damage, deferred maintenance, outdated, outdated interior,
original condition, original hardwood, old roof, panel issues, short sale, foreclosure,
REO, bank owned, bank-owned, distressed, vacant, abandoned, priced to sell, price reduced,
investor, investment property, good bones, opportunity, potential, priced below market,
needs paint, dated kitchen, dated bathrooms, structural issues

══════════════════════════════════════════════
STEP 3 — FINANCIAL SENSE CHECK (is there any possible spread?)
══════════════════════════════════════════════
The CRM captures leads for human review — do NOT over-filter here. Only skip properties where the math is clearly impossible even with negotiation.

For each property, estimate:
1. ARV — based on ZIP, beds/baths, sqft, Jacksonville market:
   - 32208, 32219: ARV $160K–$240K for 3/2
   - 32210, 32244, 32221, 32222: ARV $220K–$320K for 3/2
   - 32205, 32216, 32218: ARV $230K–$380K for 3/2
   - 32207, 32204: ARV $200K–$350K for 3/2
   - Clay County (32073, 32065, 32068): ARV $200K–$300K for 3/2

2. Estimated Reno — based on description:
   - Light cosmetic: $20K–$35K
   - Medium (kitchen/bath/flooring): $35K–$60K
   - Heavy (full gut, systems): $60K–$100K
   - Unknown: assume $50K

3. ONLY SKIP on financial grounds if BOTH of these are true:
   a) asking_price > 0.85 × estimated_ARV (less than 15% gross spread — not enough room for any investor)
   b) The ZIP is NOT a preferred ZIP (32210, 32244, 32221, 32222, 32218, 32208, 32205, 32216, 32207, 32219, Clay County)

   For PREFERRED ZIPs — NEVER skip on financial grounds. Always include if keywords pass.
   The investor will review and decide. Our job is not to reject deals in good areas.

4. Calculate MAO for reference only (goes in notes, not used to filter):
   MAO = 0.75 × estimated_ARV − estimated_reno − $30,000

Example of what NOT to skip:
  3/2 in 32210, asking $175K, ARV ~$270K → gross spread $95K → INCLUDE ✅ (preferred ZIP)

Example of what to skip:
  3/2 in unknown ZIP, asking $290K, ARV ~$300K → only $10K spread → SKIP ❌

If ARV cannot be estimated → ALWAYS include, note "ARV uncertain — verify before offer".

══════════════════════════════════════════════
STEP 4 — ZIP CODE RULES
══════════════════════════════════════════════
• ZIP 32206, 32209, 32254: HARD SKIP — never include any of these, no exceptions
• All other JAX zips, Orange Park, Middleburg, St. Augustine: include if criteria met

══════════════════════════════════════════════
STEP 5 — EXTRACT FIELDS FOR EACH QUALIFYING PROPERTY
══════════════════════════════════════════════
Return these fields:
- address: street address only (no city/state/zip)
- zip_code: 5-digit ZIP (extract carefully from the address line)
- bedrooms: number or null
- bathrooms: number or null
- sqft: number or null
- asking_price: current asking price as number
- list_price: original list price (if price dropped), else same as asking_price
- redfin_trigger_type: "price_drop" | "back_on_market" | "new_listing" | "stale_listing" | "generic_alert"
- is_hot: true if price_drop or back_on_market, false otherwise
- estimated_arv: your ARV estimate as number
- estimated_reno: your reno estimate as number
- mao: your MAO calculation (0.75 × ARV − reno − 30000)
- listing_agent_name: listing agent's full name (look in email body for agent signature, contact info, or "Listed by", "Listing agent", "Agent:" sections — null if not found)
- listing_agent_phone: listing agent's phone number as string, digits and dashes only e.g. "904-555-1234" (null if not found)
- listing_agent_email: listing agent's email address (null if not found)
- notes: start with [ARV ~$X | MAO ~$X | Reno ~$X] then 1-2 sentences on why it qualifies and investor signals found

Redfin emails often include agent contact details in the listing card or at the bottom of the email body.
Look for patterns like:
  "Listed by [Name]"
  "[Name] · [Phone]"
  "[Phone] | [Email]"
  "Contact [Name]"
  Agent name + phone near the property listing block

One email may contain multiple properties — evaluate each one separately.
Return ONLY a valid JSON array of INCLUDE leads. Empty array [] if none qualify.
`

async function filterLeadsWithClaude(emails) {
  if (emails.length === 0) return []

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const emailText = emails.map((e, i) =>
    `--- Email ${i + 1} ---\nSubject: ${e.subject}\nSnippet: ${e.snippet}\nFull Body:\n${e.body || '(no body)'}`
  ).join('\n\n')

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `${HAT_CRITERIA}\n\nAnalyze these Redfin email alerts and extract qualifying leads:\n\n${emailText}\n\nReturn ONLY a valid JSON array, no other text.`
    }]
  })

  const text = message.content[0].text.trim()
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    console.error('Claude returned invalid JSON:', text.slice(0, 500))
    return []
  }
}

// ─── Summary email ────────────────────────────────────────────────────────────

async function sendSummaryEmail(gmail, inserted, skipped, totalEmails) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Asia/Jerusalem'
  })

  const hotLeads = inserted.filter(l => l.is_hot)
  const regularLeads = inserted.filter(l => !l.is_hot)

  let body = `HAT-AI Redfin Import Summary — ${today}\n\n`
  body += `Processed ${totalEmails} Redfin emails → ${inserted.length} leads imported | ${skipped} skipped (duplicates or filtered)\n\n`

  if (hotLeads.length > 0) {
    body += `🔥 HOT LEADS (${hotLeads.length})\n`
    for (const l of hotLeads) {
      body += `• ${l.address} — $${l.asking_price?.toLocaleString()} | ${l.redfin_trigger_type}\n`
      body += `  ${l.notes}\n`
      if (l.listing_agent_name) body += `  Agent: ${l.listing_agent_name}`
      if (l.listing_agent_phone) body += ` | ${l.listing_agent_phone}`
      if (l.listing_agent_email) body += ` | ${l.listing_agent_email}`
      if (l.listing_agent_name || l.listing_agent_phone || l.listing_agent_email) body += '\n'
    }
    body += '\n'
  }

  if (regularLeads.length > 0) {
    body += `📋 ALL LEADS (${inserted.length} total)\n`
    for (const l of inserted) {
      const hot = l.is_hot ? ' 🔥' : ''
      body += `• ${l.address} — $${l.asking_price?.toLocaleString()} | ${l.zip_code}${hot}\n`
    }
    body += '\n'
  }

  if (inserted.length === 0) {
    body += 'No qualifying leads found today.\n'
  }

  body += '\nAll leads are in Triage status. Review in HatCRM Inbox tab.\n\n—\nHAT-AI | Automated Redfin Import'

  const subject = `HAT-AI Redfin Import — ${today} (${inserted.length} leads)`

  // Build RFC 2822 message
  const toLine = SUMMARY_RECIPIENTS.join(', ')
  const raw = [
    `To: ${toLine}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')

  const encoded = Buffer.from(raw).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })
  console.log(`📧 Summary email sent to ${toLine}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏠 HAT-AI Daily Redfin Import — ${new Date().toISOString()}\n`)

  const gmail = buildGmailClient()

  // 1. Fetch today's Redfin emails
  console.log('📬 Fetching Redfin emails...')
  const emails = await fetchTodayRedfinEmails(gmail)
  console.log(`   Found ${emails.length} Redfin emails after quick filter`)

  if (emails.length === 0) {
    console.log('   No emails to process.')
    await sendSummaryEmail(gmail, [], 0, 0)
    return
  }

  // 2. Claude filters and extracts qualifying leads
  console.log('🤖 Running Claude lead filter...')
  const leads = await filterLeadsWithClaude(emails)
  console.log(`   ${leads.length} qualifying leads identified`)

  // 3. Dedup + insert
  const inserted = []
  let skipped = 0

  for (const lead of leads) {
    if (!lead.address) { skipped++; continue }

    // ── ZIP: ensure we have it, look it up if missing ──────────────────────────
    if (!lead.zip_code) {
      // Try extracting from address string first (fast, no network)
      lead.zip_code = extractZipFromText(lead.address)
      if (!lead.zip_code) {
        // Fall back to US Census geocoder
        console.log(`   🔍 ZIP missing for ${lead.address} — looking up...`)
        lead.zip_code = await lookupZip(lead.address)
        if (lead.zip_code) {
          console.log(`   ✅ ZIP resolved: ${lead.zip_code}`)
        } else {
          console.log(`   ⚠️  ZIP not resolved — inserting without ZIP`)
        }
      }
    }

    // ── Hard skip blocked ZIPs (after lookup so we have the real ZIP) ──────────
    if (lead.zip_code && BLOCKED_ZIPS.has(String(lead.zip_code))) {
      console.log(`   🚫 Skip (blocked ZIP ${lead.zip_code}): ${lead.address}`)
      skipped++
      continue
    }
    // No ZIP resolved — insert anyway, Tomer will review in CRM

    const exists = await addressExists(lead.address)
    if (exists) {
      console.log(`   ⏭️  Skip (exists): ${lead.address}`)
      skipped++
      continue
    }

    try {
      // Enrich notes with financial estimates if available
      if (lead.estimated_arv && lead.mao) {
        lead.notes = `[ARV ~$${Number(lead.estimated_arv).toLocaleString()} | MAO ~$${Number(lead.mao).toLocaleString()}] ${lead.notes || ''}`
      }
      const result = await insertLead(lead)
      console.log(`   ✅ Inserted: ${lead.address} | ZIP: ${lead.zip_code || 'unknown'}`)
      inserted.push(lead)
    } catch (err) {
      console.error(`   ❌ Failed: ${lead.address} — ${err.message}`)
      skipped++
    }
  }

  console.log(`\n📊 Result: ${inserted.length} inserted | ${skipped} skipped`)

  // 4. Send summary email
  await sendSummaryEmail(gmail, inserted, skipped, emails.length)

  console.log('\n✅ Done.\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
