// src/hooks/useSpeechRecognition.js
// Capability #22.1 — browser microphone -> live transcript, via the
// standard Web Speech API (SpeechRecognition / webkitSpeechRecognition).
//
// WHY Web Speech API (mission Section 4's explicit "document why"):
//   - Zero cost, zero new provider/API-key/infrastructure — the lowest-
//     risk path to close the "Kevin still has to type" gap.
//   - Built into Chrome/Edge (Chromium), the project's documented primary
//     environment — no install, no SDK.
//   - Streaming + interim/final results out of the box, which is exactly
//     the "finalized utterance -> addSegment()" shape the existing
//     transcript session already expects (Capability #22).
//   - Trade-off, stated honestly: Chromium-only (no Firefox/Safari
//     support), sends audio to Google's speech service under the hood
//     (no local/offline mode), and has NO speaker diarization at all —
//     every result arrives as one undifferentiated stream. If accuracy or
//     browser coverage becomes a real blocker later, the smallest
//     production upgrade is a streaming STT provider (e.g. Deepgram/
//     AssemblyAI) behind this exact same hook interface — nothing above
//     this file would need to change.
//
// This hook does NOT decide what's a "seller fact" — it only turns audio
// into finalized text segments. Speaker attribution is handled downstream
// by extract-seller-facts.mjs reasoning over conversational role, since
// this API cannot tell us who's speaking (see LiveCopilot.jsx).
//
// Capability #22.3 real-call finding — Chrome's SpeechRecognition throws a
// transient 'network' error fairly often on long sessions (it's backed by
// Google's speech service, not a local model) even while the mic itself
// is fine. The original version treated ANY non-ignored error as fatal,
// dropping straight to a dead ERROR state that silently stopped
// listening mid-call until Kevin noticed and clicked Start again. Now
// 'network'/'audio-capture' are treated as recoverable and auto-retried
// with a short backoff; only a real hard failure (permission denied,
// unsupported) surfaces as ERROR requiring Kevin's attention.

import { useCallback, useEffect, useRef, useState } from 'react'

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function isSpeechRecognitionSupported() {
  return getSpeechRecognitionCtor() != null
}

// Errors the browser/OS can throw for reasons that have nothing to do
// with Kevin's mic actually being broken — safe to silently retry.
const RECOVERABLE_ERRORS = new Set(['network', 'audio-capture', 'no-speech', 'aborted'])
// Hard failures — retrying won't help, Kevin needs to act (grant
// permission, use a supported browser, etc).
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed'])
const MAX_CONSECUTIVE_RETRIES = 6
const RETRY_DELAY_MS = 500

/**
 * @param {(finalText: string) => void} onFinalUtterance — called once per
 *   finalized utterance (never per interim/partial result).
 */
export function useSpeechRecognition(onFinalUtterance) {
  const [status, setStatus] = useState('OFF') // OFF | LISTENING | PAUSED | ERROR
  const [error, setError] = useState(null)
  const [interimText, setInterimText] = useState('')
  const recognitionRef = useRef(null)
  const pausedByUserRef = useRef(false)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef(null)
  const onFinalRef = useRef(onFinalUtterance)
  onFinalRef.current = onFinalUtterance

  const restart = useCallback((rec) => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    // A short delay before calling start() again avoids Chrome's
    // InvalidStateError when start() is called too soon after the
    // previous session actually finishes tearing down.
    retryTimerRef.current = setTimeout(() => {
      if (pausedByUserRef.current || recognitionRef.current !== rec) return
      try {
        rec.start()
        setStatus('LISTENING')
      } catch {
        // Still mid-teardown — try once more shortly; the retry-count
        // ceiling below is what actually prevents an infinite loop.
        restart(rec)
      }
    }, RETRY_DELAY_MS)
  }, [])

  const setupRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return null
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onresult = (event) => {
      retryCountRef.current = 0 // real audio is flowing again — reset the recovery counter
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript || ''
        if (result.isFinal) {
          if (text.trim()) onFinalRef.current?.(text.trim())
        } else {
          interim += text
        }
      }
      setInterimText(interim)
    }

    rec.onerror = (event) => {
      const errType = event.error
      if (errType === 'no-speech' || errType === 'aborted') return // routine — onend below handles the restart

      if (FATAL_ERRORS.has(errType)) {
        setStatus('ERROR')
        setError(errType === 'not-allowed' ? 'Microphone permission denied — check your browser\'s site settings.' : errType)
        pausedByUserRef.current = true // stop auto-retrying a failure retrying can't fix
        return
      }

      if (RECOVERABLE_ERRORS.has(errType)) {
        retryCountRef.current += 1
        if (retryCountRef.current > MAX_CONSECUTIVE_RETRIES) {
          setStatus('ERROR')
          setError(`Lost connection repeatedly (${errType}) — click Start Listening to try again.`)
          pausedByUserRef.current = true
          return
        }
        // Stay silent to Kevin — this is exactly the "don't flash to
        // ERROR then back" case; onend (below) drives the actual restart.
        return
      }

      // Unknown error type — treat conservatively as recoverable rather
      // than dead-ending the call over something not seen before.
      retryCountRef.current += 1
      if (retryCountRef.current > MAX_CONSECUTIVE_RETRIES) {
        setStatus('ERROR')
        setError(errType || 'Speech recognition error')
        pausedByUserRef.current = true
      }
    }

    rec.onend = () => {
      // Web Speech API stops itself after silence/errors even in
      // continuous mode — restart automatically unless Kevin explicitly
      // paused/stopped, or a fatal error already gave up.
      if (!pausedByUserRef.current && recognitionRef.current === rec) {
        restart(rec)
      }
    }

    return rec
  }, [restart])

  const start = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setStatus('ERROR')
      setError('Speech recognition is not supported in this browser (Chrome/Edge required).')
      return
    }
    pausedByUserRef.current = false
    retryCountRef.current = 0
    const rec = setupRecognition()
    recognitionRef.current = rec
    try {
      rec.start()
      setStatus('LISTENING')
      setError(null)
    } catch (err) {
      setStatus('ERROR')
      setError(err.message || 'Could not start microphone')
    }
  }, [setupRecognition])

  const pause = useCallback(() => {
    pausedByUserRef.current = true
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    recognitionRef.current?.stop()
    setStatus('PAUSED')
  }, [])

  const resume = useCallback(() => {
    pausedByUserRef.current = false
    retryCountRef.current = 0
    setStatus('LISTENING')
    try { recognitionRef.current?.start() } catch { start() }
  }, [start])

  const stop = useCallback(() => {
    pausedByUserRef.current = true
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setStatus('OFF')
    setInterimText('')
  }, [])

  useEffect(() => () => {
    pausedByUserRef.current = true
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    recognitionRef.current?.stop()
  }, [])

  return { status, error, interimText, start, pause, resume, stop, supported: isSpeechRecognitionSupported() }
}
