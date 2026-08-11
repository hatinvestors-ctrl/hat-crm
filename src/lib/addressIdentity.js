// src/lib/addressIdentity.js
// Capability #10.5 — ONE unit-aware address representation, reused
// everywhere a property identity needs to be built or compared. Fixes the
// real gap #10.4 exposed: normalizeAddress() (leadDedup.js) strips '#'
// entirely and never separates a unit number from the street, so
// "10200 Belle Rive Blvd #270" and the bare complex address "10200 Belle
// Rive Blvd" were indistinguishable to any downstream matcher — exactly
// why BatchData skip-traced to the wrong LLC/owner in #10.4's Stage 1.
//
// This module does NOT replace normalizeAddress()/streetCore()
// (leadDedup.js) — those still own street-name/suffix normalization for
// dedup. This only adds the ONE thing they don't do: recognizing and
// isolating unit/apt/suite identity without destroying the base address.

// Recognizes APT/UNIT/#/STE (+ trailing punctuation like "APT." or "STE,")
// followed by a unit token, OR a bare "#270" with no label word.
const UNIT_PATTERN = /\b(?:apt|unit|ste|suite)\.?\s*#?\s*([a-z0-9-]+)\b|#\s*([a-z0-9-]+)\b/i

/**
 * Parses a single address-line string into { street, unit } — does NOT
 * attempt to parse city/state/zip out of a combined string (those are
 * expected as separate fields already, per every source this codebase
 * uses: Duval, HatCRM's own leads.city/state/zip_code, BatchData's own
 * request shape).
 *
 * @param {string} raw
 * @returns {{street: string, unit: string|null}}
 */
export function parseUnitAwareAddress(raw) {
  if (!raw) return { street: '', unit: null }
  const s = String(raw).trim()
  const match = s.match(UNIT_PATTERN)
  if (!match) return { street: s.replace(/\s+/g, ' ').trim(), unit: null }

  const unit = (match[1] || match[2] || '').trim()
  // Don't let a bare "#" match consume a legitimate street-number-looking
  // token from somewhere it isn't a unit (e.g. never applied to the
  // leading house number — UNIT_PATTERN only matches with the apt/unit/ste
  // keyword or a literal '#', never a lone number, so this is safe).
  const street = s.slice(0, match.index).replace(/\s+/g, ' ').trim()
  return { street: street || s.replace(/\s+/g, ' ').trim(), unit: unit || null }
}

/**
 * Builds the strongest available property identity for a paid lookup,
 * combining whatever unit information is available across our own fields
 * — preferring an explicit unit already in `address`, falling back to one
 * embedded in `owner_mailing_address` (Duval's MAILADDR line commonly
 * carries it even when the property address itself doesn't).
 *
 * @param {{address: string, city?: string, state?: string, zip_code?: string, owner_mailing_address?: string}} lead
 * @returns {{street: string, unit: string|null, city: string, state: string, zip: string, identitySource: string}}
 */
export function buildStrongestIdentity(lead) {
  const fromAddress = parseUnitAwareAddress(lead?.address)
  if (fromAddress.unit) {
    return { street: fromAddress.street, unit: fromAddress.unit, city: lead.city || '', state: lead.state || '', zip: lead.zip_code || '', identitySource: 'address' }
  }
  const fromMailing = parseUnitAwareAddress(lead?.owner_mailing_address)
  if (fromMailing.unit) {
    return { street: fromAddress.street, unit: fromMailing.unit, city: lead.city || '', state: lead.state || '', zip: lead.zip_code || '', identitySource: 'owner_mailing_address' }
  }
  return { street: fromAddress.street, unit: null, city: lead.city || '', state: lead.state || '', zip: lead.zip_code || '', identitySource: 'address' }
}

/**
 * Formats a unit-aware identity into the single street-line string a
 * provider's address-line field expects (e.g. BatchData's
 * propertyAddress.street) — "UNIT" is the most broadly recognized label
 * across providers/USPS conventions.
 */
export function formatStreetWithUnit(identity) {
  if (!identity?.street) return ''
  return identity.unit ? `${identity.street} UNIT ${identity.unit}` : identity.street
}
