import { useEffect, useState } from 'react'
import { useParams, useOutletContext, useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LeadDetailHeader from '../components/lead-detail/LeadDetailHeader'
import ActionZone from '../components/lead-detail/ActionZone'
import LeadStatusPipeline from '../components/lead-detail/LeadStatusPipeline'
import PropertyInfoSection from '../components/lead-detail/PropertyInfoSection'
import NotesSection from '../components/lead-detail/NotesSection'
import DealAnalysisCard from '../components/lead-detail/DealAnalysisCard'
import ContactInfoSection from '../components/lead-detail/ContactInfoSection'
import ListingAgentCard from '../components/lead-detail/ListingAgentCard'
import MlsStatusBanner from '../components/lead-detail/MlsStatusBanner'
import DistressBanner from '../components/lead-detail/DistressBanner'
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
import SellerSnapshotStrip from '../components/lead-detail/workspace/SellerSnapshotStrip'

// Lead Workspace redesign, Phase 2 — SAME ENGINE, SAME COMPONENTS, BETTER
// WORKSPACE (mission Section 3). Every child component below still
// receives the exact same props/callbacks it always did; only WHERE they
// render (which tab pane) and the addition of a sticky header/tab shell
// changed. No component was rewritten to produce this layout.

export default function LeadDetailPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
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

      {/* LeadDetailHeader kept exactly as-is (identity + Edit/Delete/Create
          Project) — unmodified component, just repositioned above the new
          sticky decision header instead of being the only header. */}
      <div className="px-6 pt-4">
        <LeadDetailHeader
          lead={lead}
          members={members}
          canEdit={canEdit}
          canAssign={canAssign}
          onEdit={() => setEditOpen(true)}
          onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
          onCreateProject={handleCreateProject}
          creatingProject={creatingProject}
          workspaceId={workspaceId}
        />
      </div>

      <div className="px-6">
        <LeadWorkspaceHeader
          lead={lead}
          dealStrategy={dealStrategy}
          onLogOutcome={() => setLogOutcomeOpen(true)}
          onOpenLiveCopilot={() => setLiveCopilotOpen(true)}
          onScheduleFollowUp={() => setActiveTab('overview')}
        />
      </div>

      <div className="px-6 py-4 flex-1 max-w-[1400px] w-full">
        <LeadWorkspaceTabs active={activeTab} onChange={setActiveTab} />

        {/* ══════════════ OVERVIEW — "Should I pursue this, and what now?" ══════════════ */}
        <div id="workspace-panel-overview" role="tabpanel" aria-labelledby="workspace-tab-overview" hidden={activeTab !== 'overview'} className="space-y-4">
          <DistressBanner lead={lead} />
          <MlsStatusBanner lead={lead} onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))} paused={!!workspace?.settings?.mls_paused} />

          <AcquisitionCopilot lead={lead} onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))} />

          {isOffMarket && (
            <SellerSnapshotStrip lead={lead} onOpenFull={() => setActiveTab('acquisition')} />
          )}

          <ActionZone
            lead={lead}
            userId={user.id}
            members={members}
            canEdit={canEdit}
            onUpdated={onLeadUpdated}
          />

          {/* LeadStatusPipeline already defaults to its own collapsed
              (gridOpen=false) state — kept, not rebuilt, so it stays
              available without dominating Overview. */}
          <LeadStatusPipeline
            lead={lead}
            members={members}
            userId={user.id}
            workspaceId={workspaceId}
            canEdit={canEdit}
            onUpdated={onLeadUpdated}
          />
        </div>

        {/* ══════════════ DEAL / UNDERWRITING — "Do the economics work?" ══════════════
            Scope decision (Phase 1 Section 15 / Phase 2 Section 15): DealAnalysisCard
            mixes deterministic economics with AI evidence/comps in one
            1,483-line component that we are explicitly NOT splitting or
            duplicating in this phase. It is mounted ONCE, in the AI & Comps
            tab (below), since it also owns Run/Refresh Analysis. This tab
            covers underwriting via FinancialSection, which already surfaces
            the canonical Flip/BRRRR MAO, Price Cushion equivalent ("Gap"),
            and profit/cash-flow-at-MAO figures — the "important economics on
            first screen" mission requirement — with a link to the full
            Detailed Analysis / Margin of Safety / Path to Deal breakdown in
            AI & Comps for anyone who wants the full picture. */}
        <div id="workspace-panel-deal" role="tabpanel" aria-labelledby="workspace-tab-deal" hidden={activeTab !== 'deal'} className="space-y-4">
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
            onUpdated={onLeadUpdated}
          />
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] hover:border-[color:var(--color-accent)] transition-colors"
          >
            <span className="text-[12.5px] font-medium text-[color:var(--color-text)]">
              Margin of Safety, Path to a Deal, and Full Breakdown — see AI &amp; Comps
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

        {/* ══════════════ ACQUISITION — market-type-aware, "how do I move this deal?" ══════════════ */}
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
            <>
              <ContactInfoSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={onLeadUpdated}
              />
              <ListingAgentCard lead={lead} />
            </>
          )}
        </div>

        {/* ══════════════ AI & COMPS — "what evidence supports the decision?" ══════════════ */}
        <div id="workspace-panel-ai" role="tabpanel" aria-labelledby="workspace-tab-ai" hidden={activeTab !== 'ai'} className="space-y-4">
          <DealAnalysisCard
            lead={lead}
            userId={user.id}
            canEdit={canEdit}
            onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
            onStrategyChange={setDealStrategy}
          />
          <ReportSection lead={lead} />
        </div>

        {/* ══════════════ ACTIVITY — "what has happened with this lead?" ══════════════ */}
        <div id="workspace-panel-activity" role="tabpanel" aria-labelledby="workspace-tab-activity" hidden={activeTab !== 'activity'} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <NotesSection
              lead={lead}
              canEdit={canEdit}
              onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
            />
            <ActivityTimeline leadId={lead.id} refreshKey={activityRefresh} />
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
    </>
  )
}
