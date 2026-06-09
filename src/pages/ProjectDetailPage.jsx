import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useOutletContext, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor, DEAL_RATING_INFO } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import Card from '../components/ui/Card'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import DealRenovationItems from '../components/lead-detail/DealRenovationItems'
import DealImportModal from '../components/lead-detail/DealImportModal'

const labelCls = 'text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] block mb-0.5'
const inputCls = 'w-full h-8 px-2 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'
const calcDisplayCls = 'h-8 px-2 flex items-center text-[12px] rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]'

// Calculated display with an expandable breakdown popover (fixed-position to avoid clip)
function CalcDisplay({ value, lines = [], className = '' }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const hasLines = lines.length > 0

  const toggle = () => {
    if (pos) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, left: r.left })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    window.addEventListener('click', close, true)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close, true); window.removeEventListener('scroll', close, true) }
  }, [pos])

  return (
    <div className="relative">
      <div className={`${calcDisplayCls} ${className} pr-1 gap-1`}>
        <span className="flex-1">{value}</span>
        {hasLines && (
          <button
            ref={btnRef}
            onClick={e => { e.stopPropagation(); toggle() }}
            className={`shrink-0 w-5 h-5 rounded text-[10px] flex items-center justify-center transition-colors ${
              pos
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'text-[color:var(--color-text-dim)] hover:bg-[color:var(--color-bg-elev)] hover:text-[color:var(--color-text)]'
            }`}
            title="Show breakdown"
          >
            {pos ? '−' : '+'}
          </button>
        )}
      </div>
      {pos && hasLines && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-64 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg)] shadow-xl p-3 space-y-1"
        >
          {lines.map((line, i) => (
            line === '---'
              ? <div key={i} className="border-t border-[color:var(--color-line)] my-1.5" />
              : <div key={i} className={`flex justify-between text-[11px] ${line.bold ? 'font-semibold text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}`}>
                  <span className="truncate pr-2">{line.label}</span>
                  <span className="shrink-0 tabular-nums">{line.value}</span>
                </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, children, tip }) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {tip && (
          <span title={tip} className="ml-1 cursor-help opacity-50 hover:opacity-100 normal-case tracking-normal font-normal">ⓘ</span>
        )}
      </label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, onBlur, disabled, placeholder }) {
  const [local, setLocal] = useState(value ?? '')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setLocal(value ?? '') }, [value])
  const handleChange = (e) => {
    setLocal(e.target.value)
    const num = Number(e.target.value)
    if (e.target.value !== '' && !isNaN(num)) onChange?.(num)
  }
  const handleBlur = async (e) => {
    await onBlur?.(e.target.value)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <div className="relative">
      <input
        type="number"
        value={local}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder || '0'}
        className={inputCls}
      />
      {saved && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--color-success-text)] pointer-events-none animate-pulse">✓</span>
      )}
    </div>
  )
}

function MetricRow({ label, value, highlight, positive, negative }) {
  const valueColor = positive
    ? 'text-[color:var(--color-success-text)]'
    : negative
      ? 'text-[color:var(--color-danger-text)]'
      : highlight
        ? 'text-[color:var(--color-text)]'
        : 'text-[color:var(--color-text-muted)]'
  return (
    <div className={`flex justify-between items-center py-1.5 border-b border-[color:var(--color-line)] text-[12px] last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-[color:var(--color-text-dim)]">{label}</span>
      <span className={valueColor}>{value}</span>
    </div>
  )
}

// Live calculation panel — shown sticky on the right
function LiveCalcPanel({ calc, financials, ratingKey, ratingInfo }) {
  if (!calc) return (
    <div className="text-[12px] text-[color:var(--color-text-dim)] py-6 text-center">
      Fill in deal details to see live calculations.
    </div>
  )

  const dim   = 'text-[color:var(--color-text-dim)]'
  const muted = 'text-[color:var(--color-text-muted)]'
  const bold  = 'font-semibold text-[color:var(--color-text)]'

  const Row = ({ label, value, indent = 0, total = false, positive, negative, divider = false }) => (
    <>
      {divider && <div className="my-2 border-t border-[color:var(--color-line)]" />}
      <div className={`flex justify-between items-baseline py-[3px] text-[11.5px] ${total ? 'font-semibold border-t border-[color:var(--color-line)] mt-1 pt-2' : ''}`}
        style={{ paddingLeft: indent * 12 }}>
        <span className={total ? 'text-[color:var(--color-text)]' : dim}>{label}</span>
        <span className={
          positive ? 'text-[color:var(--color-success-text)] font-semibold' :
          negative ? 'text-[color:var(--color-danger-text)] font-semibold' :
          total ? bold : muted
        }>{value}</span>
      </div>
    </>
  )

  const holdMo = calc.holdMonths || 0
  const profitResult = calc.actual || calc.expected

  return (
    <div className="space-y-5 text-[11.5px]">

      {/* ── All-In Cost ── */}
      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">All-In Cost</div>

        <Row label="Purchase Price" value={fmtUSD(financials?.purchase_price_actual)} />

        <Row label="Purchase Closing Costs" value="" divider />
        <Row label="Title & Closing" value={fmtUSD(calc.purchaseClosing)} indent={1} />
        <Row label="  Subtotal" value={fmtUSD(calc.purchaseClosing)} indent={1} total />

        <Row label="Lender Fees at Closing" value="" divider />
        <Row label="Points" value={fmtUSD(calc.pointsCost)} indent={1} />
        <Row label="Title Insurance" value={fmtUSD(financials?.title_lender_insurance)} indent={1} />
        <Row label="Doc Stamps" value={fmtUSD(financials?.doc_stamps_mortgage)} indent={1} />
        <Row label="Intangible Tax" value={fmtUSD(financials?.intangible_tax)} indent={1} />
        <Row label="Interest Portion" value={fmtUSD(financials?.interest_portion)} indent={1} />
        {(financials?.extension_fee > 0) && <Row label="Extension Fee" value={fmtUSD(financials?.extension_fee)} indent={1} />}
        <Row label="  Subtotal" value={fmtUSD(calc.hmlClosingCosts)} indent={1} total />

        <Row label={`Lender Monthly Payments (×${holdMo}mo)`} value="" divider />
        <Row label="Monthly Interest" value={fmtUSD(calc.monthlyInterest)} indent={1} />
        <Row label={`  × ${holdMo} months`} value={fmtUSD(calc.totalInterest)} indent={1} total />

        <Row label="Renovation" value="" divider />
        <Row label="Total Renovation Cost" value={fmtUSD(calc.totalRenovationCost)} indent={1} />

        <Row label={`Other Holding Costs (×${holdMo}mo)`} value="" divider />
        <Row label="Insurance + Utilities + Taxes + HOA + Misc" value={fmtUSD(calc.monthlyHoldCosts)} indent={1} />
        <Row label={`  × ${holdMo} months`} value={fmtUSD(calc.monthlyHoldCosts * holdMo)} indent={1} total />

        <div className="mt-3 pt-2 border-t-2 border-[color:var(--color-text)] flex justify-between font-bold text-[13px]">
          <span className="text-[color:var(--color-text)]">= Total All-In Cost</span>
          <span className="text-[color:var(--color-text)]">{fmtUSD(calc.totalAllInCost)}</span>
        </div>
      </div>

      {/* ── Cash at Closing ── */}
      <div className="border-t border-[color:var(--color-line)] pt-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">Total Cash Invested</div>
        <Row label={`Down Payment (${fmtPct(1 - (financials?.loan_to_purchase_pct ?? 0.9))})`} value={fmtUSD(calc.downPayment)} />
        <Row label="+ Lender Fees at Closing" value={fmtUSD(calc.hmlClosingCosts)} />
        <Row label="+ Purchase Closing Costs" value={fmtUSD(calc.purchaseClosing)} />
        {calc.renovationGap > 0 && <Row label="+ Renovation Gap (cash portion)" value={fmtUSD(calc.renovationGap)} />}
        <Row
          label={`+ Interest Paid (${calc.holdMonths}mo × ${fmtUSD(calc.monthlyInterest)})`}
          value={fmtUSD(calc.totalInterest)}
        />
        {calc.monthlyHoldCosts > 0 && (
          <Row
            label={`+ Other Holding (${calc.holdMonths}mo × ${fmtUSD(calc.monthlyHoldCosts)})`}
            value={fmtUSD(calc.monthlyHoldCosts * calc.holdMonths)}
          />
        )}
        <div className="mt-2 pt-2 border-t border-[color:var(--color-line)] flex justify-between font-bold text-[12px]">
          <span className="text-[color:var(--color-text)]">= Total Cash Invested</span>
          <span className="text-[color:var(--color-text)]">{fmtUSD(calc.totalCashInvested)}</span>
        </div>
        <div className="mt-1 flex justify-between text-[11px]">
          <span className={dim}>Break-Even Sale Price</span>
          <span className={muted}>{fmtUSD(calc.breakEvenPrice)}</span>
        </div>
      </div>

      {/* ── Profit & ROI ── */}
      {profitResult && (
        <div className="border-t border-[color:var(--color-line)] pt-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">
            {calc.actual ? '✓ Actual Profit' : 'Expected Profit'}
          </div>
          <Row label="Sale Price" value={fmtUSD(profitResult.sellPrice)} />
          <Row label="Selling Costs" value="" divider />
          {calc.agentCommissionPct > 0 && (
            <Row label={`Listing Agent (${fmtPct(calc.agentCommissionPct)})`} value={`− ${fmtUSD(profitResult.sellPrice * calc.agentCommissionPct)}`} indent={1} />
          )}
          {calc.buyerAgentPct > 0 && (
            <Row label={`Buyer's Agent (${fmtPct(calc.buyerAgentPct)})`} value={`− ${fmtUSD(profitResult.sellPrice * calc.buyerAgentPct)}`} indent={1} />
          )}
          {calc.sellingClosingPct > 0 && (
            <Row label={`Title & Closing (${fmtPct(calc.sellingClosingPct)})`} value={`− ${fmtUSD(profitResult.sellPrice * calc.sellingClosingPct)}`} indent={1} />
          )}
          {calc.sellingOtherPct > 0 && (
            <Row label={`Other (${fmtPct(calc.sellingOtherPct)})`} value={`− ${fmtUSD(profitResult.sellPrice * calc.sellingOtherPct)}`} indent={1} />
          )}
          <Row label={`  Total (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(profitResult.sellingCosts)}`} indent={1} total />
          <Row label="− Total All-In Cost" value={`− ${fmtUSD(calc.totalAllInCost)}`} />
          {calc.isJV && profitResult.totalDealProfit != null && (
            <div className="mt-2 pt-2 border-t border-[color:var(--color-line)] flex justify-between text-[12px]">
              <span className={dim}>= Total Deal Profit</span>
              <span className={profitResult.totalDealProfit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
                {fmtUSD(profitResult.totalDealProfit)}
              </span>
            </div>
          )}
          <div className={`${calc.isJV ? 'mt-1' : 'mt-2 pt-2 border-t border-[color:var(--color-line)]'} flex justify-between font-bold text-[13px]`}>
            <span className="text-[color:var(--color-text)]">
              {calc.isJV ? `= Your Share (${Math.round(calc.jvSplitPct * 100)}%)` : '= Net Profit'}
            </span>
            <span className={profitResult.netProfit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
              {fmtUSD(profitResult.netProfit)}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-[12px] font-semibold">
            <span className={dim}>ROI on Cash</span>
            <span className={profitResult.roi >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
              {fmtPct(profitResult.roi)}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between text-[11px]">
            <span className={dim}>Annualized ROI ({calc.holdMonths}mo)</span>
            <span className={profitResult.annualizedRoi >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
              {fmtPct(profitResult.annualizedRoi)}
            </span>
          </div>
        </div>
      )}

      {/* ── Deal Rating ── */}
      {ratingKey && (
        <div className="border-t border-[color:var(--color-line)] pt-4">
          <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg w-full ${dealRatingColor(calc.dealRating)}`}>
            <span className="text-[20px] font-bold">{ratingKey}</span>
            <div>
              <div className="text-[12px] font-semibold">{ratingInfo?.label}</div>
              <div className="text-[10px] opacity-80">{ratingInfo?.description}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Hero stat box
function StatBox({ label, value, sub, color }) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
      <div className={`text-[18px] font-bold leading-tight ${color || 'text-[color:var(--color-text)]'}`}>{value}</div>
      {sub && <div className="text-[10px] text-[color:var(--color-text-dim)] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function ProjectDetailPage() {
  const { leadId } = useParams()
  const { workspace, workspaceId, userRole } = useOutletContext()
  const navigate = useNavigate()
  const canEdit = userRole !== 'readonly'

  const [lead, setLead]             = useState(null)
  const [financials, setFinancials] = useState(null)
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingRenovCost, setPendingRenovCost] = useState(null)
  const [hmlFeesOpen, setHmlFeesOpen] = useState(false) // live update while typing new reno item
  const [markSoldOpen, setMarkSoldOpen] = useState(false)
  const [soldPrice, setSoldPrice]   = useState('')
  const [soldDate, setSoldDate]     = useState('')
  const [markingSOld, setMarkingSold] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingAddress, setEditingAddress] = useState(false)
  const [addressDraft, setAddressDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: fin }, { data: reno }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('deal_financials').select('*').eq('lead_id', leadId).maybeSingle(),
      supabase.from('deal_renovation_items').select('*').eq('lead_id', leadId).order('sort_order'),
    ])
    setLead(l || null)
    setFinancials(fin || null)
    setItems(reno || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const reloadItems = useCallback(async () => {
    const { data: reno } = await supabase
      .from('deal_renovation_items').select('*').eq('lead_id', leadId).order('sort_order')
    setItems(reno || [])
  }, [leadId])

  // Keep a ref to financials.id so save() never goes stale
  const financialsIdRef = useRef(null)
  useEffect(() => { financialsIdRef.current = financials?.id }, [financials?.id])

  const save = useCallback(async (changes) => {
    if (!financialsIdRef.current) return
    setFinancials(prev => ({ ...prev, ...changes, updated_at: new Date().toISOString() }))
    await supabase.from('deal_financials').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', financialsIdRef.current)
  }, [])

  // Live update — updates calc immediately as the user types, without saving to DB
  const handleLive = (field) => (num) => setFinancials(prev => prev ? { ...prev, [field]: num } : prev)

  const handleBlur = (field) => (value) => save({ [field]: value === '' ? null : Number(value) })
  const handleSelect = (field) => (e) => save({ [field]: e.target.value })

  const handleApply = async (values) => {
    setFinancials(prev => ({ ...prev, ...values, updated_at: new Date().toISOString() }))
    await supabase.from('deal_financials').update({ ...values, updated_at: new Date().toISOString() }).eq('id', financials.id)
    setImportOpen(false)
  }

  const handleMarkSold = async () => {
    if (!soldPrice) return
    setMarkingSold(true)
    const { data: updatedLead } = await supabase
      .from('leads').update({ status: 'sold' }).eq('id', leadId).select().single()

    // Auto-calculate hold months if we have both purchase_date and sold_date
    let autoHoldMonths = financials.hold_months
    const closingDate = soldDate || null
    if (financials.purchase_date && closingDate) {
      const purchase = new Date(financials.purchase_date)
      const closing  = new Date(closingDate)
      const diffMs   = closing - purchase
      autoHoldMonths = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.44))
    }

    const updates = {
      actual_sale_price: Number(soldPrice),
      sold_date: closingDate,
      hold_months: autoHoldMonths,
      updated_at: new Date().toISOString(),
    }
    await supabase.from('deal_financials').update(updates).eq('id', financials.id)
    setMarkingSold(false)
    setMarkSoldOpen(false)
    if (updatedLead) setLead(updatedLead)
    setFinancials(prev => ({ ...prev, ...updates }))
  }

  if (loading) return <LoadingSpinner fullPage label="Loading project…" />
  if (!lead) return <div className="p-6 text-[color:var(--color-text-muted)]">Project not found.</div>

  const handleSaveAddress = async () => {
    const trimmed = addressDraft.trim()
    if (!trimmed || trimmed === lead.address) { setEditingAddress(false); return }
    await supabase.from('leads').update({ address: trimmed }).eq('id', leadId)
    setLead(prev => ({ ...prev, address: trimmed }))
    setEditingAddress(false)
  }

  const handleDeleteProject = async () => {
    setDeleting(true)
    await supabase.from('deal_renovation_items').delete().eq('lead_id', leadId)
    await supabase.from('deal_financials').delete().eq('lead_id', leadId)
    await supabase.from('leads').update({ status: 'follow_up' }).eq('id', leadId)
    navigate(`/w/${workspaceId}/projects`)
  }

  // When user is typing a new reno item (not saved yet), add pending cost to items for live calc
  const calcItems = pendingRenovCost != null
    ? [...items, { estimated_cost: pendingRenovCost, actual_cost: null }]
    : items
  const calc = financials ? calcDeal(financials, calcItems) : null
  const isSold = lead.status === 'sold'
  const ratingKey = calc?.dealRating?.charAt(0)
  const ratingInfo = DEAL_RATING_INFO[ratingKey]

  return (
    <>
      <Topbar
        title={lead.address || 'Project'}
        breadcrumbs={[
          { label: workspace?.name, to: `/w/${workspaceId}` },
          { label: 'Projects', to: `/w/${workspaceId}/projects` },
          { label: lead.address || 'Project' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && !isSold && financials && (
              <button
                onClick={() => setMarkSoldOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] hover:brightness-95 transition"
              >
                ✓ Mark as Sold
              </button>
            )}
            <Link
              to={`/w/${workspaceId}/leads/${leadId}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
            >
              View Lead ↗
            </Link>
            {canEdit && (
              <button
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] hover:brightness-95 transition"
              >
                Delete Project
              </button>
            )}
          </div>
        }
      />

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-line)] rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-[14px] font-semibold text-[color:var(--color-text)]">Delete Project?</h2>
            <p className="text-[12px] text-[color:var(--color-text-muted)]">
              This will remove all financial data and renovation items for <strong>{lead.address}</strong>. The lead will be kept and set back to <em>Follow Up</em>.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                className="h-8 px-4 text-[12.5px] rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="h-8 px-4 text-[12.5px] font-medium rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] hover:brightness-95 transition disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-4 max-w-[1400px] w-full">

        {/* Status + editable address */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
            isSold
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
              : 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
          }`}>
            {isSold ? '✓ Sold' : 'Active Project'}
          </span>
          {financials?.purchase_date && (
            <span className="text-[11.5px] text-[color:var(--color-text-dim)]">
              Purchased <strong className="text-[color:var(--color-text-muted)]">{financials.purchase_date}</strong>
              {isSold && financials.sold_date && (
                <> · Sold <strong className="text-[color:var(--color-text-muted)]">{financials.sold_date}</strong>
                  {' · '}<strong className="text-[color:var(--color-text-muted)]">{financials.hold_months}mo hold</strong>
                </>
              )}
            </span>
          )}
          {canEdit && (
            editingAddress ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={addressDraft}
                  onChange={e => setAddressDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveAddress(); if (e.key === 'Escape') setEditingAddress(false) }}
                  className="h-8 px-2 text-[13px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none w-80"
                />
                <button onClick={handleSaveAddress} className="h-8 px-3 text-[12px] rounded bg-[color:var(--color-accent)] text-white font-medium">Save</button>
                <button onClick={() => setEditingAddress(false)} className="h-8 px-3 text-[12px] rounded border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => { setAddressDraft(lead.address || ''); setEditingAddress(true) }}
                className="text-[12px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] underline decoration-dotted transition"
                title="Edit address"
              >
                {lead.address} ✎
              </button>
            )
          )}
        </div>

        {/* Mark as Sold inline dialog */}
        {markSoldOpen && (
          <div className="rounded-lg border border-[color:var(--color-success)] bg-[color:var(--color-success-soft)] p-4 space-y-3">
            <div className="text-[13px] font-semibold text-[color:var(--color-success-text)]">Mark this project as sold</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Actual Sale Price *">
                <input
                  type="number"
                  value={soldPrice}
                  onChange={e => setSoldPrice(e.target.value)}
                  placeholder="Enter sale price"
                  className={inputCls}
                  autoFocus
                />
              </Field>
              <Field label="Closing Date">
                <input
                  type="date"
                  value={soldDate}
                  onChange={e => setSoldDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            {/* Auto-calculated hold months preview */}
            {financials.purchase_date && soldDate && (() => {
              const purchase = new Date(financials.purchase_date)
              const closing  = new Date(soldDate)
              const months   = Math.round((closing - purchase) / (1000 * 60 * 60 * 24 * 30.44))
              return (
                <div className="text-[12px] text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)] border border-[color:var(--color-success)] rounded-lg px-3 py-2">
                  Hold time will be auto-calculated: <strong>{months} months</strong> (from {financials.purchase_date} to {soldDate})
                </div>
              )
            })()}
            <div className="flex gap-2">
              <button
                onClick={handleMarkSold}
                disabled={!soldPrice || markingSOld}
                className="h-8 px-4 text-[12.5px] font-medium rounded-md bg-[color:var(--color-success)] text-white hover:brightness-110 disabled:opacity-50 transition"
              >
                {markingSOld ? 'Saving…' : 'Confirm Sale'}
              </button>
              <button
                onClick={() => setMarkSoldOpen(false)}
                className="h-8 px-4 text-[12.5px] rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Two-column layout: forms left, live calc panel right */}
        <div className="flex gap-5 items-start">
        {/* ── Left column: forms ── */}
        <div className="flex-1 min-w-0 space-y-4">

        {/* ── Hero summary strip ── */}
        {calc && (
          <div className="flex gap-3 flex-wrap">
            <StatBox
              label="Purchase Price"
              value={fmtUSD(financials?.purchase_price_actual)}
            />
            <StatBox
              label="Total All-In Cost"
              value={fmtUSD(calc.totalAllInCost)}
            />
            <StatBox
              label="Cash Invested"
              value={fmtUSD(calc.totalCashInvested)}
              sub="at closing"
            />
            {(calc.actual || calc.expected) && calc.isJV && (
              <StatBox
                label={calc.actual ? 'Total Deal Profit' : 'Total Deal Profit (exp.)'}
                value={fmtUSD(calc.actual?.totalDealProfit ?? calc.expected?.totalDealProfit)}
                sub="full deal before split"
                color="text-[color:var(--color-text-muted)]"
              />
            )}
            {(calc.actual || calc.expected) && (
              <StatBox
                label={calc.isJV
                  ? (calc.actual ? `Your Share (${Math.round(calc.jvSplitPct*100)}%)` : `Your Share (${Math.round(calc.jvSplitPct*100)}%) exp.`)
                  : (calc.actual ? 'Actual Profit' : 'Expected Profit')}
                value={fmtUSD(calc.actual?.netProfit ?? calc.expected?.netProfit)}
                color={(calc.actual?.netProfit ?? calc.expected?.netProfit) >= 0
                  ? 'text-[color:var(--color-success-text)]'
                  : 'text-[color:var(--color-danger-text)]'}
              />
            )}
            {(calc.actual || calc.expected) && (
              <StatBox
                label={calc.actual ? 'Actual ROI' : 'Expected ROI'}
                value={fmtPct(calc.actual?.roi ?? calc.expected?.roi)}
                sub={`${fmtPct(calc.actual?.annualizedRoi ?? calc.expected?.annualizedRoi)} annualized`}
                color={(calc.actual?.roi ?? calc.expected?.roi) >= 0
                  ? 'text-[color:var(--color-success-text)]'
                  : 'text-[color:var(--color-danger-text)]'}
              />
            )}
            {calc.dealRating && (
              <div className="flex-1 min-w-0 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Deal Rating</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[20px] font-bold ${dealRatingColor(calc.dealRating)} px-2 py-0.5 rounded`}>
                    {ratingKey}
                  </span>
                  <div>
                    <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{ratingInfo?.label}</div>
                    <div className="text-[10px] text-[color:var(--color-text-dim)]">{ratingInfo?.description}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        {calc?.warnings?.map((w, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[oklch(0.97_0.04_80)] border border-[oklch(0.85_0.08_80)] text-[12px] text-[oklch(0.45_0.12_80)]">
            ⚠ {w}
          </div>
        ))}

        {/* Property Summary */}
        <Card title="Property Summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Static lead info */}
            {[
              { label: 'Address',      value: [lead.address, lead.city, lead.state].filter(Boolean).join(', ') || '—' },
              { label: 'Beds / Baths', value: [lead.bedrooms && `${lead.bedrooms} bd`, lead.bathrooms && `${lead.bathrooms} ba`].filter(Boolean).join(' / ') || '—' },
              { label: 'Sqft',         value: lead.square_feet ? Number(lead.square_feet).toLocaleString() : '—' },
              { label: 'Year Built',   value: lead.year_built || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className={labelCls}>{label}</div>
                <div className="text-[12px] text-[color:var(--color-text)]">{value}</div>
              </div>
            ))}
            {/* Editable financial fields — from deal_financials, not the stale lead record */}
            {financials && (
              <>
                <Field label="Purchase Price" tip="Actual purchase price — updates deal calculations">
                  <NumInput
                    value={financials.purchase_price_actual}
                    onChange={handleLive('purchase_price_actual')}
                    onBlur={handleBlur('purchase_price_actual')}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="ARV (Expected Sale Price)" tip="After Repair Value — your expected sale price, used for all profit calculations">
                  <NumInput
                    value={financials.expected_sell_price}
                    onChange={handleLive('expected_sell_price')}
                    onBlur={handleBlur('expected_sell_price')}
                    disabled={!canEdit}
                  />
                </Field>
              </>
            )}
            {[
              { label: 'Listing Agent', value: lead.listing_agent_name || '—' },
              { label: 'Agent Phone',   value: lead.listing_agent_phone || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className={labelCls}>{label}</div>
                <div className="text-[12px] text-[color:var(--color-text)]">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        {!financials ? (
          <Card>
            <div className="py-8 text-center text-[13px] text-[color:var(--color-text-muted)]">
              No financial data found for this project.
            </div>
          </Card>
        ) : (
          <>
            {/* Deal Parameters (formerly Assumptions) */}
            <Card title="Deal Parameters">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Purchase Date" tip="Date you closed on the property. Used to auto-calculate hold time when sold.">
                  <input
                    type="date"
                    defaultValue={financials.purchase_date || ''}
                    onBlur={e => save({ purchase_date: e.target.value || null })}
                    disabled={!canEdit}
                    className={inputCls}
                  />
                </Field>
                <Field label="Hold Months" tip={financials.purchase_date ? 'Auto-calculated from purchase date when sold' : 'Estimated hold time'}>
                  <NumInput value={financials.hold_months} onChange={handleLive('hold_months')} onBlur={handleBlur('hold_months')} disabled={!canEdit} placeholder="5" />
                </Field>
                <Field label="Loan-to-Purchase % (LTV)">
                  <NumInput
                    value={financials.loan_to_purchase_pct != null ? financials.loan_to_purchase_pct * 100 : ''}
                    onChange={n => setFinancials(prev => prev ? {...prev, loan_to_purchase_pct: n / 100} : prev)} onBlur={v => save({ loan_to_purchase_pct: v === '' ? null : Number(v) / 100 })}
                    disabled={!canEdit} placeholder="90"
                  />
                </Field>
                <Field label="Renovation Financing">
                  <select value={financials.renovation_financing || 'Financed'} onChange={handleSelect('renovation_financing')} disabled={!canEdit} className={inputCls}>
                    <option value="Financed">Financed by lender</option>
                    <option value="Cash">Paid in cash</option>
                  </select>
                </Field>
                <Field label="Points Charged On">
                  <select value={financials.points_charged_on || 'Full Loan'} onChange={handleSelect('points_charged_on')} disabled={!canEdit} className={inputCls}>
                    <option value="Full Loan">Full Loan (purchase + reno)</option>
                    <option value="Purchase Only">Purchase Only</option>
                  </select>
                </Field>
              </div>
            </Card>

            {/* Joint Venture — only shown when is_jv = true */}
            {financials?.is_jv && (
              <Card title="Joint Venture Structure">
                <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 mb-4 text-[11.5px] text-amber-800 dark:text-amber-300 font-medium">
                  JV Deal — profit is split {Math.round((financials.jv_profit_split_pct || 0.5) * 100)}% / {100 - Math.round((financials.jv_profit_split_pct || 0.5) * 100)}%. ROI and cash invested reflect <strong>your share only</strong>.
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Field label="Partner's Purchase + Closing" tip="What your partner paid for the property including their closing costs">
                    <NumInput value={financials.jv_partner_purchase} onBlur={v => saveField('jv_partner_purchase', parseFloat(v) || 0)} disabled={!canEdit} />
                  </Field>
                  <Field label="Partner Loan to Us" tip="Amount your partner lent us for renovation">
                    <NumInput value={financials.jv_partner_loan} onBlur={v => saveField('jv_partner_loan', parseFloat(v) || 0)} disabled={!canEdit} />
                  </Field>
                  <Field label="Partner Loan Rate (Annual)" tip="Interest rate on the partner's loan to us, e.g. 0.12 for 12%">
                    <NumInput value={financials.jv_partner_loan_rate} onBlur={v => saveField('jv_partner_loan_rate', parseFloat(v) || 0)} disabled={!canEdit} />
                  </Field>
                  <Field label="Our Profit Split" tip="Our share of the deal profit, e.g. 0.5 for 50%">
                    <NumInput value={financials.jv_profit_split_pct} onBlur={v => saveField('jv_profit_split_pct', parseFloat(v) || 0.5)} disabled={!canEdit} />
                  </Field>
                  <Field label="Partner Interest (auto)">
                    <div className={calcDisplayCls}>{calc ? fmtUSD(calc.jvPartnerInterest) : '—'}</div>
                  </Field>
                  <Field label="Our Cash In (auto)" tip="Reno gap + interest we owe partner">
                    <div className={`${calcDisplayCls} font-semibold text-[color:var(--color-success-text)]`}>{calc ? fmtUSD(calc.totalCashInvested) : '—'}</div>
                  </Field>
                </div>
              </Card>
            )}

            {/* Hard Money Loan */}
            <Card title="Hard Money Loan">

              {/* ── Section 1: Your Deal Terms (highlighted — fill these in) ── */}
              <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-3 mb-4">
                <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)] mb-3 flex items-center gap-1.5">
                  <span>✏</span> Fill In Your Deal Terms
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Renovation Budget" tip={items.length > 0 ? "Locked — using your renovation line items total" : "Total renovation cost. Enter here until you add line items below"}>
                    <NumInput
                      value={financials.renovation_lender_amount}
                      onChange={handleLive('renovation_lender_amount')}
                      onBlur={handleBlur('renovation_lender_amount')}
                      disabled={!canEdit || items.length > 0}
                      placeholder="e.g. 47000"
                    />
                  </Field>
                  <Field label="Lender Covers %" tip="What % of the renovation does the lender finance? (typically 85–100%)">
                    <NumInput
                      value={financials.renovation_lender_pct != null ? financials.renovation_lender_pct * 100 : 100}
                      onChange={n => setFinancials(prev => prev ? {...prev, renovation_lender_pct: n / 100} : prev)}
                      onBlur={v => save({ renovation_lender_pct: v === '' ? 1.0 : Number(v) / 100 })}
                      disabled={!canEdit} placeholder="100"
                    />
                  </Field>
                  <Field label="Interest Rate (Annual %)" tip="Hard money lender's annual rate. Typical: 10–14%">
                    <NumInput
                      value={financials.interest_rate_annual != null ? financials.interest_rate_annual * 100 : ''}
                      onChange={n => setFinancials(prev => prev ? {...prev, interest_rate_annual: n / 100} : prev)}
                      onBlur={v => save({ interest_rate_annual: v === '' ? null : Number(v) / 100 })}
                      disabled={!canEdit} placeholder="12"
                    />
                  </Field>
                  <Field label="Points %" tip="Lender origination fee as % of total loan. Typical: 1–3%">
                    <NumInput
                      value={financials.points_pct != null ? financials.points_pct * 100 : ''}
                      onChange={n => setFinancials(prev => prev ? {...prev, points_pct: n / 100} : prev)}
                      onBlur={v => save({ points_pct: v === '' ? null : Number(v) / 100 })}
                      disabled={!canEdit} placeholder="2"
                    />
                  </Field>
                </div>
              </div>

              {/* ── Section 2: Auto-Calculated ── */}
              <div className="mb-4">
                <div className={labelCls + ' mb-2'}>Calculated Automatically</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Purchase Loan" tip="Purchase price × LTV%">
                    <CalcDisplay value={calc ? fmtUSD(calc.purchaseLoan) : '—'} lines={calc ? [
                      { label: `${fmtUSD(financials?.purchase_price_actual)} × ${fmtPct(financials?.loan_to_purchase_pct ?? 0.9)}`, value: '' },
                      '---', { label: 'Purchase Loan', value: fmtUSD(calc.purchaseLoan), bold: true },
                    ] : []} />
                  </Field>
                  <Field label="Renovation Loan" tip="Renovation Budget × Lender Covers %">
                    <CalcDisplay value={calc ? fmtUSD(calc.renovationLoan) : '—'} lines={calc ? [
                      { label: `${fmtUSD(calc.totalRenovationCost)} × ${fmtPct(calc.renovLenderPct)}`, value: '' },
                      '---', { label: 'Renovation Loan', value: fmtUSD(calc.renovationLoan), bold: true },
                      { label: 'Your cash portion', value: fmtUSD(calc.renovationGap) },
                    ] : []} />
                  </Field>
                  <Field label="Total Loan" tip="Purchase Loan + Renovation Loan">
                    <CalcDisplay value={calc ? fmtUSD(calc.totalLoan) : '—'} className="font-semibold text-[color:var(--color-text)]" lines={calc ? [
                      { label: 'Purchase Loan', value: fmtUSD(calc.purchaseLoan) },
                      { label: 'Renovation Loan', value: fmtUSD(calc.renovationLoan) },
                      '---', { label: 'Total Loan', value: fmtUSD(calc.totalLoan), bold: true },
                    ] : []} />
                  </Field>
                  <Field label="Monthly Interest" tip="Total Loan × (Rate ÷ 12)">
                    <CalcDisplay value={calc ? fmtUSD(calc.monthlyInterest) : '—'} className="font-semibold text-[color:var(--color-accent-text)]" lines={calc ? [
                      { label: `${fmtUSD(calc.totalLoan)} × (${fmtPct(financials?.interest_rate_annual)} ÷ 12)`, value: '' },
                      '---', { label: 'Monthly', value: fmtUSD(calc.monthlyInterest), bold: true },
                      { label: `× ${calc.holdMonths}mo total`, value: fmtUSD(calc.totalInterest) },
                    ] : []} />
                  </Field>
                </div>
              </div>

              {/* ── Section 3: Florida Closing Fees (collapsible defaults) ── */}
              <div className="border-t border-[color:var(--color-line)] pt-3">
                <button
                  onClick={() => setHmlFeesOpen(p => !p)}
                  className="flex items-center gap-2 text-[11px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors w-full"
                >
                  <span className="text-[color:var(--color-text-dim)]">{hmlFeesOpen ? '▾' : '▸'}</span>
                  <span className="font-medium uppercase tracking-wider">Florida Closing Fees</span>
                  <span className="text-[color:var(--color-text-dim)]">— usually set once, rarely changes</span>
                  {calc && <span className="ml-auto font-semibold text-[color:var(--color-text-muted)]">{fmtUSD(calc.hmlClosingCosts)} total</span>}
                </button>
                {hmlFeesOpen && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                    <Field label="Points Cost (auto)" tip="Points % × Total Loan">
                      <div className={calcDisplayCls}>{calc ? fmtUSD(calc.pointsCost) : '—'}</div>
                    </Field>
                    <Field label="Title Lender Insurance" tip="Protects the lender's interest">
                      <NumInput value={financials.title_lender_insurance} onChange={handleLive('title_lender_insurance')} onBlur={handleBlur('title_lender_insurance')} disabled={!canEdit} />
                    </Field>
                    <Field label="Interest Portion" tip="Pre-paid interest for partial first month">
                      <NumInput value={financials.interest_portion} onChange={handleLive('interest_portion')} onBlur={handleBlur('interest_portion')} disabled={!canEdit} />
                    </Field>
                    <Field label="Doc Stamps (Mortgage)" tip="FL tax: 0.35% of loan. On $148K = ~$518">
                      <NumInput value={financials.doc_stamps_mortgage} onChange={handleLive('doc_stamps_mortgage')} onBlur={handleBlur('doc_stamps_mortgage')} disabled={!canEdit} />
                    </Field>
                    <Field label="Intangible Tax" tip="FL tax: 0.2% of loan. On $148K = ~$296">
                      <NumInput value={financials.intangible_tax} onChange={handleLive('intangible_tax')} onBlur={handleBlur('intangible_tax')} disabled={!canEdit} />
                    </Field>
                    <Field label="Extension Fee" tip="If you need to extend the loan term">
                      <NumInput value={financials.extension_fee} onChange={handleLive('extension_fee')} onBlur={handleBlur('extension_fee')} disabled={!canEdit} />
                    </Field>
                  </div>
                )}
              </div>
            </Card>

            {/* Purchase Closing Costs */}
            <Card title="Purchase Closing Costs">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title & Closing Costs" tip="Title search, title insurance (owner's), attorney, recording fees">
                  <NumInput value={financials.title_closing_costs} onChange={handleLive('title_closing_costs')} onBlur={handleBlur('title_closing_costs')} disabled={!canEdit} />
                </Field>
                <Field label="Other">
                  <NumInput value={financials.purchase_closing_costs_other} onChange={handleLive('purchase_closing_costs_other')} onBlur={handleBlur('purchase_closing_costs_other')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            {/* Holding Costs */}
            <Card title="Holding Costs (Monthly)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Insurance">
                  <NumInput value={financials.insurance_monthly} onChange={handleLive('insurance_monthly')} onBlur={handleBlur('insurance_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Utilities">
                  <NumInput value={financials.utilities_monthly} onChange={handleLive('utilities_monthly')} onBlur={handleBlur('utilities_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Property Taxes">
                  <NumInput value={financials.taxes_monthly} onChange={handleLive('taxes_monthly')} onBlur={handleBlur('taxes_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="HOA">
                  <NumInput value={financials.hoa_monthly} onChange={handleLive('hoa_monthly')} onBlur={handleBlur('hoa_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Misc">
                  <NumInput value={financials.misc_holding_monthly} onChange={handleLive('misc_holding_monthly')} onBlur={handleBlur('misc_holding_monthly')} disabled={!canEdit} />
                </Field>
                {calc && (
                  <Field label="Total Holding (auto)">
                    <CalcDisplay
                      value={`${fmtUSD(calc.totalHoldingCosts)} (${calc.holdMonths}mo)`}
                      lines={[
                        { label: `Monthly Interest`, value: fmtUSD(calc.monthlyInterest) },
                        { label: `Insurance`, value: fmtUSD(financials?.insurance_monthly) },
                        { label: `Utilities`, value: fmtUSD(financials?.utilities_monthly) },
                        { label: `Taxes`, value: fmtUSD(financials?.taxes_monthly) },
                        { label: `HOA`, value: fmtUSD(financials?.hoa_monthly) },
                        { label: `Misc`, value: fmtUSD(financials?.misc_holding_monthly) },
                        '---',
                        { label: `Monthly Total`, value: fmtUSD(calc.monthlyInterest + calc.monthlyHoldCosts) },
                        { label: `× ${calc.holdMonths} months`, value: '' },
                        '---',
                        { label: `Total Holding`, value: fmtUSD(calc.totalHoldingCosts), bold: true },
                      ]}
                    />
                  </Field>
                )}
              </div>
            </Card>

            {/* Renovation Items — wrapped in Card */}
            <Card title="Renovation Items">
              <DealRenovationItems
                leadId={leadId}
                workspaceId={workspaceId}
                canEdit={canEdit}
                items={items}
                onChanged={reloadItems}
                onOpenImport={() => setImportOpen(true)}
                onPendingChange={setPendingRenovCost}
              />
            </Card>

            {/* Selling Price & Profit */}
            <Card title="Selling Price & Profit">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Left: inputs */}
                <div className="space-y-4">
                  <Field label="Expected Sale Price">
                    <NumInput value={financials.expected_sell_price} onChange={handleLive('expected_sell_price')} onBlur={handleBlur('expected_sell_price')} disabled={!canEdit} />
                  </Field>

                  {/* Selling cost breakdown */}
                  <div>
                    <div className={labelCls + ' mb-2'}>Selling Costs Breakdown</div>
                    <div className="space-y-1.5">
                      {[
                        { label: 'Listing Agent %',   field: 'agent_commission_pct', calcKey: 'agentCommissionPct', defaultPct: 0.03, tip: "Commission paid to the seller's agent" },
                        { label: "Buyer's Agent %",   field: 'buyer_agent_pct',      calcKey: 'buyerAgentPct',      defaultPct: 0.03, tip: "Commission paid to the buyer's agent" },
                        { label: 'Title & Closing %', field: 'selling_closing_pct',  calcKey: 'sellingClosingPct',  defaultPct: 0.01, tip: 'Title insurance, attorney, doc stamps on deed' },
                        { label: 'Other %',           field: 'selling_other_pct',    calcKey: 'sellingOtherPct',    defaultPct: 0.00, tip: 'Any other selling costs' },
                      ].map(({ label, field, calcKey, defaultPct, tip }) => {
                        const pctVal = financials[field] != null ? financials[field] * 100 : defaultPct * 100
                        const sellRef = financials.expected_sell_price || 0
                        const dollarAmt = sellRef * (calc?.[calcKey] ?? defaultPct)
                        return (
                          <div key={field} className="flex items-center gap-2">
                            <div className="w-36 shrink-0">
                              <label className={labelCls}>
                                {label}
                                {tip && <span title={tip} className="ml-1 cursor-help opacity-50 hover:opacity-100">ⓘ</span>}
                              </label>
                            </div>
                            <div className="w-20 shrink-0">
                              <NumInput
                                value={pctVal}
                                onChange={n => setFinancials(prev => prev ? { ...prev, [field]: n / 100 } : prev)}
                                onBlur={v => save({ [field]: v === '' ? 0 : Number(v) / 100 })}
                                disabled={!canEdit}
                                placeholder="0"
                              />
                            </div>
                            <div className="text-[11.5px] text-[color:var(--color-text-muted)] tabular-nums">
                              {sellRef > 0 ? fmtUSD(dollarAmt) : '—'}
                            </div>
                          </div>
                        )
                      })}

                      {/* Total row */}
                      <div className="flex items-center gap-2 pt-2 border-t border-[color:var(--color-line)]">
                        <div className="w-36 shrink-0 text-[11px] font-semibold text-[color:var(--color-text)]">Total Selling Costs</div>
                        <div className="w-20 shrink-0 text-[12px] font-semibold text-[color:var(--color-text)] px-2">
                          {calc ? fmtPct(calc.sellingCostPct) : '—'}
                        </div>
                        <div className="text-[11.5px] font-semibold text-[color:var(--color-danger-text)] tabular-nums">
                          {calc?.expected ? `− ${fmtUSD(calc.expected.sellingCosts)}` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {isSold && (
                    <>
                      <Field label="Actual Sale Price">
                        <NumInput value={financials.actual_sale_price} onChange={handleLive('actual_sale_price')} onBlur={handleBlur('actual_sale_price')} disabled={!canEdit} />
                      </Field>
                      <Field label="Sold Date">
                        <input type="date" defaultValue={financials.sold_date || ''} onBlur={e => save({ sold_date: e.target.value || null })} disabled={!canEdit} className={inputCls} />
                      </Field>
                    </>
                  )}
                </div>

                {/* Right: live profit result */}
                <div>
                  {calc?.expected ? (
                    <>
                      <div className={labelCls + ' mb-2'}>Expected Profit</div>
                      <MetricRow label="Sale Price"                                          value={fmtUSD(calc.expected.sellPrice)} />
                      <MetricRow label={`− Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.expected.sellingCosts)}`} />
                      <MetricRow label="− Total All-In Cost"                                 value={`− ${fmtUSD(calc.totalAllInCost)}`} />
                      {calc.isJV && <MetricRow label="Total Deal Profit" value={fmtUSD(calc.expected.totalDealProfit)} />}
                      <MetricRow label={calc.isJV ? `Your Share (${Math.round(calc.jvSplitPct*100)}%)` : 'Net Profit'} value={fmtUSD(calc.expected.netProfit)} highlight positive={calc.expected.netProfit >= 0} negative={calc.expected.netProfit < 0} />
                      <MetricRow label="ROI on Cash Invested"    value={fmtPct(calc.expected.roi)}            highlight positive={calc.expected.roi >= 0}            negative={calc.expected.roi < 0} />
                      <MetricRow label={`Annualized ROI (${calc.holdMonths}mo)`} value={fmtPct(calc.expected.annualizedRoi)} positive={calc.expected.annualizedRoi >= 0} negative={calc.expected.annualizedRoi < 0} />
                    </>
                  ) : (
                    <div className="text-[12px] text-[color:var(--color-text-dim)] py-6 text-center">
                      Enter an expected sale price to see profit.
                    </div>
                  )}
                  {calc?.actual && (
                    <div className="mt-5">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-success-text)] mb-2">✓ Actual Result</div>
                      <MetricRow label="Sale Price"                                          value={fmtUSD(calc.actual.sellPrice)} />
                      <MetricRow label={`− Selling Costs (${fmtPct(calc.sellingCostPct)})`} value={`− ${fmtUSD(calc.actual.sellingCosts)}`} />
                      <MetricRow label="− Total All-In Cost"                                 value={`− ${fmtUSD(calc.totalAllInCost)}`} />
                      {calc.isJV && <MetricRow label="Total Deal Profit" value={fmtUSD(calc.actual.totalDealProfit)} />}
                      <MetricRow label={calc.isJV ? `Your Share (${Math.round(calc.jvSplitPct*100)}%)` : 'Net Profit'} value={fmtUSD(calc.actual.netProfit)}  highlight positive={calc.actual.netProfit >= 0} negative={calc.actual.netProfit < 0} />
                      <MetricRow label="ROI on Cash Invested"    value={fmtPct(calc.actual.roi)}            highlight positive={calc.actual.roi >= 0}            negative={calc.actual.roi < 0} />
                      <MetricRow label={`Annualized ROI (${calc.holdMonths}mo)`} value={fmtPct(calc.actual.annualizedRoi)} positive={calc.actual.annualizedRoi >= 0} negative={calc.actual.annualizedRoi < 0} />
                    </div>
                  )}
                </div>
              </div>
            </Card>

          </>
        )}

        </div>{/* end left column */}

        {/* ── Right column: sticky live calc panel ── */}
        <div className="w-[300px] shrink-0 sticky top-4 self-start">
          <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 overflow-y-auto max-h-[calc(100vh-80px)]">
            <div className="text-[11px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)] mb-3 flex items-center gap-1.5">
              <span>📊</span> Live Calculation
            </div>
            <LiveCalcPanel calc={calc} financials={financials} ratingKey={ratingKey} ratingInfo={ratingInfo} />
          </div>
        </div>

        </div>{/* end two-column flex */}
      </div>

      {financials && (
        <DealImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onApply={handleApply}
        />
      )}
    </>
  )
}
