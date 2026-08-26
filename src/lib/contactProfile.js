// src/lib/contactProfile.js
// Capability — Rich Skip Trace Contact Profile V1.
//
// AUDIT FINDING (see delivery report): BatchData's real, Stage-1-verified
// skip-trace response is result.result.data[0].persons[] — a PLURAL array.
// netlify/functions/batchdata-enrich.mjs already computes `ranked`, a
// match-classified sort of every person in that array (classifyPersonMatch,
// unchanged, reused as-is here) — but historically kept only ranked[0] and
// discarded every other person and all but one phone/email. This module
// builds the full structured profile from that SAME already-computed
// `ranked` array — it does not call BatchData, does not re-run matching,
// and does not invent any field the provider hasn't been confirmed (via
// this codebase's own Stage-1 comments) to actually return: name.full/
// first/last, phones[].{rank,number,type,carrier,tested,reachable,dnc,
// tcpa}, emails[].{rank,email,tested}, addresses[].{fullAddress,street,
// propertyMailingAddress}. No "spouse"/"relative"/relationship field has
// ever been observed here — every non-primary person is therefore always
// ASSOCIATED_PERSON, never inferred as spouse (mission Section 5/6).

// ── Normalization / dedupe keys ──────────────────────────────────────────
export function normalizePhoneDigits(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return digits || null // shorter/garbage input kept as-is rather than silently dropped
}
export function normalizeEmailKey(raw) {
  if (!raw) return null
  return String(raw).trim().toLowerCase() || null
}

function dedupePhones(phones) {
  const byKey = new Map()
  for (const p of phones || []) {
    const key = normalizePhoneDigits(p.number)
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, {
        number: key, raw: p.number, type: p.type || null, carrier: p.carrier || null,
        tested: p.tested ?? null, reachable: p.reachable ?? null, dnc: p.dnc ?? null,
        tcpa: p.tcpa ?? null, rank: p.rank ?? null, source: 'batchdata', is_primary: false,
      })
    }
  }
  return [...byKey.values()]
}
function dedupeEmails(emails) {
  const byKey = new Map()
  for (const e of emails || []) {
    const key = normalizeEmailKey(e.email)
    if (!key) continue
    if (!byKey.has(key)) {
      byKey.set(key, { email: key, raw: e.email, tested: e.tested ?? null, rank: e.rank ?? null, source: 'batchdata', is_primary: false })
    }
  }
  return [...byKey.values()]
}
function dedupeAddresses(addresses) {
  const seen = new Set()
  const out = []
  for (const a of addresses || []) {
    const key = (a.fullAddress || a.street || '').trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ full_address: a.fullAddress || a.street || null, is_property_mailing_address: !!a.propertyMailingAddress })
  }
  return out
}

// Primary phone/email selection — Section 3/4's documented rule, EXACT
// same effective priority the pre-existing pickPhones()/pickEmail() in
// batchdata-enrich.mjs already applied (rank asc, then reachable, then
// Mobile-type first for phones; rank asc, then tested for emails) — this
// function only marks is_primary on the entry that selection would have
// picked, it does not change what gets picked.
function markPrimaryPhone(phones) {
  if (!phones.length) return phones
  const sorted = [...phones].sort((a, b) =>
    (a.rank ?? 99) - (b.rank ?? 99) || ((b.reachable ? 1 : 0) - (a.reachable ? 1 : 0)) || ((b.type === 'Mobile' ? 1 : 0) - (a.type === 'Mobile' ? 1 : 0))
  )
  sorted[0].is_primary = true
  return phones.map(p => ({ ...p, is_primary: p.number === sorted[0].number }))
}
function markPrimaryEmail(emails) {
  if (!emails.length) return emails
  const sorted = [...emails].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || ((b.tested ? 1 : 0) - (a.tested ? 1 : 0)))
  return emails.map(e => ({ ...e, is_primary: e.email === sorted[0].email }))
}

/**
 * Builds the full structured contact profile from the SAME `ranked` array
 * batchdata-enrich.mjs already computes (persons ranked by
 * classifyPersonMatch — reused unmodified, zero new matching logic).
 * Only persons whose match status is not NO_MATCH are included as
 * associated people — the existing safety layer's own verdict, not a new
 * check invented here.
 *
 * @param {Array<{p: object, match: string}>} ranked - classifyPersonMatch results, sorted best-first
 * @param {object} opts - { enrichedAt, propertyMatchStatus }
 */
export function buildContactProfile(ranked, { enrichedAt, propertyMatchStatus } = {}) {
  if (!ranked?.length) return null
  const [primaryEntry, ...rest] = ranked
  const primary = primaryEntry.p

  const phones = markPrimaryPhone(dedupePhones(primary.phones))
  const emails = markPrimaryEmail(dedupeEmails(primary.emails))
  if (phones.length === 0 && emails.length === 0) return null // nothing usable — Section 12, don't build an empty shell

  const associatedPeople = rest
    .filter(r => r.match !== 'NO_MATCH')
    .map(r => ({
      name: r.p.name?.full || [r.p.name?.first, r.p.name?.last].filter(Boolean).join(' ') || null,
      relationship: 'ASSOCIATED_PERSON', // Section 5/6 — never inferred as spouse; the provider has never been observed to supply a relationship label here.
      match_status: r.match,
      phones: dedupePhones(r.p.phones),
      emails: dedupeEmails(r.p.emails),
      source: 'batchdata',
    }))
    .filter(a => a.name || a.phones.length || a.emails.length)

  return {
    provider: 'batchdata',
    enriched_at: enrichedAt || new Date().toISOString(),
    primary_person: {
      name: primary.name?.full || null,
      first_name: primary.name?.first || null,
      last_name: primary.name?.last || null,
    },
    phones,
    emails,
    associated_people: associatedPeople,
    mailing_addresses: dedupeAddresses(primary.addresses),
    match: {
      property_match_status: propertyMatchStatus || null,
      person_match_status: primaryEntry.match,
    },
  }
}

// ── Non-destructive merge — Section 11. A rerun never erases an existing
// contact, never duplicates an identical one, and only adds/updates
// provider metadata. ────────────────────────────────────────────────────
export function mergeContactProfile(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing

  const mergeList = (existingList, incomingList, keyFn) => {
    const byKey = new Map(existingList.map(item => [keyFn(item), item]))
    for (const item of incomingList) {
      const key = keyFn(item)
      // Update metadata for an already-known contact rather than duplicate it.
      byKey.set(key, { ...byKey.get(key), ...item, is_primary: false })
    }
    return [...byKey.values()]
  }

  const phones = markPrimaryPhone(mergeList(existing.phones || [], incoming.phones || [], p => p.number))
  const emails = markPrimaryEmail(mergeList(existing.emails || [], incoming.emails || [], e => e.email))

  // Associated people merged by name (the only stable identifier BatchData
  // gives us for a non-primary person) — same non-destructive add/update.
  const byName = new Map((existing.associated_people || []).map(a => [a.name, a]))
  for (const a of incoming.associated_people || []) {
    const prior = byName.get(a.name)
    byName.set(a.name, prior ? { ...prior, ...a, phones: mergeList(prior.phones, a.phones, p => p.number), emails: mergeList(prior.emails, a.emails, e => e.email) } : a)
  }

  const addrSeen = new Set((existing.mailing_addresses || []).map(a => a.full_address))
  const mailing_addresses = [...(existing.mailing_addresses || []), ...(incoming.mailing_addresses || []).filter(a => !addrSeen.has(a.full_address))]

  return {
    ...existing,
    ...incoming,
    phones, emails,
    associated_people: [...byName.values()],
    mailing_addresses,
  }
}
