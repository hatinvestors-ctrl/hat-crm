/**
 * HAT-AI Daily Redfin Import
 * Reads today's Redfin emails → Claude filters leads → inserts into HatCRM → sends summary email
 * Runs via Windows Task Scheduler daily at 10am Israel time.
 */

import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import 'dotenv/config'

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_PAT = process.env.SUPABASE_PAT || 'sbp_05434f76c664e2ed394f7e128cd22eb78058bcc1'
const SUPABASE_PROJECT_REF = 'pyrgotfotmwazigewlke'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const SUMMARY_RECIPIENTS = ['tom@hatinvestors.com', 'hemi@hatinvestors.com']

// ─── Supabase ─────────────────────────────────────────────────────────────────

async function supabaseQuery(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Supabase error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch { return [] }
}

function sqlStr(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function sqlNum(v) {
  if (v == null) return 'NULL'
  const n = Number(v)
  return isNaN(n) ? 'NULL' : String(n)
}

async function addressExists(address) {
  const rows = await supabaseQuery(`
    SELECT id FROM public.leads
    WHERE workspace_id = ${sqlStr(WORKSPACE_ID)} AND address = ${sqlStr(address)}
    LIMIT 1
  `)
  return rows.length > 0
}

async function insertLead(lead) {
  const now = new Date().toISOString()
  return supabaseQuery(`
    INSERT INTO public.leads
      (workspace_id, address, city, state, zip_code, property_type,
       bedrooms, bathrooms, sqft, asking_price, list_price,
       lead_source, redfin_trigger_type, status, auto_imported,
       mls_status, is_hot, notes, created_at, updated_at)
    VALUES (
      ${sqlStr(WORKSPACE_ID)}, ${sqlStr(lead.address)}, 'Jacksonville', 'FL', ${sqlStr(lead.zip_code)},
      'single_family', ${sqlNum(lead.bedrooms)}, ${sqlNum(lead.bathrooms)}, ${sqlNum(lead.sqft)},
      ${sqlNum(lead.asking_price)}, ${sqlNum(lead.list_price)},
      'redfin_auto', ${sqlStr(lead.redfin_trigger_type)}, 'triage', true, 'active',
      ${lead.is_hot ? 'true' : 'false'}, ${sqlStr(lead.notes)}, ${sqlStr(now)}, ${sqlStr(now)}
    )
    RETURNING id, address
  `)
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

async function fetchTodayRedfinEmails(gmail) {
  // Search for Redfin emails from the past 24 hours
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
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    })
    const headers = full.data.payload.headers
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const snippet = full.data.snippet || ''

    // Quick skip: clearly out of range or not SFR
    const subjectLower = subject.toLowerCase()
    if (
      subjectLower.includes('luxury') ||
      subjectLower.includes('commercial') ||
      subjectLower.includes('condo') ||
      subjectLower.includes('townhome') ||
      subjectLower.includes('townhouse')
    ) continue

    emails.push({ id: msg.id, subject, snippet })
  }

  return emails
}

// ─── Claude filtering ─────────────────────────────────────────────────────────

const HAT_CRITERIA = `
HAT Investors buy criteria (Jacksonville, FL):
- Single-family residential only (no condos, HOA communities, townhomes, new construction)
- Price range: up to $350,000 (can go to $350K for price_drop or back_on_market)
- Must be in Jacksonville area (32xxx zip codes, or Orange Park, Middleburg, Keystone Heights)
- Skip luxury/waterfront/golf/gated communities
- Prefer distressed, fixer-upper, cash buyer listings
- Trigger types: price_drop (most important), back_on_market, new_listing, stale_listing, generic_alert
- is_hot=true for price_drop or back_on_market

For each qualifying property extract:
- address (street address only, no city/state)
- zip_code (5 digits)
- bedrooms (number or null)
- bathrooms (number or null)
- sqft (number or null)
- asking_price (number, current price)
- list_price (number, original list price — same as asking_price if no drop)
- redfin_trigger_type: price_drop | back_on_market | new_listing | stale_listing | generic_alert
- is_hot: true/false
- notes: 1-2 sentence summary including price history if available

Return a JSON array of qualifying leads. Empty array if none qualify.
`

async function filterLeadsWithClaude(emails) {
  if (emails.length === 0) return []

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const emailText = emails.map((e, i) =>
    `--- Email ${i + 1} ---\nSubject: ${e.subject}\nSnippet: ${e.snippet}`
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

    const exists = await addressExists(lead.address)
    if (exists) {
      console.log(`   ⏭️  Skip (exists): ${lead.address}`)
      skipped++
      continue
    }

    try {
      const result = await insertLead(lead)
      console.log(`   ✅ Inserted: ${lead.address}`)
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
