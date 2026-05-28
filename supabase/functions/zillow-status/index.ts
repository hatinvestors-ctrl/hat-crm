// Edge Function: zillow-status
// Fetches a Zillow listing page server-side and extracts the public listing status.
// Stores it on the lead and returns it to the caller.
// Honest disclaimer: Zillow actively blocks scrapers. Works for occasional checks
// of a few addresses; expect failures at scale. Plug in a residential proxy or
// scraping API (ScrapingBee, ScrapingAnt, Bright Data) if you hit blocks.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
}

function normalize(raw: string): string {
  const u = raw.toUpperCase()
  if (u.includes('PENDING')) return 'pending'
  if (u.includes('CONTINGENT')) return 'contingent'
  if (u.includes('FORECLOSURE') || u.includes('AUCTION')) return 'auction'
  if (u.includes('NEW_CONSTRUCTION')) return 'for_sale'
  if (u.includes('FOR_SALE') || u === 'ACTIVE' || u === 'FOR SALE') return 'for_sale'
  if (u.includes('SOLD') || u.includes('RECENTLY_SOLD')) return 'sold'
  if (u.includes('OFF_MARKET') || u.includes('OFFMARKET') || u === 'OTHER') return 'off_market'
  if (u.includes('PRE_FORECLOSURE')) return 'pre_foreclosure'
  return raw.toLowerCase().replace(/[^a-z_]/g, '_')
}

function parseStatus(html: string): { status: string; raw: string } | null {
  // Try structured JSON signals first (most reliable)
  const jsonPatterns = [
    /"homeStatus"\s*:\s*"([A-Z_]+)"/,
    /"listingStatus"\s*:\s*"([A-Z_]+)"/,
    /\\"homeStatus\\"\s*:\s*\\"([A-Z_]+)\\"/,
  ]
  for (const p of jsonPatterns) {
    const m = html.match(p)
    if (m) return { status: normalize(m[1]), raw: m[1] }
  }

  // Fallback: visible text on the page
  if (/FOR\s*SALE.*?PENDING/is.test(html)) return { status: 'pending', raw: 'PENDING' }
  if (/FOR\s*SALE.*?CONTINGENT/is.test(html)) return { status: 'contingent', raw: 'CONTINGENT' }
  if (/Status:\s*<[^>]*>\s*FOR SALE/i.test(html)) return { status: 'for_sale', raw: 'FOR SALE' }
  if (/\bSOLD\b.*?(?:on|in)/i.test(html)) return { status: 'sold', raw: 'SOLD' }
  if (/Off market/i.test(html)) return { status: 'off_market', raw: 'OFF MARKET' }
  if (/Pre-foreclosure/i.test(html)) return { status: 'pre_foreclosure', raw: 'PRE_FORECLOSURE' }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing Authorization header', 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return jsonError('Invalid token', 401)

    const body = await req.json()
    const ids: string[] = body.lead_ids || (body.lead_id ? [body.lead_id] : [])
    if (!ids.length) return jsonError('lead_id or lead_ids required', 400)

    // RLS-aware fetch: user only sees leads in their workspace
    const { data: leads, error: leadsErr } = await userClient
      .from('leads')
      .select('id, address, zillow_url')
      .in('id', ids)
    if (leadsErr) return jsonError(leadsErr.message, 400)

    const admin = createClient(supabaseUrl, serviceKey)
    const results: Array<{ id: string; status?: string; raw?: string; error?: string }> = []

    for (const lead of leads || []) {
      if (!lead.zillow_url) {
        results.push({ id: lead.id, error: 'No Zillow URL' })
        continue
      }
      try {
        const r = await fetch(lead.zillow_url, { headers: BROWSER_HEADERS, redirect: 'follow' })
        if (!r.ok) {
          // Many failures = blocked / captcha
          results.push({ id: lead.id, error: `Zillow returned HTTP ${r.status}` })
          continue
        }
        const html = await r.text()
        const parsed = parseStatus(html)
        if (!parsed) {
          results.push({ id: lead.id, error: 'Could not detect status on page' })
          continue
        }
        await admin.from('leads')
          .update({ mls_status: parsed.status, mls_last_checked: new Date().toISOString() })
          .eq('id', lead.id)
        results.push({ id: lead.id, status: parsed.status, raw: parsed.raw })
      } catch (e) {
        results.push({ id: lead.id, error: (e as Error).message })
      }
      // Be polite: small pause between requests to avoid rate-limit
      await new Promise(r => setTimeout(r, 400))
    }

    return jsonOk({ results })
  } catch (e) {
    return jsonError((e as Error).message || 'Server error', 500)
  }
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
