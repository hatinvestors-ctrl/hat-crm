/**
 * Single source of truth for "does the AI analysis need re-running".
 * Compares the lead's live ARV / renovation cost / strategy against the
 * values that were actually used to produce lead.deal_analysis.
 */
export function useDealStaleness(lead) {
  const inp = lead?.deal_analysis?.inputs
  if (!inp) return { stale: false, reasons: [] }

  const reasons = []

  if (Number(lead.arv || 0) !== Number(inp.arv || 0)) {
    reasons.push('ARV changed')
  }

  const curReno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const renoMatch = curReno === inp.renovation_cost || (curReno == null && inp.renovation_cost == null)
  if (!renoMatch) {
    reasons.push('Renovation cost changed')
  }

  const curStrategy = lead.deal_analysis?.strategy || 'flip'
  const inpStrategy = inp.strategy || 'flip'
  if (inp.strategy != null && curStrategy !== inpStrategy) {
    reasons.push('Strategy changed')
  }

  return { stale: reasons.length > 0, reasons }
}
