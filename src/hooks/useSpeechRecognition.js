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

import { useCallback, useEffect, useRef, useState } from 'react'

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function isSpeechRecognitionSupported() {
  return getSpeechRecognitionCtor() != null
}

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
  const onFinalRef = useRef(onFinalUtterance)
  onFinalRef.current = onFinalUtterance

  const setupRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return null
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onresult = (event) => {
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
      // 'no-speech' and 'aborted' are routine (silence, or we stopped it
      // ourselves) — not real errors, don't surface them as ERROR state.
      if (event.error === 'no-speech' || event.error === 'aborted') return
      setStatus('ERROR')
      setError(event.error || 'Speech recognition error')
    }

    rec.onend = () => {
      // Web Speech API auto-stops after periods of silence even in
      // continuous mode — restart automatically unless the user paused/
      // stopped it deliberately.
      if (!pausedByUserRef.current && recognitionRef.current === rec) {
        try { rec.start() } catch { /* already starting — ignore */ }
      }
    }

    return rec
  }, [])

  const start = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setStatus('ERROR')
      setError('Speech recognition is not supported in this browser (Chrome/Edge required).')
      return
    }
    pausedByUserRef.current = false
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
    recognitionRef.current?.stop()
    setStatus('PAUSED')
  }, [])

  const resume = useCallback(() => {
    pausedByUserRef.current = false
    setStatus('LISTENING')
    try { recognitionRef.current?.start() } catch { start() }
  }, [start])

  const stop = useCallback(() => {
    pausedByUserRef.current = true
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setStatus('OFF')
    setInterimText('')
  }, [])

  useEffect(() => () => { pausedByUserRef.current = true; recognitionRef.current?.stop() }, [])

  return { status, error, interimText, start, pause, resume, stop, supported: isSpeechRecognitionSupported() }
}
