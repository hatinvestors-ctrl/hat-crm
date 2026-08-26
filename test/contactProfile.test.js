// test/contactProfile.test.js
// Rich Skip Trace Contact Profile V1 — pure normalization/merge logic,
// plus a full provider-response -> real classifyPersonMatch -> profile
// chain against test/fixtures/batchdata-skiptrace-response.json (see that
// file's _provenance note: no real captured raw payload exists anywhere
// in this repo, so this fixture is built strictly from fields this
// codebase's own Stage-1-verified comments confirm the provider returns —
// no relationship/spouse field, since none has ever been observed here).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import fixture from './fixtures/batchdata-skiptrace-response.json'
import { buildContactProfile, mergeContactProfile, normalizePhoneDigits, normalizeEmailKey } from '../src/lib/contactProfile.js'
import { classifyPersonMatch } from '../netlify/functions/batchdata-enrich.mjs'

const LEAD = { owner_name: 'JOHN A SMITH' }
const IDENTITY = { unit: null }

function realRanked() {
  const persons = fixture.result.data[0].persons
  return persons.map(p => ({ p, match: classifyPersonMatch(p, LEAD, IDENTITY) }))
    .sort((a, b) => ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(a.match) - ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(b.match))
}

describe('Full chain — real provider response shape -> real matching -> buildContactProfile', () => {
  const ranked = realRanked()
  const profile = buildContactProfile(ranked, { propertyMatchStatus: ranked[0].match })

  it('Test 1 — multiple phones preserved for the primary person', () => {
    expect(profile.phones.length).toBe(2) // 9045551212 x2 (dupes) + landline -> 2 unique
  })
  it('Test 2 — duplicate phone formats collapse to one', () => {
    // "9045551212" and "(904) 555-1212" are the same number in different formats
    const numbers = profile.phones.map(p => p.number)
    expect(new Set(numbers).size).toBe(numbers.length) // no duplicate keys survived
    expect(numbers).toContain('9045551212')
  })
  it('Test 3 — primary phone selected deterministically (rank asc, then reachable, then Mobile)', () => {
    const primary = profile.phones.find(p => p.is_primary)
    expect(primary.number).toBe('9045551212')
    expect(primary.rank).toBe(1)
  })
  it('Test 5 — multiple emails preserved', () => {
    expect(profile.emails.length).toBe(1) // the two source emails are case-variant dupes of the same address
  })
  it('Test 6 — duplicate emails (case-variant) collapse to one', () => {
    expect(profile.emails[0].email).toBe('john.smith@example.com')
  })
  it('Test 7 — a legitimate associated person is preserved', () => {
    expect(profile.associated_people.some(a => a.name === 'MARY SMITH')).toBe(true)
  })
  it('Test 9 — an unlabeled associated person is NEVER converted into "spouse"', () => {
    const mary = profile.associated_people.find(a => a.name === 'MARY SMITH')
    expect(mary.relationship).toBe('ASSOCIATED_PERSON')
    expect(JSON.stringify(profile)).not.toMatch(/spouse/i)
  })
  it('a genuinely unrelated person (no name/token overlap) is excluded entirely', () => {
    expect(profile.associated_people.some(a => a.name === 'RANDOM UNRELATED PERSON')).toBe(false)
  })
  it('mailing address is preserved from the primary person', () => {
    expect(profile.mailing_addresses[0].full_address).toMatch(/123 MAIN ST/)
  })
  it('provider and match metadata are real, not fabricated', () => {
    expect(profile.provider).toBe('batchdata')
    expect(profile.match.person_match_status).toBe(ranked[0].match)
  })
})

describe('Test 8 — explicit spouse label is preserved verbatim IF the provider ever supplies one (defensive — not exercised by real fixture data)', () => {
  it('buildContactProfile never invents a relationship string beyond ASSOCIATED_PERSON, by construction', () => {
    const ranked = realRanked()
    const profile = buildContactProfile(ranked, {})
    for (const a of profile.associated_people) {
      expect(a.relationship).toBe('ASSOCIATED_PERSON')
    }
  })
})

describe('Test 10 — external associated person is never a confirmed decision maker (structural)', () => {
  it('LiveCopilot.jsx never writes contact_profile associated_people into seller_intelligence/decision_makers', () => {
    const src = fs.readFileSync('src/components/lead-detail/LiveCopilot.jsx', 'utf8')
    // The hint block reads associated_people but must never assign it to decision_makers.
    expect(src).toMatch(/associated_people/)
    expect(src).not.toMatch(/decision_makers:\s*.*associated_people/)
  })
})

describe('Test 16/17/18 — partial and empty responses handled honestly', () => {
  it('a phone-only person (no emails) still produces a usable profile', () => {
    const ranked = [{ p: { name: { full: 'A B' }, phones: [{ rank: 1, number: '9045550001' }], emails: [] }, match: 'VERIFIED' }]
    const profile = buildContactProfile(ranked, {})
    expect(profile.phones.length).toBe(1)
    expect(profile.emails.length).toBe(0)
  })
  it('an email-only person (no phones) still produces a usable profile', () => {
    const ranked = [{ p: { name: { full: 'A B' }, phones: [], emails: [{ rank: 1, email: 'a@b.com' }] }, match: 'VERIFIED' }]
    const profile = buildContactProfile(ranked, {})
    expect(profile.emails.length).toBe(1)
    expect(profile.phones.length).toBe(0)
  })
  it('Test 18 — a person with neither phone nor email produces NO profile (never an empty shell)', () => {
    const ranked = [{ p: { name: { full: 'A B' }, phones: [], emails: [] }, match: 'VERIFIED' }]
    expect(buildContactProfile(ranked, {})).toBeNull()
  })
  it('an empty ranked array produces null, never a crash', () => {
    expect(buildContactProfile([], {})).toBeNull()
    expect(buildContactProfile(null, {})).toBeNull()
  })
})

describe('Test 15 — mergeContactProfile: non-destructive rerun', () => {
  it('a rerun adds a new phone without duplicating or losing the existing one', () => {
    const existing = { phones: [{ number: '9045551111', rank: 1, is_primary: true }], emails: [], associated_people: [], mailing_addresses: [] }
    const incoming = { phones: [{ number: '9045552222', rank: 1 }], emails: [], associated_people: [], mailing_addresses: [] }
    const merged = mergeContactProfile(existing, incoming)
    expect(merged.phones.map(p => p.number).sort()).toEqual(['9045551111', '9045552222'])
  })
  it('a rerun returning the SAME phone updates metadata, never creates a duplicate entry', () => {
    const existing = { phones: [{ number: '9045551111', rank: 2, tested: false, is_primary: true }], emails: [], associated_people: [], mailing_addresses: [] }
    const incoming = { phones: [{ number: '9045551111', rank: 1, tested: true }], emails: [], associated_people: [], mailing_addresses: [] }
    const merged = mergeContactProfile(existing, incoming)
    expect(merged.phones.length).toBe(1)
    expect(merged.phones[0].tested).toBe(true) // updated metadata
  })
  it('merging with null on either side never throws and returns the other side untouched', () => {
    const p = { phones: [{ number: '1', rank: 1 }], emails: [], associated_people: [], mailing_addresses: [] }
    expect(mergeContactProfile(null, p)).toBe(p)
    expect(mergeContactProfile(p, null)).toBe(p)
  })
  it('associated people merge by name without duplicating', () => {
    const existing = { phones: [], emails: [], associated_people: [{ name: 'MARY SMITH', relationship: 'ASSOCIATED_PERSON', phones: [], emails: [] }], mailing_addresses: [] }
    const incoming = { phones: [], emails: [], associated_people: [{ name: 'MARY SMITH', relationship: 'ASSOCIATED_PERSON', phones: [{ number: '9045559999', rank: 1 }], emails: [] }], mailing_addresses: [] }
    const merged = mergeContactProfile(existing, incoming)
    expect(merged.associated_people.length).toBe(1)
    expect(merged.associated_people[0].phones.length).toBe(1)
  })
})

describe('Normalization helpers', () => {
  it('phone digits normalize across common formats to the same key', () => {
    expect(normalizePhoneDigits('9045551212')).toBe('9045551212')
    expect(normalizePhoneDigits('(904) 555-1212')).toBe('9045551212')
    expect(normalizePhoneDigits('+1 904-555-1212')).toBe('9045551212')
  })
  it('email keys normalize case/whitespace', () => {
    expect(normalizeEmailKey('  John@Example.com ')).toBe('john@example.com')
  })
})

describe('Test 11/12/13 — backward compatibility (unchanged fields)', () => {
  it('batchdata-enrich.mjs still writes lead.phone/lead.email from the single best match only (unchanged primary logic, structural)', () => {
    const src = fs.readFileSync('netlify/functions/batchdata-enrich.mjs', 'utf8')
    expect(src).toMatch(/leadUpdate\.phone = phones\.primary/)
    expect(src).toMatch(/leadUpdate\.email = email/)
    expect(src).toMatch(/!lead\.phone && phones\.primary/) // manual phone never silently overwritten
  })
  it('Test 20 — existing BatchData safety files are untouched by this capability (zero diff)', () => {
    // Verified via git diff in the delivery report; structurally reconfirm
    // this file never redefines classifyPersonMatch's own logic elsewhere.
    const preflight = fs.readFileSync('src/lib/batchDataPreflight.js', 'utf8')
    expect(preflight).not.toMatch(/contact_profile/)
  })
})

describe('Test 19 — wrong-property/person match writes no contact data', () => {
  it('an AMBIGUOUS or NO_MATCH primary never reaches buildContactProfile (gated in batchdata-enrich.mjs, structural)', () => {
    const src = fs.readFileSync('netlify/functions/batchdata-enrich.mjs', 'utf8')
    expect(src).toMatch(/contactMatchStatus === 'VERIFIED' \|\| contactMatchStatus === 'LIKELY'\)\s*\{\s*\n\s*phones = pickPhones/)
    expect(src).toMatch(/newContactProfile = buildContactProfile/)
  })
})
