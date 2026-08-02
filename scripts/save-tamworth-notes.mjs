// Save investor analysis notes for Tamworth BRRRR project
// financials_id: 5be4457f-b9be-4505-838f-3e3687cb5dd6

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  }
} catch {}

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SERVICE_KEY) { console.error('No service key'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const FINANCIALS_ID = '5be4457f-b9be-4505-838f-3e3687cb5dd6'

const notes = `BRRRR INVESTOR ANALYSIS — 9129 Tamworth Rd, Jacksonville FL 32208
Reviewed: July 2026 | Strategy: Buy–Rehab–Rent–Refinance–Repeat

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEAL SNAPSHOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Purchase price:      $77,500
Total HML loan:      $112,000 (purchase $72K + reno escrow $40K @ 12%)
Reno budget:         $50,000 (lender covers $40K / we cover $10K gap)
Cash at close:       $11,339
+ Reno gap:          $10,000
+ Carrying (5mo):    $7,180  (HML interest $5,600 + ins/tax $1,580)
TOTAL CASH IN:       $28,519

REFINANCE (70% of $180K ARV):
Refi loan:           $126,000 @ 6.7%, 30yr → $813/mo P&I
HML payoff:         -$112,000
Refi title/closing:  -$2,000
CASH OUT:            $12,000
CASH STILL IN DEAL:  $16,519 (42% recaptured — money left working in property)
Equity at refi:      $54,000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CASH FLOW (post-refi, current rent $1,350/mo)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Rent:                $1,350
- P&I ($126K 6.7%):  -$813
- Taxes:             -$180
- Insurance:         -$136
- Vacancy (5%):       -$68
- Mgmt (10%):        -$135
- Maintenance (5%):   -$68
MONTHLY CASH FLOW:   -$49/mo  ← NEGATIVE
Annual cash flow:    -$589/yr
Cap rate:             5.09%  (below 6% threshold)
Cash-on-cash:        -3.56%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RENT SENSITIVITY — WHAT RENT MAKES THIS WORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current rent:        $1,350/mo → -$49/mo cash flow (losing money)
Breakeven rent:      $1,411/mo → $0/mo
Rent for +$100/mo:   $1,536/mo
Rent for +$200/mo:   $1,661/mo

The original business plan projected $1,600/mo rent — which would have produced
strong positive cash flow and a perfect (or near-perfect) BRRRR. Market comps
came in at $1,350, a 15% miss that flipped the deal from excellent to marginal.

ACTION NEEDED: Get 3 current rental comps on Zillow/Rentometer for this zip.
If comparable 3BR SFH rentals are showing $1,400–1,500, push for that range.
A tenant at $1,425 cuts the loss to ~$10/mo. At $1,475 you're breakeven.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL RETURN PICTURE (Year 1 post-refi)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Annual cash flow:    -$589
+ Principal paydown:  +$1,315  (tenant pays down mortgage each year)
= Net annual return:   $726/yr on $16,519 invested
Total ROI:            4.4%

With 3% annual appreciation on $180K property:
Appreciation:        +$5,400/yr
Total unlevered ROI: ~37% (but unrealized until sale)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFI CLOSING COSTS REALITY CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Entered in CRM: $2,000. Actual Florida breakdown on $126K refi:
  Doc stamps (0.35%):      $441
  Intangible tax (0.20%):  $252
  Lender title ins:        ~$600
  Title search/exam:       ~$275
  Recording:               ~$100
  Appraisal:               ~$450
  Estimated real cost:    ~$2,118
Recommendation: Update refi_closing_costs to $2,200 to be conservative.
Impact: cash out drops $200 → net cash in deal = $16,719.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INVESTOR VERDICT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRATEGY FIT: MARGINAL — not a textbook BRRRR

This is NOT a bad deal. But calling it a clean BRRRR is a stretch:

✅ STRENGTHS:
- Strong equity position: $54K locked in at refi
- All-in vs ARV at 78.6% — technically within limits
- Property acquired at $77.5K — solid buy price in this market
- HML covers 80% of reno — low exposure during rehab phase

⚠ WEAKNESSES:
- Only 42% of cash recaptured — $16,519 still tied up
- Negative cash flow of $49/mo at market rent of $1,350
- Cap rate 5.09% — below the 6% minimum for rental investment
- Cash-on-cash: -3.56% — you're paying annually to hold this asset
- Original rent projection ($1,600) was 15% above market — key assumption error

WHAT THIS DEAL ACTUALLY IS:
This is an equity/appreciation play in a long-term hold wrapper.
You're essentially paying $49/mo to own $54K in equity on a $180K property —
that's not terrible, but it's not the cash-machine BRRRR was supposed to be.

WHAT NEEDS TO HAPPEN:
1. Push rent to $1,425+ before signing tenant. Don't leave money on the table.
2. Update refi_closing_costs to $2,200 in CRM (more realistic).
3. Consider self-managing (10% mgmt = $135/mo) if you have capacity — at
   $1,350 rent, self-mgmt alone would flip this to +$86/mo positive.
4. Monitor for rent increases at renewal — Jacksonville rents have trended up.
   At $1,425 this becomes breakeven. At $1,500 it becomes a solid cash producer.

ALTERNATIVE CONSIDERATION:
If post-reno ARV holds at $180K and you can list it, a flip might have netted
more. Worth calculating: $180K sale price - 6% selling costs ($10,800) - loan
payoff ($112K) - all costs = ~$18K profit in hand vs $16,519 tied up losing money.
The flip exit and BRRRR exit are very close in this case.

BOTTOM LINE:
Keep the property if you believe in Jacksonville long-term appreciation and can
get rent to $1,425+. Consider selling if rent comps won't support that and you
need the $16K capital for a better opportunity.`

async function main() {
  // Find lead_id from financials
  const { data: fin, error: finErr } = await supabase
    .from('deal_financials')
    .select('lead_id')
    .eq('id', FINANCIALS_ID)
    .single()

  if (finErr) { console.error('Could not find financials:', finErr); process.exit(1) }
  console.log('Lead ID:', fin.lead_id)

  // Update lead notes
  const { error } = await supabase
    .from('leads')
    .update({ notes })
    .eq('id', fin.lead_id)

  if (error) { console.error('Failed to update notes:', error); process.exit(1) }
  console.log('Notes saved to lead', fin.lead_id)
}

main()
