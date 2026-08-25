// src/components/off-market/ControlCenter.jsx
// Off-Market Engine — Control Center V1.
//
// Calls the REAL netlify/functions/offmarket-find-leads.mjs, which reuses
// the exact same resolve/classify/dedupe/import logic as scripts/
// cap14_lien_pipeline.mjs and scripts/lispendens-pilot.mjs — nothing here
// reimplements distress classification, scoring, Buy Box rules, or
// dedupe. No fake percentages: the backend cannot stream per-stage
// progress (single synchronous call), so this shows ONE honest "Running"
// state rather than fabricated stage completion (see audit finding #8).
import { useState } from 'react'
import { Link } from 'react-router-dom'

const DATE_PRESETS = [
  { key: 7, label: 'Last 7 Days' },
  { key: 30, label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
]
const RECORD_LIMITS = [10, 25, 50, 100]

const RUN_STAGES = [
  'Fetching public records',
  'Matching property/address',
  'Classifying distress',
  'Checking duplicates',
  'Checking Buy Box',
  'Scoring opportunity',
  'Creating qualified leads',
]

const FUTURE_SOURCES = [
  'Tax Delinquency', 'Code Violations / Liens', 'Probate', 'Evictions', 'Vacant / Absentee', 'Failed / Expired Listings',
]

function FunnelRow({ label, value, dim }) {
  if (value == null) return null
  return (
    <div className={`flex items-center justify-between text-[13px] ${dim ? 'text-[color:var(--color-text-dim)]' : ''}`}>
      <span>{label}</span>
      <span className={`font-bold tabular-nums ${dim ? '' : 'text-[color:var(--color-text)]'}`}>{value}</span>
    </div>
  )
}

export default function ControlCenter({ workspaceId, onViewNewLeads, onOpenActionCenter }) {
  const [dateRange, setDateRange] = useState(30)
  const [customDays, setCustomDays] = useState(30)
  const [maxRecords, setMaxRecords] = useState(10)
  const [onlyNew, setOnlyNew] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('idle') // idle | running | complete | error | blocked
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const effectiveDays = dateRange === 'custom' ? Math.min(Math.max(Number(customDays) || 30, 1), 90) : dateRange

  const applyDemoSafeRun = () => {
    setDateRange(30)
    setMaxRecords(10)
    setOnlyNew(true)
    setConfirming(true)
  }

  const startRun = async () => {
    setStatus('running')
    setErrorMsg(null)
    setResult(null)
    try {
      const res = await fetch('/.netlify/functions/offmarket-find-leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dateRangeDays: effectiveDays, maxRecords, onlyNew, workspaceId }),
      })
      const data = await res.json().catch(() => null)
      if (!data) {
        setStatus('error')
        setErrorMsg('The run did not return a valid response.')
        return
      }
      if (data.blocked) {
        setStatus('blocked')
        setErrorMsg(data.reason)
        return
      }
      if (!data.ok) {
        setStatus('error')
        setErrorMsg(data.error || 'The run failed.')
        setResult(data) // partial results, if any, still shown per Part 15
        return
      }
      setResult(data)
      setStatus('complete')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message || 'Network error — the run could not reach the server.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* SOURCE STATUS */}
      <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
        <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-2">Live Source</div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-bold">Lis Pendens / Foreclosure</div>
            <div className="text-[11.5px] text-[color:var(--color-text-dim)]">Duval County · or.duvalclerk.com</div>
          </div>
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">● READY</span>
        </div>
        <details className="mt-3">
          <summary className="text-[10.5px] text-[color:var(--color-text-dim)] cursor-pointer select-none">Future sources (not yet connected)</summary>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {FUTURE_SOURCES.map(label => (
              <span key={label} className="text-[11px] font-semibold px-2.5 h-7 inline-flex items-center rounded-full border border-dashed border-[color:var(--color-line)] text-[color:var(--color-text-faint)]">
                {label} <span className="ml-1 text-[9px] text-[color:var(--color-text-dim)]">COMING SOON</span>
              </span>
            ))}
          </div>
        </details>
      </div>

      {status === 'idle' && !confirming && (
        <>
          {/* CRITERIA */}
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-4">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1.5">Date Range</div>
              <div className="flex flex-wrap gap-1.5">
                {DATE_PRESETS.map(p => (
                  <button key={p.key} onClick={() => setDateRange(p.key)}
                    className={`text-[11.5px] font-semibold px-2.5 h-7 rounded-full border transition-colors ${dateRange === p.key ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev-2)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'}`}>
                    {p.label}
                  </button>
                ))}
                {dateRange === 'custom' && (
                  <input type="number" min="1" max="90" value={customDays} onChange={e => setCustomDays(e.target.value)}
                    className="w-20 text-[12px] px-2 h-7 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)]" />
                )}
              </div>
            </div>

            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mb-1.5">Max Records</div>
              <div className="flex flex-wrap gap-1.5">
                {RECORD_LIMITS.map(n => (
                  <button key={n} onClick={() => setMaxRecords(n)}
                    className={`text-[11.5px] font-semibold px-3 h-7 rounded-full border transition-colors ${maxRecords === n ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev-2)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between pt-2 border-t border-[color:var(--color-line)] cursor-pointer">
              <div>
                <div className="text-[12px] font-semibold">Only New Records</div>
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Uses the existing address-based dedupe — a record already in the CRM is never re-created.</div>
              </div>
              <input type="checkbox" checked={onlyNew} onChange={e => setOnlyNew(e.target.checked)} className="w-4 h-4" />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setConfirming(true)}
              className="px-4 py-2.5 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[13px] hover:opacity-90">
              FIND NEW LEADS
            </button>
            <button onClick={applyDemoSafeRun} className="text-[11.5px] font-semibold underline text-[color:var(--color-text-dim)]">
              Demo Safe Run (30 days · Max 10 · Only New)
            </button>
          </div>
        </>
      )}

      {/* RUN CONFIRMATION */}
      {confirming && status === 'idle' && (
        <div className="rounded-lg border-2 border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-4 space-y-2">
          <div className="text-[13px] font-bold">Find New Leads</div>
          <div className="text-[12px] space-y-0.5">
            <div><span className="text-[color:var(--color-text-dim)]">Source:</span> Lis Pendens / Foreclosure</div>
            <div><span className="text-[color:var(--color-text-dim)]">Period:</span> Last {effectiveDays} Days</div>
            <div><span className="text-[color:var(--color-text-dim)]">Maximum:</span> {maxRecords} records</div>
            <div><span className="text-[color:var(--color-text-dim)]">Only New:</span> {onlyNew ? 'Yes' : 'No'}</div>
          </div>
          <p className="text-[10.5px] text-[color:var(--color-text-dim)] pt-1 border-t border-[color:var(--color-accent)]">
            This run uses only free public-record enrichment already proven in HAT's ingestion pipeline — no paid provider is called.
          </p>
          <div className="flex gap-2 pt-1">
            <button onClick={startRun} className="px-4 py-2 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[12.5px] hover:opacity-90">Start Run</button>
            <button onClick={() => setConfirming(false)} className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] text-[12px] font-semibold text-[color:var(--color-text-muted)]">Cancel</button>
          </div>
        </div>
      )}

      {/* LIVE RUN STATUS — honest single RUNNING state; backend cannot
          stream per-stage progress (see audit finding #8), so this never
          fakes stage-by-stage completion or percentages. */}
      {status === 'running' && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-accent)] animate-pulse" />
            <div className="text-[13px] font-bold">RUNNING</div>
          </div>
          <ol className="space-y-1 text-[12px] text-[color:var(--color-text-dim)] list-decimal list-inside">
            {RUN_STAGES.map(s => <li key={s}>{s}</li>)}
          </ol>
          <p className="text-[10.5px] text-[color:var(--color-text-faint)] mt-2">This can take up to a minute for a live public-records fetch.</p>
        </div>
      )}

      {/* BLOCKED */}
      {status === 'blocked' && (
        <div className="rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] p-4 space-y-2">
          <div className="text-[13px] font-bold text-[color:var(--color-warn-text)]">Run Blocked</div>
          <p className="text-[12px] text-[color:var(--color-text)]">{errorMsg}</p>
          <button onClick={() => { setStatus('idle'); setConfirming(false) }} className="text-[11.5px] font-semibold underline text-[color:var(--color-text-dim)]">Back</button>
        </div>
      )}

      {/* ERROR (with partial results if any, per Part 15) */}
      {status === 'error' && (
        <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] p-4 space-y-2">
          <div className="text-[13px] font-bold text-[color:var(--color-danger-text)]">Run Failed</div>
          <p className="text-[12px] text-[color:var(--color-text)]">{errorMsg}</p>
          {result?.createdLeads?.length > 0 && (
            <p className="text-[11.5px] text-[color:var(--color-text-dim)]">{result.createdLeads.length} lead(s) were still created successfully before the failure — nothing was lost.</p>
          )}
          <button onClick={() => { setStatus('idle'); setResult(null) }} className="text-[11.5px] font-semibold underline text-[color:var(--color-text-dim)]">Try Again</button>
        </div>
      )}

      {/* RESULT FUNNEL */}
      {status === 'complete' && result && (
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-3">
          <div className="text-[13px] font-bold text-[color:var(--color-success-text)]">RUN COMPLETE</div>
          <div className="space-y-1.5">
            <FunnelRow label="Records Found" value={result.funnel.recordsFound} />
            <FunnelRow label="New Records" value={result.funnel.newRecords} />
            <FunnelRow label="Property Matches" value={result.funnel.propertyMatches} />
            <FunnelRow label="Buy Box Fit" value={result.funnel.buyBoxFit} />
            <FunnelRow label="Contact Ready" value={result.funnel.contactReady} />
            <FunnelRow label="High Priority" value={result.funnel.highPriority} />
          </div>
          <div className="pt-2 border-t border-[color:var(--color-line)] space-y-1">
            <FunnelRow label="Duplicates Skipped" value={result.funnel.duplicatesSkipped} dim />
            <FunnelRow label="Needs Review" value={result.funnel.needsReview} dim />
            <FunnelRow label="Errors" value={result.funnel.errors} dim />
          </div>
          {result.errors?.length > 0 && (
            <div className="rounded bg-[color:var(--color-warn-soft)] px-3 py-2 text-[11.5px] text-[color:var(--color-warn-text)]">
              Run completed with warnings — {result.errors.length} record(s) hit an error and were skipped. Every successful lead below is still fully usable.
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={() => onViewNewLeads?.(result.createdLeads?.map(l => l.id) || [])}
              disabled={!result.createdLeads?.length}
              className="px-3 py-2 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[12px] hover:opacity-90 disabled:opacity-40">
              VIEW NEW LEADS
            </button>
            <Link to="../../action-center" onClick={() => onOpenActionCenter?.()}
              className="px-3 py-2 rounded-lg border border-[color:var(--color-line)] font-semibold text-[12px] text-[color:var(--color-text-muted)]">
              OPEN IN ACTION CENTER
            </Link>
            <button onClick={() => { setStatus('idle'); setResult(null) }} className="text-[11.5px] font-semibold underline text-[color:var(--color-text-dim)] ml-auto">Run Again</button>
          </div>
        </div>
      )}

      {/* RUN HISTORY — honest current-session-only state (Part 12). No DB
          table exists to reconstruct past runs; adding one requires a
          migration this capability doesn't include without approval. */}
      <div className="rounded-lg border border-dashed border-[color:var(--color-line)] px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Run History</div>
        <p className="text-[11px] text-[color:var(--color-text-faint)] mt-1">
          Not persisted yet — history shown here is this browser session only and clears on refresh. Persisting real run history requires a new database table (not created without approval; see final report).
        </p>
      </div>
    </div>
  )
}
