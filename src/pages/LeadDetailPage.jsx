import { useEffect, useState } from 'react'
import { useParams, useOutletContext, useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import ActionZone from '../components/lead-detail/ActionZone'
import TriageDecisionBar from '../components/lead-detail/TriageDecisionBar'
import LeadStatusPipeline from '../components/lead-detail/LeadStatusPipeline'
import PropertyInfoSection from '../components/lead-detail/PropertyInfoSection'
import NotesSection from '../components/lead-detail/NotesSection'
import DealAnalysisCard from '../components/lead-detail/DealAnalysisCard'
import ComplsIntelligenceCard from '../components/lead-detail/workspace/ComplsIntelligenceCard'
import MlsStatusBanner from '../components/lead-detail/MlsStatusBanner'
import DistressBanner from '../components/lead-detail/DistressBanner'
import LeadEssentialsBar from '../components/lead-detail/LeadEssentialsBar'
import FinancialSection from '../components/lead-detail/FinancialSection'
import ReportSection from '../components/lead-detail/ReportSection'
import ActivityTimeline from '../components/lead-detail/ActivityTimeline'
import CommentBox from '../components/lead-detail/CommentBox'
import AttachmentsSection from '../components/lead-detail/AttachmentsSection'
import LeadForm from '../components/leads/LeadForm'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { supabase } from '../lib/supabase'
import { enrichLead } from '../lib/enrichment'
import AcquisitionCopilot from '../components/lead-detail/AcquisitionCopilot'
import OffMarketSellerStrategy from '../components/lead-detail/OffMarketSellerStrategy'
import LiveCopilot from '../components/lead-detail/LiveCopilot'
import LogOutcomeModal from '../components/action-center/LogOutcomeModal'
import { getMarketType } from '../lib/sellerStrategy'
import LeadWorkspaceHeader from '../components/lead-detail/workspace/LeadWorkspaceHeader'
import LeadWorkspaceTabs from '../components/lead-detail/workspace/LeadWorkspaceTabs'
import EnrichContactsModal from '../components/off-market/EnrichContactsModal'
import { runContactEnrichmentBatch } from '../lib/enrichmentRun'
import SellerSnapshotStrip from '../components/lead-detail/workspace/SellerSnapshotStrip'
import DealSnapshotCompact from '../components/lead-detail/workspace/DealSnapshotCompact'
import DecisionHero from '../components/lead-detail/workspace/DecisionHero'
import DealDecisionCenter from '../components/lead-detail/workspace/DealDecisionCenter'
import OnMarketAcquisitionWorkspace from '../components/lead-detail/workspace/OnMarketAcquisitionWorkspace'
import { getDealReadiness, getAcquisitionReadiness, getAiReadiness } from '../components/lead-detail/workspace/readiness'
import { resolveUnderwritingSettings } from '../lib/underwritingSettings'
import UnderwritingAssumptionsPanel from '../components/lead-detail/workspace/UnderwritingAssumptionsPanel'

// Lead Workspace redesign, Phase 2 — SAME ENGINE, SAME COMPONENTS, BETTER
// WORKSPACE (mission Section 3). Every child component below still
// receives the exact same props/callbacks it always did; only WHERE they
// render (which tab pane) and the addition of a sticky header/tab shell
// changed. No component was rewritten to produce this layout.

export default function LeadDetailPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
  // Underwriting Configuration V1 — the ONE resolved effective settings
  // object for this workspace, threaded to every canonical-engine
  // consumer on this page. Resolved once per render; resolveUnderwritingSettings
  // always returns a complete, valid object (safe fallback to system
  // defaults when workspace.settings.underwriting is absent/malformed).
  const underwritingSettings = resolveUnderwritingSettings(workspace.settings)
  const { leadId } = useParams()
  const navigate = useNavigate()
  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [creatingProject, setCreatingProject] = useState(false)
  // Bug fix (pre-redesign) — Deal Analysis's Flip/BRRRR tab was local-only
  // state inside DealAnalysisCard, so Financials (a sibling section)
  // always showed Flip MAO even after switching to BRRRR. DealAnalysisCard
  // reports its active tab up here via onStrategyChange so Financials'
  // (and now the workspace header's) MAO figure stays in sync.
  const [dealStrategy, setDealStrategy] = useState('flip')

  // Lead Workspace redesign — which of the 5 tabs is active. Overview is
  // the default per mission Section 6.
  const [activeTab, setActiveTab] = useState('overview')
  // Lead Workspace redesign, Section 9 — Live Copilot is mounted HERE, as
  // a sibling to the tab content, NOT inside any individual tab pane.
  // Switching `activeTab` never unmounts it — its own internal mic/
  // transcript/pending-facts state (LiveCopilot.jsx) survives every tab
  // switch, exactly per the Phase 1 audit's highest-priority finding.
  const [liveCopilotOpen, setLiveCopilotOpen] = useState(false)
  const [logOutcomeOpen, setLogOutcomeOpen] = useState(false)
  // Final UX Polish, Section 3 — tab readiness labels are DATA-AWARE, not
  // status-dependent; activityCount is the only one that needs a value
  // from a child (ActivityTimeline already fetches it, this just surfaces
  // the count via an additive callback prop — no second query).
  const [activityCount, setActivityCount] = useState(null)

  const handleCreateProject = async () => {
    setCreatingProject(true)
    const { data: updatedLead, error: leadError } = await supabase
      .from('leads')
      .update({ status: 'working_project' })
      .eq('id', leadId)
      .select()
      .single()

    if (leadError) {
      setCreatingProject(false)
      return
    }

    const { error: finError } = await supabase.from('deal_financials').upsert({
      lead_id:                  lead.id,
      workspace_id:             lead.workspace_id || workspaceId,
      purchase_price_actual:    lead.offer_price || lead.asking_price || null,
      expected_sell_price:      lead.arv || null,
      renovation_lender_amount: lead.renovation_cost || null,
    }, { onConflict: 'lead_id' })

    if (finError) {
      setCreatingProject(false)
      return
    }

    setCreatingProject(false)
    if (updatedLead) setLead(updatedLead)
    navigate(`/w/${workspaceId}/projects/${leadId}`)
  }

  const canEdit   = userRole !== 'readonly'
  const canAssign = userRole === 'admin'
  const canDelete = userRole === 'admin'

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).single()
    if (error) setError(error.message)
    else setLead(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [leadId])

  // Final UX polish pass, Part 2 — ONE canonical single-lead enrichment
  // execution path, shared by LeadEssentialsBar's "Enrich Contact" and
  // DistressBanner's clickable Next Action ("Retry Contact"). Both only
  // ever call onRequestEnrich() to open this SAME confirmation modal —
  // neither triggers BatchData directly, and there is no second call site
  // for runContactEnrichmentBatch anywhere else on this page.
  const [enrichConfirmOpen, setEnrichConfirmOpen] = useState(false)
  const [enrichRunning, setEnrichRunning] = useState(false)
  const runSingleEnrichment = async () => {
    setEnrichRunning(true)
    await runContactEnrichmentBatch([leadId])
    setEnrichRunning(false)
    setEnrichConfirmOpen(false)
    load()
  }

  // Auto-refresh MLS status if it's stale (>1h since last check).
  // Silent background call — skipped entirely when MLS is paused workspace-wide.
  useEffect(() => {
    if (!lead || !lead.id) return
    if (workspace?.settings?.mls_paused) return
    const ageMs = lead.mls_last_checked ? (Date.now() - new Date(lead.mls_last_checked).getTime()) : Infinity
    if (ageMs < 60 * 60 * 1000) return
    let cancelled = false
    enrichLead(lead.id).then(r => {
      if (cancelled) return
      if (r?.ok && r.lead) setLead(r.lead)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [lead?.id, workspace?.settings?.mls_paused])

  const handleDelete = async () => {
    setDeleting(true)
    const { error } = await supabase.from('leads').delete().eq('id', leadId)
    setDeleting(false)
    if (!error) navigate(`/w/${workspaceId}/leads`)
  }

  if (loading) return <LoadingSpinner fullPage label="Loading lead…" />
  if (error || !lead) {
    return (
      <>
        <Topbar title="Lead not found" />
        <div className="p-6 text-slate-500">{error || 'This lead could not be loaded.'}</div>
      </>
    )
  }

  const isOffMarket = getMarketType(lead) === 'OFF_MARKET'
  const onLeadUpdated = (updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }

  // Final UX Polish, Section 3 — subtle tab subtitles, purely derived from
  // data already on the lead (never from lead.status).
  const dealReadiness = getDealReadiness(lead)
  const acqReadiness = getAcquisitionReadiness(lead)
  const aiReadiness = getAiReadiness(lead)
  const tabReadiness = {
    deal: dealReadiness.flipReady ? 'Ready' : 'Needs ' + (dealReadiness.missing[0]?.label || 'Info'),
    acquisition: isOffMarket ? undefined : (acqReadiness.ready ? undefined : 'No Agent'),
    ai: aiReadiness.hasRun ? undefined : 'Not Run',
    activity: activityCount != null ? String(activityCount) : undefined,
  }

  return (
    <>
      <Topbar
        title={lead.address || 'Lead'}
        breadcrumbs={[
          { label: workspace.name, to: `/w/${workspaceId}` },
          { label: 'Leads', to: `/w/${workspaceId}/leads` },
          { label: lead.address || 'Lead' },
        ]}
        actions={canDelete && <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete</Button>}
      />

      {/* HAT Premium Visual Pass, Part 3 — brand identity, sparingly: one
          small descriptor line, not a logo (none exists in the project —
          per the mission's own instruction, none is invented), not
          repeated anywhere else on the page. */}
      <div className="px-6 pt-3 text-[9.5px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">
        HAT Investors · Acquisition Intelligence
      </div>

      {/* Visual QA fix pass, Part 1 — HEADER CONSOLIDATION. What used to
          be two stacked bars (LeadDetailHeader + LeadWorkspaceHeader) is
          now ONE sticky identity header. All prior functionality
          (Assigned, Created/Updated, Hot toggle, View Project, Zillow,
          More menu, Live Copilot, Log Outcome) is preserved — just
          consolidated so the address is never split from the rest of the
          lead's identity. EditLeadModal (setEditOpen) still exists below. */}
      <div className="px-6">
        <LeadWorkspaceHeader
          lead={lead}
          members={members}
          canEdit={canEdit}
          canAssign={canAssign}
          onEdit={() => setEditOpen(true)}
          onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
          onCreateProject={handleCreateProject}
          creatingProject={creatingProject}
          workspaceId={workspaceId}
          onLogOutcome={() => setLogOutcomeOpen(true)}
          onOpenLiveCopilot={() => setLiveCopilotOpen(true)}
        />
      </div>

      <div className="px-6 py-4 flex-1 max-w-[1400px] w-full">
        {/* LEVEL 1 — Lead Essentials (Part 3/8/9). Visible regardless of
            active tab; not a replacement for the tabs below it. */}
        <LeadEssentialsBar
          lead={lead}
          userId={user.id}
          members={members}
          canEdit={canEdit}
          onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
          onRequestEnrich={() => setEnrichConfirmOpen(true)}
        />

        {/* Compact Triage Decision Bar V1 — a lightweight workflow gate,
            not another analysis card. Renders only while lead.status ===
            'triage' (auto-imported, not yet decided); disappears the
            instant the lead is promoted/rejected/dismissed. Placed here,
            above the tabs, so the decision is seen early without adding a
            full-width card into Overview (removed from ActionZone below). */}
        <div className="mt-3">
          <TriageDecisionBar
            lead={lead}
            userId={user.id}
            members={members}
            canEdit={canEdit}
            onUpdated={onLeadUpdated}
          />
        </div>

        <LeadWorkspaceTabs active={activeTab} onChange={setActiveTab} readiness={tabReadiness} />

        {/* ══════════════ OVERVIEW — "Should I pursue this, and what now?"
            Phase 2.1 hierarchy: exceptions → decision (AcquisitionCopilot,
            already the one dominant decision surface — not duplicated
            here) → what now (ActionZone) → deal snapshot → seller snapshot
            (off-market) → compact status. A user should understand the
            lead within ~5 seconds without scrolling past all of this. ══ */}
        <div id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={activeTab !== 'overview'} className="space-y-4">
          <DistressBanner lead={lead} onRequestEnrich={() => setEnrichConfirmOpen(true)} />
          <MlsStatusBanner lead={lead} onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))} paused={!!workspace?.settings?.mls_paused} />

          {/* HAT Premium Visual Pass, Part 7 — the ONE dominant decision
              surface. AcquisitionCopilot below is now Deal-Brief-only
              (its old header duplicated this). */}
          <DecisionHero lead={lead} />

          <AcquisitionCopilot lead={lead} onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))} />

          <ActionZone
            lead={lead}
            userId={user.id}
            members={members}
            canEdit={canEdit}
            onUpdated={onLeadUpdated}
          />

          {/* DATA-AWARE, not status-dependent (Final UX Polish mandate) —
              DealSnapshotCompact always renders the same way for every
              lead, adapting to what data exists rather than branching on
              lead.status/'triage'. */}
          <DealSnapshotCompact lead={lead} onOpenDeal={() => setActiveTab('deal')} />

          {isOffMarket && (
            <SellerSnapshotStrip lead={lead} onOpenFull={() => setActiveTab('acquisition')} />
          )}

          {/* LeadStatusPipeline now defaults to its own collapsed
              (gridOpen=false) state (Phase 2.1) — "Current Stage: X
              [Change status]" compactly, full grid still opens on demand,
              every status/action preserved. */}
          <LeadStatusPipeline
            lead={lead}
            members={members}
            userId={user.id}
            workspaceId={workspaceId}
            canEdit={canEdit}
            onUpdated={onLeadUpdated}
          />
        </div>

        {/* ══════════════ DEAL — "Do the economics work and what can we pay?"
            Phase 2.1, Section 6: ANSWER FIRST (DealDecisionCenter — decision
            strip, Flip/BRRRR comparison, recommended strategy, Margin of
            Safety, Path to a Deal, all reusing computeFlipResult/
            computeBrrrrResult/computeStrategyRecommendation), INPUTS SECOND
            (PropertyInfoSection/FinancialSection, unchanged), details last
            (link to AI & Comps for Full Breakdown/comps/notes). Margin of
            Safety and Path to a Deal are MOVED here from DealAnalysisCard,
            not duplicated (hideDecisionSummary below). ══════════════ */}
        <div id="workspace-panel-deal" role="tabpanel" aria-labelledby="workspace-tab-deal" hidden={activeTab !== 'deal'} className="space-y-4">
          <div className="-mt-1 mb-1">
            <div className="text-[11px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Deal Economics &amp; Underwriting</div>
          </div>

          <DealDecisionCenter lead={lead} onRunAnalysis={() => setActiveTab('ai')} underwritingSettings={underwritingSettings} />

          <UnderwritingAssumptionsPanel
            underwritingSettings={underwritingSettings}
            canEditSettings={userRole === 'admin'}
            workspaceId={workspaceId}
          />

          <div className="pt-2">
            <div className="text-[9px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-2">Property &amp; Assumptions</div>
            <div className="space-y-4">
              <PropertyInfoSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={onLeadUpdated}
              />
              <FinancialSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                strategy={dealStrategy}
                underwritingSettings={underwritingSettings}
                onUpdated={onLeadUpdated}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] hover:border-[color:var(--color-accent)] transition-colors"
          >
            <span className="text-[12.5px] font-medium text-[color:var(--color-text)]">
              Full Breakdown, comps, and detailed AI analysis — see AI &amp; Comps
            </span>
            <span className="text-[12px] font-semibold text-[color:var(--color-accent-text)] shrink-0">Open →</span>
          </button>
          <a
            href={(() => {
              const params = new URLSearchParams()
              if (lead.address) params.set('address', lead.address)
              const pp = lead.mao ?? lead.asking_price
              if (pp != null) params.set('pp', pp)
              if (lead.arv != null) params.set('arv', lead.arv)
              if (lead.renovation_cost != null) params.set('reno', lead.renovation_cost)
              if (lead.rent_estimate != null) params.set('rent', lead.rent_estimate)
              return `/deal-analyzer.html?${params.toString()}`
            })()}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] hover:border-[color:var(--color-accent)] transition-colors"
          >
            <span className="text-[13px] font-medium text-[color:var(--color-text)]">
              For scenario modeling and ARV/MAO breakpoint sliders, see the Dashboard
            </span>
            <span className="text-[12px] font-semibold text-[color:var(--color-accent-text)] shrink-0">Open Dashboard →</span>
          </a>
        </div>

        {/* ══════════════ ACQUISITION — market-type-aware execution workspace.
            Phase 2.1, Section 7: on-market gets a real negotiation
            workspace (OnMarketAcquisitionWorkspace) instead of "mostly a
            Contact tab"; off-market keeps the existing, deliberately
            different OffMarketSellerStrategy untouched. ══════════════ */}
        <div id="workspace-panel-acquisition" role="tabpanel" aria-labelledby="workspace-tab-acquisition" hidden={activeTab !== 'acquisition'} className="space-y-4">
          {isOffMarket ? (
            <OffMarketSellerStrategy
              lead={lead}
              userId={user.id}
              members={members}
              canEdit={canEdit}
              onUpdated={onLeadUpdated}
              onOpenLiveCopilot={() => setLiveCopilotOpen(true)}
            />
          ) : (
            <OnMarketAcquisitionWorkspace
              lead={lead}
              userId={user.id}
              members={members}
              canEdit={canEdit}
              onUpdated={onLeadUpdated}
              onOpenActivity={() => setActiveTab('activity')}
            />
          )}
        </div>

        {/* ══════════════ AI & COMPS — "what evidence supports the decision?"
            hideDecisionSummary=true: Margin of Safety / Path to a Deal now
            live in Deal (moved, not duplicated) — this tab keeps the AI
            Conclusion (Detailed Analysis verdict strip), comps, Full
            Breakdown, notes, and Ask AI as the deeper evidence layer. ══ */}
        <div id="workspace-panel-ai" role="tabpanel" aria-labelledby="workspace-tab-ai" hidden={activeTab !== 'ai'} className="space-y-4">
          <ComplsIntelligenceCard lead={lead} underwritingSettings={underwritingSettings} />
          <DealAnalysisCard
            lead={lead}
            userId={user.id}
            canEdit={canEdit}
            underwritingSettings={underwritingSettings}
            onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
            onStrategyChange={setDealStrategy}
            hideDecisionSummary
          />
          <ReportSection lead={lead} />
        </div>

        {/* ══════════════ ACTIVITY — "what has happened with this lead?"
            Timeline is the primary content; Notes/Comments/Attachments are
            the secondary work area around it. ══════════════ */}
        <div id="workspace-panel-activity" role="tabpanel" aria-labelledby="workspace-tab-activity" hidden={activeTab !== 'activity'} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <ActivityTimeline leadId={lead.id} refreshKey={activityRefresh} onCountLoaded={setActivityCount} />
          </div>
          <div className="space-y-4">
            {canEdit && (
              <CommentBox
                leadId={lead.id}
                userId={user.id}
                workspaceId={workspaceId}
                onPosted={() => setActivityRefresh(v => v + 1)}
              />
            )}
            <NotesSection
              lead={lead}
              canEdit={canEdit}
              onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
            />
            <AttachmentsSection leadId={lead.id} userId={user.id} canEdit={canEdit} />
          </div>
        </div>
      </div>

      {/* Live Copilot — mounted at page level, independent of `activeTab`
          (Section 9). Only for off-market leads, matching its existing
          gating (OffMarketSellerStrategy/LiveCopilot itself never rendered
          for on-market leads). */}
      {isOffMarket && liveCopilotOpen && (
        <LiveCopilot
          lead={lead}
          userId={user.id}
          workspaceId={workspaceId}
          members={members}
          canEdit={canEdit}
          onUpdated={onLeadUpdated}
          onClose={() => setLiveCopilotOpen(false)}
        />
      )}

      {logOutcomeOpen && (
        <LogOutcomeModal
          lead={lead}
          userId={user.id}
          members={members}
          onClose={() => setLogOutcomeOpen(false)}
          onSaved={(updated) => { onLeadUpdated(updated); setLogOutcomeOpen(false) }}
        />
      )}

      <LeadForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => { setEditOpen(false); setLead(updated); setActivityRefresh(v => v + 1) }}
        lead={lead}
        workspaceId={workspaceId}
        userId={user.id}
        userRole={userRole}
        members={members}
        workspaceDefaults={workspace.settings}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this lead?"
        message="This will permanently delete the lead and all its scenarios, activities, and attachments."
        confirmLabel="Delete Lead"
        loading={deleting}
      />

      {enrichConfirmOpen && (
        <EnrichContactsModal
          count={1}
          running={enrichRunning}
          onCancel={() => setEnrichConfirmOpen(false)}
          onConfirm={runSingleEnrichment}
        />
      )}
    </>
  )
}
