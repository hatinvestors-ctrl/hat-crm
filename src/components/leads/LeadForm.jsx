import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Textarea from '../ui/Textarea'
import CurrencyInput from '../ui/CurrencyInput'
import Button from '../ui/Button'
import StatusPicker from './StatusPicker'
import { LEAD_SOURCES, PROPERTY_TYPES, SIGNED_STATUSES } from '../../lib/constants'
import { buildZillowUrl } from '../../lib/zillow'
import { findDuplicateLeads } from '../../lib/leadDedup'
import { validateOptionalUrl } from '../../lib/urlSafety'
import { refreshLeadMls, mlsStatusMeta } from '../../lib/mlsStatus'
import { calculateMAO } from '../../lib/calculations'
import { supabase } from '../../lib/supabase'
import { logLeadCreated, logChanges } from '../../lib/activityLogger'
import { lookupAddress } from '../../lib/enrichment'
import { upsertAgentFromLead } from '../../lib/agentOutreach'

const EMPTY_LEAD = {
  address: '',
  city: '',
  state: 'FL',
  zip_code: '',
  property_type: '',
  bedrooms: '',
  bathrooms: '',
  sqft: '',
  year_built: '',
  has_garage: null,
  lot_size_sqft: '',
  seller_name: '',
  phone: '',
  email: '',
  lead_source: '',
  asking_price: '',
  arv: '',
  renovation_cost: '',
  mao: '',
  offer_price: '',
  rent_estimate: '',
  zillow_url: '',
  redfin_url: '',
  mls_url: '',
  photos_url: '',
  status: 'new_lead',
  follow_up_date: '',
  contract_signed_date: '',
  assigned_to: '',
  visible_to_all: false,
  notes: '',
  mls_status: null,
  mls_last_checked: null,
  is_hot: false,
}


export default function LeadForm({ open, onClose, onSaved, lead, workspaceId, userId, userRole, members = [], workspaceDefaults }) {
  const [form, setForm] = useState(EMPTY_LEAD)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [duplicates, setDuplicates] = useState([])
  const dupTimer = useRef(null)
  const [refreshingMls, setRefreshingMls] = useState(false)
  const [mlsRefreshErr, setMlsRefreshErr] = useState(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupNotice, setLookupNotice] = useState(null)  // { kind: 'ok'|'err', text }

  // RentCast autofill: merge response into form, never overwriting fields the user already filled.
  const runLookup = async () => {
    if (!form.address?.trim()) {
      setLookupNotice({ kind: 'err', text: 'Type an address first.' })
      return
    }
    setLookingUp(true)
    setLookupNotice(null)
    try {
      const fullAddr = [form.address, form.city, form.state, form.zip_code].filter(Boolean).join(', ')
      const r = await lookupAddress(fullAddr)
      if (!r.ok) {
        setLookupNotice({ kind: 'err', text: r.error || 'Lookup failed.' })
        return
      }
      const patch = {}
      const setIfEmpty = (key, value) => {
        if (value === null || value === undefined || value === '') return
        const cur = form[key]
        if (cur === null || cur === undefined || cur === '') {
          patch[key] = value
        }
      }
      setIfEmpty('city', r.city)
      setIfEmpty('state', r.state)
      setIfEmpty('zip_code', r.zip_code)
      setIfEmpty('property_type', r.property_type)
      setIfEmpty('bedrooms', r.bedrooms)
      setIfEmpty('bathrooms', r.bathrooms)
      setIfEmpty('sqft', r.sqft)
      setIfEmpty('lot_size_sqft', r.lot_size_sqft)
      setIfEmpty('year_built', r.year_built)
      if (r.has_garage !== null && r.has_garage !== undefined && (form.has_garage === null || form.has_garage === undefined)) {
        patch.has_garage = r.has_garage
      }
      setIfEmpty('asking_price', r.list_price)
      // Always set the live-status fields
      if (r.mls_status) patch.mls_status = r.mls_status
      patch.mls_last_checked = r.mls_last_checked || new Date().toISOString()
      // Agent → fills seller_name/phone/email if empty (it's the listing-agent contact for this lead)
      if (r.listing_agent_name && !form.seller_name) {
        patch.seller_name = r.listing_brokerage
          ? `${r.listing_agent_name} (${r.listing_brokerage})`
          : r.listing_agent_name
      }
      setIfEmpty('phone', r.listing_agent_phone)
      setIfEmpty('email', r.listing_agent_email)
      // Default lead_source to MLS if none set
      if (!form.lead_source) patch.lead_source = 'mls'

      const filledCount = Object.keys(patch).length
      setForm(prev => ({ ...prev, ...patch }))
      // Auto-upsert agent into agents table if email was returned
      if (r.listing_agent_email) {
        upsertAgentFromLead(workspaceId, {
          listing_agent_name:  r.listing_agent_name,
          listing_agent_email: r.listing_agent_email,
          listing_agent_phone: r.listing_agent_phone,
          listing_brokerage:   r.listing_brokerage,
        }).catch(() => {})
      }

      const bits = []
      if (r.mls_status) bits.push(`status=${r.mls_status}`)
      if (typeof r.days_on_market === 'number') bits.push(`DOM ${r.days_on_market}`)
      if (r.listing_agent_name) bits.push(`agent ${r.listing_agent_name}`)
      setLookupNotice({
        kind: 'ok',
        text: `Filled ${filledCount} field${filledCount === 1 ? '' : 's'}${bits.length ? ` — ${bits.join(' · ')}` : ''}`,
      })
    } catch (e) {
      setLookupNotice({ kind: 'err', text: e.message || 'Lookup failed.' })
    } finally {
      setLookingUp(false)
    }
  }

  // Debounced duplicate check when address changes
  useEffect(() => {
    if (!open || !workspaceId || !form.address?.trim()) {
      setDuplicates([])
      return
    }
    clearTimeout(dupTimer.current)
    dupTimer.current = setTimeout(async () => {
      const dups = await findDuplicateLeads(workspaceId, form.address, lead?.id)
      setDuplicates(dups)
    }, 350)
    return () => clearTimeout(dupTimer.current)
  }, [form.address, workspaceId, open, lead?.id])

  useEffect(() => {
    if (open) {
      if (lead) {
        setForm({
          ...EMPTY_LEAD,
          ...lead,
          assigned_to: lead.visible_to_all ? '__all__' : (lead.assigned_to || ''),
          visible_to_all: lead.visible_to_all || false,
        })
      } else {
        // Non-admin creating a new lead: auto-assign to themselves
        setForm({
          ...EMPTY_LEAD,
          assigned_to: userRole !== 'admin' ? userId : '',
        })
      }
      setError(null)
    }
  }, [open, lead, workspaceDefaults])

  const update = (patch) => setForm(prev => {
    const next = { ...prev, ...patch }
    if (['arv', 'renovation_cost'].some(k => k in patch)) {
      const mao = calculateMAO(next.arv, next.renovation_cost)
      if (mao !== null) next.mao = mao.toFixed(2)
    }
    // Auto-populate Zillow URL when address parts change, unless user has manually set a different URL
    if (['address','city','state','zip_code'].some(k => k in patch)) {
      const generatedFromPrev = buildZillowUrl({ address: prev.address, city: prev.city, state: prev.state, zip_code: prev.zip_code })
      const isEmptyOrAuto = !prev.zillow_url || prev.zillow_url === generatedFromPrev
      if (isEmptyOrAuto) {
        next.zillow_url = buildZillowUrl({ address: next.address, city: next.city, state: next.state, zip_code: next.zip_code })
      }
    }
    return next
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.address?.trim()) throw new Error('Address is required')

      // Validate URL fields — reject javascript:/data:/vbscript: schemes
      payload.zillow_url = validateOptionalUrl(payload.zillow_url, 'Zillow URL')
      payload.redfin_url = validateOptionalUrl(payload.redfin_url, 'Redfin URL')
      payload.mls_url    = validateOptionalUrl(payload.mls_url,    'MLS URL')
      payload.photos_url = validateOptionalUrl(payload.photos_url, 'Photos URL')

      // Normalize empty strings to null for nullable fields
      const nullable = ['zip_code', 'property_type', 'bedrooms', 'bathrooms', 'sqft', 'year_built',
        'lot_size_sqft', 'has_garage',
        'seller_name', 'phone', 'email', 'lead_source', 'asking_price', 'arv', 'renovation_cost',
        'mao', 'offer_price', 'rent_estimate', 'zillow_url', 'redfin_url', 'mls_url', 'photos_url',
        'follow_up_date', 'contract_signed_date', 'assigned_to', 'notes']
      nullable.forEach(k => { if (payload[k] === '') payload[k] = null })

      // Handle "All Members" assignment
      if (payload.assigned_to === '__all__') {
        payload.visible_to_all = true
        payload.assigned_to = null
      } else {
        payload.visible_to_all = false
      }

      // Coerce numbers to actual numbers (Supabase numeric)
      ;['bedrooms', 'sqft', 'year_built', 'lot_size_sqft'].forEach(k => {
        if (payload[k] !== null) payload[k] = parseInt(payload[k], 10)
      })

      if (lead?.id) {
        const { data: updated, error: upErr } = await supabase
          .from('leads')
          .update(payload)
          .eq('id', lead.id)
          .select()
          .single()
        if (upErr) throw upErr
        const userLookup = Object.fromEntries(members.map(m => [m.user_id, m.profiles]))
        await logChanges(lead.id, userId, lead, updated, userLookup)
        onSaved?.(updated)
      } else {
        payload.workspace_id = workspaceId
        payload.created_by = userId
        const { data: created, error: insErr } = await supabase
          .from('leads')
          .insert(payload)
          .select()
          .single()
        if (insErr) {
          if (insErr.code === '23505') {
            throw new Error('A lead with this address already exists in your workspace.')
          }
          throw insErr
        }
        await logLeadCreated(created.id, userId)
        onSaved?.(created)
      }
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const memberOptions = [
    { value: '', label: 'Unassigned' },
    { value: '__all__', label: '🌐 All Members' },
    ...members.map(m => ({ value: m.user_id, label: m.profiles?.full_name || 'User' })),
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={lead ? 'Edit Lead' : 'New Lead'}
      size="lg"
      footer={
        <div className="flex flex-col gap-2 w-full">
          {error && (
            <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} loading={saving}>{lead ? 'Save Changes' : 'Create Lead'}</Button>
          </div>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="p-2.5 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">{error}</div>}

        <section className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">Priority</span>
            <button
              type="button"
              onClick={() => update({ is_hot: !form.is_hot })}
              className={`inline-flex items-center gap-1.5 h-7 px-3 text-[12px] font-semibold rounded-md transition-all ${
                form.is_hot
                  ? 'bg-[oklch(0.5_0.22_25)] text-white shadow-[0_0_12px_oklch(0.65_0.22_25/0.5)]'
                  : 'bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-danger-soft)] hover:text-[color:var(--color-danger-text)] hover:border-[color:var(--color-danger)]'
              }`}
            >
              🔥 {form.is_hot ? 'HOT' : 'Mark Hot'}
            </button>
          </div>
          <StatusPicker value={form.status} onChange={v => update({ status: v })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {form.status === 'follow_up' && (
              <Input
                label="Follow-up Date"
                type="date"
                value={form.follow_up_date || ''}
                onChange={e => update({ follow_up_date: e.target.value })}
                required
              />
            )}
            {SIGNED_STATUSES.includes(form.status) && (
              <Input
                label="Contract Signed Date"
                type="date"
                value={form.contract_signed_date || ''}
                onChange={e => update({ contract_signed_date: e.target.value })}
              />
            )}
            {userRole === 'admin' && (
              <Select
                label="Assigned To"
                options={memberOptions}
                value={form.assigned_to}
                onChange={e => update({ assigned_to: e.target.value })}
              />
            )}
          </div>
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2.5">Property</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-end gap-2">
                <Input label="Address" required placeholder="Street address only" hint="Fill City & Zip below before looking up for best results" value={form.address} onChange={e => update({ address: e.target.value })} containerClassName="flex-1" />
                <button
                  type="button"
                  onClick={runLookup}
                  disabled={lookingUp || !form.address?.trim()}
                  className="h-8 inline-flex items-center gap-1.5 px-3 text-[12px] rounded-md bg-[color:var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
                  title="Look up this address on RentCast — autofills property details, MLS status, agent contact"
                >
                  {lookingUp ? 'Looking up…' : '🔍 Look up'}
                </button>
              </div>
              {/,|\b[A-Z]{2}\b|\b\d{5}\b/.test(form.address || '') && (
                <div className="text-[11.5px] px-2 py-1 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]">
                  Address looks like it includes city/state/zip — enter street only (e.g. "2712 Cherrywood Road"). Use the City, State, Zip fields below.
                </div>
              )}
              {lookupNotice && (
                <div className={`text-[11.5px] px-2 py-1 rounded ${
                  lookupNotice.kind === 'ok'
                    ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
                    : 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]'
                }`}>
                  {lookupNotice.kind === 'err' ? `⚠ ${lookupNotice.text} You can still create the lead manually.` : lookupNotice.text}
                </div>
              )}
              {duplicates.length > 0 && (
                <div className="p-2.5 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)] text-[color:var(--color-warn-text)] text-[12px] leading-relaxed">
                  <div className="flex items-start gap-2">
                    <span className="text-[14px] leading-none mt-0.5">⚠️</span>
                    <div className="flex-1">
                      <div className="font-semibold">
                        {duplicates.every(d => d.fuzzy)
                          ? `This might be the same property as an existing lead — double-check before saving.`
                          : duplicates.length === 1
                            ? 'A lead with this address already exists in this workspace.'
                            : `${duplicates.length} leads with this address already exist in this workspace.`}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {duplicates.map(d => (
                          <li key={d.id}>
                            <Link
                              to={`/w/${workspaceId}/leads/${d.id}`}
                              target="_blank"
                              className="underline hover:no-underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {d.address}
                            </Link>
                            {d.fuzzy && <span className="opacity-70 ml-1.5 italic">· possible match</span>}
                            <span className="opacity-70 ml-1.5">· {d.status?.replace(/_/g, ' ')}</span>
                            {d.follow_up_date && <span className="opacity-70 ml-1.5">· follow-up {d.follow_up_date}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Input label="City" placeholder="e.g. Jacksonville" value={form.city} onChange={e => update({ city: e.target.value })} />
            <Input label="State" value={form.state} onChange={e => update({ state: e.target.value })} />
            <Input label="Zip Code" value={form.zip_code} onChange={e => update({ zip_code: e.target.value })} />
            <Select label="Property Type" placeholder="Select…" options={PROPERTY_TYPES} value={form.property_type} onChange={e => update({ property_type: e.target.value })} />
            <Input label="Bedrooms" type="number" value={form.bedrooms} onChange={e => update({ bedrooms: e.target.value })} />
            <Input label="Bathrooms" type="number" step="0.5" value={form.bathrooms} onChange={e => update({ bathrooms: e.target.value })} />
            <Input label="Sqft" type="number" value={form.sqft} onChange={e => update({ sqft: e.target.value })} />
            <Input label="Year Built" type="number" value={form.year_built} onChange={e => update({ year_built: e.target.value })} />
            <Input label="Lot Size (sqft)" type="number" value={form.lot_size_sqft} onChange={e => update({ lot_size_sqft: e.target.value })} />
            <Select
              label="Garage"
              placeholder="—"
              options={[
                { value: 'true',  label: 'Yes' },
                { value: 'false', label: 'No' },
              ]}
              value={form.has_garage === null || form.has_garage === undefined ? '' : String(form.has_garage)}
              onChange={e => update({ has_garage: e.target.value === '' ? null : e.target.value === 'true' })}
            />
            <CurrencyInput label="Asking Price" value={form.asking_price} onChange={v => update({ asking_price: v })} containerClassName="sm:col-span-2" />
          </div>
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2.5">Notes</h3>
          <Textarea
            rows={5}
            value={form.notes || ''}
            onChange={e => update({ notes: e.target.value })}
            placeholder="General notes about this property, condition, owner motivation, anything worth remembering…"
          />
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2.5">Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Seller / Agent / Wholesaler Name" value={form.seller_name} onChange={e => update({ seller_name: e.target.value })} containerClassName="sm:col-span-2" />
            <Input label="Phone" value={form.phone} onChange={e => update({ phone: e.target.value })} />
            <Input label="Email" type="email" value={form.email} onChange={e => update({ email: e.target.value })} />
            <Select label="Lead Source" placeholder="Select…" options={LEAD_SOURCES} value={form.lead_source} onChange={e => update({ lead_source: e.target.value })} containerClassName="sm:col-span-2" />
          </div>
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2.5">Financial</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CurrencyInput label="Offer Price" value={form.offer_price} onChange={v => update({ offer_price: v })} />
            <CurrencyInput label="ARV (After Repair Value)" value={form.arv} onChange={v => update({ arv: v })} />
            <CurrencyInput label="Renovation Cost" value={form.renovation_cost} onChange={v => update({ renovation_cost: v })} />
            <CurrencyInput label="Rent Estimate" value={form.rent_estimate} onChange={v => update({ rent_estimate: v })} />
            <CurrencyInput label="MAO (auto-calculated, editable)" value={form.mao} onChange={v => update({ mao: v })} />
          </div>
          <p className="text-[11px] text-[color:var(--color-text-dim)] mt-2">MAO = 75% × ARV − Renovation</p>
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2.5">Links</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <div className="flex items-end gap-2">
                <Input
                  label="Zillow URL (auto-generated from address)"
                  value={form.zillow_url || ''}
                  onChange={e => update({ zillow_url: e.target.value })}
                  containerClassName="flex-1"
                  hint="Edit to override the auto link. Clear and re-edit address to regenerate."
                />
                {form.zillow_url && (
                  <a
                    href={form.zillow_url}
                    target="_blank"
                    rel="noreferrer"
                    className="h-8 inline-flex items-center gap-1.5 px-3 text-[12px] rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition shrink-0"
                  >
                    Open ↗
                  </a>
                )}
              </div>

              {/* MLS Status row */}
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-text-dim)]">MLS Status:</span>
                {form.mls_status ? (
                  (() => {
                    const meta = mlsStatusMeta(form.mls_status)
                    const toneCls = {
                      success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
                      warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
                      danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
                      accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
                      neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
                    }[meta.tone]
                    return (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium ${toneCls}`}>
                        {meta.label}
                      </span>
                    )
                  })()
                ) : (
                  <span className="text-[11.5px] text-[color:var(--color-text-dim)] italic">Not checked yet</span>
                )}
                {form.mls_last_checked && (
                  <span className="text-[10.5px] text-[color:var(--color-text-dim)]">
                    · checked {new Date(form.mls_last_checked).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                {lead?.id && form.zillow_url && (
                  <button
                    type="button"
                    onClick={async () => {
                      setRefreshingMls(true); setMlsRefreshErr(null)
                      try {
                        const r = await refreshLeadMls(lead.id)
                        if (r?.error) setMlsRefreshErr(r.error)
                        else if (r?.status) {
                          update({ mls_status: r.status, mls_last_checked: new Date().toISOString() })
                        }
                      } catch (e) {
                        setMlsRefreshErr(e.message)
                      } finally {
                        setRefreshingMls(false)
                      }
                    }}
                    disabled={refreshingMls}
                    className="text-[11px] px-2 h-6 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)] disabled:opacity-50 transition-colors"
                  >
                    {refreshingMls ? 'Checking…' : '↻ Refresh from Zillow'}
                  </button>
                )}
                {!lead?.id && (
                  <span className="text-[10.5px] text-[color:var(--color-text-dim)] italic">Save lead first to enable MLS check</span>
                )}
              </div>
              {mlsRefreshErr && (
                <div className="mt-1.5 text-[11px] text-[color:var(--color-danger-text)]">
                  {mlsRefreshErr}
                </div>
              )}
            </div>
            <Input label="Redfin URL" value={form.redfin_url || ''} onChange={e => update({ redfin_url: e.target.value })} />
            <Input label="MLS URL" value={form.mls_url || ''} onChange={e => update({ mls_url: e.target.value })} />
            <Input label="Photos URL" value={form.photos_url || ''} onChange={e => update({ photos_url: e.target.value })} containerClassName="sm:col-span-2" />
          </div>
        </section>

      </form>
    </Modal>
  )
}
