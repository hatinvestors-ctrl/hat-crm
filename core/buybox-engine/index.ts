// core/buybox-engine — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md

import type { BuyBoxConfig } from '../../config/buybox.config'

export interface ZipEligibilityResult {
  eligible: boolean
  reason: string
  tier: 'A' | 'B' | 'C' | 'blocked' | 'unknown'
}

export interface SenseCheckResult {
  passes: boolean
  grossSpreadPct: number | null
  reason: string
}

export interface BuyBoxResult {
  eligible: boolean
  zipResult: ZipEligibilityResult
  propertyTypeEligible: boolean
  senseCheck: SenseCheckResult
  reasons: string[]
}

/**
 * Determines whether a ZIP is eligible, blocked, or preferred.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function checkZipEligibility(
  zip: string,
  config: BuyBoxConfig
): ZipEligibilityResult

/**
 * Determines whether a property type passes the hard-skip list.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function checkPropertyType(
  propertyType: string,
  config: BuyBoxConfig
): boolean

/**
 * Runs the financial sense-check (gross spread vs threshold, ZIP-tier aware).
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function checkFinancialSenseCheck(
  askingPrice: number,
  estimatedArv: number,
  zip: string,
  config: BuyBoxConfig
): SenseCheckResult

/**
 * Composes all buy-box checks into a single eligibility result.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function evaluateBuyBox(
  inputs: { zip: string; propertyType: string; askingPrice: number; estimatedArv: number },
  config: BuyBoxConfig
): BuyBoxResult
