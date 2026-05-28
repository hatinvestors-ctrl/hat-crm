// URL safety helpers. Block javascript:, data:, vbscript:, file: schemes
// to prevent stored XSS via lead URL fields (zillow_url, redfin_url, mls_url, photos_url)
// that get rendered as <a href>.

const SAFE_SCHEMES = ['http:', 'https:']

export function isSafeHttpUrl(url) {
  if (url === null || url === undefined || url === '') return true // empty is ok
  try {
    const u = new URL(String(url).trim())
    return SAFE_SCHEMES.includes(u.protocol.toLowerCase())
  } catch {
    return false
  }
}

// Returns the URL if safe, null otherwise. Use for href={safeUrl(...)}
export function safeUrl(url) {
  return isSafeHttpUrl(url) ? url : null
}

// Returns the URL if safe AND non-empty, else null. For validation on save.
export function validateOptionalUrl(url, fieldLabel = 'URL') {
  if (!url || !String(url).trim()) return null
  if (!isSafeHttpUrl(url)) {
    throw new Error(`${fieldLabel} must start with http:// or https://`)
  }
  return String(url).trim()
}

// Sanitize a phone number to be safe in tel: links. Strip everything that
// could let an attacker break out of the URI scheme.
export function safeTelHref(phone) {
  if (!phone) return null
  const clean = String(phone).replace(/[^\d+]/g, '')
  return clean ? `tel:${clean}` : null
}

// Sanitize email for mailto links. Reject anything that looks like header injection.
export function safeMailtoHref(email) {
  if (!email) return null
  const e = String(email).trim()
  // Basic email shape + no CR/LF/comma/semicolon (header injection)
  if (!/^[^\s,;<>"'\\/\r\n]+@[^\s,;<>"'\\/\r\n]+\.[^\s,;<>"'\\/\r\n]+$/.test(e)) return null
  return `mailto:${encodeURIComponent(e).replace(/%40/g, '@')}`
}
