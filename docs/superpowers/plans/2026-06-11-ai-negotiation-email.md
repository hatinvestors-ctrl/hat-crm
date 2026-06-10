# AI Negotiation Email Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static email template in EmailComposeModal with an AI-powered negotiation assistant that writes emails as Kevin Bachman, adapts strategy to the offer/ask gap, and generates smart replies to seller responses.

**Architecture:** New Netlify function `generate-email.mjs` calls Claude with a negotiation persona prompt and all lead data. The modal gains two tabs (Initial Outreach / Reply) with Generate buttons that call the function and populate the body textarea. The Reply tab has situation preset chips plus a free-text paste area for the actual seller reply.

**Tech Stack:** React (tabs/chips in JSX), Netlify Functions (ES modules), Anthropic API (`claude-haiku-4-5-20251001`), existing `Modal/Textarea/Button` UI components.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `netlify/functions/generate-email.mjs` | **Create** | Claude API call, negotiation system prompt, strategy logic |
| `src/components/lead-detail/EmailComposeModal.jsx` | **Modify** | Two tabs, Generate buttons, situation chips, paste textarea, loading states |

---

### Task 1: Create `generate-email.mjs` Netlify function

**Files:**
- Create: `netlify/functions/generate-email.mjs`

- [ ] **Step 1: Create the file with boilerplate, HEADERS, and entry point**

```js
// AI-powered negotiation email generator.
//
// POST /.netlify/functions/generate-email
// body: { mode, lead, situation?, their_reply? }
//   mode: 'initial' | 'reply'
//   lead: { address, city, state, property_type, bedrooms, bathrooms, sqft,
//           year_built, asking_price, offer_price, arv, renovation_cost, mao,
//           rent_estimate, mls_status, listing_agent_name }
//   situation: string[]  (preset chips, reply mode only)
//   their_reply: string  (pasted seller email, reply mode only)
//
// Required env vars: ANTHROPIC_API_KEY

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { mode = 'initial', lead = {}, situation = [], their_reply = '' } = body

    if (!['initial', 'reply'].includes(mode)) {
      return new Response(JSON.stringify({ ok: false, error: 'mode must be initial or reply' }), { status: 400, headers: HEADERS })
    }

    const userPrompt = buildUserPrompt({ mode, lead, situation, their_reply })

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const emailBody  = claudeData.content?.[0]?.text?.trim() || ''

    return new Response(JSON.stringify({ ok: true, body: emailBody }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Add the SYSTEM_PROMPT constant above the handler**

```js
const SYSTEM_PROMPT = `You are Kevin Bachman, Broker/Owner of Bachman Property Brokers LLC.
You represent HAT Investors — a Jacksonville-based real estate investment company that actively buys, renovates, and holds properties across the Jacksonville metro area.

Your job is to write professional, ready-to-send negotiation emails on behalf of HAT Investors.

## Identity
- From: Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC, (904) 748-9141
- Buyer client: HAT Investors (do NOT name individual people — never mention Tomer or any internal staff)
- HAT Investors buys as-is, cash, closes in 14–21 days, no financing contingency

## Tone & Style
- Professional but warm — you're building a relationship, not just transacting
- Confident without being aggressive
- Concise — agents are busy, get to the point
- No filler phrases like "I hope this email finds you well"
- Never use placeholders like [NAME] or [AMOUNT] — use the actual data provided

## Output Format
- Output ONLY the email body text — no subject line, no metadata
- Start with the greeting (e.g. "Hi Jane,")
- End with the signature block:
  Kevin Bachman
  Broker/Owner | Bachman Property Brokers LLC
  (904) 748-9141
- Plain text only — no markdown, no bullet points in the email itself unless natural in context

## Negotiation Principles
- Anchor with data, not opinion — reference ARV and renovation scope to justify numbers
- Acknowledge the other party's position before countering
- Use social proof subtly ("we've closed multiple deals in this zip code")
- Create soft urgency without pressure ("our buy box fills quickly this time of year")
- For ghosted leads: re-engage with a new angle — never repeat the same pitch
- For proof-of-funds requests: acknowledge confidently, pivot to speed and certainty advantage
- For "not interested": plant a seed for future deals, never burn the bridge
- For high counters: validate their number, then re-anchor with deal math (ARV - reno - profit margin)
- For leaseback/stay-longer requests: show flexibility, use it as a closing lever`
```

- [ ] **Step 3: Add the `buildUserPrompt` function above the handler**

```js
function buildUserPrompt({ mode, lead, situation, their_reply }) {
  const addr = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  const fmt  = (n) => n ? `$${Number(n).toLocaleString()}` : 'not set'

  const offerPrice   = lead.offer_price   || lead.mao  || null
  const askingPrice  = lead.asking_price  || null

  // Determine gap and strategy
  let gapStrategy = ''
  if (offerPrice && askingPrice) {
    const gap = (askingPrice - offerPrice) / askingPrice
    if (gap < 0.05) {
      gapStrategy = 'NEAR-ASK: Our offer is very close to asking. Use a confident, near-full-price tone. Emphasize speed, certainty, and cash — not price. Create mild urgency.'
    } else if (gap <= 0.20) {
      gapStrategy = 'MODERATE GAP: Our offer is moderately below asking. Lead with relationship and market context. Reference renovation scope and ARV math to justify the number. Rapport-first, then the ask.'
    } else {
      gapStrategy = 'LARGE GAP: Our offer is significantly below asking. Use an as-is, cash-buyer anchor. Focus on seller motivation and certainty of close over price. Frame the offer as fair given condition and renovation risk. Do not apologize for the number.'
    }
  } else {
    gapStrategy = 'NO PRICE DATA: Write a relationship-building initial outreach. Do not mention a specific offer price.'
  }

  const leadContext = `
Property: ${addr || 'not provided'}
Type: ${lead.property_type || 'residential'} | Beds: ${lead.bedrooms || '?'} | Baths: ${lead.bathrooms || '?'} | Sqft: ${lead.sqft || '?'} | Year: ${lead.year_built || '?'}
MLS Status: ${lead.mls_status || 'unknown'}
Asking Price: ${fmt(askingPrice)}
Our Offer Price: ${fmt(offerPrice)}
ARV: ${fmt(lead.arv)}
Renovation Estimate: ${fmt(lead.renovation_cost)}
MAO: ${fmt(lead.mao)}
Rent Estimate: ${fmt(lead.rent_estimate)}
Listing Agent: ${lead.listing_agent_name || 'Agent'}
`.trim()

  if (mode === 'initial') {
    return `Write an initial outreach email to the listing agent for this property.

${leadContext}

Negotiation Strategy: ${gapStrategy}

Write the full email body now. No placeholders. Use all available data above.`
  }

  // Reply mode
  const situationText = situation.length > 0
    ? `Situation: ${situation.join(', ')}`
    : ''
  const replyText = their_reply?.trim()
    ? `Their response:\n"""\n${their_reply.trim()}\n"""`
    : ''

  return `Write a negotiation reply email for this property.

${leadContext}

Negotiation Strategy: ${gapStrategy}

${situationText}
${replyText}

Write the full reply email body now. Acknowledge their response/situation, apply the right negotiation strategy, and advance toward closing. No placeholders.`
}
```

- [ ] **Step 4: Verify the file looks correct end-to-end**

The file should have, in order: comment header, `ANTHROPIC_API_KEY` constant, `HEADERS` constant, `SYSTEM_PROMPT` constant, `buildUserPrompt` function, `handler` default export. No imports needed (uses global `fetch`).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/generate-email.mjs
git commit -m "feat: add generate-email Netlify function with negotiation AI"
```

---

### Task 2: Update EmailComposeModal — tab structure + Initial Outreach generate button

**Files:**
- Modify: `src/components/lead-detail/EmailComposeModal.jsx`

- [ ] **Step 1: Add `activeTab` and `generating` state, remove `buildDefaultBody`, initialize body as empty**

Replace the existing state block and `buildDefaultBody` function. The full updated top of the component (imports through state declarations):

```jsx
import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Textarea from '../ui/Textarea'
import Button from '../ui/Button'
import { logEmailSent } from '../../lib/activityLogger'

export default function EmailComposeModal({ open, onClose, lead, onSent, recipientEmail, recipientName }) {
  const { user, profile, workspaceId } = useOutletContext()
  const [activeTab,   setActiveTab]   = useState('initial')
  const [to,          setTo]          = useState('')
  const [cc,          setCc]          = useState('')
  const [subject,     setSubject]     = useState('')
  const [body,        setBody]        = useState('')
  const [sending,     setSending]     = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [genError,    setGenError]    = useState(null)
  const [error,       setError]       = useState(null)
  // Reply tab state
  const [situations,  setSituations]  = useState([])
  const [theirReply,  setTheirReply]  = useState('')
```

- [ ] **Step 2: Update the `useEffect` to reset tab state and use empty body**

```jsx
  useEffect(() => {
    if (!open) return
    const city = lead.city ? `, ${lead.city}` : ''
    const toEmail = recipientEmail ?? lead.listing_agent_email ?? ''
    const toName  = recipientName  ?? lead.listing_agent_name  ?? ''
    setTo(toEmail)
    setCc('')
    setSubject(`Inquiry about ${lead.address || ''}${city}`)
    setBody('')
    setActiveTab('initial')
    setSituations([])
    setTheirReply('')
    setGenError(null)
    setError(null)
    setSending(false)
    setGenerating(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Add the `handleGenerate` function after the useEffect**

```jsx
  async function handleGenerate(mode) {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          lead: {
            address:            lead.address,
            city:               lead.city,
            state:              lead.state,
            property_type:      lead.property_type,
            bedrooms:           lead.bedrooms,
            bathrooms:          lead.bathrooms,
            sqft:               lead.sqft,
            year_built:         lead.year_built,
            asking_price:       lead.asking_price,
            offer_price:        lead.offer_price,
            arv:                lead.arv,
            renovation_cost:    lead.renovation_cost,
            mao:                lead.mao,
            rent_estimate:      lead.rent_estimate,
            mls_status:         lead.mls_status,
            listing_agent_name: lead.listing_agent_name,
          },
          situation:   mode === 'reply' ? situations : [],
          their_reply: mode === 'reply' ? theirReply : '',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      setBody(data.body)
    } catch (err) {
      setGenError(err.message || 'Could not generate email.')
    } finally {
      setGenerating(false)
    }
  }
```

- [ ] **Step 4: Keep `handleSend` exactly as-is** (no changes needed)

- [ ] **Step 5: Replace the modal JSX body with tabs + generate button**

Replace the entire `return (` block:

```jsx
  const SITUATION_OPTIONS = [
    { id: 'countered_higher',       label: 'Countered higher' },
    { id: 'asked_proof_of_funds',   label: 'Asked for proof of funds' },
    { id: 'said_not_interested',    label: 'Said not interested' },
    { id: 'no_response_ghosted',    label: 'No response / ghosted' },
    { id: 'wants_faster_close',     label: 'Wants faster close' },
    { id: 'wants_leaseback',        label: 'Wants leaseback / stay longer' },
  ]

  const toggleSituation = (id) =>
    setSituations(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])

  return (
    <Modal
      open={open}
      onClose={sending ? undefined : onClose}
      title="Compose Email"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button variant="primary" onClick={handleSend} loading={sending} disabled={!to.trim() || sending}>
            Open in Gmail ↗
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] text-[11.5px] leading-relaxed">
          Opens Gmail compose in a new tab pre-filled with these fields. Sends from the Gmail account you're currently signed in to (<span className="font-medium text-[color:var(--color-text)]">hatinvestors.automation@gmail.com</span> if you're signed in there). Review in Gmail and click Send — no SMTP setup required.
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12.5px]">
            {error}
          </div>
        )}

        <Input label="To" required value={to} onChange={e => setTo(e.target.value)} placeholder="agent@brokerage.com" type="email" />
        <Input label="CC" value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" type="email" />
        <Input label="Subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" />

        {/* Tabs */}
        <div className="border-b border-[color:var(--color-line)] flex gap-0">
          {[
            { id: 'initial', label: 'Initial Outreach' },
            { id: 'reply',   label: 'Reply / Follow-up' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                  : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Reply tab inputs */}
        {activeTab === 'reply' && (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">Situation</div>
              <div className="flex flex-wrap gap-1.5">
                {SITUATION_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleSituation(opt.id)}
                    className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                      situations.includes(opt.id)
                        ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
                        : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              label="Paste their reply (optional)"
              value={theirReply}
              onChange={e => setTheirReply(e.target.value)}
              rows={4}
              placeholder="Paste the email they sent back…"
            />
          </div>
        )}

        {/* Generate button */}
        {genError && (
          <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
            {genError}
          </div>
        )}
        <button
          type="button"
          onClick={() => handleGenerate(activeTab)}
          disabled={generating}
          className="w-full h-9 flex items-center justify-center gap-2 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)] text-[12.5px] font-semibold hover:bg-[color:var(--color-accent)] hover:text-white disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : activeTab === 'initial' ? '✦ Generate Email' : '✦ Generate Reply'}
        </button>

        <Textarea
          label="Body"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
        />
      </div>
    </Modal>
  )
}
```

- [ ] **Step 6: Verify no stray references to `buildDefaultBody` or `senderName` remain in the file**

```bash
grep -n "buildDefaultBody\|senderName" src/components/lead-detail/EmailComposeModal.jsx
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/lead-detail/EmailComposeModal.jsx
git commit -m "feat: AI negotiation email modal with tabs, generate buttons, situation chips"
```

---

### Task 3: Smoke test and deploy

- [ ] **Step 1: Run the dev server and open a lead that has offer_price, asking_price, arv, renovation_cost set**

```bash
npm run dev
```

Navigate to any lead detail page that has financial data filled in.

- [ ] **Step 2: Open the email modal and test Initial Outreach**

Click the email compose button → verify modal opens with empty body and "Initial Outreach" tab active → click "✦ Generate Email" → verify spinner appears → verify body populates with a complete email signed by Kevin Bachman with no placeholders.

- [ ] **Step 3: Test the Reply tab**

Switch to "Reply / Follow-up" tab → click "Countered higher" chip → verify it toggles highlighted → paste a sample reply → click "✦ Generate Reply" → verify body populates with a counter-negotiation email.

- [ ] **Step 4: Test with missing financial data**

Open a lead with no offer_price or asking_price set → generate initial email → verify it writes a relationship-building email without mentioning specific numbers.

- [ ] **Step 5: Commit and push to deploy**

```bash
git add -A
git commit -m "chore: verify AI email generation working"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Email written as Kevin Bachman with full signature
- ✅ No mention of Tomer or internal users
- ✅ All lead fields passed (offer price, ARV, reno, MAO, asking price, etc.)
- ✅ Gap strategy: near-ask / moderate / large gap logic in `buildUserPrompt`
- ✅ No placeholders — system prompt explicitly forbids them
- ✅ Initial Outreach tab with Generate button
- ✅ Reply tab with situation chips + paste textarea
- ✅ Both modes call same endpoint with `mode` param
- ✅ Body textarea editable after generation
- ✅ Existing To/CC/Subject/Gmail flow unchanged

**Placeholder scan:** No TBD, no TODO, all code blocks complete.

**Type consistency:** `handleGenerate(mode)` called with `activeTab` ('initial'|'reply') — matches function signature. `situations` is `string[]` of chip IDs — matches what `buildUserPrompt` joins. All consistent.
