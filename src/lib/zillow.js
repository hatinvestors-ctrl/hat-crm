// Generate a Zillow search URL from an address.
// Format: https://www.zillow.com/homes/{address-with-dashes}_rb/
// Zillow accepts loose matches — they'll resolve the closest listing.

export function buildZillowUrl({ address, city, state, zip_code }) {
  if (!address?.trim()) return ''
  const parts = [address, city, state, zip_code].filter(Boolean).join(' ')
  const slug = parts
    .trim()
    .replace(/[#.,]/g, '')        // strip punctuation Zillow ignores
    .replace(/\s+/g, '-')          // spaces → dashes
    .replace(/-+/g, '-')           // collapse repeats
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`
}

export function buildRedfinUrl({ address, city, state, zip_code }) {
  if (!address?.trim()) return ''
  const parts = [address, city, state, zip_code].filter(Boolean).join(' ')
  return `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(parts)}&v=2`
}
