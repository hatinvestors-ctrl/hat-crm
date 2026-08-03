import { useState } from 'react'
import Card from '../ui/Card'
import EditableField from './EditableField'
import { PROPERTY_TYPES } from '../../lib/constants'
import { formatNumber, formatCurrency } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { mlsStatusMeta } from '../../lib/mlsStatus'
import { safeUrl } from '../../lib/urlSafety'
import { enrichLead } from '../../lib/enrichment'

const TONE_PILL = {
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
}

export default function PropertyInfoSection({ lead, userId, members, canEdit, onUpdated }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [refreshing, setRefreshing] = useState(false)
  const [mlsErr, setMlsErr] = useState(null)
  const mlsMeta = lead.mls_status ? mlsStatusMeta(lead.mls_status) : null

  const links = [
    { label: 'Zillow', url: safeUrl(lead.zillow_url) },
    { label: 'Redfin', url: safeUrl(lead.redfin_url) },
    { label: 'MLS',    url: safeUrl(lead.mls_url) },
    { label: 'Photos', url: safeUrl(lead.photos_url) },
  ].filter(l => l.url)

  return (
    <Card title="Property">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <EditableField label="Address" value={lead.address}    onSave={(v) => update({ address: v })}   disabled={!canEdit} />
        <EditableField label="City"    value={lead.city}       onSave={(v) => update({ city: v })}      disabled={!canEdit} />
        <EditableField label="State"   value={lead.state}      onSave={(v) => update({ state: v })}     disabled={!canEdit} />
        <EditableField label="Zip"     value={lead.zip_code}   onSave={(v) => update({ zip_code: v })}  disabled={!canEdit} />
        <EditableField
          label="Type"
          value={lead.property_type}
          options={PROPERTY_TYPES}
          type="select"
          onSave={(v) => update({ property_type: v })}
          disabled={!canEdit}
        />
        <EditableField label="Year Built" type="number" value={lead.year_built} onSave={(v) => update({ year_built: v })} disabled={!canEdit} />
        <EditableField label="Bedrooms"   type="number" value={lead.bedrooms}   onSave={(v) => update({ bedrooms: v })}   disabled={!canEdit} />
        <EditableField label="Bathrooms"  value={lead.bathrooms} onSave={(v) => update({ bathrooms: v === '' ? null : parseFloat(v) })} disabled={!canEdit} />
        <EditableField
          label="Sqft"
          type="number"
          value={lead.sqft}
          formatter={(v) => formatNumber(v)}
          onSave={(v) => update({ sqft: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Lot Size"
          type="number"
          value={lead.lot_size_sqft}
          formatter={(v) => `${formatNumber(v)} sqft`}
          onSave={(v) => update({ lot_size_sqft: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Garage"
          type="bool"
          value={lead.has_garage}
          onSave={(v) => update({ has_garage: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Days on Market"
          type="number"
          value={lead.days_on_market}
          formatter={(v) => `${formatNumber(v)}d`}
          onSave={(v) => update({ days_on_market: v })}
          disabled={!canEdit}
        />
      </div>

      <div className="mt-3 flex items-center justify-between px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-warn-text)]">Seller's Asking Price</span>
        <EditableField
          label=""
          type="currency"
          value={lead.asking_price}
          formatter={formatCurrency}
          onSave={(v) => update({ asking_price: v })}
          disabled={!canEdit}
        />
      </div>

      {/* External links — MLS refresh is in the banner at the top */}
      {links.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[color:var(--color-line)]">
          <div className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">External links</div>
          <div className="flex flex-wrap gap-1.5">
            {links.map(l => (
              <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="text-[12px] px-2 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors">
                {l.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
