// platform/analysis — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1.1 (HAT AI OS architecture correction) — see docs/architecture/HAT_AI_OS.md
//
// New orchestration layer between Context Builder and Prompt Builder. Determines
// which /core engines a task requires, executes them, and produces a typed
// AnalysisResult. NO LLM calls belong here — see README.md.

import type { Context } from '../ai/context-builder'
import type { MaoResult, HmlLoanResult, HoldingCostResult } from '../../core/financial-engine'
import type { FlipResult } from '../../core/flip-engine'
import type { RefiResult, CashFlowResult } from '../../core/brrrr-engine'
import type { AnchorResult, MotivationResult } from '../../core/negotiation-engine'
import type { RehabCostBracket, MaxRehabBudgetResult } from '../../core/rehab-engine'
import type { DealScoreResult } from '../../core/scoring-engine'
import type { BuyBoxResult } from '../../core/buybox-engine'

/**
 * Normalizes the output of whichever /core engines a given task required into
 * one typed shape Prompt Builder can consume regardless of task type. Every
 * field is optional because not every task requires every engine (e.g. `comps`
 * requires none of these; `core-analysis` requires most of them).
 */
export interface AnalysisResult {
  taskId: string
  buyBox?: BuyBoxResult
  mao?: MaoResult
  hmlLoan?: HmlLoanResult
  holdingCosts?: HoldingCostResult
  flip?: FlipResult
  refi?: RefiResult
  cashFlow?: CashFlowResult
  rehabBracket?: RehabCostBracket
  maxRehabBudget?: MaxRehabBudgetResult
  motivation?: MotivationResult
  anchor?: AnchorResult
  dealScore?: DealScoreResult
  /** Which engines actually ran for this task, for logging/debugging. */
  enginesExecuted: string[]
}

/**
 * Determines which /core engines a given task requires. Pure mapping, no
 * execution — separated from runAnalysis() so the required-engine list itself
 * is inspectable/testable independent of running anything.
 * NOT IMPLEMENTED — Sprint 1.1 defines the contract only.
 */
export declare function determineRequiredEngines(taskId: string): string[]

/**
 * Executes the required /core engines for a task, in dependency order, and
 * assembles the typed AnalysisResult. This is the ONLY place engine execution
 * is orchestrated — prompt-builder must never call engines itself.
 * NOT IMPLEMENTED — Sprint 1.1 defines the contract only.
 */
export declare function runAnalysis(
  taskId: string,
  context: Context
): Promise<AnalysisResult>
