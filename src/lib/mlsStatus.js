import { supabase } from './supabase'

export const MLS_STATUS_META = {
  for_sale:        { label: 'For Sale',       tone: 'success' },
  pending:         { label: 'Pending',        tone: 'warn'    },
  contingent:      { label: 'Contingent',     tone: 'warn'    },
  sold:            { label: 'Sold',           tone: 'danger'  },
  off_market:      { label: 'Off Market',     tone: 'neutral' },
  pre_foreclosure: { label: 'Pre-Foreclosure',tone: 'danger'  },
  auction:         { label: 'Auction',        tone: 'accent'  },
}

export function mlsStatusMeta(status) {
  return MLS_STATUS_META[status] || { label: status, tone: 'neutral' }
}

export async function refreshLeadMls(leadId) {
  const { data, error } = await supabase.functions.invoke('zillow-status', {
    body: { lead_id: leadId },
  })
  if (error) {
    let detail = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) detail = ctx.error
    } catch (_) {}
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  return data?.results?.[0]
}

export async function refreshLeadsMls(leadIds) {
  const { data, error } = await supabase.functions.invoke('zillow-status', {
    body: { lead_ids: leadIds },
  })
  if (error) throw new Error(error.message)
  return data?.results || []
}
