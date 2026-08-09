// core/negotiation-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { NegotiationConfig } from '../../config/negotiation.config'
import type { MaoResult } from '../financial-engine'

export interface MotivationSignals {
  notes: string
  teamComments: string
  daysOnMarket: number | null
  priceDropPct: number | null
}

export interface MotivationResult {
  score: number
  label: 'LOW' | 'MEDIUM' | 'HIGH'
  matchedTags: string[]
}

export interface AnchorResult {
  startingOffer: number
  targetPrice: number
  maxWalkAway: number
  reasoning: string[]
}

/**
 * Scores seller motivation from free-text and listing signals against the
 * weighted keyword list in negotiation.config.ts.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeMotivationScore(
  signals: MotivationSignals,
  config: NegotiationConfig
): MotivationResult

/**
 * Computes starting offer / target price / max walk-away using the room-factor
 * and credibility-floor model, bounded by the deal's MAO.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function computeAnchor(
  askingPrice: number,
  mao: MaoResult,
  motivation: MotivationResult,
  competitiveMode: boolean,
  config: NegotiationConfig
): AnchorResult
