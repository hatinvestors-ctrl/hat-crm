// src/components/lead-detail/ContactIntelligenceCard.jsx
// Capability — Rich Skip Trace Contact Profile V1, Section 7. Compact by
// default, progressively discloses the full profile. Renders from
// lead.enrichment_data.contact_profile — falls back to the plain phone/
// email Facts a lead without a rich profile already had (backward
// compatible with pre-this-capability leads and manually-entered contact
// data, which never has a contact_profile at all).
import { useState } from 'react'
import { formatPhone } from '../../lib/calculations'
import { safeTelHref, safeMailtoHref } from '../../lib/urlSafety'

function fmtPhone(p) {
  return formatPhone(p.raw || p.number) + (p.type ? ` — ${p.type}` : '')
}

export default function ContactIntelligenceCard({ lead }) {
  const [expanded, setExpanded] = useState(false)
  const profile = lead?.enrichment_data?.contact_profile
  if (!profile) return null // caller falls back to the plain Fact grid

  const primaryPhone = profile.phones?.find(p => p.is_primary) || profile.phones?.[0]
  const primaryEmail = profile.emails?.find(e => e.is_primary) || profile.emails?.[0]
  const extraPhones = (profile.phones || []).filter(p => p !== primaryPhone)
  const extraEmails = (profile.emails || []).filter(e => e !== primaryEmail)
  const associatedCount = profile.associated_people?.length || 0

  return (
    <div className="mt-1">
      <div className="text-[9.5px] uppercase tracking-widest text-amber-700/70 dark:text-amber-400/70 font-semibold mb-1">
        Contact Intelligence
      </div>
      {profile.primary_person?.name && (
        <div className="text-[12.5px] font-semibold text-[color:var(--color-text)] mb-1">{profile.primary_person.name}</div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
        {primaryPhone && (
          <a href={safeTelHref(primaryPhone.raw || primaryPhone.number)} className="hover:text-[color:var(--color-accent-text)]">
            📱 {formatPhone(primaryPhone.raw || primaryPhone.number)}
          </a>
        )}
        {primaryEmail && (
          <a href={safeMailtoHref(primaryEmail.raw || primaryEmail.email)} className="hover:text-[color:var(--color-accent-text)]">
            ✉ {primaryEmail.raw || primaryEmail.email}
          </a>
        )}
      </div>

      {(extraPhones.length > 0 || extraEmails.length > 0 || associatedCount > 0) && !expanded && (
        <div className="text-[11px] text-amber-700/70 dark:text-amber-400/70 mt-1 space-x-2">
          {extraPhones.length > 0 && <span>+ {extraPhones.length} additional phone{extraPhones.length === 1 ? '' : 's'}</span>}
          {extraEmails.length > 0 && <span>+ {extraEmails.length} additional email{extraEmails.length === 1 ? '' : 's'}</span>}
          {associatedCount > 0 && <span>+ {associatedCount} associated person{associatedCount === 1 ? '' : 's'}</span>}
        </div>
      )}

      <button onClick={() => setExpanded(v => !v)} className="text-[10.5px] font-semibold underline text-amber-700/80 dark:text-amber-400/80 mt-1.5">
        {expanded ? 'Hide Full Contact Intelligence' : 'View All Contact Intelligence'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2.5 border-t border-amber-300/40 dark:border-amber-800/40 pt-2">
          {profile.phones?.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70 font-semibold mb-0.5">Phone Numbers</div>
              {profile.phones.map(p => (
                <div key={p.number} className="text-[11.5px] flex items-center gap-2">
                  <a href={safeTelHref(p.raw || p.number)} className="hover:text-[color:var(--color-accent-text)]">{fmtPhone(p)}</a>
                  {p.is_primary && <span className="text-[9px] font-bold px-1 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">PRIMARY</span>}
                  {p.dnc && <span className="text-[9px] font-bold text-[color:var(--color-danger-text)]">DNC</span>}
                </div>
              ))}
            </div>
          )}
          {profile.emails?.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70 font-semibold mb-0.5">Emails</div>
              {profile.emails.map(e => (
                <div key={e.email} className="text-[11.5px] flex items-center gap-2">
                  <a href={safeMailtoHref(e.raw || e.email)} className="hover:text-[color:var(--color-accent-text)]">{e.raw || e.email}</a>
                  {e.is_primary && <span className="text-[9px] font-bold px-1 rounded bg-amber-200/70 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">PRIMARY</span>}
                </div>
              ))}
            </div>
          )}
          {associatedCount > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70 font-semibold mb-0.5">Associated People</div>
              {profile.associated_people.map((a, i) => (
                <div key={i} className="text-[11.5px] mb-1">
                  <div className="font-semibold">{a.name || 'Unnamed'} <span className="text-[10px] font-normal text-amber-700/70 dark:text-amber-400/70">— {a.relationship === 'ASSOCIATED_PERSON' ? 'Associated Person (relationship not confirmed by provider)' : a.relationship}</span></div>
                  {a.phones?.map(p => <div key={p.number} className="text-[11px] text-[color:var(--color-text-muted)] ml-2">📱 {formatPhone(p.raw || p.number)}</div>)}
                  {a.emails?.map(e => <div key={e.email} className="text-[11px] text-[color:var(--color-text-muted)] ml-2">✉ {e.raw || e.email}</div>)}
                </div>
              ))}
              <div className="text-[10px] italic text-amber-700/70 dark:text-amber-400/70">Potential additional decision maker from public/contact data — verify during conversation.</div>
            </div>
          )}
          {profile.mailing_addresses?.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70 font-semibold mb-0.5">Mailing / Other Contact Info</div>
              {profile.mailing_addresses.map((a, i) => (
                <div key={i} className="text-[11.5px]">{a.full_address}{a.is_property_mailing_address ? ' (property mailing address)' : ''}</div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-amber-700/60 dark:text-amber-400/60">Source: BatchData · Enriched {profile.enriched_at ? new Date(profile.enriched_at).toLocaleDateString() : '—'}</div>
        </div>
      )}
    </div>
  )
}
