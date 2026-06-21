import { useMemo, useState } from 'react'

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseNotes(text) {
  if (!text?.trim()) return null
  const chunks = text.split(/={5,}/).map(c => c.trim()).filter(Boolean)
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
  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const totalRaw = get('Total')
  const verdict  = get('Verdict')
  const total    = totalRaw ? parseInt(totalRaw) : null

  const subScores = [
    { key: 'Price Gap',          max: 25 },
    { key: 'Deal Math',          max: 25 },
    { key: 'Cash Flow',          max: 15 },
    { key: 'ZIP Quality',        max: 15 },
    { key: 'Seller Motivation',  max: 10 },
    { key: 'ARV Confidence',     max: 10 },
  ].map(({ key, max }) => {
    const raw = get(key)
    if (!raw) return null
    const scoreMatch = raw.match(/^(\d+)\/\d+/)
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null
    const detail = raw.replace(/^\d+\/\d+\s*[—-]\s*/, '').trim()
    return { key, max, score, detail }
  }).filter(Boolean)

  const scoreColor = (n, max) => {
    const pct = n / max
    return pct >= 0.75 ? 'var(--color-success)' : pct >= 0.5 ? 'var(--color-warn)' : 'var(--color-danger)'
  }

  const totalColor = total >= 80 ? { txt: 'var(--color-success-text)', bg: 'var(--color-success-soft)', bdr: 'var(--color-success)' }
    : total >= 65 ? { txt: 'var(--color-accent-text)', bg: 'var(--color-accent-soft)', bdr: 'var(--color-accent)' }
    : total >= 45 ? { txt: 'var(--color-warn-text)', bg: 'var(--color-warn-soft)', bdr: 'var(--color-warn)' }
    : { txt: 'var(--color-text-muted)', bg: 'var(--color-bg-elev-2)', bdr: 'var(--color-line)' }

  return (
    <div className="space-y-3">
      {/* Gauge */}
      {total != null && (
        <div className="flex items-center gap-4 p-3 rounded-lg border" style={{ background: totalColor.bg, borderColor: totalColor.bdr }}>
          <div className="relative shrink-0 w-16 h-16">
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-line)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none"
                stroke={totalColor.bdr} strokeWidth="3"
                strokeDasharray={`${total} ${100 - total}`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[16px] font-black leading-none" style={{ color: totalColor.txt }}>{total}</span>
              <span className="text-[9px]" style={{ color: totalColor.txt }}>/100</span>
            </span>
          </div>
          <div>
            <div className="text-[15px] font-black" style={{ color: totalColor.txt }}>
              {total >= 80 ? 'EXCEPTIONAL' : total >= 65 ? 'STRONG' : total >= 45 ? 'WATCH' : total >= 25 ? 'MARGINAL' : 'DEAD LEAD'}
            </div>
            {verdict && <p className="text-[11px] mt-0.5" style={{ color: totalColor.txt }}>{verdict.replace(/^(STRONG|SOLID|MARGINAL|WEAK)[^—–-]*/i, '')}</p>}
          </div>
        </div>
      )}

      {/* Sub-scores */}
      <div className="space-y-2">
        {subScores.map(({ key, max, score, detail }) => (
          <div key={key} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px] font-semibold text-[color:var(--color-text-muted)]">{key}</span>
              <span className="text-[11px] font-bold" style={{ color: score != null ? scoreColor(score, max) : 'var(--color-text-dim)' }}>
                {score ?? '?'}/{max}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[color:var(--color-line)] overflow-hidden mb-1.5">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: score != null ? `${(score / max) * 100}%` : '0%', backgroundColor: score != null ? scoreColor(score, max) : 'transparent' }} />
            </div>
            {detail && <p className="text-[10.5px] text-[color:var(--color-text-dim)] leading-snug">{detail}</p>}
          </div>
        ))}
      </div>
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

function RecommendedActionSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const get = prefix => lines.find(l => new RegExp(`^${prefix}:`, 'i').test(l.trim()))
    ?.replace(new RegExp(`^${prefix}:\\s*`, 'i'), '').trim()

  const verdict    = get('Verdict')
  const atAsk      = get('At Ask')
  const atMao      = get('At MAO')
  const gap        = get('Gap')
  const strategy   = get('Strategy')
  const arv        = get('Our ARV')
  const starting   = get('Starting Offer')
  const target     = get('Target Price')
  const maxWalk    = get('Max Walk-Away')
  const summary    = get('Summary')

  // Value-add lines (optional)
  const bedroomAdd = get('Bedroom Add')
  const bathAdd    = get('Bath Add')
  const otherUp    = get('Other Upside')

  const isBuyNow   = /^BUY NOW/i.test(verdict || '')
  const isOffer    = /^OFFER/i.test(verdict || '')
  const isWatch    = /^WATCH/i.test(verdict || '')
  const isDead     = /^DEAD/i.test(verdict || '')

  const verdictMeta = isBuyNow
    ? { bg: 'var(--color-success-soft)', txt: 'var(--color-success-text)', bdr: 'var(--color-success)', icon: '✅', label: 'BUY NOW' }
    : isOffer
    ? { bg: 'var(--color-accent-soft)',  txt: 'var(--color-accent-text)',  bdr: 'var(--color-accent)',  icon: '💬', label: 'OFFER & NEGOTIATE' }
    : isWatch
    ? { bg: 'var(--color-warn-soft)',    txt: 'var(--color-warn-text)',    bdr: 'var(--color-warn)',    icon: '👀', label: 'WATCH' }
    : isDead
    ? { bg: 'var(--color-bg-elev-2)',    txt: 'var(--color-text-muted)',   bdr: 'var(--color-line)',    icon: '🚫', label: 'DEAD LEAD' }
    : { bg: 'var(--color-bg-elev-2)',    txt: 'var(--color-text-muted)',   bdr: 'var(--color-line)',    icon: '📋', label: verdict || '—' }

  // Strip verdict keyword from the full verdict string to get the explanation
  const verdictDetail = (verdict || '').replace(/^(BUY NOW|OFFER & NEGOTIATE|WATCH|DEAD LEAD)\s*[—-]\s*/i, '')

  // Parse At Ask / At MAO status
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
      {/* Main verdict banner */}
      {verdict && (
        <div className="flex items-start gap-3 p-3 rounded-lg border"
          style={{ background: verdictMeta.bg, borderColor: verdictMeta.bdr }}>
          <span className="text-[22px] shrink-0 mt-0.5">{verdictMeta.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-black leading-tight" style={{ color: verdictMeta.txt }}>{verdictMeta.label}</div>
            {verdictDetail && (
              <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: verdictMeta.txt }}>{verdictDetail}</p>
            )}
            {strategy && (
              <div className="text-[10.5px] mt-1 opacity-75" style={{ color: verdictMeta.txt }}>Strategy: {strategy}</div>
            )}
          </div>
        </div>
      )}

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
        {starting && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-0.5">Starting Offer</div>
            <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{starting.split('←')[0].trim()}</div>
          </div>
        )}
        {target && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-success-text)] mb-0.5">Target Price (MAO)</div>
            <div className="text-[14px] font-bold text-[color:var(--color-success-text)]">{target.split('←')[0].trim()}</div>
          </div>
        )}
        {maxWalk && (
          <div className="p-2.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">Max Walk-Away</div>
            <div className="text-[14px] font-bold text-[color:var(--color-text)]">{maxWalk.split('←')[0].trim()}</div>
          </div>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed px-1 italic">{summary}</p>
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
  const lines = body.split('\n').filter(Boolean)
  const compLines = lines.filter(l => /^COMP:/i.test(l.trim()))
  const whyLines  = lines.filter(l => /^Why relevant:/i.test(l.trim()))
  const conclusion = lines.find(l => /^ARV Conclusion:/i.test(l.trim()))?.replace(/^ARV Conclusion:\s*/i, '').trim()

  if (compLines.length === 0) return <PlainText body={body} />

  return (
    <div className="space-y-2.5">
      <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Sold Comps Used for ARV</div>
      {compLines.map((line, i) => {
        const content = line.replace(/^COMP:\s*/i, '')
        const parts   = content.split('|').map(s => s.trim())
        const [area, profile, sqft, sold, ppsf, timeframe, condition] = parts
        const why = whyLines[i]?.replace(/^Why relevant:\s*/i, '').trim()
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

function CRMCompsUsedSection({ body }) {
  const lines = body.split('\n').filter(Boolean)
  const compLines = lines.filter(l => /^COMP:/i.test(l.trim()))
  const howLines  = lines.filter(l => /^How used:/i.test(l.trim()))
  const overall   = lines.find(l => /^Overall:/i.test(l.trim()))?.replace(/^Overall:\s*/i, '').trim()

  if (compLines.length === 0) return <PlainText body={body} />

  return (
    <div className="space-y-2.5">
      {compLines.map((line, i) => {
        const content = line.replace(/^COMP:\s*/i, '')
        const parts   = content.split('|').map(s => s.trim())
        const [addrZip, profile, ask, arv, reno, offer, status] = parts
        const how = howLines[i]?.replace(/^How used:\s*/i, '').trim()
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
      {overall && (
        <div className="px-3 py-2.5 rounded-lg bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)]">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-1">What CRM History Tells Us</div>
          <p className="text-[12px] text-[color:var(--color-accent-text)] leading-relaxed">{overall}</p>
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
  'CRM COMPS USED':                      { icon: '🏡', render: s => <CRMCompsUsedSection    body={s} /> },
  'BEDROOM ADD OPPORTUNITY':             { icon: '🛏️', render: s => <BedroomAddSection     body={s} /> },
  'CRM WORKFLOW':                        { icon: '⚙️', render: s => <CRMWorkflowSection    body={s} /> },
}

// Tab definitions — sections are matched by name prefix
const TABS = [
  { id: 'summary',  label: 'Summary',  icon: '📊', match: n => /^DEAL SNAPSHOT$|^DEAL SCORE$|^OPPORTUNITY SCORE/.test(n) },
  { id: 'strategy', label: 'Strategy', icon: '🎯', match: n => /^RECOMMENDED ACTION|^STRATEGY RECOMMENDATION|^NEXT ACTION|^CRM WORKFLOW/.test(n) },
  { id: 'analysis', label: 'Analysis', icon: '🔍', match: n => /^PROS|^CONS|^KEY INSIGHTS/.test(n) },
  { id: 'comps',    label: 'Comps',    icon: '🏡', match: n => /^COMPARABLE SALES|^MARKET COMPS|^CRM COMPS USED|^BEDROOM ADD|^ARV ANALYSIS/.test(n) },
]

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({ name, body }) {
  const meta = SECTION_META[name] || { icon: '📝', render: s => <PlainText body={s} /> }
  return (
    <div className="rounded-xl border border-[color:var(--color-line)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
        <span className="text-[13px]">{meta.icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">{name}</span>
      </div>
      <div className="p-3 bg-[color:var(--color-bg)]">
        {meta.render(body)}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function NotesRenderer({ notes, extraTabs = [] }) {
  const [activeTab, setActiveTab] = useState('strategy')
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

  // Build tabs, skip any that have no matching sections; append extraTabs at end
  const tabSections = [
    ...TABS.map(tab => ({
      ...tab,
      items: sections.filter(s => tab.match(s.name)),
      content: null,
    })).filter(tab => tab.items.length > 0),
    ...extraTabs.map(t => ({ ...t, items: [], content: t.content })),
  ]

  // Ensure active tab is valid
  const validTab = tabSections.find(t => t.id === activeTab) ? activeTab : tabSections[0]?.id
  const currentTab = tabSections.find(t => t.id === validTab)

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3 p-1 rounded-lg bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
        {tabSections.map(tab => {
          const isActive = tab.id === validTab
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all"
              style={{
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
        className="space-y-2 overflow-y-auto pr-0.5"
        style={{
          maxHeight: '55vh',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--color-line) transparent',
        }}
      >
        {currentTab?.content
          ? currentTab.content
          : (currentTab?.items || []).map(({ name, body }) => (
              <SectionCard key={name} name={name} body={body} />
            ))
        }
      </div>
    </div>
  )
}
