// src/components/lead-detail/OffMarketSellerStrategy.jsx
// Capability — Off-Market Seller Strategy & Acquisition Playbook.
//
// Renders ONLY for off-market leads (getMarketType(lead) === 'OFF_MARKET',
// which reuses the existing isDistressedLead() detector — no second
// classification system). On-market leads are completely unaffected;
// this component isn't even mounted for them.
//
// Everything here is deterministic (src/lib/sellerStrategy.js) — no LLM
// call, so it can never invent seller motivation or treat an unverified
// public-record signal as fact (mission Sections 3, 28, 30).
import { useState } from 'react'
import Card from '../ui/Card'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import {
  getMarketType, getSellerIntelligence, mergeSellerIntelligence, getSellerSnapshot,
  getNextBestQuestion, getRelevantPlaybooks, getRetailVsCashFraming, getCallObjective,
  SCENARIO_LIBRARY, CALL_STAGES, PAIN_POINT_OPTIONS, TIMELINE_OPTIONS, DESIRED_OUTCOME_OPTIONS,
} from '../../lib/sellerStrategy'

const SNAPSHOT_COLOR = {
  UNKNOWN: 'var(--color-text-dim)', LOW: 'var(--color-danger-text)', POSSIBLE: 'var(--color-warn-text)',
  MODERATE: 'var(--color-accent-text)', STRONG: 'var(--color-success-text)',
}

function Pill({ children, active, onClick, tone = 'neutral' }) {
  const toneStyle = active
    ? { background: 'var(--color-accent)', color: '#fff', borderColor: 'var(--color-accent)' }
    : { background: 'var(--color-bg-elev-2)', color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' }
  return (
    <button type="button" onClick={onClick}
      className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
      style={toneStyle}>
      {children}
    </button>
  )
}

function OverviewTab({ lead, si, onUpdate, onOpenCall }) {
  const snapshot = getSellerSnapshot(lead)
  const playbooks = getRelevantPlaybooks(lead)
  const nextQuestion = getNextBestQuestion(lead, si)

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">🎯 Call Objective</div>
        <p className="text-[13px] font-medium text-[color:var(--color-text)] leading-snug">{getCallObjective(lead)}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ['Motivation', snapshot.motivation, SNAPSHOT_COLOR[snapshot.motivation]],
          ['Timeline', snapshot.timeline, 'var(--color-text)'],
          ['Condition', snapshot.condition, 'var(--color-text)'],
          ['Price', snapshot.price, 'var(--color-text)'],
          ['Decision', snapshot.decisionMaker || 'UNKNOWN', 'var(--color-text)'],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-md px-2 py-1.5 bg-[color:var(--color-bg-elev-2)]">
            <div className="text-[8.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
            <div className="text-[11.5px] font-bold truncate" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {playbooks.length > 0 && (
        <div>
          <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Why This Lead</div>
          <div className="flex flex-wrap gap-1.5 mb-1">
            {playbooks.map(p => (
              <span key={p.label} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)]">
                {p.label}
              </span>
            ))}
          </div>
          <p className="text-[10.5px] text-[color:var(--color-text-dim)] italic">⚠ These are public-record signals — verify with the seller, never state them as fact.</p>
        </div>
      )}

      {nextQuestion ? (
        <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-3 py-2.5">
          <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold mb-0.5">Next Best Question</div>
          <p className="text-[13px] font-semibold text-[color:var(--color-accent-text)]">"{nextQuestion}"</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Seller said no — respect it. No further question suggested unless something changes.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOpenCall}
          className="text-[12px] font-bold px-3 py-1.5 rounded-lg text-white bg-[color:var(--color-accent)] hover:opacity-90">
          📞 Start Call
        </button>
      </div>
    </div>
  )
}

function CallGuideTab({ lead, si, onUpdate }) {
  const [stageIdx, setStageIdx] = useState(0)
  const stage = CALL_STAGES[stageIdx]
  const nextQuestion = getNextBestQuestion(lead, si)

  function togglePain(key) {
    const has = si.pain_points.includes(key)
    onUpdate({ pain_points: has ? si.pain_points.filter(p => p !== key) : [...si.pain_points, key] })
  }
  function setTimeline(key) { onUpdate({ timeline: key }) }
  function toggleOutcome(key) {
    const has = si.desired_outcome.includes(key)
    onUpdate({ desired_outcome: has ? si.desired_outcome.filter(o => o !== key) : [...si.desired_outcome, key] })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-text-dim)]">
          Step {stageIdx + 1} of {CALL_STAGES.length} — {stage}
        </div>
        <div className="flex gap-1">
          <button disabled={stageIdx === 0} onClick={() => setStageIdx(i => Math.max(0, i - 1))} className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-line)] disabled:opacity-30">◀</button>
          <button disabled={stageIdx === CALL_STAGES.length - 1} onClick={() => setStageIdx(i => Math.min(CALL_STAGES.length - 1, i + 1))} className="text-[10px] px-2 py-0.5 rounded border border-[color:var(--color-line)] disabled:opacity-30">▶</button>
        </div>
      </div>

      {stage === 'CONNECT' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-text-dim)]">TRY SAYING:</p>
          <p className="text-[13px] font-medium text-[color:var(--color-text)]">"Hi {lead.owner_name?.split(' ')[0] || '[Owner]'}, this is Kevin with HAT Investors. I'm calling about the property at {lead.address}. Did I catch you at an okay time?"</p>
          <p className="text-[13px] font-medium text-[color:var(--color-text)]">"We're looking to buy another property in the area and wanted to see if you'd have any interest in selling it if the numbers and timing made sense."</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Pill active={si.open_to_sell === 'YES'} onClick={() => onUpdate({ open_to_sell: 'YES' })}>Open to it</Pill>
            <Pill active={si.open_to_sell === 'MAYBE'} onClick={() => onUpdate({ open_to_sell: 'MAYBE' })}>Maybe</Pill>
            <Pill active={si.open_to_sell === 'NO'} onClick={() => onUpdate({ open_to_sell: 'NO' })}>Not interested</Pill>
          </div>
        </div>
      )}

      {stage === 'DISCOVER' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-text-dim)]">TRY SAYING:</p>
          <p className="text-[13px] font-medium text-[color:var(--color-text)]">"Give me a quick picture of the house. If I walked through it today, what would I see?"</p>
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Condition Notes</label>
          <textarea
            value={si.condition_notes}
            onChange={e => onUpdate({ condition_notes: e.target.value })}
            rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]"
            placeholder="Roof, HVAC, plumbing, occupancy, damage…"
          />
        </div>
      )}

      {stage === 'UNDERSTAND' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-text-dim)]">TRY SAYING:</p>
          <p className="text-[13px] font-medium text-[color:var(--color-text)]">"Besides me calling today, what would make you consider selling?"</p>
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Quick Capture — Pain Points</label>
          <div className="flex flex-wrap gap-1.5">
            {PAIN_POINT_OPTIONS.map(p => (
              <Pill key={p.key} active={si.pain_points.includes(p.key)} onClick={() => togglePain(p.key)}>{p.label}</Pill>
            ))}
          </div>
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Timeline</label>
          <div className="flex flex-wrap gap-1.5">
            {TIMELINE_OPTIONS.map(t => (
              <Pill key={t.key} active={si.timeline === t.key} onClick={() => setTimeline(t.key)}>{t.label}</Pill>
            ))}
          </div>
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Seller Notes</label>
          <textarea value={si.motivation_notes} onChange={e => onUpdate({ motivation_notes: e.target.value })} rows={2}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" />
        </div>
      )}

      {stage === 'SOLVE' && (() => {
        const framing = getRetailVsCashFraming()
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-[color:var(--color-bg-elev-2)] p-2">
                <div className="text-[9.5px] font-bold text-[color:var(--color-text-dim)] mb-1">OPTION A — RETAIL</div>
                <ul className="text-[10.5px] text-[color:var(--color-text-muted)] space-y-0.5 list-disc pl-3">{framing.retail.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className="rounded-md bg-[color:var(--color-accent-soft)] p-2">
                <div className="text-[9.5px] font-bold text-[color:var(--color-accent-text)] mb-1">OPTION B — HAT</div>
                <ul className="text-[10.5px] text-[color:var(--color-accent-text)] space-y-0.5 list-disc pl-3">{framing.hat.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            </div>
            <p className="text-[12.5px] font-medium text-[color:var(--color-text)]">"{framing.ask}"</p>
            <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Desired Outcome (besides price)</label>
            <div className="flex flex-wrap gap-1.5">
              {DESIRED_OUTCOME_OPTIONS.map(o => (
                <Pill key={o} active={si.desired_outcome.includes(o)} onClick={() => toggleOutcome(o)}>{o.replace(/_/g, ' ')}</Pill>
              ))}
            </div>
          </div>
        )
      })()}

      {stage === 'PRICE' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[color:var(--color-text-dim)]">TRY SAYING:</p>
          <p className="text-[13px] font-medium text-[color:var(--color-text)]">"If you decided to sell it as-is, what were you hoping to walk away with?"</p>
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Seller Asking Price (optional)</label>
          <input type="number" value={si.seller_asking_price ?? ''} onChange={e => onUpdate({ seller_asking_price: e.target.value ? Number(e.target.value) : null })}
            className="w-40 text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" placeholder="$" />
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Decision Makers</label>
          <input value={si.decision_makers} onChange={e => onUpdate({ decision_makers: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" placeholder="e.g. Owner + spouse" />
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Debt / Title Notes</label>
          <input value={si.debt_notes} onChange={e => onUpdate({ debt_notes: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" placeholder="e.g. Tax balance — verify at title" />
        </div>
      )}

      {stage === 'NEXT STEP' && (
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Last Response</label>
          <input value={si.last_response} onChange={e => onUpdate({ last_response: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" placeholder="e.g. Needs to think about it" />
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Next Step</label>
          <input value={si.next_step} onChange={e => onUpdate({ next_step: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" placeholder="e.g. Follow up Thursday" />
          <p className="text-[10.5px] text-[color:var(--color-text-dim)] italic">Use the lead's existing Follow-Up / Log Outcome flow to actually schedule this — that's the one source of truth for follow-ups, not a separate tracker here.</p>
        </div>
      )}

      {nextQuestion && stage !== 'CONNECT' && (
        <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-2.5 py-2 mt-1">
          <div className="text-[8.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold">Next Best Question</div>
          <p className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">"{nextQuestion}"</p>
        </div>
      )}
    </div>
  )
}

function ScenariosTab() {
  const [query, setQuery] = useState('')
  const [openKey, setOpenKey] = useState(null)
  const filtered = SCENARIO_LIBRARY.filter(s => !query || s.signal.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="space-y-2">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search scenarios…"
        className="w-full text-[12px] px-2 py-1.5 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]" />
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {filtered.map(s => (
          <div key={s.key} className="rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]">
            <button type="button" onClick={() => setOpenKey(k => k === s.key ? null : s.key)}
              className="w-full text-left px-2.5 py-1.5 text-[12px] font-semibold text-[color:var(--color-text)]">
              {s.signal}
            </button>
            {openKey === s.key && (
              <div className="px-2.5 pb-2 space-y-1 text-[11px]">
                <div><span className="font-semibold text-[color:var(--color-text-dim)]">Means: </span><span className="text-[color:var(--color-text-muted)]">{s.means}</span></div>
                <div><span className="font-semibold text-[color:var(--color-text-dim)]">Objective: </span><span className="text-[color:var(--color-text-muted)]">{s.objective}</span></div>
                <div className="rounded bg-[color:var(--color-accent-soft)] px-2 py-1"><span className="font-semibold text-[color:var(--color-accent-text)]">Try saying: </span><span className="text-[color:var(--color-accent-text)]">"{s.tryS}"</span></div>
                <div><span className="font-semibold text-[color:var(--color-text-dim)]">Next: </span><span className="text-[color:var(--color-text-muted)]">{s.next}</span></div>
                <div><span className="font-semibold text-[color:var(--color-danger-text)]">Avoid: </span><span className="text-[color:var(--color-text-muted)]">{s.avoid}</span></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function OffMarketSellerStrategy({ lead, userId, members, canEdit, onUpdated }) {
  const [tab, setTab] = useState('overview')
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  if (getMarketType(lead) !== 'OFF_MARKET') return null

  const si = getSellerIntelligence(lead)

  async function handleUpdate(patch) {
    const distress_data = mergeSellerIntelligence(lead, patch)
    await update({ distress_data })
  }

  return (
    <Card title="Off-Market Seller Strategy" subtitle="Understand the seller before talking price — deterministic, no AI guessing">
      <div className="flex gap-1.5 mb-3">
        {[['overview', 'Overview'], ['call', 'Call Guide'], ['scenarios', 'Scenarios']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              tab === key ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev-2)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {!canEdit ? (
        <OverviewTab lead={lead} si={si} onUpdate={() => {}} onOpenCall={() => {}} />
      ) : tab === 'overview' ? (
        <OverviewTab lead={lead} si={si} onUpdate={handleUpdate} onOpenCall={() => setTab('call')} />
      ) : tab === 'call' ? (
        <CallGuideTab lead={lead} si={si} onUpdate={handleUpdate} />
      ) : (
        <ScenariosTab />
      )}
    </Card>
  )
}
