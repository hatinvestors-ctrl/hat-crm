// Draw Reconciliation Dashboard — live summary of HML escrow, contractor payments, lender draws
import { fmtUSD } from '../../lib/dealCalculations'

function Metric({ label, value, sub, color }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</span>
      <span className={`text-[15px] font-bold tabular-nums ${color || 'text-[color:var(--color-text)]'}`}>{value}</span>
      {sub && <span className="text-[10px] text-[color:var(--color-text-dim)]">{sub}</span>}
    </div>
  )
}

export default function DrawReconciliationCard({ loan, draws, payments, scopeItems }) {
  if (!loan) return null

  const rehabEscrow      = Number(loan.rehab_escrow_amount) || 0
  const totalDrawsFunded = draws.filter(d => d.draw_status === 'funded').reduce((s, d) => s + (Number(d.amount_funded) || 0), 0)
  const pendingDraws     = draws.filter(d => ['submitted','inspecting','approved'].includes(d.draw_status)).reduce((s, d) => s + (Number(d.amount_requested) || 0), 0)
  const remainingEscrow  = rehabEscrow - totalDrawsFunded - pendingDraws
  const totalContractorPaid  = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const totalReimbursed      = payments.filter(p => p.reimbursed).reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const hatCashExposed       = totalContractorPaid - totalReimbursed
  const totalScopeBudget     = scopeItems.reduce((s, i) => s + (Number(i.estimated_cost) || 0) + (Number(i.approved_change_order) || 0), 0)
  const totalInvoiced        = scopeItems.reduce((s, i) => s + (Number(i.amount_invoiced) || 0), 0)
  const remainingOwed        = Math.max(0, totalInvoiced - totalContractorPaid)
  const uncommittedEscrow    = rehabEscrow - totalScopeBudget

  // Scope completion (budget-weighted average)
  const totalBudget = scopeItems.reduce((s, i) => s + (Number(i.estimated_cost) || 0), 0)
  const weightedComplete = totalBudget > 0
    ? scopeItems.reduce((s, i) => s + (Number(i.pct_complete) || 0) * (Number(i.estimated_cost) || 0), 0) / totalBudget
    : 0
  const scopePct = Math.round(weightedComplete)

  const exposureColor = hatCashExposed > 25000
    ? 'text-[color:var(--color-danger-text)]'
    : hatCashExposed > 10000
    ? 'text-[color:var(--color-warn-text,#d97706)]'
    : 'text-[color:var(--color-text)]'

  const escrowColor = remainingEscrow < 0
    ? 'text-[color:var(--color-danger-text)]'
    : remainingEscrow < 5000
    ? 'text-[color:var(--color-warn-text,#d97706)]'
    : 'text-[color:var(--color-success-text)]'

  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Draw Reconciliation</span>
        {draws.length > 0 && (
          <span className="text-[10px] text-[color:var(--color-text-dim)]">{draws.filter(d => d.draw_status === 'funded').length} of {draws.length} draws funded</span>
        )}
      </div>

      {/* 6-metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Metric label="Rehab Escrow" value={fmtUSD(rehabEscrow)} sub="lender committed" />
        <Metric label="Draws Funded" value={fmtUSD(totalDrawsFunded)} sub={pendingDraws > 0 ? `+${fmtUSD(pendingDraws)} pending` : undefined} />
        <Metric label="Remaining Escrow" value={fmtUSD(remainingEscrow)} color={escrowColor} sub={uncommittedEscrow > 0 ? `${fmtUSD(uncommittedEscrow)} unallocated` : undefined} />
        <Metric label="Paid to Contractors" value={fmtUSD(totalContractorPaid)} />
        <Metric label="HAT Cash Exposed" value={fmtUSD(hatCashExposed)} color={exposureColor} sub="paid but not reimbursed" />
        <Metric label="Remaining Owed" value={fmtUSD(remainingOwed)} sub="invoiced but unpaid" />
      </div>

      {/* Alerts */}
      {hatCashExposed > 25000 && (
        <div className="text-[11px] px-3 py-2 rounded bg-[color:var(--color-danger-soft,#fee2e2)] text-[color:var(--color-danger-text)] border border-[color:var(--color-danger-text)]/20">
          ⚠ HAT cash exposure is high ({fmtUSD(hatCashExposed)}). Submit a lender draw request to reduce float.
        </div>
      )}
      {remainingEscrow < 0 && (
        <div className="text-[11px] px-3 py-2 rounded bg-[color:var(--color-danger-soft,#fee2e2)] text-[color:var(--color-danger-text)] border border-[color:var(--color-danger-text)]/20">
          ⚠ Draws exceed rehab escrow by {fmtUSD(Math.abs(remainingEscrow))}. Over-drawn — contact lender immediately.
        </div>
      )}
      {uncommittedEscrow < 0 && remainingEscrow >= 0 && (
        <div className="text-[11px] px-3 py-2 rounded bg-[color:var(--color-warn-soft,#fef3c7)] text-[color:var(--color-warn-text,#92400e)] border border-[color:var(--color-warn-text,#92400e)]/20">
          ⚠ Scope budget ({fmtUSD(totalScopeBudget)}) exceeds rehab escrow ({fmtUSD(rehabEscrow)}) by {fmtUSD(Math.abs(uncommittedEscrow))}. HAT covers the gap.
        </div>
      )}

      {/* Scope progress bar */}
      {scopeItems.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-[color:var(--color-text-dim)]">
            <span>Scope Completion</span>
            <span>{scopePct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[color:var(--color-bg-elev-2)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[color:var(--color-accent)] transition-all duration-300"
              style={{ width: `${scopePct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
