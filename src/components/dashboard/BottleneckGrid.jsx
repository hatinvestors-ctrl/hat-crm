import { Link } from 'react-router-dom'
import Card from '../ui/Card'

function ageDays(iso) {
  if (!iso) return 0
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function Stage({ label, leads, viewId, workspaceId, hint, tone = 'neutral', threshold = 7 }) {
  const ages = leads.map(l => ageDays(l.updated_at)).sort((a, b) => a - b)
  const avgAge = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0
  const oldest = ages.length ? ages[ages.length - 1] : 0
  const stale = leads.filter(l => ageDays(l.updated_at) >= threshold).length

  const toneCls = {
    accent:  'border-l-[color:var(--color-accent)]',
    warn:    'border-l-[color:var(--color-warn)]',
    danger:  'border-l-[color:var(--color-danger)]',
    neutral: 'border-l-[color:var(--color-text-dim)]',
  }[tone]

  return (
    <Link
      to={`/w/${workspaceId}/leads${viewId ? `?view=${viewId}` : ''}`}
      className={`block bg-[color:var(--color-bg)] rounded-md border border-[color:var(--color-line)] border-l-4 ${toneCls} p-3 hover:bg-[color:var(--color-bg-elev-2)] transition-colors`}
    >
      <div className="text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <div className="text-[22px] font-semibold tabular-nums leading-none text-[color:var(--color-text)]">{leads.length}</div>
        <div className="text-[11px] text-[color:var(--color-text-muted)]">leads</div>
      </div>
      <div className="mt-1 text-[11px] text-[color:var(--color-text-dim)] leading-snug">
        {leads.length === 0 ? (
          <>—</>
        ) : (
          <>
            avg <span className="tabular-nums text-[color:var(--color-text-muted)]">{avgAge}d</span>
            <span className="mx-1.5">·</span>
            oldest <span className="tabular-nums text-[color:var(--color-text-muted)]">{oldest}d</span>
            {stale > 0 && (
              <>
                <span className="mx-1.5">·</span>
                <span className="text-[color:var(--color-warn-text)]">{stale} stuck</span>
              </>
            )}
          </>
        )}
      </div>
      {hint && <div className="mt-1 text-[10.5px] text-[color:var(--color-text-dim)] italic">{hint}</div>}
    </Link>
  )
}

export default function BottleneckGrid({ workspaceId, leadsByStatus }) {
  return (
    <Card title="Workflow bottlenecks">
      <div className="text-[11.5px] text-[color:var(--color-text-muted)] mb-3 leading-relaxed">
        Where leads are sitting right now. Click any tile to open the matching list.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <Stage
          label="Triage"
          leads={leadsByStatus.triage || []}
          viewId="status_triage"
          workspaceId={workspaceId}
          tone="warn"
          threshold={2}
          hint="Auto-imports waiting to be qualified"
        />
        <Stage
          label="To MAO"
          leads={leadsByStatus.new_lead || []}
          viewId="status_new_lead"
          workspaceId={workspaceId}
          tone="neutral"
          threshold={3}
          hint="New — run MAO calc"
        />
        <Stage
          label="Waiting for HAT signature"
          leads={leadsByStatus.offer_pending_hat_signing || []}
          viewId="status_offer_pending_hat_signing"
          workspaceId={workspaceId}
          tone="accent"
          threshold={3}
          hint="Chase HAT"
        />
        <Stage
          label="To send → seller"
          leads={leadsByStatus.offer_signed || []}
          viewId="status_offer_signed"
          workspaceId={workspaceId}
          tone="accent"
          threshold={2}
          hint="Signed — send to seller"
        />
        <Stage
          label="Awaiting seller reply"
          leads={leadsByStatus.offer_sent || []}
          viewId="status_offer_sent"
          workspaceId={workspaceId}
          tone="warn"
          threshold={3}
          hint="Sent — chase or move forward"
        />
        <Stage
          label="MAO calculated"
          leads={leadsByStatus.mao_calculated || []}
          viewId="status_mao_calculated"
          workspaceId={workspaceId}
          tone="neutral"
          threshold={3}
          hint="Decide: send to HAT, or pass"
        />
        <Stage
          label="Negotiating"
          leads={leadsByStatus.negotiating || []}
          viewId="status_negotiating"
          workspaceId={workspaceId}
          tone="warn"
          threshold={7}
          hint="Push to close"
        />
        <Stage
          label="Accepted → closing"
          leads={leadsByStatus.offer_accepted || []}
          viewId="status_offer_accepted"
          workspaceId={workspaceId}
          tone="accent"
          threshold={14}
          hint="Track to closing"
        />
        <Stage
          label="Follow-up scheduled"
          leads={leadsByStatus.follow_up || []}
          viewId="status_follow_up"
          workspaceId={workspaceId}
          tone="neutral"
          threshold={0}
        />
        <Stage
          label="Working project"
          leads={leadsByStatus.working_project || []}
          viewId="status_working_project"
          workspaceId={workspaceId}
          tone="accent"
          threshold={30}
          hint="Owned / under renovation"
        />
      </div>
    </Card>
  )
}
