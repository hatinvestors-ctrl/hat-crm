/**
 * Suggests a renovation tier (cosmetic / medium / heavy) based on
 * lead notes, AI analysis text, and property fields.
 *
 * Returns { tier: 'cosmetic'|'medium'|'heavy', reason: string }
 */
export function suggestRenoTier(lead) {
  const text = [
    lead.notes || '',
    lead.ai_notes || '',
    lead.description || '',
    lead.property_condition || '',
  ].join(' ').toLowerCase()

  let heavyScore = 0
  let mediumScore = 0
  let cosmeticScore = 0

  // ── Heavy signals ──────────────────────────────────────────────
  const heavyKeywords = [
    { kw: 'no permit',        score: 3, tag: 'unpermitted work' },
    { kw: 'unpermitted',      score: 3, tag: 'unpermitted work' },
    { kw: 'foundation',       score: 3, tag: 'foundation issues' },
    { kw: 'structural',       score: 3, tag: 'structural issues' },
    { kw: 'fire damage',      score: 3, tag: 'fire damage' },
    { kw: 'flood',            score: 3, tag: 'flood/water damage' },
    { kw: 'mold',             score: 3, tag: 'mold' },
    { kw: 'gut',              score: 2, tag: 'gut renovation' },
    { kw: 'gut rehab',        score: 3, tag: 'gut rehab' },
    { kw: 'needs everything', score: 3, tag: 'needs everything' },
    { kw: 'total rehab',      score: 3, tag: 'total rehab' },
    { kw: 'needs roof',       score: 2, tag: 'roof needed' },
    { kw: 'roof replacement', score: 2, tag: 'roof replacement' },
    { kw: 'bad roof',         score: 2, tag: 'bad roof' },
    { kw: 'electrical',       score: 2, tag: 'electrical work' },
    { kw: 'rewire',           score: 2, tag: 'rewiring needed' },
    { kw: 'plumbing',         score: 2, tag: 'plumbing work' },
    { kw: 'knob and tube',    score: 3, tag: 'knob-and-tube wiring' },
    { kw: 'heavy renovation', score: 3, tag: 'heavy renovation' },
    { kw: 'full renovation',  score: 2, tag: 'full renovation' },
    { kw: 'major renovation', score: 2, tag: 'major renovation' },
    { kw: 'abandoned',        score: 2, tag: 'abandoned property' },
    { kw: 'vacant',           score: 1, tag: 'vacant' },
    { kw: 'hoarder',          score: 2, tag: 'hoarder home' },
    { kw: 'distressed',       score: 1, tag: 'distressed' },
  ]

  // ── Medium signals ─────────────────────────────────────────────
  const mediumKeywords = [
    { kw: 'hvac',             score: 2, tag: 'HVAC' },
    { kw: 'ac unit',          score: 2, tag: 'AC unit' },
    { kw: 'water heater',     score: 1, tag: 'water heater' },
    { kw: 'windows',          score: 1, tag: 'windows' },
    { kw: 'kitchen remodel',  score: 2, tag: 'kitchen remodel' },
    { kw: 'full kitchen',     score: 2, tag: 'kitchen work' },
    { kw: 'bathroom remodel', score: 2, tag: 'bathroom remodel' },
    { kw: 'siding',           score: 1, tag: 'siding' },
    { kw: 'mechanicals',      score: 2, tag: 'mechanicals' },
    { kw: 'medium renovation',score: 3, tag: 'medium renovation' },
    { kw: 'partial rehab',    score: 2, tag: 'partial rehab' },
    { kw: 'needs updating',   score: 1, tag: 'needs updating' },
    { kw: 'dated',            score: 1, tag: 'dated finishes' },
    { kw: 'outdated',         score: 1, tag: 'outdated' },
  ]

  // ── Cosmetic signals ───────────────────────────────────────────
  const cosmeticKeywords = [
    { kw: 'cosmetic',         score: 3, tag: 'cosmetic only' },
    { kw: 'paint',            score: 1, tag: 'paint/floors' },
    { kw: 'flooring',         score: 1, tag: 'flooring' },
    { kw: 'carpet',           score: 1, tag: 'carpet' },
    { kw: 'light update',     score: 2, tag: 'light updates' },
    { kw: 'minor update',     score: 2, tag: 'minor updates' },
    { kw: 'clean up',         score: 1, tag: 'clean up' },
    { kw: 'move-in ready',    score: 2, tag: 'near move-in ready' },
    { kw: 'good condition',   score: 2, tag: 'good condition' },
    { kw: 'well maintained',  score: 2, tag: 'well maintained' },
    { kw: 'updated kitchen',  score: 2, tag: 'kitchen updated' },
    { kw: 'new roof',         score: 2, tag: 'roof already new' },
    { kw: 'new hvac',         score: 2, tag: 'HVAC already new' },
    { kw: 'new ac',           score: 2, tag: 'AC already new' },
    { kw: 'freshly painted',  score: 2, tag: 'freshly painted' },
    { kw: 'fixtures',         score: 1, tag: 'fixture updates' },
  ]

  const heavyMatches  = heavyKeywords.filter(k => text.includes(k.kw))
  const mediumMatches = mediumKeywords.filter(k => text.includes(k.kw))
  const cosmeticMatches = cosmeticKeywords.filter(k => text.includes(k.kw))

  heavyScore   = heavyMatches.reduce((s, k) => s + k.score, 0)
  mediumScore  = mediumMatches.reduce((s, k) => s + k.score, 0)
  cosmeticScore = cosmeticMatches.reduce((s, k) => s + k.score, 0)

  // Property age boost — older homes more likely to need major work
  const yr = lead.year_built ? Number(lead.year_built) : null
  if (yr && yr < 1960) { heavyScore += 2 }
  else if (yr && yr < 1980) { mediumScore += 1 }
  else if (yr && yr >= 2000) { cosmeticScore += 1 }

  // If AI analysis mentions condition explicitly
  const condMatch = text.match(/condition:\s*(light cosmetic|cosmetic|medium|heavy|unknown)/i)
  if (condMatch) {
    const cond = condMatch[1].toLowerCase()
    if (cond.includes('heavy'))   heavyScore   += 4
    else if (cond.includes('medium'))  mediumScore  += 4
    else if (cond.includes('cosmetic')) cosmeticScore += 4
  }

  let tier, reason, tags

  if (heavyScore > mediumScore && heavyScore > cosmeticScore) {
    tier = 'heavy'
    tags = heavyMatches.slice(0, 3).map(k => k.tag)
    reason = tags.length
      ? `Notes mention: ${tags.join(', ')}${yr && yr < 1960 ? ` · built ${yr}` : ''}`
      : yr && yr < 1960 ? `Built ${yr} — older homes typically need major systems work` : 'Multiple risk signals in notes'
  } else if (mediumScore > cosmeticScore) {
    tier = 'medium'
    tags = mediumMatches.slice(0, 3).map(k => k.tag)
    reason = tags.length
      ? `Notes mention: ${tags.join(', ')}`
      : 'Typical mid-tier condition for this property type'
  } else if (cosmeticScore > 0) {
    tier = 'cosmetic'
    tags = cosmeticMatches.slice(0, 2).map(k => k.tag)
    reason = tags.length
      ? `Notes suggest: ${tags.join(', ')}`
      : 'Property appears to be in good condition'
  } else {
    // No signals — default to medium as safe middle ground
    tier = 'medium'
    reason = 'No condition signals found — medium is a safe starting estimate'
  }

  return { tier, reason }
}
