import { useState, useMemo } from 'react'

const fmt   = n  => n != null ? `$${Math.round(n).toLocaleString()}` : '—'
const fmtK  = n  => n != null ? `$${(Math.round(n / 1000))}K` : '—'
const color = ok => ok ? 'var(--color-success-text)' : 'var(--color-danger-text)'
const bg    = ok => ok ? 'var(--color-success-soft)' : 'var(--color-danger-soft)'
const bdr   = ok => ok ? 'var(--color-success)'      : 'var(--color-danger)'

function calcBRRRR(pp, arv, reno, rent, bedrooms) {
  if (!pp || !arv || reno == null) return null
  const hml         = pp * 0.90 + reno
  const hmlPoints   = hml * 0.02
  const hmlFees     = 1500
  const holdMo      = 6
  const hmlInterest = hml * 0.12 * (holdMo / 12)
  const hmlCosts    = hmlPoints + hmlFees + hmlInterest
  const allIn       = pp + reno + hmlCosts
  const refi        = arv * 0.70
  const cashLeftIn  = allIn - refi
  const rentEst     = rent || (bedrooms >= 4 ? 2000 : bedrooms === 3 ? 1600 : 1300)
  const loanFactor  = refi <= 150000 ? 985 : refi <= 180000 ? 1182 : refi <= 200000 ? 1313 : refi <= 220000 ? 1445 : Math.round(refi * 0.006566)
  const cashflow    = rentEst - loanFactor - 208 - 136
  const status      = cashLeftIn < 30000 ? 'EXCELLENT' : cashLeftIn < 60000 ? 'ACCEPTABLE' : 'FAILS'
  return { hml, hmlCosts, allIn, refi, cashLeftIn, loanFactor, cashflow, rentEst, status, works: cashLeftIn < 60000 && cashflow > 0 }
}

function calcFlip(pp, arv, reno) {
  if (!pp || !arv || reno == null) return null
  const allIn      = pp + reno
  const carryClose = arv * 0.08
  const netProfit  = arv - allIn - carryClose
  const rating     = netProfit >= 40000 ? 'STRONG' : netProfit >= 25000 ? 'THIN' : 'FAILS'
  return { allIn, carryClose, netProfit, rating, works: netProfit >= 25000 }
}

export default function WhatIfPanel({ lead }) {
  const [arvAdj,  setArvAdj]  = useState(0)   // percent: -30 to +30
  const [renoAdj, setRenoAdj] = useState(0)   // percent: -50 to +100
  const [open,    setOpen]    = useState(false)

  const pp   = Number(lead.asking_price) || null
  const mao  = Number(lead.mao)          || null
  const baseArv  = Number(lead.arv)            || null
  const baseReno = Number(lead.renovation_cost) || null

  const adjArv  = baseArv  != null ? baseArv  * (1 + arvAdj  / 100) : null
  const adjReno = baseReno != null ? baseReno * (1 + renoAdj / 100) : null

  const brrrr = useMemo(() => calcBRRRR(pp || mao, adjArv, adjReno, Number(lead.rent_estimate) || null, lead.bedrooms), [pp, mao, adjArv, adjReno, lead])
  const flip  = useMemo(() => calcFlip(pp || mao, adjArv, adjReno), [pp, mao, adjArv, adjReno])

  if (!baseArv && !baseReno) return null  // nothing to slide

  return (
    <div className="mt-3 rounded-xl border border-[color:var(--color-line)] overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-bg-elev-3)] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px]">🎚️</span>
          <span className="text-[12px] font-semibold text-[color:var(--color-text)]">What-If Scenarios</span>
          {(arvAdj !== 0 || renoAdj !== 0) && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--color-accent)] text-white font-bold">ADJUSTED</span>
          )}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="w-3.5 h-3.5 text-[color:var(--color-text-dim)] transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-[color:var(--color-bg)]">
          {/* Sliders */}
          <div className="space-y-3">
            {baseArv != null && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[11px] font-semibold text-[color:var(--color-text-muted)]">ARV Adjustment</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${arvAdj > 0 ? 'text-green-400' : arvAdj < 0 ? 'text-red-400' : 'text-[color:var(--color-text-dim)]'}`}>
                      {arvAdj > 0 ? '+' : ''}{arvAdj}%
                    </span>
                    <span className="text-[10.5px] text-[color:var(--color-text-dim)]">→ {fmtK(adjArv)}</span>
                  </div>
                </div>
                <input type="range" min="-30" max="30" step="1" value={arvAdj}
                  onChange={e => setArvAdj(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <div className="flex justify-between text-[9px] text-[color:var(--color-text-dim)] mt-0.5 px-0.5">
                  <span>−30%</span><span>−15%</span><span>0</span><span>+15%</span><span>+30%</span>
                </div>
              </div>
            )}
            {baseReno != null && (
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[11px] font-semibold text-[color:var(--color-text-muted)]">Reno Cost Adjustment</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold ${renoAdj < 0 ? 'text-green-400' : renoAdj > 0 ? 'text-red-400' : 'text-[color:var(--color-text-dim)]'}`}>
                      {renoAdj > 0 ? '+' : ''}{renoAdj}%
                    </span>
                    <span className="text-[10.5px] text-[color:var(--color-text-dim)]">→ {fmtK(adjReno)}</span>
                  </div>
                </div>
                <input type="range" min="-50" max="100" step="1" value={renoAdj}
                  onChange={e => setRenoAdj(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <div className="flex justify-between text-[9px] text-[color:var(--color-text-dim)] mt-0.5 px-0.5">
                  <span>−50%</span><span>−25%</span><span>0</span><span>+50%</span><span>+100%</span>
                </div>
              </div>
            )}
            {(arvAdj !== 0 || renoAdj !== 0) && (
              <button onClick={() => { setArvAdj(0); setRenoAdj(0) }}
                className="text-[10.5px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] underline">
                Reset to baseline
              </button>
            )}
          </div>

          {/* Results */}
          <div className="grid grid-cols-1 gap-2">
            {brrrr && (
              <div className="rounded-lg border p-3 space-y-2"
                style={{ borderColor: bdr(brrrr.works), background: bg(brrrr.works) }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: color(brrrr.works) }}>BRRRR</span>
                  <span className="text-[11px] font-black" style={{ color: color(brrrr.works) }}>{brrrr.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(brrrr.works) }}>All-In</div>
                    <div className="text-[12px] font-bold" style={{ color: color(brrrr.works) }}>{fmtK(brrrr.allIn)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(brrrr.works) }}>Refi Out</div>
                    <div className="text-[12px] font-bold" style={{ color: color(brrrr.works) }}>{fmtK(brrrr.refi)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(brrrr.works) }}>Cash Left In</div>
                    <div className="text-[12px] font-bold" style={{ color: color(brrrr.works) }}>{fmtK(brrrr.cashLeftIn)}</div>
                  </div>
                </div>
                <div className="flex justify-center gap-1 text-[10.5px]" style={{ color: color(brrrr.works) }}>
                  <span>Cash flow:</span>
                  <span className="font-bold">{fmt(brrrr.cashflow)}/mo</span>
                </div>
              </div>
            )}
            {flip && (
              <div className="rounded-lg border p-3 space-y-2"
                style={{ borderColor: bdr(flip.works), background: bg(flip.works) }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: color(flip.works) }}>FLIP</span>
                  <span className="text-[11px] font-black" style={{ color: color(flip.works) }}>{flip.rating}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(flip.works) }}>All-In</div>
                    <div className="text-[12px] font-bold" style={{ color: color(flip.works) }}>{fmtK(flip.allIn)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(flip.works) }}>Carry+Close</div>
                    <div className="text-[12px] font-bold" style={{ color: color(flip.works) }}>{fmtK(flip.carryClose)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wide opacity-70" style={{ color: color(flip.works) }}>Net Profit</div>
                    <div className="text-[12px] font-bold" style={{ color: color(flip.works) }}>{fmtK(flip.netProfit)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
