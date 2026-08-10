import { useEffect, useState } from 'react'
import { useParams, useOutletContext, useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LeadDetailHeader from '../components/lead-detail/LeadDetailHeader'
import ActionZone from '../components/lead-detail/ActionZone'
import LeadStatusPipeline from '../components/lead-detail/LeadStatusPipeline'
import LeadFlowStepper from '../components/lead-detail/LeadFlowStepper'
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

function GroupDivider({ label }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-[9px] font-bold uppercase tracking-widest text-[color:var(--color-text-dim)] shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-[color:var(--color-line)]" />
    </div>
  )
}

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
      <div className="px-6 py-4 space-y-4 flex-1 max-w-[1400px] w-full">
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

        <MlsStatusBanner lead={lead} onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))} paused={!!workspace?.settings?.mls_paused} />

        <DistressBanner lead={lead} />

        <LeadFlowStepper lead={lead} />

        <ActionZone
          lead={lead}
          userId={user.id}
          members={members}
          canEdit={canEdit}
          onUpdated={(updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }}
        />

        <LeadStatusPipeline
          lead={lead}
          members={members}
          userId={user.id}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onUpdated={(updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-6">

            {/* ── Group 1: Evaluate ─────────────────────── */}
            <GroupDivider label="Property" />
            <div id="step-property" className="space-y-4">
              <PropertyInfoSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={(updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }}
              />
            </div>

            <GroupDivider label="Renovation & Financials" />
            <div id="step-renovation" className="space-y-4">
              <FinancialSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={(updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }}
              />
            </div>

            <GroupDivider label="AI Analysis & Notes" />

            {/* ── Group 2: Understand ───────────────────── */}
            <div id="step-analysis" className="space-y-4">
              <DealAnalysisCard
                lead={lead}
                userId={user.id}
                canEdit={canEdit}
                onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
              />
              <NotesSection
                lead={lead}
                canEdit={canEdit}
                onUpdated={(updated) => setLead(prev => ({ ...prev, ...updated }))}
              />
            </div>

            <GroupDivider label="Decision" />
            <div id="step-decision" className="space-y-4">
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

            <GroupDivider label="Contacts & Reports" />

            {/* ── Group 3: Admin ────────────────────────── */}
            <div className="space-y-4">
              <ContactInfoSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={(updated) => { setLead(prev => ({ ...prev, ...updated })); setActivityRefresh(v => v + 1) }}
              />
              <ListingAgentCard lead={lead} />
              <ReportSection lead={lead} />
            </div>

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
            <ActivityTimeline leadId={lead.id} refreshKey={activityRefresh} />
            <AttachmentsSection leadId={lead.id} userId={user.id} canEdit={canEdit} />
          </div>
        </div>
      </div>

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
