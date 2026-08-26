// src/pages/OffMarketEnginePage.jsx
// Off-Market Dashboard Manager (Wholesaler Demo V1).
//
// HONESTY CONTRACT (see docs/release-readiness/RELEASE-READINESS.md for
// the full report): every number on this page is a REAL, live query
// against the existing `leads` table, using the SAME canonical
// classification functions every other screen in the app already uses
// (distressInfo.js / distressScoring.js / contactEnrichment.js /
// dealExplanation.js) — nothing here reimplements distress scoring, buy
// box, or deal economics. Where a concept in the original brief has no
// real backing data yet (source-level RAW record counts before
// deduplication, run-level history, multi-signal stacking, source
// conversion-to-close), this page says so explicitly instead of
// fabricating a number — see the "Not currently tracked" notices below.
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { supabase } from '../lib/supabase'
import { applyLeadVisibility } from '../lib/leadVisibility'
import { formatCurrency as fc, formatDate } from '../lib/calculations'
import { computeFlipResult } from '../lib/dealExplanation'
import {
  isDistressedLead, getDistressInfo, getOpportunityInfo, fmtDistressType, getPrimaryDistressLabel,
  fmtOwnerMatch, fmtAbsentee, fmtBuyBoxFit, fmtFilingDate, fmtLienAmount, fmtLienStatus, fmtDistressSource,
} from '../lib/distressInfo'
import { DISTRESS_CATEGORY_LABELS } from '../lib/distressScoring'
import { getContactStatus, fmtContactStatus, getEnrichmentRecommendation } from '../lib/contactEnrichment'
import { runContactEnrichmentBatch, summarizeEnrichmentResults } from '../lib/enrichmentRun'
import { fmtAttemptResult } from '../lib/enrichmentResult'
import { KPI_DEFINITIONS, annotate, filterBySource, computeFunnel, applyViewFilter } from '../lib/offMarketMetrics'
import ControlCenter from '../components/off-market/ControlCenter'
import EnrichContactsModal from '../components/off-market/EnrichContactsModal'

const CONTACT_STATUS_TONE = {
  CONTACT_READY: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  MATCH_NEEDS_REVIEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ENRICHMENT_ERROR: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]',
  NO_MATCH: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]',
  NEEDS_ENRICHMENT: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
}

const SOURCE_FILTERS = Object.keys(DISTRESS_CATEGORY_LABELS).filter(k => k !== 'UNKNOWN')

function FunnelStage({ label, value, definition, notTracked }) {
  return (
    <div className="flex flex-col items-center px-3 py-2 min-w-[110px]">
      <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] text-center">{label}</div>
      {notTracked ? (
        <div className="text-[12px] text-[color:var(--color-text-faint)] italic mt-1">Not currently tracked</div>
      ) : (
        <div className="text-[20px] font-extrabold tabular-nums text-[color:var(--color-text)] mt-0.5">{value}</div>
      )}
      {definition && <div className="text-[9px] text-[color:var(--color-text-faint)] mt-0.5 text-center max-w-[130px]">{definition}</div>}
    </div>
  )
}

// Section 9 — ONE canonical contact status (getContactStatus), no
// second/conflicting "Contact Ready" definition.
function ContactStatusBadge({ lead }) {
  const status = getContactStatus(lead)
  const parts = []
  if (status === 'CONTACT_READY') {
    if (lead.phone) parts.push('1 phone')
    if (lead.email) parts.push('1 email')
  }
  return (
    <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${CONTACT_STATUS_TONE[status]}`}>
      {fmtContactStatus(status).toUpperCase()}{parts.length ? ` · ${parts.join(', ')}` : ''}
    </span>
  )
}

function PriorityChip({ opportunity }) {
  if (!opportunity?.opportunity_score) return <span className="text-[11px] text-[color:var(--color-text-dim)]">—</span>
  const key = opportunity.opportunity_priority?.key
  const icon = key === 'HIGH_PRIORITY' ? '🔥' : key === 'REVIEW' ? '🟠' : key === 'RESEARCH' ? '🟡' : '⚪'
  return <span className="text-[13px] font-bold tabular-nums">{icon} {opportunity.opportunity_score}</span>
}

// "Why This Lead?" detail panel — every line traces to a real stored field.
function WhyThisLeadPanel({ lead, onClose }) {
  const info = getDistressInfo(lead)
  const opp = getOpportunityInfo(lead)
  const flip = (lead.arv != null && lead.renovation_cost != null) ? computeFlipResult(lead) : null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-[color:var(--color-bg)] border-l border-[color:var(--color-line)] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold">Why This Lead?</h3>
          <button onClick={onClose} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] text-[13px]">✕ Close</button>
        </div>
        <div className="text-[13px] font-semibold mb-1">{lead.address}</div>
        <div className="text-[11px] text-[color:var(--color-text-dim)] mb-4">{lead.city}, {lead.state} {lead.zip_code}</div>

        {opp?.opportunity_score != null ? (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-3 py-2.5 mb-3">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Opportunity Score</div>
            <div className="text-[22px] font-extrabold tabular-nums">{opp.opportunity_score} / 100</div>
            {opp.opportunity_priority?.label && <div className="text-[11px] font-semibold mt-0.5">{opp.opportunity_priority.label}</div>}
          </div>
        ) : (
          <div className="text-[11.5px] text-[color:var(--color-text-dim)] mb-3">Opportunity Score not yet computed for this lead.</div>
        )}

        {opp?.opportunity_why?.length > 0 && (
          <div className="mb-3">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Signals Detected</div>
            <ul className="space-y-1">
              {opp.opportunity_why.map((w, i) => (
                <li key={i} className="text-[12px] text-[color:var(--color-text)]">✓ {w}</li>
              ))}
            </ul>
          </div>
        )}

        {(info || opp) && (() => {
          // Part 3 — ONE canonical headline (matches the table's Signal
          // column exactly, both call getPrimaryDistressLabel). The
          // notes-derived filing type (e.g. "Lis Pendens") is real,
          // additional detail — shown as a separate labeled "Filing:" line
          // only when it's available AND says something the headline
          // doesn't already say, never presented as a second, competing
          // distress type.
          const headline = getPrimaryDistressLabel(lead)
          const filingLabel = info?.distress_type ? fmtDistressType(info.distress_type) : null
          const showFilingLine = filingLabel && filingLabel !== headline
          return (
            <div className="rounded-lg border border-[color:var(--color-line)] px-3 py-2.5 mb-3 space-y-1">
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Distress</div>
              {headline && <div className="text-[13px] font-bold">{headline}</div>}
              {/* Part 8 — hide gracefully rather than showing a "not
                  disclosed"/"unknown" placeholder row when the underlying
                  data genuinely isn't available. */}
              {showFilingLine && <div className="text-[11.5px] text-[color:var(--color-text-dim)]">Filing: {filingLabel}</div>}
              {info?.distress_filing_date && <div className="text-[11.5px]">Filed: {fmtFilingDate(info.distress_filing_date) || info.distress_filing_date}</div>}
              {info?.lien_amount != null && Number(info.lien_amount) > 0 && <div className="text-[11.5px]">Amount: {fmtLienAmount(info.lien_amount)}</div>}
              {info && (info.lien_status === 'active' || info.lien_status === 'Active' || info.lien_status === 'released' || info.lien_status === 'Released') && (
                <div className="text-[11.5px]">Status: {fmtLienStatus(info.lien_status)}</div>
              )}
              {info?.distress_source && <div className="text-[11.5px] text-[color:var(--color-text-dim)]">Source: {fmtDistressSource(info.distress_source)}</div>}
            </div>
          )
        })()}

        <div className="rounded-lg border border-[color:var(--color-line)] px-3 py-2.5 mb-3 space-y-1">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Property Fit</div>
          <div className="text-[11.5px] flex justify-between"><span>Buy Box</span><span className="font-bold">{fmtBuyBoxFit(opp?.buy_box_fit)}</span></div>
          {info && (info.owner_match_status === 'MATCH' || info.owner_match_status === 'POSSIBLE_MATCH' || info.owner_match_status === 'DIFFERENT') && (
            <div className="text-[11.5px] flex justify-between"><span>Owner Match</span><span>{fmtOwnerMatch(info.owner_match_status)}</span></div>
          )}
          {info && (info.absentee_owner === true || info.absentee_owner === false) && (
            <div className="text-[11.5px] flex justify-between"><span>Absentee Owner</span><span>{fmtAbsentee(info.absentee_owner)}</span></div>
          )}
        </div>

        <div className="rounded-lg border border-[color:var(--color-line)] px-3 py-2.5 mb-3 space-y-1">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Contact</div>
          <div className="text-[11.5px] flex justify-between"><span>Owner Identified</span><span>{lead.owner_name ? '✓' : '—'}</span></div>
          <div className="text-[11.5px] flex justify-between"><span>Phone Found</span><span>{lead.phone ? '✓' : '—'}</span></div>
          <div className="text-[11.5px] flex justify-between"><span>Email Found</span><span>{lead.email ? '✓' : '—'}</span></div>
          <div className="text-[11.5px] flex justify-between"><span>Property Data</span><span>{(lead.bedrooms || lead.sqft || lead.year_built) ? '✓' : '—'}</span></div>
        </div>

        {/* Part 20 — Wholesale Potential, only shown when a real Max Buy exists. */}
        {flip?.available && flip.mao != null && (
          <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] px-3 py-2.5 mb-3">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-1">Wholesale Potential</div>
            <div className="text-[11.5px] flex justify-between"><span>HAT Max Buy</span><span className="font-bold">{fc(Math.round(flip.mao / 100) * 100)}</span></div>
            {flip.currentOffer != null && (
              <>
                <div className="text-[11.5px] flex justify-between"><span>Current / Target Offer</span><span className="font-bold">{fc(flip.currentOffer)}</span></div>
                <div className="text-[11.5px] flex justify-between mt-1 pt-1 border-t border-[color:var(--color-accent)]">
                  <span>Potential Assignment Room</span>
                  <span className="font-bold">{fc(Math.round(flip.mao / 100) * 100 - flip.currentOffer)}</span>
                </div>
              </>
            )}
            <div className="text-[9.5px] text-[color:var(--color-text-dim)] mt-1.5">Difference between the modeled acquisition price and HAT's current Max Buy. Not guaranteed assignment profit — excludes deal-specific wholesale costs.</div>
          </div>
        )}

        <Link
          to={`../leads/${lead.id}`}
          className="block text-center mt-2 px-3 py-2 rounded-lg bg-[color:var(--color-accent)] text-white font-semibold text-[12.5px] hover:opacity-90"
        >
          Open Lead Workspace →
        </Link>
      </div>
    </div>
  )
}

export default function OffMarketEnginePage() {
  const { workspace, workspaceId, user, userRole } = useOutletContext()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [sourceFilter, setSourceFilter] = useState(new Set(SOURCE_FILTERS))
  const [viewFilter, setViewFilter] = useState('ALL')
  const [detailLead, setDetailLead] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [lastFetchedAt, setLastFetchedAt] = useState(null)
  const [tab, setTab] = useState('CONTROL_CENTER')
  const [newRunLeadIds, setNewRunLeadIds] = useState(new Set())
  // Section 3/7 — Contact Enrichment selection + batch run state.
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirmingEnrich, setConfirmingEnrich] = useState(false)
  const [enrichRunning, setEnrichRunning] = useState(false)
  const [enrichResults, setEnrichResults] = useState(null) // per-lead results, in progress or final
  const [enrichSummary, setEnrichSummary] = useState(null)

  // Part 18 — a single re-fetch function, reused by the initial load and
  // the "Refresh Dashboard" button. Guards against overlapping concurrent
  // refreshes (a second click while one is in flight is a no-op). This
  // only re-runs the SAME read query — it never triggers enrichment or
  // ingestion, and never writes/duplicates records.
  const fetchLeads = async ({ isRefresh = false } = {}) => {
    if (!workspaceId) return
    if (isRefresh) { if (refreshing) return; setRefreshing(true) } else setLoading(true)
    setLoadError(null)
    try {
      let q = supabase
        .from('leads')
        .select('id,address,city,state,zip_code,status,is_distressed,lead_source,notes,distress_data,enrichment_data,owner_name,phone,email,arv,renovation_cost,asking_price,starting_offer,offer_price,bedrooms,bathrooms,sqft,year_built,created_at,updated_at')
        .eq('workspace_id', workspaceId)
        .or(`is_distressed.eq.true,lead_source.eq.off_market,notes.ilike.⚠ DISTRESSED OPPORTUNITY%`)
      q = applyLeadVisibility(q, user.id, userRole)
      const { data, error } = await q
      if (error) throw error
      // isDistressedLead() is the same canonical classifier every other
      // screen uses — re-checked client-side as the final authority.
      setLeads((data || []).filter(isDistressedLead))
      setLastFetchedAt(new Date())
    } catch (err) {
      setLoadError(err.message || 'Could not load the off-market pipeline. Try refreshing.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchLeads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, user.id, userRole])

  // Part 2/19 — "Last Pipeline Update" derived ONLY from a real stored
  // timestamp: the most recent leads.updated_at among the currently
  // loaded off-market leads. This is a lead-record edit time (enrichment
  // writes, manual edits, status changes all touch it) — NOT proof a
  // full ingestion "run" completed at that moment, so it's labeled
  // accordingly rather than implied to be a run-completion timestamp.
  const latestLeadUpdate = useMemo(() => {
    if (leads.length === 0) return null
    return leads.reduce((max, l) => {
      const t = l.updated_at ? new Date(l.updated_at) : null
      return t && (!max || t > max) ? t : max
    }, null)
  }, [leads])

  const enriched = useMemo(() => annotate(leads), [leads])
  const knownCategories = useMemo(() => new Set(SOURCE_FILTERS), [])
  const bySource = useMemo(() => filterBySource(enriched, sourceFilter, knownCategories), [enriched, sourceFilter, knownCategories])
  const kpis = useMemo(() => computeFunnel(bySource), [bySource])
  const viewFiltered = useMemo(() => applyViewFilter(bySource, viewFilter), [bySource, viewFilter])
  // Part 11 — "records created in this run" filter. Page-local (not a
  // reusable classification rule), so it stays here rather than touching
  // the shared offMarketMetrics.js filter logic.
  const runFiltered = useMemo(
    () => (viewFilter === 'NEW_FROM_RUN' ? viewFiltered.filter(({ lead }) => newRunLeadIds.has(lead.id)) : viewFiltered),
    [viewFiltered, viewFilter, newRunLeadIds]
  )

  const sorted = useMemo(() => [...runFiltered].sort((a, b) => (b.opp?.opportunity_score ?? -1) - (a.opp?.opportunity_score ?? -1)), [runFiltered])

  const handleViewNewLeads = (ids) => {
    setNewRunLeadIds(new Set(ids))
    setViewFilter(ids.length ? 'NEW_FROM_RUN' : 'ALL')
    setTab('LEADS')
    fetchLeads({ isRefresh: true })
  }

  // Section 14 — Control Center's "Review & Enrich Contacts". Opens Leads
  // filtered to this run and pre-selects the recommended subset — never
  // bills automatically, selection alone never triggers a paid call.
  const handleReviewAndEnrich = async (ids) => {
    handleViewNewLeads(ids)
  }

  // Recommended set (Section 4) — computed from whatever's currently
  // visible in the table, using the SAME annotate()'d opp object the table
  // itself renders from. Recomputed after every fetch/enrichment refresh.
  const recommendedIds = useMemo(() => {
    const idSet = new Set()
    for (const { lead, opp } of sorted) {
      if (getEnrichmentRecommendation(lead, opp).recommended) idSet.add(lead.id)
    }
    return idSet
  }, [sorted])

  // Auto-preselect recommended leads once, right after a Control Center
  // "Review & Enrich Contacts" hand-off lands on this filtered view —
  // never on ordinary page load (only when newRunLeadIds is freshly set).
  useEffect(() => {
    if (newRunLeadIds.size > 0 && viewFilter === 'NEW_FROM_RUN' && recommendedIds.size > 0) {
      setSelectedIds(new Set([...recommendedIds].filter(id => newRunLeadIds.has(id))))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newRunLeadIds])

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAllVisible = () => setSelectedIds(new Set(sorted.map(({ lead }) => lead.id)))
  const selectRecommended = () => setSelectedIds(new Set(recommendedIds))
  const clearSelection = () => setSelectedIds(new Set())

  const runEnrichment = async () => {
    setEnrichRunning(true)
    setEnrichResults([])
    const ids = [...selectedIds]
    const finalResults = await runContactEnrichmentBatch(ids, {
      onProgress: (partial) => setEnrichResults(partial),
    })
    setEnrichResults(finalResults)
    setEnrichSummary(summarizeEnrichmentResults(finalResults))
    setEnrichRunning(false)
    setConfirmingEnrich(false)
    fetchLeads({ isRefresh: true })
  }

  const toggleSource = (key) => {
    setSourceFilter(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <>
      <Topbar title="Off-Market Engine" breadcrumbs={[{ label: workspace.name }, { label: 'Off-Market Engine' }]} />
      <div className="px-6 pt-4">
        <div className="flex gap-1 border-b border-[color:var(--color-line)]">
          {[{ key: 'CONTROL_CENTER', label: 'Control Center' }, { key: 'LEADS', label: 'Leads' }].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 h-9 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-text)]'
                  : 'border-transparent text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'CONTROL_CENTER' && (
        <div className="px-6 py-6 w-full flex-1">
          <ControlCenter workspaceId={workspaceId} onViewNewLeads={handleViewNewLeads} onReviewAndEnrich={handleReviewAndEnrich} />
        </div>
      )}

      {tab === 'LEADS' && (
      <div className="px-6 py-6 w-full flex-1 space-y-5">
        {/* Part 2 — operational header. Every number here is real:
            offMarketLeads count comes from the same live query as the
            KPI row below; the timestamp is the MAX(leads.updated_at)
            among currently-loaded leads — a real record-edit time, never
            implied to be a completed-ingestion-run timestamp (see
            comment on latestLeadUpdate above). */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[20px] font-bold text-[color:var(--color-text)]">Off-Market Engine</h1>
            <p className="text-[12.5px] text-[color:var(--color-text-dim)] mt-0.5">Find, enrich and prioritize distressed acquisition opportunities.</p>
            {!loading && (
              <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-1.5">
                <span className="font-semibold text-[color:var(--color-text)]">{leads.length}</span> active off-market opportunit{leads.length === 1 ? 'y' : 'ies'} in Jacksonville / Duval County
                {latestLeadUpdate && (
                  <> · Latest lead data updated: {latestLeadUpdate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {latestLeadUpdate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => fetchLeads({ isRefresh: true })}
            disabled={refreshing || loading}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh Dashboard'}
          </button>
        </div>

        {loadError && (
          <div className="rounded-lg border border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] px-4 py-2.5 text-[12px] text-[color:var(--color-danger-text)] flex items-center justify-between gap-3">
            <span>Couldn't load the latest data. {loadError}</span>
            <button onClick={() => fetchLeads({ isRefresh: true })} className="underline font-semibold shrink-0">Try again</button>
          </div>
        )}

        {/* Control panel */}
        <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Market</div>
              <div className="text-[12.5px] font-semibold px-2.5 py-1 rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] inline-block">
                Jacksonville / Duval County
              </div>
              <div className="text-[9.5px] text-[color:var(--color-text-faint)] mt-1">The only market HAT's current ingestion pipeline covers. Selector designed to add more later.</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Active Distress Sources</div>
              <div className="flex gap-2">
                <button onClick={() => setSourceFilter(new Set(SOURCE_FILTERS))} className="text-[10px] underline text-[color:var(--color-accent-text)]">Select All</button>
                <button onClick={() => setSourceFilter(new Set())} className="text-[10px] underline text-[color:var(--color-text-dim)]">Clear</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_FILTERS.map(key => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleSource(key)}
                  className={`text-[11px] font-semibold px-2.5 h-7 rounded-full border transition-colors ${
                    sourceFilter.has(key)
                      ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                      : 'bg-[color:var(--color-bg-elev-2)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'
                  }`}
                >
                  {DISTRESS_CATEGORY_LABELS[key]}
                </button>
              ))}
            </div>
            {/* Part 4 — visually separated from active sources so the
                default screen emphasizes what works today; not hidden,
                not pretended active. */}
            <details className="mt-2">
              <summary className="text-[10.5px] text-[color:var(--color-text-dim)] cursor-pointer select-none">Planned sources (not yet active)</summary>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {['Probate', 'Eviction', 'Vacancy', 'Failed / Expired Listing'].map(label => (
                  <span key={label} className="text-[11px] font-semibold px-2.5 h-7 inline-flex items-center rounded-full border border-dashed border-[color:var(--color-line)] text-[color:var(--color-text-faint)]">
                    {label}
                  </span>
                ))}
              </div>
            </details>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[color:var(--color-line)]">
            <div>
              <div className="text-[12px] font-semibold">Apply HAT Buy Box <span className="text-[color:var(--color-success-text)]">ON</span></div>
              <div className="text-[10.5px] text-[color:var(--color-text-dim)]">Filters opportunities using HAT's existing property, ZIP, ARV and strategy criteria. Buy-box fit shown per lead below — always HAT's own logic, never recomputed here.</div>
            </div>
          </div>

          {/* Part 3 — reframed as an intentional, forward-looking state
              rather than a broken-looking disabled CTA. No developer/
              script language shown to the user (Part 16). */}
          <div className="pt-2 border-t border-[color:var(--color-line)] rounded-lg bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">Automated Source Runs</div>
            <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-1">
              Current off-market data is populated through HAT's connected ingestion jobs. UI-controlled source runs are the next operational step — for now, use <span className="font-semibold text-[color:var(--color-text)]">Refresh Dashboard</span> above to pull in the latest results.
            </p>
          </div>
        </div>

        {loading ? <LoadingSpinner label="Loading off-market pipeline…" /> : leads.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-6 py-10 text-center">
            <div className="text-[16px] font-bold mb-1">Find off-market acquisition opportunities</div>
            <p className="text-[12.5px] text-[color:var(--color-text-dim)] max-w-md mx-auto">Choose distress sources, apply your Buy Box, and run the engine to surface prioritized properties. No off-market leads are in this workspace yet.</p>
          </div>
        ) : (
          <>
            {/* Part 2 (final polish) — ONE KPI presentation, not two. The
                funnel communicates progression (properties → fit →
                enriched → contact ready → high priority) in less vertical
                space than the funnel-strip + card-grid combo used before,
                so the lead table sits higher on screen. Definitions come
                from KPI_DEFINITIONS (offMarketMetrics.js) — short,
                customer-facing product copy, not implementation detail. */}
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-2 py-3 overflow-x-auto">
              <div className="flex items-center divide-x divide-[color:var(--color-line)]">
                <FunnelStage label="Unique Properties" value={kpis.offMarketLeads} definition={KPI_DEFINITIONS.offMarketLeads} />
                <FunnelStage label="Buy-Box Fit" value={kpis.buyBoxFit} definition={KPI_DEFINITIONS.buyBoxFit} />
                <FunnelStage label="Enriched" value={kpis.enrichedCount} definition={KPI_DEFINITIONS.enriched} />
                <FunnelStage label="Contact Ready" value={kpis.contactReady} definition={KPI_DEFINITIONS.contactReady} />
                <FunnelStage label="High Priority" value={kpis.highPriority} definition={KPI_DEFINITIONS.highPriority} />
              </div>
            </div>

            {/* Part 1 (final polish) — Run History hidden for tomorrow's
                demo rather than shown as a visible gap (option A, the
                mission's preferred choice). Nothing here claims run-level
                tracking exists; it simply isn't shown yet. */}

            {/* View filters */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'ALL', label: 'All' },
                { key: 'HIGH_PRIORITY', label: 'High Priority' },
                { key: 'CONTACT_READY', label: 'Contact Ready' },
                { key: 'BUY_BOX_MATCH', label: 'Buy Box Match' },
                { key: 'NEEDS_ENRICHMENT', label: 'Needs Enrichment' },
                ...(newRunLeadIds.size > 0 ? [{ key: 'NEW_FROM_RUN', label: `New From Last Run (${newRunLeadIds.size})` }] : []),
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setViewFilter(f.key)}
                  className={`text-[11.5px] font-semibold px-2.5 h-7 rounded-full border transition-colors ${
                    viewFilter === f.key
                      ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                      : 'bg-[color:var(--color-bg-elev)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Section 3 — selection bar. Disabled action when nothing is
                selected; selecting a row never bills anything by itself. */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 text-[11.5px] text-[color:var(--color-text-dim)]">
                <button onClick={selectAllVisible} className="font-semibold underline text-[color:var(--color-accent-text)]">Select All</button>
                <button onClick={selectRecommended} disabled={recommendedIds.size === 0} className="font-semibold underline text-[color:var(--color-accent-text)] disabled:opacity-40 disabled:no-underline">
                  Select Recommended{recommendedIds.size > 0 ? ` (${recommendedIds.size})` : ''}
                </button>
                {selectedIds.size > 0 && <button onClick={clearSelection} className="underline text-[color:var(--color-text-dim)]">Clear</button>}
                {selectedIds.size > 0 && <span>{selectedIds.size} selected</span>}
              </div>
              <div className="text-right">
                <button
                  onClick={() => setConfirmingEnrich(true)}
                  disabled={selectedIds.size === 0}
                  className="px-3 py-1.5 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[12px] hover:opacity-90 disabled:opacity-40"
                >
                  Enrich Contacts
                </button>
                <div className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">Phone &amp; email lookup</div>
              </div>
            </div>

            {enrichSummary && (
              <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3.5 space-y-2">
                <div className="text-[12.5px] font-bold text-[color:var(--color-success-text)]">CONTACT ENRICHMENT COMPLETE</div>
                <div className="text-[11.5px] text-[color:var(--color-text-dim)]">{enrichSummary.total} selected</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                  <div><span className="font-bold">{enrichSummary.contactReady}</span> Contact Ready</div>
                  <div><span className="font-bold">{enrichSummary.noMatch}</span> No Match</div>
                  <div><span className="font-bold">{enrichSummary.alreadyEnriched}</span> Already Enriched</div>
                  <div><span className="font-bold">{enrichSummary.errors}</span> Errors</div>
                </div>
                <div className="text-[11px] text-[color:var(--color-text-dim)]">Phones Found: {enrichSummary.phonesFound} · Emails Found: {enrichSummary.emailsFound}</div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setViewFilter('CONTACT_READY'); setEnrichSummary(null); setEnrichResults(null); clearSelection() }}
                    disabled={enrichSummary.contactReady === 0}
                    className="px-3 py-1.5 rounded-lg bg-[color:var(--color-accent)] text-white font-bold text-[11.5px] hover:opacity-90 disabled:opacity-40"
                  >
                    View Contact-Ready Leads
                  </button>
                  <button onClick={() => { setEnrichSummary(null); setEnrichResults(null) }} className="text-[11px] font-semibold underline text-[color:var(--color-text-dim)]">Dismiss</button>
                </div>

                {/* Part 4 — per-lead result report. RESULT / WHY / WHAT WE
                    FOUND / WHAT WE SAVED / NEXT ACTION, using ONLY the real
                    response each lead's attempt returned. */}
                <div className="pt-2 border-t border-[color:var(--color-line)] space-y-2">
                  {enrichResults?.map(r => {
                    const lead = sorted.find(s => s.lead.id === r.leadId)?.lead
                    const providerCalledLabel = r.explanation?.providerCalled === true ? 'Called' : r.explanation?.providerCalled === false ? 'Skipped' : 'Unknown'
                    const profile = r.rawResponse?.contactProfile
                    return (
                      <div key={r.leadId} className="rounded border border-[color:var(--color-line)] px-3 py-2 text-[11.5px]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-[color:var(--color-text)]">{lead?.address || r.leadId}</div>
                          <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] shrink-0">{fmtAttemptResult(r.explanation?.attemptResult)}</span>
                        </div>
                        {lead?.owner_name && <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">Owner on record: {lead.owner_name}</div>}
                        <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">Provider request: {providerCalledLabel}</div>
                        <div className="text-[11px] text-[color:var(--color-text-muted)] mt-1">{r.explanation?.humanReason}</div>
                        {profile && (
                          <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1">
                            Saved: {profile.phones?.length || 0} phone(s), {profile.emails?.length || 0} email(s){profile.associated_people?.length ? `, ${profile.associated_people.length} associated person(s)` : ''}
                          </div>
                        )}
                        {lead && <Link to={`../leads/${lead.id}`} className="text-[10.5px] font-semibold underline text-[color:var(--color-accent-text)] mt-1 inline-block">Open Lead →</Link>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Lead table */}
            <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="border-b border-[color:var(--color-line)]">
                    <tr>
                      <th className="px-3 h-9 w-px"><input type="checkbox" checked={sorted.length > 0 && selectedIds.size === sorted.length} onChange={() => (selectedIds.size === sorted.length ? clearSelection() : selectAllVisible())} /></th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Priority</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Property</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Owner</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Signal</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Buy Box</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Contact</th>
                      <th className="px-3 h-9 text-left text-[10.5px] font-medium uppercase tracking-wider text-[color:var(--color-text-dim)]">Updated</th>
                      <th className="px-3 h-9 w-px" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--color-line)]">
                    {sorted.map(({ lead, opp }) => {
                      const enrichRow = enrichResults?.find(r => r.leadId === lead.id)
                      return (
                      <tr key={lead.id} className="hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
                        <td className="px-3 py-2.5"><input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} /></td>
                        <td className="px-3 py-2.5"><PriorityChip opportunity={opp} /></td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-[color:var(--color-text)]">{lead.address}</div>
                          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">{lead.city}, {lead.zip_code}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{lead.owner_name || '—'}</td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{getPrimaryDistressLabel(lead) || 'Unknown'}</td>
                        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtBuyBoxFit(opp?.buy_box_fit)}</td>
                        <td className="px-3 py-2.5">
                          {enrichRow ? (
                            <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]">{enrichRow.outcome}</span>
                          ) : <ContactStatusBadge lead={lead} />}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-[color:var(--color-text-dim)]">{formatDate(lead.updated_at)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => setDetailLead(lead)} className="text-[11px] font-semibold underline text-[color:var(--color-accent-text)] mr-2">Why This Lead?</button>
                          <Link to={`../leads/${lead.id}`} className="text-[11px] font-semibold underline text-[color:var(--color-text-muted)]">Open →</Link>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              {sorted.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">No leads match the current filters.</div>
              )}
            </div>
          </>
        )}
      </div>
      )}
      {confirmingEnrich && (
        <EnrichContactsModal
          count={selectedIds.size}
          running={enrichRunning}
          onCancel={() => setConfirmingEnrich(false)}
          onConfirm={runEnrichment}
        />
      )}
      {detailLead && <WhyThisLeadPanel lead={detailLead} onClose={() => setDetailLead(null)} />}
    </>
  )
}
