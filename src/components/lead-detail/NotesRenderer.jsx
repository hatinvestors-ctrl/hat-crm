import { createContext, useContext, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const MissingFieldsContext = createContext([])
const NotesContext = createContext('')
const LeadContext = createContext(null)

// ─── Shared score computation (used by DealScoreSection + RecommendedActionSection) ─

const SUB_SCORE_KEYS = ['Deal Return', 'Price Gap', 'Seller Signals', 'Market & Exit', 'Cash Flow', 'Data Quality']

function computeScoreFromText(text) {
  if (!text) return null
  const lines = text.split('\n')
  const get = key => {
    const line = lines.find(l => new RegExp(`^[-•*\\s]*${key}:`, 'i').test(l.trim()))
    return line?.replace(new RegExp(`^[-•*\\s]*${key}:\\s*`, 'i'), '').trim()
  }
  const vals = SUB_SCORE_KEYS.map(k => {
    const raw = get(k)
    const m = raw?.match(/^(\d+)\/\d+/)
    return m ? parseInt(m[1]) : null
  })
  if (vals.every(v => v != null)) return vals.reduce((s, v) => s + v, 0)
  return null
}

function scoreToVerdict(score) {
  if (score == null) return null
  if (score >= 65) return 'MAKE OFFER'
  if (score >= 45) return 'NEGOTIATE'
  if (score >= 30) return 'LONG SHOT'
  if (score >= 15) return 'WATCH'
  return 'DEAD LEAD'
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseNotes(text) {
  if (!text?.trim()) return null
  // Strip any preamble before the first ===== so AI intro text never misaligns pairing
  const firstSep = text.search(/={5,}/)
  const clean = firstSep > 0 ? text.slice(firstSep) : text
  const chunks = clean.split(/={5,}/).map(c => c.trim()).filter(Boolean)
  const sections = []
  for (let i = 0; i + 1 < chunks.length; i += 2) {
    const name = chunks[i].trim()
    const body = (chunks[i + 1] || '').trim()
    if (name && body) sections.push({ name, body })
  }
  return sections.length >= 2 ? sections : null
}

function extractScore(body) {
  const m = body.match(/(\d+)\/100/)
  return m ? parseInt(m[1]) : null
}

function extractConfidence(body) {
  const m = body.match(/Deal Confidence:\s*(HIGH|MEDIUM|LOW)\s*[-–]\s*(\d+)%/i)
  return m ? { level: m[1].toUpperCase(), pct: parseInt(m[2]) } : null
}

function extractARV(body) {
  const m = body.match(/Conservative\s+\$([0-9,KM]+)\s*\|\s*Base\s+\$([0-9,KM]+)\s*\|\s*Aggressive\s+\$([0-9,KM]+)/i)
  if (!m) return null
  const p = s => { const n = parseInt(s.replace(/,/g, '')); return s.toUpperCase().includes('K') ? n * 1000 : n }
  return { conservative: p(m[1]), base: p(m[2]), aggressive: p(m[3]) }
}

function parseScenarios(body) {
  const parts = body.split(/^SCENARIO\s+[A-Z](?:-ALT)?:\s*/im)
  return parts.slice(1).slice(0, 3).map(chunk => {
    const lines = chunk.split('\n').filter(Boolean)
    const title = lines[0]?.trim() || ''
    const verdictLine = lines.find(l => /^Verdict:/i.test(l.trim()))
    const verdict = verdictLine?.replace(/^Verdict:\s*/i, '').trim() || ''
    let metric = null
    const titleU = title.toUpperCase()
    if (titleU.includes('BRRRR')) {
      const m = chunk.match(/Cash left in:\s*(?:approx|~)?\s*\$([0-9,]+)/i)
      if (m) metric = { label: 'Cash left in', value: '$' + m[1] }
    } else if (titleU.includes('FLIP')) {
      const m = chunk.match(/Net (?:flip )?profit:\s*(?:approx|~)?\s*(-?\$[0-9,]+|-[0-9,]+)/i)
      if (m) metric = { label: 'Net profit', value: m[1] }
    } else if (titleU.includes('RENTAL')) {
      const m = chunk.match(/Cap rate.*?:\s*~?([0-9.]+)%/i)
      if (m) metric = { label: 'Cap rate', value: m[1] + '%' }
    }
    return { title, verdict, metric }
  })
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function scoreColor(n) {
  return n >= 70 ? '#22c55e' : n >= 45 ? '#f59e0b' : '#ef4444'
}

function verdictStyle(text = '') {
  const t = text.toUpperCase()
  if (t.includes('STRONG') || t.includes('EXCELLENT'))
    return { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)', label: 'STRONG' }
  if (t.includes('ACCEPTABLE'))
    return { bg: 'var(--color-accent-soft)', txt: 'var(--color-accent-text)', bdr: 'var(--color-accent)', label: 'ACCEPTABLE' }
  if (t.includes('WEAK'))
    return { bg: 'var(--color-warn-soft)', txt: 'var(--color-warn-text)', bdr: 'var(--color-warn)', label: 'WEAK' }
  if (t.includes('FAIL') || t.includes('UNDER') || t.includes('PASS'))
    return { bg: 'var(--color-danger-soft)', txt: 'var(--color-danger-text)', bdr: 'var(--color-danger)', label: 'FAILS' }
  return { bg: 'var(--color-bg-elev-2)', txt: 'var(--color-text-muted)', bdr: 'var(--color-line)', label: '—' }
}

// ─── Section renderers ────────────────────────────────────────────────────────

function PlainText({ body }) {
  return <p className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-wrap">{body}</p>
}

function DealScoreSection({ body }) {
  const missingFields = useContext(MissingFieldsContext)
  const lines = body.split('\n').filter(Boolean)
  // Strip leading bullets/dashes/spaces before matching field names
  const get = prefix => {
    const line = lines.find(l => new RegExp(`^[-•*\\s]*${prefix}:`, 'i').test(l.trim()))
    return line?.replace(new RegExp(`^[-•*\\s]*${prefix}:\\s*`, 'i'), '').trim()
  }

  const subScores = [
    { key: 'Deal Return',    max: 30 },
    { key: 'Price Gap',      max: 20 },
    { key: 'Seller Signals', max: 15 },
    { key: 'Market & Exit',  max: 15 },
    { key: 'Cash Flow',      max: 10 },
    { key: 'Data Quality',   max: 10 },
  ].map(({ key, max }) => {
    const raw = get(key)
    if (!raw) return null
    const scoreMatch = raw.match(/^(\d+)\/\d+/)
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null
    const detail = raw.replace(/^\d+\/\d+\s*[—\-–]\s*/, '').trim()
    return { key, max, score, detail }
  }).filter(Boolean)

  // Compute total from sub-scores (don't trust AI's stated total — it inflates)
  const computedTotal = subScores.length > 0 && subScores.every(s => s.score != null)
    ? subScores.reduce((sum, s) => sum + s.score, 0)
    : null
  const total = computedTotal

  const scoreColor = (n, max) => {
    const pct = n / max
    return pct >= 0.75 ? 'var(--color-success)' : pct >= 0.5 ? 'var(--color-warn)' : 'var(--color-danger)'
  }

  // What each factor means in plain English (shown as tooltip/sublabel)
  const factorMeta = {
    'Deal Return':    { icon: '💰', hint: 'How much money we make — profit on a flip or cash left in on a BRRRR' },
    'Price Gap':      { icon: '↕️', hint: 'How far the asking price is from our offer — smaller gap = easier to close' },
    'Seller Signals': { icon: '🤝', hint: 'Signs the seller is motivated to move quickly (estate, price drop, as-is listing, etc.)' },
    'Market & Exit':  { icon: '📍', hint: 'How strong the ZIP code is and how confident we are in the ARV comps' },
    'Cash Flow':      { icon: '🏦', hint: 'Monthly income after all expenses if we hold/rent — only matters for BRRRR' },
    'Data Quality':   { icon: '📋', hint: 'How complete our info is — ARV, reno cost, rent estimate. Low score = re-run after getting better numbers' },
  }

  const [showBreakdown, setShowBreakdown] = useState(false)

  return (
    <div className="space-y-3">
      {/* Missing data warning */}
      {missingFields.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[11px] shrink-0 mt-px">⚠</span>
          <p className="text-[11px] text-[color:var(--color-warn-text)] leading-snug">
            <strong>Score based on incomplete data.</strong> Missing: {missingFields.join(', ')}. Fill these fields and regenerate for a reliable score.
          </p>
        </div>
      )}

      {/* Sub-scores */}
      {subScores.length === 0 && total == null && <PlainText body={body} />}
      {subScores.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowBreakdown(s => !s)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] hover:opacity-80 transition-opacity"
          >
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-semibold">Score breakdown</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="w-3.5 h-3.5 text-[color:var(--color-text-dim)] transition-transform duration-200"
              style={{ transform: showBreakdown ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showBreakdown && subScores.map(({ key, max, score, detail }) => {
            const meta = factorMeta[key] || { icon: '•', hint: '' }
            const pct  = score != null ? score / max : 0
            const clr  = pct >= 0.75 ? 'var(--color-success)' : pct >= 0.5 ? 'var(--color-warn)' : 'var(--color-danger)'
            const tag  = pct >= 0.75 ? 'Strong' : pct >= 0.5 ? 'OK' : 'Weak'
            const tagBg  = pct >= 0.75 ? 'var(--color-success-soft)' : pct >= 0.5 ? 'var(--color-warn-soft)' : 'var(--color-danger-soft)'
            const tagTxt = pct >= 0.75 ? 'var(--color-success-text)' : pct >= 0.5 ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
            return (
              <div key={key} className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
                {/* Header row */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px]">{meta.icon}</span>
                  <span className="text-[12px] font-semibold text-[color:var(--color-text)] flex-1">{key}</span>
                  <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: tagBg, color: tagTxt }}>{tag}</span>
                  <span className="text-[11px] font-black" style={{ color: clr }}>{score ?? '?'}<span className="text-[9px] font-normal opacity-60">/{max}</span></span>
                </div>
                {/* Bar */}
                <div className="h-1.5 rounded-full bg-[color:var(--color-line)] overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct * 100}%`, backgroundColor: clr }} />
                </div>
                {/* What this factor means */}
                <p className="text-[10px] text-[color:var(--color-text-dim)] leading-snug mb-1 italic">{meta.hint}</p>
                {/* AI detail */}
                {detail && <p className="text-[11px] text-[color:var(--color-text-muted)] leading-snug border-t border-[color:var(--color-line)] pt-1.5 mt-1">{detail}</p>}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

function SnapshotSection({ body }) {
  const fields = body.split('\n').filter(Boolean).reduce((acc, line) => {
    const ci = line.indexOf(':')
    if (ci > 0 && ci < 22) acc.push({ key: line.slice(0, ci).trim(), val: line.slice(ci + 1).trim() })
    return acc
  }, [])
  if (fields.length < 2) return <PlainText body={body} />
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {fields.map(({ key, val }, i) => (
        <div key={i} className={key.toLowerCase() === 'address' ? 'col-span-2' : ''}>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">{key}</div>
          <div className="text-[12.5px] font-medium text-[color:var(--color-text)] leading-snug">{val || '—'}</div>
        </div>
      ))}
    </div>
  )
}

function ARVSection({ body }) {
  const arv = extractARV(body)
  return (
    <div className="space-y-3">
      {arv && (
        <div className="p-3 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-line)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-3">ARV Range</div>
          <div className="relative h-1.5 rounded-full bg-[color:var(--color-line)] mb-4 mx-2">
            <div className="absolute inset-y-0 rounded-full bg-[color:var(--color-accent)] opacity-25"
              style={{ left: '0%', right: '0%' }} />
            {[0, 50, 100].map((pct, i) => (
              <div key={i} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pct}%` }}>
                <div className="w-2.5 h-2.5 rounded-full bg-[color:var(--color-accent)] border-2 border-[color:var(--color-bg)]" />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-center">
            {[
              { label: 'Conservative', value: arv.conservative },
              { label: 'Base', value: arv.base },
              { label: 'Aggressive', value: arv.aggressive },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-[13px] font-bold text-[color:var(--color-text)]">${(value / 1000).toFixed(0)}K</div>
                <div className="text-[9.5px] text-[color:var(--color-text-dim)]">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <PlainText body={body} />
    </div>
  )
}

function ScoreSection({ body }) {
  const score = extractScore(body)
  const conf = extractConfidence(body)
  const driverLines = body.split('\n').filter(l => /^\s*[+\-]\d+ pts/.test(l))
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {score != null && (
          <div className="relative shrink-0 w-16 h-16">
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-line)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={scoreColor(score)} strokeWidth="3"
                strokeDasharray={`${score} ${100 - score}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[15px] font-bold leading-none" style={{ color: scoreColor(score) }}>{score}</span>
              <span className="text-[9px] text-[color:var(--color-text-dim)]">/100</span>
            </span>
          </div>
        )}
        {conf && (
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-[11px] text-[color:var(--color-text-muted)]">Deal Confidence</span>
              <span className="text-[11px] font-bold" style={{
                color: conf.level === 'HIGH' ? 'var(--color-success-text)' : conf.level === 'MEDIUM' ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
              }}>{conf.level} · {conf.pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[color:var(--color-line)] overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${conf.pct}%`,
                backgroundColor: conf.level === 'HIGH' ? 'var(--color-success)' : conf.level === 'MEDIUM' ? 'var(--color-warn)' : 'var(--color-danger)',
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>
        )}
      </div>
      {driverLines.length > 0 && (
        <div className="space-y-1">
          {driverLines.map((l, i) => {
            const pos = l.trim().startsWith('+')
            const pts = l.match(/[+\-]\d+ pts/)?.[0]
            const label = l.replace(/^\s*[+\-]\d+ pts\s*/i, '').trim()
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10.5px] font-bold w-14 shrink-0 text-right"
                  style={{ color: pos ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>
                  {pts}
                </span>
                <span className="text-[11.5px] text-[color:var(--color-text-muted)]">{label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DealMathSection({ body }) {
  const scenarios = parseScenarios(body)
  const maoLine    = body.split('\n').find(l => /^MAO:/i.test(l.trim()))
  const spreadLine = body.split('\n').find(l => /^Gross spread/i.test(l.trim()))
  return (
    <div className="space-y-3">
      {(maoLine || spreadLine) && (
        <div className="grid grid-cols-2 gap-2">
          {[maoLine, spreadLine].filter(Boolean).map((line, i) => {
            const ci  = line.indexOf(':')
            const key = line.slice(0, ci).trim()
            const val = line.slice(ci + 1).trim()
            return (
              <div key={i} className="p-2.5 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-line)] text-center">
                <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">{key}</div>
                <div className="text-[13px] font-bold text-[color:var(--color-text)]">{val.split('(')[0].trim()}</div>
              </div>
            )
          })}
        </div>
      )}
      {scenarios.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {scenarios.map((s, i) => {
            const vs = verdictStyle(s.verdict)
            return (
              <div key={i} className="rounded-lg border p-2.5 flex flex-col gap-1.5"
                style={{ background: vs.bg, borderColor: vs.bdr }}>
                <div className="text-[9.5px] uppercase tracking-wider font-bold" style={{ color: vs.txt }}>
                  {s.title.split(' ').slice(0, 3).join(' ')}
                </div>
                <div className="text-[12px] font-bold" style={{ color: vs.txt }}>{vs.label}</div>
                {s.metric && (
                  <div className="text-[10.5px]" style={{ color: vs.txt }}>
                    <span className="opacity-70">{s.metric.label}:</span>{' '}
                    <span className="font-semibold">{s.metric.value}</span>
                  </div>
                )}
                {s.verdict && (
                  <p className="text-[10px] leading-relaxed opacity-75 mt-auto" style={{ color: vs.txt }}>
                    {s.verdict.replace(/^[A-Z\s]+[-–]\s*/, '').slice(0, 70)}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BulletSection({ body, variant = 'success' }) {
  const items = body.split('\n').filter(l => /^\s*(\d+\.|•)/.test(l))
  if (items.length === 0) return <PlainText body={body} />
  const isPos = variant === 'success'
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const text = item.replace(/^\s*(\d+\.\s*|•\s*)/, '')
        const dashIdx = text.search(/\s[—-]\s/)
        const label  = dashIdx > 0 ? text.slice(0, dashIdx) : null
        const detail = dashIdx > 0 ? text.slice(dashIdx + 3) : text
        return (
          <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg"
            style={{ background: isPos ? 'var(--color-success-soft)' : 'var(--color-danger-soft)' }}>
            <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black mt-0.5"
              style={{ background: isPos ? 'var(--color-success)' : 'var(--color-danger)', color: '#fff' }}>
              {isPos ? '✓' : '!'}
            </span>
            <p className="text-[12px] leading-relaxed flex-1"
              style={{ color: isPos ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>
              {label && <span className="font-bold">{label} — </span>}
              {detail}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function InsightsSection({ body }) {
  const blocks = body.split(/\n(?=•)/).filter(Boolean)
  if (blocks.length === 0) return <PlainText body={body} />
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines   = block.split('\n').filter(Boolean)
        const heading = lines[0].replace(/^•\s*/, '')
        const dashIdx = heading.search(/\s[—-]\s/)
        const label   = dashIdx > 0 ? heading.slice(0, dashIdx) : heading
        const summary = dashIdx > 0 ? heading.slice(dashIdx + 3) : ''
        const bodyLines = lines.slice(1)
        return (
          <div key={i} className="rounded-lg border border-[color:var(--color-warn)] overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[color:var(--color-warn-soft)]">
              <span className="text-[12px]">💡</span>
              <span className="text-[11px] font-bold text-[color:var(--color-warn-text)]">{label}</span>
            </div>
            {(summary || bodyLines.length > 0) && (
              <div className="px-2.5 py-2 bg-[color:var(--color-bg)]">
                {summary && <p className="text-[12px] text-[color:var(--color-text)] leading-relaxed">{summary}</p>}
                {bodyLines.map((l, j) => (
                  <p key={j} className="text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed mt-0.5">{l.trim()}</p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StrategySection({ body }) {
  const lines    = body.split('\n').filter(Boolean)
  const exitLine = lines.find(l => /^Best exit:/i.test(l))
  const whyLine  = lines.find(l => /^Why:/i.test(l))
  const rest     = lines.filter(l => l !== exitLine && l !== whyLine)
  const exit     = exitLine?.replace(/^Best exit:\s*/i, '').trim() || ''
  const why      = whyLine?.replace(/^Why:\s*/i, '').trim() || ''
  const isGo     = /BRRRR|FLIP|RENTAL/i.test(exit) && !/PASS/i.test(exit)
  const isPass   = /PASS/i.test(exit)
  const color    = isGo
    ? { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)' }
    : isPass
    ? { bg: 'var(--color-danger-soft)', txt: 'var(--color-danger-text)', bdr: 'var(--color-danger)' }
    : { bg: 'var(--color-warn-soft)', txt: 'var(--color-warn-text)', bdr: 'var(--color-warn)' }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border p-3 flex items-start gap-3"
        style={{ background: color.bg, borderColor: color.bdr }}>
        <span className="text-[20px] shrink-0">{isGo ? '✅' : isPass ? '⛔' : '⚠️'}</span>
        <div>
          {exit && <div className="text-[13px] font-bold mb-1" style={{ color: color.txt }}>{exit}</div>}
          {why  && <p className="text-[12px] leading-relaxed" style={{ color: color.txt }}>{why}</p>}
        </div>
      </div>
      {rest.map((l, i) => (
        <p key={i} className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed">{l}</p>
      ))}
    </div>
  )
}

function RecommendedActionSectionV1({ body }) {
  const fullNotes = useContext(NotesContext)
  const lead      = useContext(LeadContext)
  const [logged, setLogged] = useState({})

  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  // Authoritative verdict from computed sub-scores
  const computedScore = computeScoreFromText(fullNotes)
  const verdict    = scoreToVerdict(computedScore) || get('Verdict')
  const atAsk      = get('At Ask')
  const atMao      = get('At MAO')
  const gap        = get('Gap') || get('Gap to Close')
  const strategy   = get('Strategy')
  const arv        = get('Our ARV')
  const ourMao     = get('Our MAO')
  const starting   = get('Starting Offer')
  const target     = get('Target Price')
  const maxWalk    = get('Max Walk-Away')
  const howToGet   = get('How to Get There')
  const summary    = get('Summary')

  const maxRenoBRRRR   = get('Max Reno (BRRRR)')
  const maxRenoFlip    = get('Max Reno (Flip)')
  const inspectionPlay = get('Inspection Play')
  const bedroomAdd     = get('Bedroom Add')
  const bathAdd        = get('Bath Add')
  const otherUp        = get('Other Upside')

  const isBuyNow    = /^BUY NOW/i.test(verdict || '')
  const isMakeOffer = /^MAKE OFFER/i.test(verdict || '')
  const isOffer     = /^OFFER/i.test(verdict || '')
  const isNegotiate = /^NEGOTIATE/i.test(verdict || '')
  const isLongShot  = /^LONG SHOT/i.test(verdict || '')
  const isWatch     = /^WATCH/i.test(verdict || '')
  const isDead      = /^DEAD/i.test(verdict || '')
  const isGo        = isBuyNow || isMakeOffer || isOffer || isNegotiate

  // Derive seller odds from Seller Signals sub-score
  const sellerSignalsScore = (() => {
    if (!fullNotes) return null
    const line = fullNotes.split('\n').find(l => /^[-•*\s]*Seller Signals:/i.test(l.trim()))
    const raw  = line?.replace(/^[-•*\s]*Seller Signals:\s*/i, '').trim()
    const m    = raw?.match(/^(\d+)\/15/)
    return m ? parseInt(m[1]) : null
  })()
  const sellerOdds = sellerSignalsScore == null ? null
    : sellerSignalsScore >= 10 ? { label: 'HIGH',   color: 'var(--color-success-text)', bg: 'var(--color-success-soft)', bdr: 'var(--color-success)',  dot: '🟢', tip: 'Strong motivation signals — seller likely to negotiate.' }
    : sellerSignalsScore >= 6  ? { label: 'MEDIUM', color: 'var(--color-warn-text)',    bg: 'var(--color-warn-soft)',    bdr: 'var(--color-warn)',     dot: '🟡', tip: 'Some signals present. Follow up consistently.' }
    :                            { label: 'LOW',    color: 'var(--color-danger-text)',  bg: 'var(--color-danger-soft)', bdr: 'var(--color-danger)',   dot: '🔴', tip: 'No urgency signals yet. Seller may not be ready to move.' }

  // Deal math signal — prefer "At Ask" when ask already works below MAO
  const askWorks = /^WORKS/i.test(atAsk || '')
  const maoWorks = /^WORKS/i.test(atMao || '')
  const dealMath = (() => {
    // If ask price works, that's the relevant signal — show it (not the MAO scenario)
    if (askWorks)
      return { label: 'WORKS AT ASK PRICE', color: 'var(--color-success-text)', bg: 'var(--color-success-soft)', bdr: 'var(--color-success)', dot: '✅', note: 'Ask is already below MAO — deal works at current price.' }
    if (maoWorks)
      return { label: 'WORKS AT MAO', color: 'var(--color-success-text)', bg: 'var(--color-success-soft)', bdr: 'var(--color-success)', dot: '✅', note: null }
    if (/^MARGINAL/i.test(atMao || ''))
      return { label: 'MARGINAL AT MAO', color: 'var(--color-warn-text)', bg: 'var(--color-warn-soft)', bdr: 'var(--color-warn)', dot: '⚠️', note: null }
    if (atMao || atAsk)
      return { label: 'FAILS AT MAO', color: 'var(--color-danger-text)', bg: 'var(--color-danger-soft)', bdr: 'var(--color-danger)', dot: '❌', note: 'Deal math breaks at MAO — reno budget is the constraint.' }
    return null
  })()

  // Primary offer amount — strip N/A values, fall back to ask-price context
  const rawOffer = (starting || ourMao || target || '')
  const offerAmt = /n\/a/i.test(rawOffer) ? '' : rawOffer.split('(')[0].split('←')[0].trim()

  // Log an activity to the lead timeline
  const logActivity = async (key, text) => {
    if (!lead?.id || logged[key]) return
    await supabase.from('lead_activities').insert({ lead_id: lead.id, type: 'comment', content: `[Action] ${text}` })
    setLogged(prev => ({ ...prev, [key]: true }))
  }

  // When ask < MAO, the offer is at or below asking price
  const askBelowMao = askWorks && !maoWorks
  const offerLabel = offerAmt || (askBelowMao ? 'asking price or below' : 'MAO')
  const offerLogLabel = offerAmt || (askBelowMao ? 'asking price' : 'MAO')

  // Gap size drives urgency and approach
  const gapNum = (() => {
    const ask = lead?.asking_price ? Number(lead.asking_price) : null
    const mao = lead?.mao          ? Number(lead.mao)          : null
    if (!ask || !mao || ask <= mao) return 0
    return ask - mao
  })()
  const gapPct      = lead?.asking_price ? Math.round((gapNum / Number(lead.asking_price)) * 100) : 0
  const gapTiny     = gapPct <= 5                    // one round, close fast
  const gapSmall    = gapPct > 5  && gapPct <= 15   // 1–2 rounds, 2–3 weeks
  const gapMedium   = gapPct > 15 && gapPct <= 30   // 2–3 rounds, 4–8 weeks
  const gapLarge    = gapPct > 30                    // long game, 60+ days

  const sellerHot   = sellerSignalsScore != null && sellerSignalsScore >= 10
  const sellerCold  = sellerSignalsScore != null && sellerSignalsScore < 6
  const followUpDays = sellerHot ? 3 : gapTiny ? 5 : gapSmall ? 7 : gapMedium ? 14 : 30

  // Kevin's plain-English read on this deal — synthesizes gap + score + seller motivation
  const kevinsRead = (() => {
    if (isBuyNow || (isMakeOffer && gapNum === 0))
      return `The price is already right. Don't sit on this — send the offer today. Every day you wait is a day another investor might get there first.`

    if (isMakeOffer && gapTiny)
      return `This is a strong deal and the gap is tiny. One conversation should close it. ${sellerHot ? 'Seller signals are strong — they want to move. Strike now.' : 'Send the offer this week and follow up in 5 days.'}`

    if (isMakeOffer && gapSmall)
      return `Good deal with a manageable gap. I'd expect one round of counters — they'll come back, you inch up a little, done. Don't overthink it. ${sellerHot ? 'Seller looks motivated — push harder on the first offer.' : 'Send your offer and stay consistent with follow-ups.'}`

    if ((isNegotiate || isOffer) && gapMedium)
      return `Real deal, but it needs work. The gap is real — plan for 2 or 3 rounds of back and forth over the next 4–6 weeks. ${sellerHot ? 'Good news: seller motivation looks strong, which gives you leverage.' : sellerCold ? 'Seller signals are quiet — you may need to warm them up before price talk lands.' : 'Stay patient, stay consistent, and let the Negotiate tab scripts do the heavy lifting.'}`

    if ((isNegotiate || isOffer || isLongShot) && gapLarge)
      return `The gap is big — ${gapPct}% between their price and ours. This one isn't closing this week. The play is to plant a seed now, stay visible, and let time work for you. Sellers at an inflated price usually come around at 60–90 days on market when the reality sets in. ${sellerHot ? "That said, seller motivation looks high — worth pushing harder than usual." : 'Stay in the game monthly. Don\'t chase, but don\'t disappear either.'}`

    if (isLongShot)
      return `Low odds right now, but not zero. Send a low offer, be friendly, and follow up once a month. The deals that close at big discounts are almost always ones where the investor stayed in touch while everyone else gave up.`

    if (isWatch)
      return `Not the right time to engage. The numbers don't work yet at this price. Set a reminder and check back when the listing ages or the price drops. Don't make an offer just to be active — it anchors you high and kills your leverage later.`

    if (isDead)
      return `This one doesn't work. Numbers fail at any realistic purchase price. Move on and focus your energy on better opportunities — there's no path to profit here regardless of how you structure it.`

    return null
  })()

  const renoIsEstimated = !!(lead?.deal_analysis?.reno_was_estimated || lead?.deal_analysis?.reno_unknown)

  // Numbered next steps — driven by gap size + seller odds + score
  const nextSteps = (() => {
    if (renoIsEstimated) return [
      { key: 'r0', icon: '🔨', text: 'Get a contractor walkthrough first', sub: 'Reno cost was estimated — real numbers change the MAO. Don\'t send an offer until you have an actual quote.', logText: 'Scheduled contractor walkthrough' },
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel} once reno is confirmed`, sub: 'Use the confirmed reno to verify MAO before committing.', logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `Follow up in ${followUpDays} days if seller is waiting`, sub: 'Keep the seller warm while you get the reno quote — 1 week max.', logText: `Set ${followUpDays}-day follow-up` },
    ]

    if (isBuyNow || (isMakeOffer && gapNum === 0)) return [
      { key: 's1', icon: '📤', text: `Send the offer today at ${offerLabel}`,   sub: 'Price is right. Don\'t wait.', logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📞', text: 'Call or text to confirm they received it', sub: 'A quick call shows you\'re serious. Most sellers respond same day.', logText: 'Called seller to confirm offer received' },
      { key: 's3', icon: '📅', text: 'Follow up in 3 days if no response',       sub: 'Motivated sellers move fast. If silence, call again — don\'t email.', logText: 'Set 3-day follow-up call' },
    ]

    if (isMakeOffer && gapTiny) return [
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel} this week`,   sub: `Gap is only ${gapPct}% — one conversation should close this.`, logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📞', text: sellerHot ? 'Call them — don\'t just email' : 'Follow up in 5 days if no response', sub: sellerHot ? 'Seller looks motivated. A phone call will get a faster yes.' : 'Short gap = low friction. Keep the momentum going.', logText: sellerHot ? 'Called seller directly' : 'Set 5-day follow-up' },
      { key: 's3', icon: '📋', text: 'Have one counter ready',                  sub: 'They\'ll likely come back $5–10K higher. Know your walk-away before you send.', logText: null },
    ]

    if (isMakeOffer && gapSmall) return [
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel}`,             sub: `${gapPct}% gap is workable — plan for 1 or 2 rounds of counters.`, logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `Follow up in ${followUpDays} days`,       sub: sellerHot ? 'Motivation is high — follow up fast and be direct.' : 'Stay consistent. Sellers in this range usually respond within 1–2 weeks.', logText: `Set ${followUpDays}-day follow-up` },
      { key: 's3', icon: '🤝', text: 'Check the Negotiate tab for counter scripts', sub: 'Pre-built responses for every counter they might throw.', logText: null },
    ]

    if ((isNegotiate || isOffer) && gapMedium) return [
      { key: 's1', icon: '📤', text: `Send starting offer at ${offerLabel}`,    sub: `Go in firm. ${gapPct}% gap means you need room to move — don't start too high.`, logText: `Sent starting offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `First follow-up in ${followUpDays} days`, sub: sellerHot ? 'Seller looks motivated — follow up quickly and reference market comps.' : 'If no response, send a short note referencing the market. Keep it warm.', logText: `Set ${followUpDays}-day follow-up` },
      { key: 's3', icon: '🔄', text: 'Expect 2–3 rounds over 4–6 weeks',        sub: 'Don\'t rush it. Each round you learn more about their real flexibility.', logText: null },
      { key: 's4', icon: '🤝', text: 'Use negotiation scripts for every counter', sub: 'Counters, silence responses, and urgency plays are all in the Negotiate tab.', logText: null },
    ]

    if ((isNegotiate || isOffer || isLongShot) && gapLarge) return [
      { key: 's1', icon: '📤', text: `Send a low offer at ${offerLabel} now`,   sub: `Big gap (${gapPct}%) — you're planting a seed, not closing today. That's fine.`, logText: `Sent low offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: 'Follow up once a month — no more',        sub: 'Monthly touch keeps you in their mind without being a pest. A quick "still interested" goes a long way.', logText: 'Set monthly follow-up cadence' },
      { key: 's3', icon: '👀', text: 'Watch for DOM > 60 days or any price drop', sub: 'When a listing sits, sellers start listening. Re-analyze and get more aggressive the moment the price moves.', logText: 'Set price-drop and DOM alert' },
    ]

    if (isLongShot) return [
      { key: 's1', icon: '📤', text: `Send a low offer at ${offerLabel}`,       sub: 'Low odds now, but offers create conversations. Worth the 5 minutes it takes.', logText: `Sent low offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: 'Follow up once a month',                  sub: 'Stay visible. The investors who close big discounts are the ones who stayed patient and consistent.', logText: 'Set monthly follow-up' },
      { key: 's3', icon: '👀', text: 'Re-analyze if price drops or DOM > 60',   sub: 'That\'s usually when the seller\'s mindset changes.', logText: 'Watching for price drop / DOM growth' },
    ]

    if (isWatch) return [
      { key: 's1', icon: '⛔', text: 'Don\'t make an offer yet',                sub: 'An offer now anchors you too high and kills your leverage later.', logText: null },
      { key: 's2', icon: '📅', text: 'Set a 45-day check-in',                   sub: 'Come back when the price drops or the listing hits 60+ days on market.', logText: 'Set 45-day check-in' },
      { key: 's3', icon: '📋', text: 'Note what would make this deal work',     sub: 'Price needs to drop, or ARV needs confirmation, or seller signals need to appear.', logText: 'Watching — noted conditions for re-engagement' },
    ]

    if (isDead) return [
      { key: 's1', icon: '🚫', text: 'Close this lead',                         sub: 'Math fails at any realistic price. No point spending more time here.', logText: null },
      { key: 's2', icon: '📋', text: 'Log why before you go',                   sub: 'One sentence on why it doesn\'t work — helps you avoid the same situation next time.', logText: 'Marked dead — logged reason' },
    ]
    return []
  })()

  // Verdict banner config
  const verdictMeta = isBuyNow
    ? { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)', icon: '✅', label: 'BUY NOW' }
    : isMakeOffer
    ? { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)', icon: '📨', label: 'MAKE OFFER' }
    : (isOffer || isNegotiate)
    ? { bg: 'var(--color-accent-soft)',  txt: 'var(--color-accent-text)',  bdr: 'var(--color-accent)',  icon: '💬', label: isNegotiate ? 'NEGOTIATE' : 'OFFER & NEGOTIATE' }
    : isLongShot
    ? { bg: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)',    bdr: 'var(--color-warn)',    icon: '🎯', label: 'LONG SHOT' }
    : isWatch
    ? { bg: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)',    bdr: 'var(--color-warn)',    icon: '👀', label: 'WATCH' }
    : isDead
    ? { bg: 'var(--color-danger-soft)',  txt: 'var(--color-danger-text)',  bdr: 'var(--color-danger)',  icon: '🚫', label: 'DEAD LEAD' }
    : { bg: 'var(--color-bg-elev-2)',    txt: 'var(--color-text-muted)',   bdr: 'var(--color-line)',    icon: '📋', label: verdict || '—' }

  // Parse At Ask / At MAO blocks
  const parseStatus = (val) => {
    if (!val) return null
    const works    = /^WORKS/i.test(val)
    const marginal = /^MARGINAL/i.test(val)
    const color = works ? 'var(--color-success-text)' : marginal ? 'var(--color-warn-text)' : 'var(--color-danger-text)'
    const bg    = works ? 'var(--color-success-soft)' : marginal ? 'var(--color-warn-soft)'  : 'var(--color-danger-soft)'
    const bdr   = works ? 'var(--color-success)'      : marginal ? 'var(--color-warn)'        : 'var(--color-danger)'
    const label = works ? 'WORKS' : marginal ? 'MARGINAL' : 'FAILS'
    const detail = val.replace(/^(WORKS|FAILS|MARGINAL)\s*[—-]\s*/i, '')
    return { label, color, bg, bdr, detail }
  }

  const askStatus = parseStatus(atAsk)
  const maoStatus = parseStatus(atMao)

  return (
    <div className="space-y-2.5">

      {/* ── DECISION BANNER ─────────────────────────────── */}
      {verdict && (
        <div className="rounded-xl border p-3.5" style={{ background: verdictMeta.bg, borderColor: verdictMeta.bdr }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[20px]">{verdictMeta.icon}</span>
            <span className="text-[15px] font-black" style={{ color: verdictMeta.txt }}>{verdictMeta.label}</span>
            {isGo && (offerAmt || askBelowMao) && (
              <span className="ml-auto text-[13px] font-bold" style={{ color: verdictMeta.txt }}>
                {offerAmt ? `Offer at ${offerAmt}` : 'Offer at or below ask'}
              </span>
            )}
          </div>
          {strategy && (
            <p className="text-[11px] leading-snug opacity-80 mt-0.5" style={{ color: verdictMeta.txt }}>{strategy}</p>
          )}

          {/* Two signals: Deal Math + Seller Odds */}
          {(dealMath || sellerOdds) && (
            <div className="flex gap-2 mt-2.5">
              {dealMath && (
                <div className="flex-1 rounded-lg px-2.5 py-1.5 border" style={{ background: 'rgba(0,0,0,0.15)', borderColor: 'rgba(255,255,255,0.1)' }}>
                  <div className="text-[8.5px] uppercase tracking-wider opacity-60 mb-0.5" style={{ color: verdictMeta.txt }}>Deal Math</div>
                  <div className="text-[11px] font-bold" style={{ color: verdictMeta.txt }}>{dealMath.dot} {dealMath.label}</div>
                  {dealMath.note && <div className="text-[9px] mt-0.5 opacity-70 leading-snug" style={{ color: verdictMeta.txt }}>{dealMath.note}</div>}
                </div>
              )}
              {sellerOdds && (
                <div className="flex-1 rounded-lg px-2.5 py-1.5 border" style={{ background: 'rgba(0,0,0,0.15)', borderColor: 'rgba(255,255,255,0.1)' }}>
                  <div className="text-[8.5px] uppercase tracking-wider opacity-60 mb-0.5" style={{ color: verdictMeta.txt }}>Seller Odds</div>
                  <div className="text-[11px] font-bold" style={{ color: verdictMeta.txt }}>{sellerOdds.dot} {sellerOdds.label}</div>
                  <div className="text-[9px] mt-0.5 opacity-70 leading-snug" style={{ color: verdictMeta.txt }}>{sellerOdds.tip}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── NEXT STEPS ──────────────────────────────────── */}
      {nextSteps.length > 0 && (
        <div className="rounded-xl border border-[color:var(--color-line)] overflow-hidden">
          <div className="px-3 py-2 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">Your Next Steps</span>
          </div>
          <div className="divide-y divide-[color:var(--color-line)]">
            {nextSteps.map((step, i) => (
              <div key={step.key} className="flex items-start gap-3 px-3 py-2.5 bg-[color:var(--color-bg)]">
                <div className="w-5 h-5 rounded-full bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-[color:var(--color-text-muted)]">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px]">{step.icon}</span>
                    <span className="text-[12px] font-semibold text-[color:var(--color-text)]">{step.text}</span>
                  </div>
                  {step.sub && <p className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5 leading-snug">{step.sub}</p>}
                </div>
                {step.logText && lead?.id && (
                  <button
                    onClick={() => logActivity(step.key, step.logText)}
                    disabled={!!logged[step.key]}
                    className="shrink-0 text-[10px] px-2 py-1 rounded-md border transition-all"
                    style={logged[step.key]
                      ? { background: 'var(--color-success-soft)', borderColor: 'var(--color-success)', color: 'var(--color-success-text)' }
                      : { background: 'var(--color-bg-elev-2)', borderColor: 'var(--color-line)', color: 'var(--color-text-muted)' }
                    }
                  >
                    {logged[step.key] ? '✓ Logged' : '📋 Log'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DETAIL CARDS (existing) ──────────────────────── */}

      {/* At Ask vs At MAO comparison */}
      {(askStatus || maoStatus) && (
        <div className="grid grid-cols-2 gap-2">
          {askStatus && (
            <div className="rounded-lg border p-2.5" style={{ background: askStatus.bg, borderColor: askStatus.bdr }}>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: askStatus.color }}>At Seller's Ask</div>
              <div className="text-[12px] font-bold" style={{ color: askStatus.color }}>{askStatus.label}</div>
              {askStatus.detail && <p className="text-[10px] mt-0.5 leading-snug opacity-80" style={{ color: askStatus.color }}>{askStatus.detail}</p>}
            </div>
          )}
          {maoStatus && (
            <div className="rounded-lg border p-2.5" style={{ background: maoStatus.bg, borderColor: maoStatus.bdr }}>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: maoStatus.color }}>At Our Offer (MAO)</div>
              <div className="text-[12px] font-bold" style={{ color: maoStatus.color }}>{maoStatus.label}</div>
              {maoStatus.detail && <p className="text-[10px] mt-0.5 leading-snug opacity-80" style={{ color: maoStatus.color }}>{maoStatus.detail}</p>}
            </div>
          )}
        </div>
      )}

      {/* Gap indicator */}
      {gap && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <span className="text-[12px]">↕️</span>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Negotiation Gap</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{gap}</div>
          </div>
        </div>
      )}

      {/* Price cards */}
      <div className="grid grid-cols-2 gap-2">
        {arv && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Our ARV</div>
            <div className="text-[14px] font-bold text-[color:var(--color-text)]">{arv.split('←')[0].trim()}</div>
          </div>
        )}
        {(ourMao || target) && lead?.renovation_cost != null && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-success-text)] mb-0.5">Our MAO</div>
            <div className="text-[14px] font-bold text-[color:var(--color-success-text)]">{(ourMao || target).split('←')[0].trim()}</div>
          </div>
        )}
        {(ourMao || target) && lead?.renovation_cost == null && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-warn-text)] mb-0.5">Our MAO</div>
            <div className="text-[12px] text-[color:var(--color-warn-text)]">Enter reno estimate to get exact MAO — see budget card below</div>
          </div>
        )}
        {starting && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-0.5">Starting Offer (anchor low)</div>
            <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{starting.split('←')[0].trim()}</div>
          </div>
        )}
        {maxWalk && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Max Walk-Away</div>
            <div className="text-[14px] font-bold text-[color:var(--color-text)]">{maxWalk.split('←')[0].trim()}</div>
          </div>
        )}
      </div>

      {/* How to Get There — negotiation strategy */}
      {howToGet && (
        <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-3">
          <div className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)] mb-1.5">🎯 How to Get There</div>
          <p className="text-[12px] text-[color:var(--color-accent-text)] leading-relaxed">{howToGet}</p>
        </div>
      )}

      {/* Summary (legacy) */}
      {summary && !howToGet && (
        <p className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed px-1 italic">{summary}</p>
      )}

      {/* Max reno budget cards (shown when reno was unknown at analysis time) */}
      {(maxRenoBRRRR || maxRenoFlip) && (
        <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] overflow-hidden">
          <div className="px-3 py-1.5 border-b border-[color:var(--color-accent)]">
            <span className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">🔨 Max Reno Budget to Make Deal Work</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-[color:var(--color-accent)]">
            {maxRenoBRRRR && (
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">BRRRR (cash left in &lt;$30K)</div>
                <div className="text-[13px] font-bold text-[color:var(--color-accent-text)]">{maxRenoBRRRR.split('—')[0].trim()}</div>
                {maxRenoBRRRR.includes('—') && <p className="text-[10px] opacity-70 text-[color:var(--color-accent-text)] mt-0.5">{maxRenoBRRRR.split('—').slice(1).join('—').trim()}</p>}
              </div>
            )}
            {maxRenoFlip && (
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">Flip (net profit &gt;$25K)</div>
                <div className="text-[13px] font-bold text-[color:var(--color-accent-text)]">{maxRenoFlip.split('—')[0].trim()}</div>
                {maxRenoFlip.includes('—') && <p className="text-[10px] opacity-70 text-[color:var(--color-accent-text)] mt-0.5">{maxRenoFlip.split('—').slice(1).join('—').trim()}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inspection Play strategy (conditional) */}
      {inspectionPlay && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[14px] mt-0.5">🔍</span>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-warn-text)] mb-0.5">Inspection Play</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-warn-text)] leading-snug">{inspectionPlay}</div>
          </div>
        </div>
      )}

      {/* Value-add opportunities (optional) */}
      {[
        bedroomAdd && { icon: '🛏️', label: 'Bedroom Add', val: bedroomAdd },
        bathAdd    && { icon: '🚿', label: 'Bath Add',    val: bathAdd    },
        otherUp    && { icon: '💡', label: 'Other Upside', val: otherUp  },
      ].filter(Boolean).map(({ icon, label, val }) => (
        <div key={label} className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
          <span className="text-[13px] mt-0.5">{icon}</span>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-0.5">{label}</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">{val}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RecommendedActionSection({ body }) {
  const fullNotes = useContext(NotesContext)
  const lead      = useContext(LeadContext)
  const [logged, setLogged] = useState({})

  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const computedScore = computeScoreFromText(fullNotes)
  const verdict    = scoreToVerdict(computedScore) || get('Verdict')
  const atMao      = get('At MAO')
  const gap        = get('Gap') || get('Gap to Close')
  const strategy   = get('Strategy')
  const arv        = get('Our ARV')
  const ourMao     = get('Our MAO')
  const starting   = get('Starting Offer')
  const target     = get('Target Price')
  const maxWalk    = get('Max Walk-Away')
  const howToGet   = get('How to Get There')
  const maxRenoBRRRR   = get('Max Reno (BRRRR)')
  const maxRenoFlip    = get('Max Reno (Flip)')
  const inspectionPlay = get('Inspection Play')
  const bedroomAdd     = get('Bedroom Add')
  const bathAdd        = get('Bath Add')
  const otherUp        = get('Other Upside')

  const isBuyNow    = /^BUY NOW/i.test(verdict || '')
  const isMakeOffer = /^MAKE OFFER/i.test(verdict || '')
  const isOffer     = /^OFFER/i.test(verdict || '')
  const isNegotiate = /^NEGOTIATE/i.test(verdict || '')
  const isLongShot  = /^LONG SHOT/i.test(verdict || '')
  const isWatch     = /^WATCH/i.test(verdict || '')
  const isDead      = /^DEAD/i.test(verdict || '')
  const isGo        = isBuyNow || isMakeOffer || isOffer || isNegotiate

  const sellerSignalsScore = (() => {
    if (!fullNotes) return null
    const line = fullNotes.split('\n').find(l => /^[-•*\s]*Seller Signals:/i.test(l.trim()))
    const raw  = line?.replace(/^[-•*\s]*Seller Signals:\s*/i, '').trim()
    const m    = raw?.match(/^(\d+)\/15/)
    return m ? parseInt(m[1]) : null
  })()
  const sellerOdds = sellerSignalsScore == null ? null
    : sellerSignalsScore >= 10 ? { label: 'HIGH',   dot: '🟢', tip: 'Strong motivation — seller likely to negotiate.' }
    : sellerSignalsScore >= 6  ? { label: 'MEDIUM', dot: '🟡', tip: 'Some signals. Follow up consistently.' }
    :                            { label: 'LOW',    dot: '🔴', tip: 'No urgency signals yet.' }

  // "Works at MAO" is a tautology — MAO is by definition the price where the deal works.
  // Only surface this chip when the deal is marginal or fails (the exceptions that matter).
  const maoMarginal = /^MARGINAL/i.test(atMao || '')
  const maoFails    = atMao && !/^WORKS/i.test(atMao)
  const dealMathLabel = maoMarginal ? '⚠️ Tight at MAO' : maoFails ? '❌ Fails at MAO' : null

  const rawOffer = (starting || ourMao || target || '')
  const offerAmt = /n\/a/i.test(rawOffer) ? '' : rawOffer.split('(')[0].split('←')[0].trim()
  const offerLabel = offerAmt || 'MAO'
  const offerLogLabel = offerAmt || 'MAO'

  const logActivity = async (key, text) => {
    if (!lead?.id || logged[key]) return
    await supabase.from('lead_activities').insert({ lead_id: lead.id, type: 'comment', content: `[Action] ${text}` })
    setLogged(prev => ({ ...prev, [key]: true }))
  }

  // Gap between asking price and MAO — used in verdict text and next steps
  const gapAmt = (() => {
    const ask = lead?.asking_price ? Number(lead.asking_price) : null
    const mao = lead?.mao          ? Number(lead.mao)          : null
    if (!ask || !mao || ask <= mao) return null
    return ask - mao
  })()
  const gapStr      = gapAmt ? `$${Math.round(gapAmt).toLocaleString()}` : null
  const gapNum      = gapAmt ?? 0
  const gapPct      = lead?.asking_price ? Math.round((gapNum / Number(lead.asking_price)) * 100) : 0
  const gapTiny     = gapPct <= 5
  const gapSmall    = gapPct > 5  && gapPct <= 15
  const gapMedium   = gapPct > 15 && gapPct <= 30
  const gapLarge    = gapPct > 30
  const sellerHot   = sellerSignalsScore != null && sellerSignalsScore >= 10
  const sellerCold  = sellerSignalsScore != null && sellerSignalsScore < 6
  const followUpDays = sellerHot ? 3 : gapTiny ? 5 : gapSmall ? 7 : gapMedium ? 14 : 30

  const kevinsRead = (() => {
    if (isBuyNow || (isMakeOffer && gapNum === 0))
      return `The price is already right. Don't sit on this — send the offer today. Every day you wait is a day another investor might get there first.`
    if (isMakeOffer && gapTiny)
      return `This is a strong deal and the gap is tiny. One conversation should close it. ${sellerHot ? 'Seller signals are strong — they want to move. Strike now.' : 'Send the offer this week and follow up in 5 days.'}`
    if (isMakeOffer && gapSmall)
      return `Good deal with a manageable gap. I'd expect one round of counters — they'll come back, you inch up a little, done. Don't overthink it. ${sellerHot ? 'Seller looks motivated — push harder on the first offer.' : 'Send your offer and stay consistent with follow-ups.'}`
    if ((isNegotiate || isOffer) && gapMedium)
      return `Real deal, but it needs work. The gap is real — plan for 2 or 3 rounds of back and forth over the next 4–6 weeks. ${sellerHot ? 'Good news: seller motivation looks strong, which gives you leverage.' : sellerCold ? 'Seller signals are quiet — you may need to warm them up before price talk lands.' : 'Stay patient, stay consistent, and let the Negotiate tab scripts do the heavy lifting.'}`
    if ((isNegotiate || isOffer || isLongShot) && gapLarge)
      return `The gap is big — ${gapPct}% between their price and ours. This one isn't closing this week. The play is to plant a seed now, stay visible, and let time work for you. Sellers at an inflated price usually come around at 60–90 days on market when the reality sets in. ${sellerHot ? "That said, seller motivation looks high — worth pushing harder than usual." : "Stay in the game monthly. Don't chase, but don't disappear either."}`
    if (isLongShot)
      return `Low odds right now, but not zero. Send a low offer, be friendly, and follow up once a month. The deals that close at big discounts are almost always ones where the investor stayed in touch while everyone else gave up.`
    if (isWatch)
      return `Not the right time to engage. The numbers don't work yet at this price. Set a reminder and check back when the listing ages or the price drops. Don't make an offer just to be active — it anchors you high and kills your leverage later.`
    if (isDead)
      return `This one doesn't work. Numbers fail at any realistic purchase price. Move on and focus your energy on better opportunities — there's no path to profit here regardless of how you structure it.`
    return null
  })()

  const renoIsEstimated = !!(lead?.deal_analysis?.reno_was_estimated || lead?.deal_analysis?.reno_unknown)

  const nextSteps = (() => {
    if (renoIsEstimated) return [
      { key: 'r0', icon: '🔨', text: 'Get a contractor walkthrough first', sub: 'Reno cost was estimated — real numbers change the MAO. Don\'t send an offer until you have an actual quote.', logText: 'Scheduled contractor walkthrough' },
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel} once reno is confirmed`, sub: 'Use the confirmed reno to verify MAO before committing.', logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `Follow up in ${followUpDays} days if seller is waiting`, sub: 'Keep the seller warm while you get the reno quote — 1 week max.', logText: `Set ${followUpDays}-day follow-up` },
    ]

    if (isBuyNow || (isMakeOffer && gapNum === 0)) return [
      { key: 's1', icon: '📤', text: `Send the offer today at ${offerLabel}`,    sub: 'Price is right. Don\'t wait.', logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📞', text: 'Call or text to confirm they received it', sub: 'A quick call shows you\'re serious. Most sellers respond same day.', logText: 'Called seller to confirm offer received' },
      { key: 's3', icon: '📅', text: 'Follow up in 3 days if no response',       sub: 'Motivated sellers move fast. If silence, call again — don\'t email.', logText: 'Set 3-day follow-up call' },
    ]
    if (isMakeOffer && gapTiny) return [
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel} this week`,    sub: `Gap is only ${gapPct}% — one conversation should close this.`, logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📞', text: sellerHot ? 'Call them — don\'t just email' : `Follow up in ${followUpDays} days`, sub: sellerHot ? 'Seller looks motivated. A phone call will get a faster yes.' : 'Short gap = low friction. Keep the momentum going.', logText: sellerHot ? 'Called seller directly' : `Set ${followUpDays}-day follow-up` },
      { key: 's3', icon: '📋', text: 'Have one counter ready',                   sub: 'They\'ll likely come back $5–10K higher. Know your walk-away before you send.', logText: null },
    ]
    if (isMakeOffer && gapSmall) return [
      { key: 's1', icon: '📤', text: `Send offer at ${offerLabel}`,              sub: `${gapPct}% gap is workable — plan for 1 or 2 rounds of counters.`, logText: `Sent offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `Follow up in ${followUpDays} days`,        sub: sellerHot ? 'Motivation is high — follow up fast and be direct.' : 'Stay consistent. Sellers in this range usually respond within 1–2 weeks.', logText: `Set ${followUpDays}-day follow-up` },
      { key: 's3', icon: '🤝', text: 'Check the Negotiate tab for counter scripts', sub: 'Pre-built responses for every counter they might throw.', logText: null },
    ]
    if ((isNegotiate || isOffer) && gapMedium) return [
      { key: 's1', icon: '📤', text: `Send starting offer at ${offerLabel}`,     sub: `Go in firm. ${gapPct}% gap means you need room to move — don't start too high.`, logText: `Sent starting offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: `First follow-up in ${followUpDays} days`,  sub: sellerHot ? 'Seller looks motivated — follow up quickly and reference market comps.' : 'If no response, send a short note referencing the market. Keep it warm.', logText: `Set ${followUpDays}-day follow-up` },
      { key: 's3', icon: '🔄', text: 'Expect 2–3 rounds over 4–6 weeks',         sub: 'Don\'t rush it. Each round you learn more about their real flexibility.', logText: null },
      { key: 's4', icon: '🤝', text: 'Use negotiation scripts for every counter', sub: 'Counters, silence responses, and urgency plays are all in the Negotiate tab.', logText: null },
    ]
    if ((isNegotiate || isOffer || isLongShot) && gapLarge) return [
      { key: 's1', icon: '📤', text: `Send a low offer at ${offerLabel} now`,    sub: `Big gap (${gapPct}%) — you're planting a seed, not closing today. That's fine.`, logText: `Sent low offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: 'Follow up once a month — no more',         sub: 'Monthly touch keeps you in their mind without being a pest.', logText: 'Set monthly follow-up cadence' },
      { key: 's3', icon: '👀', text: 'Watch for DOM > 60 days or any price drop', sub: 'When a listing sits, sellers start listening. Re-analyze the moment the price moves.', logText: 'Set price-drop and DOM alert' },
    ]
    if (isLongShot) return [
      { key: 's1', icon: '📤', text: `Send a low offer at ${offerLabel}`,        sub: 'Low odds now, but offers create conversations.', logText: `Sent low offer at ${offerLogLabel}` },
      { key: 's2', icon: '📅', text: 'Follow up once a month',                   sub: 'Stay visible. The investors who close big discounts stayed patient and consistent.', logText: 'Set monthly follow-up' },
      { key: 's3', icon: '👀', text: 'Re-analyze if price drops or DOM > 60',    sub: 'That\'s usually when the seller\'s mindset changes.', logText: 'Watching for price drop / DOM growth' },
    ]
    if (isWatch) return [
      { key: 's1', icon: '⛔', text: 'Don\'t make an offer yet',                 sub: 'An offer now anchors you too high and kills your leverage later.', logText: null },
      { key: 's2', icon: '📅', text: 'Set a 45-day check-in',                    sub: 'Come back when the price drops or the listing hits 60+ days on market.', logText: 'Set 45-day check-in' },
      { key: 's3', icon: '📋', text: 'Note what would make this deal work',      sub: 'Price needs to drop, ARV needs confirmation, or motivation signals need to appear.', logText: 'Watching — noted conditions for re-engagement' },
    ]
    if (isDead) return [
      { key: 's1', icon: '🚫', text: 'Close this lead',                          sub: 'Math fails at any realistic price. No point spending more time here.', logText: null },
      { key: 's2', icon: '📋', text: 'Log why before you go',                    sub: 'One sentence on why — helps you avoid the same situation next time.', logText: 'Marked dead — logged reason' },
    ]
    return []
  })()

  // Investor-friendly verdict config
  // All verdicts except WATCH and PASS result in sending some kind of offer.
  // The label tells Kevin HOW aggressively to move, not IF to move.
  const vm = isBuyNow
    ? {
        bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)',
        icon: '✅', label: 'Make the offer — price is right',
        what: 'The asking price already works for us. No negotiation needed.',
        action: 'Send the offer today. The longer you wait, the more likely someone else gets it.',
        posture: null,
      }
    : isMakeOffer
    ? (() => {
        const askAmt = lead?.asking_price ? Number(lead.asking_price) : null
        const maoAmt = lead?.mao          ? Number(lead.mao)          : null
        const askBelowMao = askAmt && maoAmt && askAmt <= maoAmt
        return {
          bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)',
          icon: '📨', label: 'Make the offer — good deal',
          what: askBelowMao
            ? 'The asking price already works for us. No negotiation needed.'
            : `Small gap${gapStr ? ` (${gapStr})` : ''} — the seller will likely move to close this.`,
          action: askBelowMao
            ? 'Send the offer at asking price. Move quickly — don\'t leave time for other buyers.'
            : 'Send your offer now. Follow up in 7 days if no response. Don\'t let this one sit.',
          posture: null,
        }
      })()
    : (isOffer || isNegotiate)
    ? {
        bg: 'var(--color-accent-soft)',  txt: 'var(--color-accent-text)',  bdr: 'var(--color-accent)',
        icon: '💬', label: 'Send an offer and negotiate',
        what: `There's a gap${gapStr ? ` of ${gapStr}` : ''} between their price and ours. Your job is to start the conversation and move them down.`,
        action: 'Send your starting offer. The seller will probably counter — that\'s normal. Keep going back and forth until you hit your number or decide to walk. Check the Negotiate tab for scripts.',
        posture: null,
      }
    : isLongShot
    ? {
        bg: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)',    bdr: 'var(--color-warn)',
        icon: '🎯', label: 'Send a low offer and wait',
        what: `The gap is large${gapStr ? ` (${gapStr})` : ''} — the price needs to come down a lot. But it costs nothing to make an offer.`,
        action: 'Send a low offer to get on their radar. Most won\'t take it today, but they\'ll remember you when the listing sits. Follow up in 30 days or when the price drops.',
        posture: null,
      }
    : isWatch
    ? {
        bg: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)',    bdr: 'var(--color-warn)',
        icon: '👀', label: 'Don\'t offer yet — watch and wait',
        what: `The gap is too wide${gapStr ? ` (${gapStr})` : ''} right now. An offer won\'t go anywhere at this price.`,
        action: 'Set a reminder and check back if the price drops or the listing has been sitting for 60+ days. Sellers get more flexible over time.',
        posture: null,
      }
    : isDead
    ? {
        bg: 'var(--color-danger-soft)',  txt: 'var(--color-danger-text)',  bdr: 'var(--color-danger)',
        icon: '🚫', label: 'Pass — numbers don\'t work',
        what: 'This deal doesn\'t pencil out at any realistic price. There\'s no path to profit here.',
        action: 'Move on. Close this lead and put your energy into better opportunities.',
        posture: null,
      }
    : { bg: 'var(--color-bg-elev-2)', txt: 'var(--color-text-muted)', bdr: 'var(--color-line)', icon: '📋', label: verdict || '—', what: null, action: null, posture: null }

  const maoIsZeroRenoCeiling = /zero.reno ceiling/i.test(ourMao || '')
  // MAO shown here must match FinancialSection. We read lead.mao which is always kept in sync
  // with the formula (ARV × 0.75 − Reno − $2,450) by FinancialSection's auto-sync.
  // Override the AI-text MAO with the stored lead.mao so both sections always agree.
  const consistentMaoValue = lead?.mao
    ? `$${Number(lead.mao).toLocaleString()}`
    : ourMao?.split('←')[0].split('(')[0].trim()
  const priceCards = [
    arv      && { label: 'ARV (from comps)',  value: arv.split('←')[0].trim(),                       accent: false },
    ourMao   && { label: maoIsZeroRenoCeiling ? 'MAO (zero-reno ceiling)' : 'MAO',
                  value: consistentMaoValue,
                  accent: maoIsZeroRenoCeiling ? 'warn' : 'green',
                  sub: maoIsZeroRenoCeiling ? '⚠ actual MAO lower once reno is known' : null },
    starting && { label: 'Starting Offer',    value: starting.split('←')[0].split('(')[0].trim(),   accent: 'blue' },
    maxWalk  && { label: 'Walk-Away Max',     value: maxWalk.split('←')[0].split('(')[0].trim(),     accent: false },
  ].filter(Boolean)

  return (
    <div className="space-y-2.5">

      {/* ── VERDICT BANNER ─────────────────────────────── */}
      {verdict && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: vm.bdr }}>

          {/* Header row */}
          <div className="flex items-center justify-between px-3.5 pt-3.5 pb-2" style={{ background: vm.bg }}>
            <div className="flex items-center gap-2">
              <span className="text-[22px]">{vm.icon}</span>
              <span className="text-[16px] font-black tracking-tight leading-tight" style={{ color: vm.txt }}>{vm.label}</span>
            </div>
            {computedScore != null && (
              <span className="text-[12px] font-bold px-2.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(0,0,0,0.2)', color: vm.txt }}>
                {computedScore}/100
              </span>
            )}
          </div>

          {/* What this means */}
          {vm.what && (
            <div className="px-3.5 pb-2" style={{ background: vm.bg }}>
              <p className="text-[11px] leading-snug" style={{ color: vm.txt, opacity: 0.8 }}>
                <span className="font-semibold opacity-100">What this means: </span>{vm.what}
              </p>
            </div>
          )}

          {/* Signal chips */}
          <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5" style={{ background: vm.bg }}>
            {strategy && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.2)', color: vm.txt }}>
                {strategy}
              </span>
            )}
            {dealMathLabel && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.2)', color: vm.txt }}>
                {dealMathLabel}
              </span>
            )}
            {sellerOdds && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.2)', color: vm.txt }}>
                {sellerOdds.dot} Seller: {sellerOdds.label}
              </span>
            )}
            {gap && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.2)', color: vm.txt }}>
                ↕ Gap: {gap.split('(')[0].trim()}
              </span>
            )}
          </div>

          {/* Action */}
          {vm.action && (
            <div className="px-3.5 py-2.5 border-t" style={{ background: 'var(--color-bg-elev-2)', borderColor: vm.bdr }}>
              <p className="text-[12.5px] text-[color:var(--color-text)] leading-relaxed">{vm.action}</p>
            </div>
          )}
        </div>
      )}

      {/* ── KEY NUMBERS ────────────────────────────────── */}
      {priceCards.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(priceCards.length, 2)}, 1fr)` }}>
          {priceCards.map(({ label, value, accent, sub }) => (
            <div key={label} className="p-3 rounded-xl border"
              style={accent === 'green'
                ? { background: 'var(--color-success-soft)', borderColor: 'var(--color-success)' }
                : accent === 'blue'
                ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)' }
                : accent === 'warn'
                ? { background: 'var(--color-warn-soft)', borderColor: 'var(--color-warn)' }
                : { background: 'var(--color-bg-elev-2)', borderColor: 'var(--color-line)' }
              }
            >
              <div className="text-[9px] uppercase tracking-widest mb-1"
                style={{ color: accent === 'green' ? 'var(--color-success-text)' : accent === 'blue' ? 'var(--color-accent-text)' : accent === 'warn' ? 'var(--color-warn-text)' : 'var(--color-text-dim)' }}>
                {label}
              </div>
              <div className="text-[16px] font-black leading-none"
                style={{ color: accent === 'green' ? 'var(--color-success-text)' : accent === 'blue' ? 'var(--color-accent-text)' : accent === 'warn' ? 'var(--color-warn-text)' : 'var(--color-text)' }}>
                {value}
              </div>
              {sub && (
                <div className="text-[9px] mt-1 leading-tight"
                  style={{ color: accent === 'warn' ? 'var(--color-warn-text)' : 'var(--color-text-dim)', opacity: 0.8 }}>
                  {sub}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── MAX RENO BUDGET (when reno unknown) ─────────── */}
      {(maxRenoBRRRR || maxRenoFlip) && (
        <div className="rounded-xl border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] overflow-hidden">
          <div className="px-3 py-1.5 border-b border-[color:var(--color-accent)]">
            <span className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">🔨 Max Reno Budget to Make Deal Work</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-[color:var(--color-accent)]">
            {maxRenoBRRRR && (
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">BRRRR (cash left &lt;$30K)</div>
                <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{maxRenoBRRRR.split('—')[0].trim()}</div>
              </div>
            )}
            {maxRenoFlip && (
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">Flip (profit &gt;$25K)</div>
                <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{maxRenoFlip.split('—')[0].trim()}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HOW TO GET THERE ────────────────────────────── */}
      {howToGet && (() => {
        // Try structured labels first, then newlines, then sentence split
        const labelPattern = /(?:^|\n)\s*(?:Opening|Probe for|Walk if)\s*:/gi
        const hasLabels = labelPattern.test(howToGet)
        let bullets
        if (hasLabels) {
          bullets = howToGet
            .split(/\n?\s*(?=(?:Opening|Probe for|Walk if)\s*:)/i)
            .map(l => l.trim()).filter(Boolean)
        } else {
          const byNewline = howToGet.split(/\n/).map(l => l.trim()).filter(Boolean)
          bullets = byNewline.length >= 2
            ? byNewline
            : howToGet.split(/(?<=\.)\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean)
        }
        const icons = ['📞', '🔍', '🚪']
        const labels = ['Opening', 'Probe for', 'Walk if']
        return (
          <div className="rounded-xl border border-[color:var(--color-line)] overflow-hidden">
            <div className="px-3 py-2 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">🎯 Agent Brief — What to Do</span>
            </div>
            <div className="divide-y divide-[color:var(--color-line)]">
              {bullets.map((line, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-[color:var(--color-bg)]">
                  <div className="shrink-0 flex flex-col items-center gap-0.5 pt-0.5">
                    <span className="text-[14px]">{icons[i] || '•'}</span>
                    {i < labels.length && (
                      <span className="text-[8px] uppercase tracking-wide text-[color:var(--color-text-dim)] whitespace-nowrap">{labels[i]}</span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-[color:var(--color-text)] leading-snug flex-1">{line.replace(/^[-•*]\s*/, '').replace(/^(?:Opening|Probe for|Walk if)\s*:\s*/i, '').replace(/^Line \d+:\s*/i, '')}</p>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── KEVIN'S READ ─────────────────────────────────── */}
      {kevinsRead && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <div className="shrink-0 w-7 h-7 rounded-full bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)] flex items-center justify-center text-[11px] font-black text-[color:var(--color-accent-text)]">K</div>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mb-1">Kevin's take</div>
            {renoIsEstimated && (
              <p className="text-[11px] text-[color:var(--color-warn-text)] bg-[color:var(--color-warn-soft)] rounded px-2 py-1 mb-1.5">
                ⚠ Reno cost was estimated, not confirmed — these numbers will shift once a contractor walks the property.
              </p>
            )}
            <p className="text-[12.5px] text-[color:var(--color-text)] leading-relaxed">{kevinsRead}</p>
          </div>
        </div>
      )}

      {/* ── NEXT STEPS ──────────────────────────────────── */}
      {nextSteps.length > 0 && (
        <div className="rounded-xl border border-[color:var(--color-line)] overflow-hidden">
          <div className="px-3 py-2 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">Your Next Steps</span>
          </div>
          <div className="divide-y divide-[color:var(--color-line)]">
            {nextSteps.map((step, i) => (
              <div key={step.key} className="flex items-start gap-3 px-3 py-2.5 bg-[color:var(--color-bg)]">
                <div className="w-5 h-5 rounded-full bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-[color:var(--color-text-muted)]">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px]">{step.icon}</span>
                    <span className="text-[12.5px] font-semibold text-[color:var(--color-text)]">{step.text}</span>
                  </div>
                  {step.sub && <p className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5 leading-snug">{step.sub}</p>}
                </div>
                {step.logText && lead?.id && (
                  <button
                    onClick={() => logActivity(step.key, step.logText)}
                    disabled={!!logged[step.key]}
                    className="shrink-0 text-[10px] px-2 py-1 rounded-md border transition-all"
                    style={logged[step.key]
                      ? { background: 'var(--color-success-soft)', borderColor: 'var(--color-success)', color: 'var(--color-success-text)' }
                      : { background: 'var(--color-bg-elev-2)', borderColor: 'var(--color-line)', color: 'var(--color-text-muted)' }
                    }
                  >
                    {logged[step.key] ? '✓ Logged' : '📋 Log'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── OPTIONAL ADD-ONS ──────────────────────────── */}
      {inspectionPlay && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[14px] mt-0.5">🔍</span>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-warn-text)] mb-0.5">Inspection Play</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-warn-text)] leading-snug">{inspectionPlay}</div>
          </div>
        </div>
      )}

      {[
        bedroomAdd && { icon: '🛏️', label: 'Bedroom Add', val: bedroomAdd },
        bathAdd    && { icon: '🚿', label: 'Bath Add',    val: bathAdd    },
        otherUp    && { icon: '💡', label: 'Other Upside', val: otherUp  },
      ].filter(Boolean).map(({ icon, label, val }) => (
        <div key={label} className="flex items-start gap-2 px-3 py-2 rounded-xl border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
          <span className="text-[13px] mt-0.5">{icon}</span>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-0.5">{label}</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">{val}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ActionSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get   = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()
  const action = get('Action')
  const offer  = get('Offer range')
  const walk   = get('Walk')
  const follow = get('Follow-up')
  const scriptIdx  = lines.findIndex(l => /^Agent call:/i.test(l.trim()))
  const scriptText = scriptIdx >= 0
    ? lines.slice(scriptIdx).map(l => l.replace(/^Agent call:\s*/i, '')).join(' ').trim()
    : null
  return (
    <div className="space-y-2">
      {action && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
          <span className="text-[15px]">🎯</span>
          <span className="text-[12.5px] font-bold text-[color:var(--color-accent-text)]">{action}</span>
        </div>
      )}
      {offer && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]">
          <span className="text-[15px]">💰</span>
          <span className="text-[12.5px] font-bold text-[color:var(--color-success-text)]">Offer: {offer}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {walk && (
          <div className="p-2.5 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Walk</div>
            <div className="text-[11.5px] text-[color:var(--color-text)] leading-snug">{walk}</div>
          </div>
        )}
        {follow && (
          <div className="p-2.5 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Follow-up</div>
            <div className="text-[11.5px] text-[color:var(--color-text)] leading-snug">{follow}</div>
          </div>
        )}
      </div>
      {scriptText && (
        <div className="p-2.5 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">📞 Agent Call Script</div>
          <p className="text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed italic">{scriptText}</p>
        </div>
      )}
    </div>
  )
}

function ComparableSalesSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const comps = lines.filter(l => /^COMP\s+\d+:/i.test(l.trim()))
  const summary = lines.find(l => /^Comp Summary:/i.test(l.trim()))?.replace(/^Comp Summary:\s*/i, '').trim()

  if (comps.length === 0) return <PlainText body={body} />

  return (
    <div className="space-y-2">
      {comps.map((line, i) => {
        const parts = line.replace(/^COMP\s+\d+:\s*/i, '').split('|').map(s => s.trim())
        const [area, profile, sqft, sold, ppsf, timeframe, note] = parts
        return (
          <div key={i} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="text-[12px] font-semibold text-[color:var(--color-text)] leading-snug">{area}</div>
              {sold && <div className="shrink-0 text-[13px] font-bold text-[color:var(--color-success-text)]">{sold.replace('Sold ', '')}</div>}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-text-muted)]">
              {profile && <span>{profile}</span>}
              {sqft && <span>{sqft}</span>}
              {ppsf && <span className="text-[color:var(--color-accent-text)]">{ppsf}</span>}
              {timeframe && <span>{timeframe}</span>}
            </div>
            {note && <p className="mt-1 text-[10.5px] text-[color:var(--color-text-dim)] italic">{note}</p>}
          </div>
        )
      })}
      {summary && (
        <div className="mt-1 px-3 py-2 rounded-lg bg-[color:var(--color-bg)] border border-[color:var(--color-line)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Comp Summary</div>
          <p className="text-[12px] text-[color:var(--color-text)] leading-snug">{summary}</p>
        </div>
      )}
    </div>
  )
}

function BedroomAddSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const current    = get('Current')
  const afterAdd   = get('After Add')
  const addCost    = get('Add Cost')
  const netGain    = get('Net Gain')
  const worthIt    = get('Worth It')
  const rec        = get('Recommendation')
  const comps      = lines.filter(l => /^COMP\s+[A-Z]:/i.test(l.trim()))

  const isYes = /^YES/i.test(worthIt || '')
  const isNo  = /^NO/i.test(worthIt || '')
  const worthColor = isYes
    ? { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)' }
    : isNo
    ? { bg: 'var(--color-danger-soft)', txt: 'var(--color-danger-text)', bdr: 'var(--color-danger)' }
    : { bg: 'var(--color-warn-soft)', txt: 'var(--color-warn-text)', bdr: 'var(--color-warn)' }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border font-semibold text-[12.5px]"
        style={{ background: worthColor.bg, borderColor: worthColor.bdr, color: worthColor.txt }}>
        🛏️ Bedroom Add: {worthIt}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {current && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">As-Is (2BR)</div>
            <div className="text-[12px] text-[color:var(--color-text)]">{current}</div>
          </div>
        )}
        {afterAdd && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-success-text)] mb-0.5">After Add (3BR)</div>
            <div className="text-[12px] font-bold text-[color:var(--color-success-text)]">{afterAdd}</div>
          </div>
        )}
        {addCost && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Add Cost</div>
            <div className="text-[12px] text-[color:var(--color-text)]">{addCost}</div>
          </div>
        )}
        {netGain && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-0.5">Net Gain</div>
            <div className="text-[12px] font-bold text-[color:var(--color-accent-text)]">{netGain}</div>
          </div>
        )}
      </div>
      {comps.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">3BR Comps in ZIP</div>
          {comps.map((line, i) => {
            const parts = line.replace(/^COMP\s+[A-Z]:\s*/i, '').split('|').map(s => s.trim())
            const [area, profile, sqft, sold, ppsf, timeframe] = parts
            return (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[11.5px]">
                <span className="text-[color:var(--color-text-muted)]">{area} {profile && `· ${profile}`}</span>
                <span className="font-bold text-[color:var(--color-success-text)] shrink-0">{sold?.replace('Sold ', '')}</span>
              </div>
            )
          })}
        </div>
      )}
      {rec && (
        <p className="text-[12px] text-[color:var(--color-text)] leading-relaxed px-1">{rec}</p>
      )}
    </div>
  )
}

function MarketCompsSection({ body }) {
  const lines = body.split('\n')
  const allLines = lines.filter(Boolean)
  const conclusion = allLines.find(l => /^ARV Conclusion:/i.test(l.trim()))?.replace(/^ARV Conclusion:\s*/i, '').trim()

  const conservativeARV = allLines.find(l => /^Conservative ARV:/i.test(l.trim()))?.replace(/^Conservative ARV:\s*/i, '').trim()
  const realisticARV    = allLines.find(l => /^Realistic ARV:/i.test(l.trim()))?.replace(/^Realistic ARV:\s*/i, '').trim()
  const optimisticARV   = allLines.find(l => /^Optimistic ARV:/i.test(l.trim()))?.replace(/^Optimistic ARV:\s*/i, '').trim()

  // Parse comp blocks with multi-line "Why relevant" support
  const SECTION_FIELDS = /^(COMP:|ARV Conclusion:|Why relevant:|Conservative ARV:|Realistic ARV:|Optimistic ARV:)/i
  const compBlocks = []
  let current = null
  for (const line of lines) {
    const t = line.trim()
    if (/^COMP:/i.test(t)) {
      if (current) compBlocks.push(current)
      current = { compLine: t, whyLines: [], inWhy: false }
    } else if (current) {
      if (/^Why relevant:/i.test(t)) {
        current.inWhy = true
        current.whyLines.push(t.replace(/^Why relevant:\s*/i, '').trim())
      } else if (current.inWhy && t && !SECTION_FIELDS.test(t)) {
        current.whyLines.push(t)
      } else if (/^(COMP:|ARV Conclusion:)/i.test(t)) {
        current.inWhy = false
      }
    }
  }
  if (current) compBlocks.push(current)

  if (compBlocks.length === 0 && !conservativeARV && !realisticARV && !optimisticARV) return <PlainText body={body} />

  return (
    <div className="space-y-2.5">
      {(conservativeARV || realisticARV || optimisticARV) && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5 space-y-1.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">ARV Range</div>
          {conservativeARV && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Conservative</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">{conservativeARV}</span>
            </div>
          )}
          {realisticARV && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Realistic</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">{realisticARV}</span>
            </div>
          )}
          {optimisticARV && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Optimistic</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-success-text)]">{optimisticARV}</span>
            </div>
          )}
        </div>
      )}
      <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Sold Comps Used for ARV</div>
      {compBlocks.map(({ compLine, whyLines }, i) => {
        const content = compLine.replace(/^COMP:\s*/i, '')
        const parts   = content.split('|').map(s => s.trim())
        const [area, profile, sqft, sold, ppsf, timeframe, condition] = parts
        const why = whyLines.join(' ').trim() || null
        return (
          <div key={i} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-hidden">
            <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-[color:var(--color-line)]">
              <span className="text-[12px] font-semibold text-[color:var(--color-text)]">{area}</span>
              {sold && <span className="shrink-0 text-[13px] font-bold text-[color:var(--color-success-text)]">{sold.replace('Sold ', '')}</span>}
            </div>
            <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-text-muted)]">
              {profile    && <span>{profile}</span>}
              {sqft       && <span>{sqft}</span>}
              {ppsf       && <span className="text-[color:var(--color-accent-text)] font-medium">{ppsf}</span>}
              {timeframe  && <span>{timeframe}</span>}
              {condition  && <span className="italic">{condition}</span>}
            </div>
            {why && (
              <div className="px-3 pb-2">
                <p className="text-[11px] italic text-[color:var(--color-text-dim)] leading-relaxed">{why}</p>
              </div>
            )}
          </div>
        )
      })}
      {conclusion && (
        <div className="px-3 py-2.5 rounded-lg bg-[color:var(--color-success-soft)] border border-[color:var(--color-success)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-success-text)] mb-1">ARV Conclusion</div>
          <p className="text-[12px] text-[color:var(--color-success-text)] leading-relaxed">{conclusion}</p>
        </div>
      )}
    </div>
  )
}

function RentalCompsSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get = (prefix) => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const consRent  = get('Conservative Rent')
  const realRent  = get('Realistic Rent')
  const optRent   = get('Optimistic Rent')
  const oneRule   = get('1% Rule')
  const verdict   = get('Rent Verdict')
  const verdictOk = /^STRONG|^MEETS/i.test(verdict || '')
  const verdictBad = /^BELOW/i.test(verdict || '')

  const cfLines = lines.filter(l => /^At (conservative|realistic|optimistic) rent:/i.test(l.trim()))

  const rentalComps = lines.filter(l => /^RENTAL:/i.test(l.trim()))

  if (!consRent && !realRent && rentalComps.length === 0) return <PlainText body={body} />

  return (
    <div className="space-y-2.5">
      {(consRent || realRent || optRent) && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5 space-y-1.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Rent Range</div>
          {consRent && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Conservative</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">{consRent}</span>
            </div>
          )}
          {realRent && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Realistic</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">{realRent}</span>
            </div>
          )}
          {optRent && (
            <div className="flex gap-2 items-baseline">
              <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-text-dim)] w-20 shrink-0">Optimistic</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-success-text)]">{optRent}</span>
            </div>
          )}
        </div>
      )}

      {verdict && (
        <div className={`px-3 py-2 rounded-lg border ${verdictOk ? 'border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]' : verdictBad ? 'border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)]' : 'border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]'}`}>
          <div className={`text-[9.5px] uppercase tracking-wider mb-0.5 ${verdictOk ? 'text-[color:var(--color-success-text)]' : verdictBad ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-warn-text)]'}`}>Rent Verdict</div>
          <p className={`text-[12px] font-semibold ${verdictOk ? 'text-[color:var(--color-success-text)]' : verdictBad ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-warn-text)]'}`}>{verdict}</p>
        </div>
      )}

      {oneRule && (
        <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <span className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">1% Rule — </span>
          <span className="text-[12px] font-semibold text-[color:var(--color-text)]">{oneRule}</span>
        </div>
      )}

      {cfLines.length > 0 && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">Cash Flow Range (BRRRR)</div>
          <div className="space-y-1">
            {cfLines.map((l, i) => {
              const [label, val] = l.replace(/^At /i, '').split(':').map(s => s.trim())
              const isNeg = /−|\-/.test(val || '')
              return (
                <div key={i} className="flex justify-between text-[12px]">
                  <span className="text-[color:var(--color-text-dim)] capitalize">{label}</span>
                  <span className={`font-semibold ${isNeg ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-success-text)]'}`}>{val}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rentalComps.length > 0 && (
        <>
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Active Rentals Used</div>
          {rentalComps.map((line, i) => {
            const content = line.replace(/^RENTAL:\s*/i, '')
            const parts   = content.split('|').map(s => s.trim())
            const [area, profile, sqft, rent, note] = parts
            return (
              <div key={i} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-hidden">
                <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-[color:var(--color-line)]">
                  <span className="text-[12px] font-semibold text-[color:var(--color-text)]">{area}</span>
                  {rent && <span className="shrink-0 text-[13px] font-bold text-[color:var(--color-accent-text)]">{rent}</span>}
                </div>
                <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-text-muted)]">
                  {profile && <span>{profile}</span>}
                  {sqft    && <span>{sqft}</span>}
                  {note    && <span className="italic">{note}</span>}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function CRMCompsUsedSection({ body }) {
  const lines = body.split('\n')
  const allLines = lines.filter(Boolean)

  const zipPattern       = allLines.find(l => /^ZIP Pattern:/i.test(l.trim()))?.replace(/^ZIP Pattern:\s*/i, '').trim()
  const confidenceImpact = allLines.find(l => /^Confidence Impact:/i.test(l.trim()))?.replace(/^Confidence Impact:\s*/i, '').trim()
  const overall          = allLines.find(l => /^Overall:/i.test(l.trim()))?.replace(/^Overall:\s*/i, '').trim()

  // Parse comp blocks — each COMP: line starts a block; collect until next COMP: or section field
  const SECTION_FIELDS = /^(COMP:|ZIP Pattern:|Confidence Impact:|Overall:)/i
  const compBlocks = []
  let current = null
  for (const line of lines) {
    const t = line.trim()
    if (/^COMP:/i.test(t)) {
      if (current) compBlocks.push(current)
      current = { compLine: t, howLines: [], inHow: false }
    } else if (current) {
      if (/^How used:/i.test(t)) {
        current.inHow = true
        current.howLines.push(t.replace(/^How used:\s*/i, '').trim())
      } else if (current.inHow && t && !SECTION_FIELDS.test(t)) {
        current.howLines.push(t)
      } else if (SECTION_FIELDS.test(t)) {
        current.inHow = false
      }
    }
  }
  if (current) compBlocks.push(current)

  if (compBlocks.length === 0) return <PlainText body={body} />

  return (
    <div className="space-y-2.5">
      {compBlocks.map(({ compLine, howLines }, i) => {
        const content = compLine.replace(/^COMP:\s*/i, '')
        const parts   = content.split('|').map(s => s.trim())
        const [addrZip, profile, ask, arv, reno, offer, status] = parts
        const how = howLines.join(' ').trim() || null
        return (
          <div key={i} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-hidden">
            <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-[color:var(--color-line)]">
              <span className="text-[12px] font-semibold text-[color:var(--color-text)] leading-snug">{addrZip}</span>
              {status && (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color:var(--color-bg)] text-[color:var(--color-text-muted)] border border-[color:var(--color-line)]">
                  {status.replace('Status: ', '')}
                </span>
              )}
            </div>
            <div className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--color-text-muted)]">
              {profile && <span>{profile}</span>}
              {ask     && <span className="text-[color:var(--color-text)]">{ask}</span>}
              {arv     && <span>ARV {arv.replace('ARV ', '')}</span>}
              {reno    && <span>Reno {reno.replace('Reno ', '')}</span>}
              {offer   && <span className="text-[color:var(--color-accent-text)] font-medium">{offer}</span>}
            </div>
            {how && (
              <div className="px-3 pb-2">
                <p className="text-[11px] italic text-[color:var(--color-text-dim)] leading-relaxed">{how}</p>
              </div>
            )}
          </div>
        )
      })}
      {(zipPattern || overall) && (
        <div className="px-3 py-2.5 rounded-lg bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-1">ZIP Pattern</div>
          <p className="text-[12px] text-[color:var(--color-accent-text)] leading-relaxed">{zipPattern || overall}</p>
        </div>
      )}
      {confidenceImpact && (
        <div className="px-3 py-2 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Confidence Impact</div>
          <p className="text-[12px] text-[color:var(--color-text)] leading-relaxed">{confidenceImpact}</p>
        </div>
      )}
    </div>
  )
}

function CRMWorkflowSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const status    = get('Set Status')
  const offer     = get('Make Offer')
  const amount    = get('Offer Amount')
  const followIn  = get('Follow-Up In')
  const trigger   = get('Follow-Up Trigger')
  const priority  = get('Priority')
  const crmNote   = get('Notes for CRM')

  const isHighPri  = /^HIGH/i.test(priority || '')
  const isMedPri   = /^MEDIUM/i.test(priority || '')
  const priColor   = isHighPri
    ? { bg: 'var(--color-danger-soft)', txt: 'var(--color-danger-text)', bdr: 'var(--color-danger)' }
    : isMedPri
    ? { bg: 'var(--color-warn-soft)', txt: 'var(--color-warn-text)', bdr: 'var(--color-warn)' }
    : { bg: 'var(--color-bg-elev-2)', txt: 'var(--color-text-muted)', bdr: 'var(--color-line)' }

  const isYesOffer = /^YES/i.test(offer || '')

  return (
    <div className="space-y-2.5">
      {priority && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border font-bold text-[12.5px]"
          style={{ background: priColor.bg, borderColor: priColor.bdr, color: priColor.txt }}>
          {isHighPri ? '🔴' : isMedPri ? '🟡' : '🟢'} Priority: {priority}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {status && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Set Status To</div>
            <div className="text-[12px] font-bold text-[color:var(--color-text)] font-mono">{status}</div>
          </div>
        )}
        {followIn && followIn.toLowerCase() !== 'n/a' && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Follow Up In</div>
            <div className="text-[12px] font-bold text-[color:var(--color-text)]">{followIn}</div>
          </div>
        )}
      </div>

      {isYesOffer && amount && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]">
          <span className="text-[20px]">💰</span>
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-success-text)] mb-0.5">Make Offer</div>
            <div className="text-[16px] font-black text-[color:var(--color-success-text)]">{amount}</div>
          </div>
        </div>
      )}

      {!isYesOffer && offer && (
        <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Make Offer</div>
          <div className="text-[12.5px] font-semibold text-[color:var(--color-text)]">{offer}</div>
        </div>
      )}

      {trigger && (
        <div className="p-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-1">Re-check When</div>
          <p className="text-[12px] text-[color:var(--color-accent-text)] leading-snug">{trigger}</p>
        </div>
      )}

      {crmNote && (
        <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Log This Note in CRM</div>
          <p className="text-[12px] text-[color:var(--color-text)] leading-relaxed italic">"{crmNote}"</p>
        </div>
      )}
    </div>
  )
}

function NegotiationPlanSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get = key => lines.find(l => new RegExp(`^${key}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${key}:\\s*`, 'i'), '').trim()

  const motivation     = get('Motivation')
  const theirPriority  = get('Their Priority')
  const leverage       = get('Leverage')
  const openingOffer   = get('Opening Offer')
  const leadWith       = get('Lead With')
  const firstMoveTone  = get('First Move Tone')
  const walkAway       = get('Walk-Away Price')

  const leverageColor = s => {
    if (!s) return {}
    if (/^HIGH/i.test(s)) return { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)' }
    if (/^LOW/i.test(s)) return  { bg: 'var(--color-danger-soft)',  txt: 'var(--color-danger-text)',  bdr: 'var(--color-danger)'  }
    return { bg: 'var(--color-warn-soft)', txt: 'var(--color-warn-text)', bdr: 'var(--color-warn)' }
  }
  const lc = leverageColor(leverage)

  const playbook = lines.filter(l => /^If they|^If counter/i.test(l.trim()))
  const relLine  = lines.find(l => /^RELATIONSHIP NOTE/i.test(l.trim()))
    ?.replace(/^RELATIONSHIP NOTE\s*/i, '').trim()
    || lines[lines.findIndex(l => /^RELATIONSHIP NOTE/i.test(l.trim())) + 1]?.trim()

  return (
    <div className="space-y-2.5">
      {leverage && (
        <div className="px-3 py-2 rounded-lg border" style={{ background: lc.bg, borderColor: lc.bdr }}>
          <div className="text-[9.5px] uppercase tracking-wider mb-0.5" style={{ color: lc.txt }}>Negotiation Leverage</div>
          <div className="text-[13px] font-bold" style={{ color: lc.txt }}>{leverage}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {motivation && (
          <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Seller Motivation</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{motivation}</div>
          </div>
        )}
        {theirPriority && (
          <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Their Priority</div>
            <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{theirPriority}</div>
          </div>
        )}
      </div>
      {(openingOffer || leadWith) && (
        <div className="px-3 py-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-1.5">Opening Strategy</div>
          {openingOffer && <div className="text-[13px] font-bold text-[color:var(--color-accent-text)] mb-1">{openingOffer}</div>}
          {leadWith && <p className="text-[11.5px] text-[color:var(--color-accent-text)] leading-snug">{leadWith}</p>}
          {firstMoveTone && <div className="mt-1 text-[10px] text-[color:var(--color-accent-text)] opacity-70">Tone: {firstMoveTone}</div>}
        </div>
      )}
      {playbook.length > 0 && (
        <div className="px-3 py-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">Counter Playbook</div>
          <div className="space-y-1.5">
            {playbook.map((line, i) => (
              <p key={i} className="text-[11.5px] text-[color:var(--color-text)] leading-snug">{line.trim()}</p>
            ))}
          </div>
        </div>
      )}
      {walkAway && (
        <div className="px-3 py-2 rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-danger-text)] mb-0.5">Walk-Away Price (Hard Floor)</div>
          <div className="text-[13px] font-bold text-[color:var(--color-danger-text)]">{walkAway}</div>
        </div>
      )}
      {relLine && (
        <div className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Relationship Play</div>
          <p className="text-[11.5px] italic text-[color:var(--color-text)] leading-relaxed">{relLine}</p>
        </div>
      )}
    </div>
  )
}

function CommunicationsSection({ body }) {
  const [copied, setCopied] = useState(null)

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const SCRIPT_LABELS = ['TEXT WHEN SUBMITTING OFFER', 'CALL SCRIPT', 'FOLLOW-UP TEXT', 'OBJECTION HANDLER']

  const extractBlock = (label, text) => {
    // Try strict ---\n wrapper
    const strict = new RegExp(`${label}[^\\n]*\\n-{2,}\\n([\\s\\S]*?)\\n-{2,}`, 'i')
    const m = text.match(strict)
    if (m) return m[1].trim()
    // Fallback: content from after this label until next known label or end
    const upper = text.toUpperCase()
    const idx = upper.indexOf(label.toUpperCase())
    if (idx === -1) return null
    const after = text.slice(idx + label.length)
    const nextIdx = SCRIPT_LABELS
      .filter(l => l !== label)
      .map(l => after.toUpperCase().indexOf(l))
      .filter(i => i > 0)
      .sort((a, b) => a - b)[0]
    const chunk = nextIdx != null ? after.slice(0, nextIdx) : after
    return chunk.replace(/^[\s\-\n]+/, '').replace(/[\s\-\n]+$/, '').trim() || null
  }

  const submitText  = extractBlock('TEXT WHEN SUBMITTING OFFER', body)
  const callScript  = extractBlock('CALL SCRIPT', body)
  const followUp    = extractBlock('FOLLOW-UP TEXT', body)
  const objHandler  = extractBlock('OBJECTION HANDLER', body)

  // Fallback: old format
  const sms         = !submitText ? extractBlock('SMS', body) : null
  const voicemail   = !callScript ? extractBlock('VOICEMAIL SCRIPT', body) : null
  const email       = extractBlock('EMAIL', body)
  const subjectLine = body.match(/^Subject:\s*(.+)$/im)?.[1]?.trim() || null

  const scripts = [
    submitText  && { key: 'submit', icon: '📱', label: 'Text — When Submitting the Offer',    sub: 'Send this the moment the offer goes in',           content: submitText,  accent: 'green' },
    callScript  && { key: 'call',   icon: '📞', label: 'Call Script — Advocate the Offer',    sub: 'Kevin calls the listing agent right after texting', content: callScript,  accent: 'blue'  },
    followUp    && { key: 'fu',     icon: '⏰', label: 'Follow-Up Text — No Response in 24h', sub: 'Stay visible without being pushy',                  content: followUp,    accent: null    },
    objHandler  && { key: 'obj',    icon: '🛡️', label: 'Objection Handler — "Price Too Low"', sub: "Agent says the seller wants more — Kevin's reply",  content: objHandler,  accent: 'warn'  },
    // fallbacks for old format
    sms     && { key: 'sms', icon: '📱', label: 'SMS / Text',       sub: null, content: sms,      accent: null },
    voicemail && { key: 'vm',  icon: '📞', label: 'Voicemail Script', sub: null, content: voicemail, accent: null },
    email   && { key: 'email',icon: '✉️', label: 'Email',            sub: subjectLine ? `Subject: ${subjectLine}` : null, content: email, accent: 'blue' },
  ].filter(Boolean)

  const accentStyles = {
    green: { bg: 'var(--color-success-soft)', bdr: 'var(--color-success)', hdr: 'var(--color-success-soft)', txt: 'var(--color-success-text)' },
    blue:  { bg: 'var(--color-accent-soft)',  bdr: 'var(--color-accent)',  hdr: 'var(--color-accent-soft)',  txt: 'var(--color-accent-text)'  },
    warn:  { bg: 'var(--color-warn-soft)',    bdr: 'var(--color-warn)',    hdr: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)'    },
    null:  { bg: 'var(--color-bg)',           bdr: 'var(--color-line)',    hdr: 'var(--color-bg-elev-2)',    txt: 'var(--color-text-muted)'   },
  }

  return (
    <div className="space-y-3">
      <div className="px-1 pb-1">
        <p className="text-[10.5px] text-[color:var(--color-text-dim)] leading-snug">
          Kevin uses these scripts when representing HAT's offer to the listing agent. Copy and use directly.
        </p>
      </div>
      {scripts.map(({ key, icon, label, sub, content, accent }) => {
        const st = accentStyles[accent] || accentStyles[null]
        return (
          <div key={key} className="rounded-xl border overflow-hidden" style={{ borderColor: st.bdr }}>
            <div className="flex items-start justify-between px-3 py-2.5 border-b" style={{ background: st.hdr, borderColor: st.bdr }}>
              <div className="flex items-center gap-2">
                <span className="text-[15px]">{icon}</span>
                <div>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: st.txt }}>{label}</div>
                  {sub && <p className="text-[9.5px] mt-0.5" style={{ color: st.txt, opacity: 0.7 }}>{sub}</p>}
                </div>
              </div>
              <button
                onClick={() => copy(content, key)}
                className="shrink-0 text-[10px] px-2.5 py-1 rounded-lg border transition-all"
                style={copied === key
                  ? { background: 'var(--color-success-soft)', borderColor: 'var(--color-success)', color: 'var(--color-success-text)' }
                  : { background: 'var(--color-bg)', borderColor: st.bdr, color: st.txt }
                }
              >
                {copied === key ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="p-3.5 bg-[color:var(--color-bg)]">
              <p className="text-[12.5px] text-[color:var(--color-text)] whitespace-pre-wrap leading-relaxed">{content}</p>
            </div>
          </div>
        )
      })}
      {scripts.length === 0 && <p className="text-[12px] text-[color:var(--color-text-dim)] px-1">No communication scripts generated yet.</p>}
    </div>
  )
}

// ─── Section registry ─────────────────────────────────────────────────────────

const SECTION_META = {
  'RECOMMENDED ACTION':                  { icon: '🎯', render: s => <RecommendedActionSection body={s} /> },
  'DEAL SCORE':                          { icon: '🏆', render: s => <DealScoreSection    body={s} /> },
  'DEAL SNAPSHOT':                       { icon: '📊', render: s => <SnapshotSection body={s} /> },
  'ARV ANALYSIS & COMP SUPPORT':         { icon: '🏠', render: s => <ARVSection      body={s} /> },
  'OPPORTUNITY SCORE & CONFIDENCE':      { icon: '🎯', render: s => <ScoreSection    body={s} /> },
  'DEAL MATH - THREE SCENARIOS':         { icon: '💰', render: s => <DealMathSection body={s} /> },
  'DEAL MATH — THREE SCENARIOS':         { icon: '💰', render: s => <DealMathSection body={s} /> },
  'PROS - WHY THIS DEAL IS INTERESTING': { icon: '✅', render: s => <BulletSection   body={s} variant="success" /> },
  'PROS — WHY THIS DEAL IS INTERESTING': { icon: '✅', render: s => <BulletSection   body={s} variant="success" /> },
  'CONS - RISKS AND CONCERNS':           { icon: '⚠️', render: s => <BulletSection   body={s} variant="danger"  /> },
  'CONS — RISKS AND CONCERNS':           { icon: '⚠️', render: s => <BulletSection   body={s} variant="danger"  /> },
  'KEY INSIGHTS & HIDDEN SIGNALS':       { icon: '💡', render: s => <InsightsSection body={s} /> },
  'STRATEGY RECOMMENDATION':             { icon: '🗺️', render: s => <StrategySection body={s} /> },
  'NEXT ACTION':                         { icon: '📞', render: s => <ActionSection      body={s} /> },
  'COMPARABLE SALES':                    { icon: '🏡', render: s => <ComparableSalesSection body={s} /> },
  'MARKET COMPS':                        { icon: '🏡', render: s => <MarketCompsSection      body={s} /> },
  'RENTAL COMPS':                        { icon: '🏘️', render: s => <RentalCompsSection     body={s} /> },
  'CRM COMPS USED':                      { icon: '🏡', render: s => <CRMCompsUsedSection    body={s} /> },
  'BEDROOM ADD OPPORTUNITY':             { icon: '🛏️', render: s => <BedroomAddSection     body={s} /> },
  'CRM WORKFLOW':                        { icon: '⚙️', render: s => <CRMWorkflowSection    body={s} /> },
  'NEGOTIATION PLAN': { icon: '🤝', render: s => <NegotiationPlanSection body={s} /> },
  'COMMUNICATIONS':   { icon: '✉️', render: s => <CommunicationsSection  body={s} /> },
}

// Tab definitions — sections matched by name. Summary intentionally includes
// RECOMMENDED ACTION so the tab always appears (it's always the first section generated).
const TABS = [
  { id: 'summary',  label: 'Summary',  icon: '📊', match: n => /^DEAL SNAPSHOT$|^DEAL SCORE$|^OPPORTUNITY SCORE|^RECOMMENDED ACTION|^STRATEGY RECOMMENDATION|^NEXT ACTION|^PROS|^CONS|^KEY INSIGHTS/.test(n) },
  { id: 'comps',    label: 'Comps',    icon: '🏡', match: n => /^COMPARABLE SALES|^MARKET COMPS|^RENTAL COMPS|^CRM COMPS USED|^BEDROOM ADD|^ARV ANALYSIS/.test(n) },
  { id: 'strategy', label: 'Strategy', icon: '🎯', match: n => /^NEGOTIATION PLAN|^COMMUNICATIONS/.test(n), alwaysShow: true },
]

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({ name, body, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const meta = SECTION_META[name] || { icon: '📝', render: s => <PlainText body={s} /> }
  return (
    <div className="rounded-xl border border-[color:var(--color-line)] overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)] hover:opacity-80 transition-opacity text-left"
      >
        <span className="text-[13px]">{meta.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-muted)] flex-1">{name}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="w-3 h-3 text-[color:var(--color-text-dim)] shrink-0 transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && (
        <div className="p-3 bg-[color:var(--color-bg)]">
          {meta.render(body)}
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function NotesRenderer({ notes, extraTabs = [], missingFields = [], lead = null, onGenerateScripts, generatingScripts, onRefreshComps, refreshingComps }) {
  const [activeTab, setActiveTab] = useState('summary')
  const sections = useMemo(() => parseNotes(notes), [notes])

  // Unstructured notes — plain scrollable text, no tabs
  if (!sections) {
    return (
      <div className="max-h-[60vh] overflow-y-auto pr-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-line) transparent' }}>
        <p className="text-[13px] text-[color:var(--color-text)] whitespace-pre-wrap leading-relaxed">{notes}</p>
      </div>
    )
  }

  // Build tabs — always include alwaysShow tabs (Scripts); skip others with no matching sections
  const tabSections = [
    ...TABS.map(tab => ({
      ...tab,
      items: sections.filter(s => tab.match(s.name)),
      content: null,
    })).filter(tab => tab.alwaysShow || tab.items.length > 0),
    ...extraTabs.map(t => ({ ...t, items: [], content: t.content })),
  ]

  // Ensure active tab is valid
  const validTab = tabSections.find(t => t.id === activeTab) ? activeTab : tabSections[0]?.id
  const currentTab = tabSections.find(t => t.id === validTab)

  return (
    <LeadContext.Provider value={lead}>
    <MissingFieldsContext.Provider value={missingFields}>
    <NotesContext.Provider value={notes || ''}>
    <div>
      {/* Tab bar — wraps to 2 rows if >5 tabs */}
      <div className="flex flex-wrap gap-1 mb-3 p-1 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
        {tabSections.map(tab => {
          const isActive = tab.id === validTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-md text-[10.5px] font-semibold transition-all"
              style={{
                flexGrow: 1,
                minWidth: '70px',
                background: isActive ? 'var(--color-accent)' : 'transparent',
                color: isActive ? '#fff' : 'var(--color-text-muted)',
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div
        className="space-y-2 overflow-y-auto pr-1 pb-2"
        style={{
          maxHeight: '60vh',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--color-line) transparent',
        }}
      >
        {currentTab?.content
          ? currentTab.content
          : <>
              {(currentTab?.id === 'summary'
                ? [...(currentTab.items || [])].sort((a, b) => {
                    const ORDER = ['RECOMMENDED ACTION', 'DEAL SCORE', 'DEAL SNAPSHOT', 'PROS', 'CONS', 'KEY INSIGHTS']
                    const ai = ORDER.findIndex(o => a.name.toUpperCase().startsWith(o))
                    const bi = ORDER.findIndex(o => b.name.toUpperCase().startsWith(o))
                    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
                  })
                : currentTab?.items || []
              ).map(({ name, body }) => (
                <SectionCard
                  key={name}
                  name={name}
                  body={body}
                  defaultCollapsed={/^PROS|^CONS|^KEY INSIGHTS/i.test(name)}
                />
              ))}
              {currentTab?.id === 'comps' && onRefreshComps && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
                  <span className="text-[11px] text-[color:var(--color-text-dim)]">Comps are based on recently sold homes nearby. Refresh to pull new data.</span>
                  <button
                    onClick={onRefreshComps}
                    disabled={refreshingComps}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-60 shrink-0 ml-3"
                  >
                    {refreshingComps ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        Fetching comps…
                      </>
                    ) : '↺ Refresh Comps'}
                  </button>
                </div>
              )}
              {currentTab?.id === 'strategy' && !currentTab.items.some(i => /^COMMUNICATIONS/i.test(i.name)) && (
                <div className="mt-2 flex flex-col items-center gap-3 py-8 text-center rounded-xl border border-dashed border-[color:var(--color-line)]">
                  <div className="text-2xl">📱</div>
                  <div>
                    <div className="text-[12.5px] font-semibold text-[color:var(--color-text)] mb-0.5">Kevin's Scripts</div>
                    <div className="text-[11px] text-[color:var(--color-text-dim)]">Word-for-word texts and call scripts for the listing agent.</div>
                  </div>
                  {onGenerateScripts && (
                    <button
                      onClick={onGenerateScripts}
                      disabled={generatingScripts}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                      {generatingScripts ? (
                        <>
                          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                          </svg>
                          Generating scripts…
                        </>
                      ) : '📱 Generate Kevin\'s Scripts'}
                    </button>
                  )}
                </div>
              )}
            </>
        }
      </div>
    </div>
    </NotesContext.Provider>
    </MissingFieldsContext.Provider>
    </LeadContext.Provider>
  )
}
