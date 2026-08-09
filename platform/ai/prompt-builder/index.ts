// platform/ai/prompt-builder — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Sprint 1.1 correction: buildPrompt() previously accepted a loose
// `Record<string, unknown>` of "engine results" with no defined owner of
// producing them, which architecture review flagged as implying Prompt Builder
// might call /core engines itself. It must not. Prompt Builder now accepts a
// typed `AnalysisResult`, produced exclusively by the new `platform/analysis`
// orchestration layer, and does nothing but transform Context + AnalysisResult
// into prompt strings. It has no path to invoke a /core engine and no path to
// decide which engines should run — see platform/analysis/README.md.
//
// IMPORTANT: Sprint 1.1 does not move, copy, or alter any existing prompt text.
// The real prompts remain exactly where they are today, in netlify/functions/*.mjs.

import type { Context } from '../context-builder'
import type { AnalysisResult } from '../../analysis'

export interface BuiltPrompt {
  taskId: string
  promptVersion: string
  systemPrompt: string
  userPrompt: string
  assistantPrefill?: string
}

/**
 * Builds the system/user prompt strings for a given task from an assembled
 * Context and the AnalysisResult produced upstream by platform/analysis.
 * Prompt Builder ONLY transforms Context + AnalysisResult into prompt text —
 * it never decides which /core engines to run, and never calls one itself.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only; Sprint 1.1 corrects
 * its input contract from a loose engine-results blob to typed AnalysisResult.
 */
export declare function buildPrompt(
  taskId: string,
  context: Context,
  analysisResult: AnalysisResult
): BuiltPrompt
