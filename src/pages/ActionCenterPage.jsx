// src/pages/ActionCenterPage.jsx
// Capability #5, Cycle 2 — HAT Action Center (MVP).
//
// Answers "what should I work on first today?" automatically, by reading
// data every earlier capability already computed — nothing new is
// calculated here:
//   - derivePriority() (Capability #1/#2, src/lib/leadPriority.js) — Decision,
//     Next Action, Expected Profit, Maximum Offer, Reason
//   - properties.last_rediscovery_status/reason (Capability #3/#4,
//     src/lib/propertyIntelligence.js) — Rediscovered / Improved flags
//   - lead.status (existing field) — Follow Up bucket
// No AI call, no new scoring, no new database table.

import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/calculations'
import { applyLeadVisibility } from '../lib/leadVisibility'
import { TERMINAL_STATUSES } from '../lib/constants'
import { derivePriority, PRIORITY_DISPLAY, PRIORITY_THEME } from '../lib/leadPriority'

const CATEGORY_META = {
  ACT_NOW:           { icon: '🔥', label: 'Act Now',            theme: PRIORITY_THEME.HOT },
  REVIEW_TODAY:      { icon: '🟠', label: 'Review Today',       theme: PRIORITY_THEME.TODAY },
  FOLLOW_UP:         { icon: '🟡', label: 'Follow Up',          theme: { bg: 'var(--color-accent-soft)', border: 'var(--color-accent)', text: 'var(--color-accent-text)' } },
  RECENTLY_IMPROVED: { icon: '⚪', label: 'Recently Improved',  theme: PRIORITY_THEME.WATCH },
}

// Reuses derivePriority + rediscovery status already persisted per lead —
// no recalculation. Classifies each lead into exactly one bucket (or none,
// if it isn't actionable), per the priority order in the spec.
function classifyLead(lead, rediscovery) {
  const priorityInfo = derivePriority(lead.ai_notes)
  if (!priorityInfo && !rediscovery && lead.status !== 'follow_up') return null

  const priceImproved = rediscovery?.status === 'IMPROVED' && /price dropped/i.test(rediscovery.reason || '')

  let category = null
  if (priorityInfo?.priority === 'HOT' || rediscovery?.status === 'REVIEW AGAIN' || priceImproved) {
    category = 'ACT_NOW'
  } else if (priorityInfo?.priority === 'TODAY') {
    category = 'REVIEW_TODAY'
  } else if (lead.status === 'follow_up') {
    category = 'FOLLOW_UP'
  } else if (rediscovery?.status === 'IMPROVED') {
    category = 'RECENTLY_IMPROVED'
  }
  if (!category) return null

  const decision = priorityInfo ? (PRIORITY_DISPLAY[priorityInfo.priority] || priorityInfo.priority) : null
  const nextAction = priorityInfo?.nextAction || (lead.status === 'follow_up' ? 'FOLLOW UP' : null)
  const reason = rediscovery?.reason || priorityInfo?.reasons?.[0] || null

  return {
    category,
    lead,
    decision,
    nextAction,
    expectedProfit: lead.deal_analysis?.profit ?? null,
    maxOffer: lead.mao ?? null,
    reason,
    score: priorityInfo?.confidence ?? null,
    rediscoveredAt: rediscovery?.updatedAt || null,
  }
}

function sortCategory(category, items) {
  switch (category) {
    case 'ACT_NOW':
      return [...items].sort((a, b) => {
        const profitDiff = (b.expectedProfit ?? -Infinity) - (a.expectedProfit ?? -Infinity)
        if (profitDiff !== 0) return profitDiff
        return (b.rediscoveredAt ? new Date(b.rediscoveredAt).getTime() : 0) - (a.rediscoveredAt ? new Date(a.rediscoveredAt).getTime() : 0)
      })
    case 'REVIEW_TODAY':
      return [...items].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    case 'RECENTLY_IMPROVED':
      return [...items].sort((a, b) => (b.rediscoveredAt ? new Date(b.rediscoveredAt).getTime() : 0) - (a.rediscoveredAt ? new Date(a.rediscoveredAt).getTime() : 0))
    case 'FOLLOW_UP':
      return [...items].sort((a, b) => {
        const ad = a.lead.follow_up_date, bd = b.lead.follow_up_date
        if (!ad && !bd) return 0
        if (!ad) return 1
        if (!bd) return -1
        return ad.localeCompare(bd)
      })
    default:
      return items
  }
}

function ActionCard({ item, workspaceId }) {
  const theme = CATEGORY_META[item.category].theme
  return (
    <Link
      to={`/w/${workspaceId}/leads/${item.lead.id}`}
      className="block rounded-lg border overflow-hidden hover:opacity-90 transition-opacity"
      style={{ borderColor: theme.border, background: theme.bg }}
    >
      <div className="px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-[color:var(--color-text)] truncate">{item.lead.address}</div>
            {item.lead.city && <div className="text-[11px] text-[color:var(--color-text-dim)]">{item.lead.city}</div>}
          </div>
          {item.decision && (
            <span className="shrink-0 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ color: theme.text, background: 'var(--color-bg-elev)' }}>
              {item.decision}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2.5 text-[11.5px]">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Next Action</div>
            <div className="font-semibold text-[color:var(--color-text)]">{item.nextAction || '—'}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Expected Profit</div>
            <div className="font-semibold text-[color:var(--color-text)]">{item.expectedProfit != null ? formatCurrency(item.expectedProfit) : '—'}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Maximum Offer</div>
            <div className="font-semibold text-[color:var(--color-text)]">{item.maxOffer != null ? formatCurrency(item.maxOffer) : '—'}</div>
          </div>
        </div>

        {item.reason && (
          <div className="text-[11px] text-[color:var(--color-text-muted)] mt-2 leading-snug">
            <span className="font-semibold text-[color:var(--color-text)]">Reason: </span>{item.reason}
          </div>
        )}
      </div>
    </Link>
  )
}

export default function ActionCenterPage() {
  const { workspace, workspaceId, user, userRole } = useOutletContext()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    async function load() {
      setLoading(true)

      let leadsQ = supabase
        .from('leads')
        .select('id, address, city, status, ai_notes, mao, asking_price, deal_analysis, follow_up_date, updated_at')
        .eq('workspace_id', workspaceId)
        .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
      leadsQ = applyLeadVisibility(leadsQ, user.id, userRole)
      const { data: leads } = await leadsQ
      if (cancelled) return

      // Rediscovery status per lead — Capability #3/#4's `properties` table.
      // Best-effort: if the table/columns aren't present yet (migration not
      // applied), this simply yields no rediscovery data — Action Center
      // still works from Smart Lead Prioritization alone.
      let rediscoveryByLead = {}
      const leadIds = (leads || []).map(l => l.id)
      if (leadIds.length > 0) {
        try {
          const { data: props, error } = await supabase
            .from('properties')
            .select('current_lead_id, last_rediscovery_status, last_rediscovery_reason, updated_at')
            .eq('workspace_id', workspaceId)
            .in('current_lead_id', leadIds)
          if (error) throw error
          rediscoveryByLead = Object.fromEntries(
            (props || [])
              .filter(p => p.current_lead_id)
              .map(p => [p.current_lead_id, { status: p.last_rediscovery_status, reason: p.last_rediscovery_reason, updatedAt: p.updated_at }])
          )
        } catch (err) {
          console.warn('[action-center] rediscovery data unavailable (non-fatal):', err)
        }
      }

      const classified = (leads || [])
        .map(lead => classifyLead(lead, rediscoveryByLead[lead.id]))
        .filter(Boolean)

      if (!cancelled) {
        setItems(classified)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [workspaceId, user.id, userRole])

  if (loading) return <LoadingSpinner fullPage label="Scanning for opportunities…" />

  const byCategory = {
    ACT_NOW: sortCategory('ACT_NOW', items.filter(i => i.category === 'ACT_NOW')),
    REVIEW_TODAY: sortCategory('REVIEW_TODAY', items.filter(i => i.category === 'REVIEW_TODAY')),
    FOLLOW_UP: sortCategory('FOLLOW_UP', items.filter(i => i.category === 'FOLLOW_UP')),
    RECENTLY_IMPROVED: sortCategory('RECENTLY_IMPROVED', items.filter(i => i.category === 'RECENTLY_IMPROVED')),
  }
  const totalCount = items.length

  return (
    <>
      <Topbar title="Action Center" breadcrumbs={[{ label: workspace.name }, { label: 'Action Center' }]} />

      <div className="px-6 py-6 w-full flex-1">
        <div className="pb-5 border-b border-[color:var(--color-line)] mb-6">
          <p className="text-[12px] text-[color:var(--color-text-dim)]">What deserves attention right now</p>
          <h2 className="text-[22px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
            {totalCount === 0 ? 'Nothing needs action right now.' : `${totalCount} propert${totalCount === 1 ? 'y needs' : 'ies need'} your attention.`}
          </h2>
        </div>

        {/* Top summary — 4 numbers only */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {Object.entries(CATEGORY_META).map(([key, meta]) => (
            <div key={key} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 text-center">
              <div className="text-[20px]">{meta.icon}</div>
              <div className="text-[22px] font-bold text-[color:var(--color-text)] tabular-nums mt-0.5">{byCategory[key].length}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mt-0.5">{meta.label}</div>
            </div>
          ))}
        </div>

        {totalCount === 0 ? (
          <EmptyState
            icon="✓"
            title="All clear."
            description="No lead currently meets Act Now, Review Today, Follow Up, or Recently Improved criteria."
          />
        ) : (
          <div className="space-y-6">
            {Object.entries(CATEGORY_META).map(([key, meta]) => {
              const list = byCategory[key]
              if (list.length === 0) return null
              return (
                <section key={key}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[15px]">{meta.icon}</span>
                    <h3 className="text-[13.5px] font-bold uppercase tracking-wide text-[color:var(--color-text)]">{meta.label}</h3>
                    <span className="text-[11px] text-[color:var(--color-text-dim)] tabular-nums">({list.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {list.map(item => (
                      <ActionCard key={item.lead.id} item={item} workspaceId={workspaceId} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
