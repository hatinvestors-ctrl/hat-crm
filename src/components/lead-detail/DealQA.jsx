import { useState, useRef, useEffect } from 'react'

const QUICK_QUESTIONS = [
  'What if reno runs 20% over budget?',
  'What if ARV comes in 10% lower?',
  'Is this better as a flip or BRRRR?',
  'What should Kevin say to the seller?',
  'What price drop makes this a BUY NOW?',
]

export default function DealQA({ lead, aiNotes }) {
  const [history,  setHistory]  = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [open,     setOpen]     = useState(false)
  const bottomRef  = useRef(null)
  const inputRef   = useRef(null)

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [history, open])

  const ask = async (question) => {
    const q = (question || input).trim()
    if (!q || loading) return
    setInput('')
    setError(null)
    setLoading(true)
    const newHistory = [...history, { q, a: null }]
    setHistory(newHistory)

    try {
      const res = await fetch('/.netlify/functions/ask-deal-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead,
          ai_notes: aiNotes,
          question: q,
          history: history.filter(h => h.a),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to get answer.')
      setHistory(prev => prev.map((h, i) => i === prev.length - 1 ? { ...h, a: data.answer } : h))
    } catch (err) {
      setError(err.message || 'Something went wrong.')
      setHistory(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-[color:var(--color-line)] overflow-hidden">
      {/* Header toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-bg-elev-3)] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[14px]">💬</span>
          <span className="text-[12px] font-semibold text-[color:var(--color-text)]">Ask AI About This Deal</span>
          {history.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[color:var(--color-accent)] text-white font-bold">
              {history.filter(h => h.a).length}
            </span>
          )}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="w-3.5 h-3.5 text-[color:var(--color-text-dim)] transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="bg-[color:var(--color-bg)]">
          {/* Quick questions */}
          {history.length === 0 && (
            <div className="px-4 pt-3 pb-2">
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-2">Quick questions</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_QUESTIONS.map(q => (
                  <button key={q} onClick={() => ask(q)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-[color:var(--color-accent)] text-[color:var(--color-accent-text)] hover:bg-[color:var(--color-accent-soft)] transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          {history.length > 0 && (
            <div className="px-4 pt-3 space-y-3 max-h-[40vh] overflow-y-auto"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-line) transparent' }}>
              {history.map((item, i) => (
                <div key={i} className="space-y-1.5">
                  {/* Question */}
                  <div className="flex justify-end">
                    <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm bg-[color:var(--color-accent)] text-white text-[12px] leading-relaxed">
                      {item.q}
                    </div>
                  </div>
                  {/* Answer */}
                  {item.a ? (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] px-3 py-2 rounded-xl rounded-bl-sm bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[12px] text-[color:var(--color-text)] leading-relaxed whitespace-pre-wrap">
                        {item.a}
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="px-3 py-2 rounded-xl rounded-bl-sm bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
                        <div className="flex gap-1 items-center">
                          {[0,1,2].map(d => (
                            <div key={d} className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-text-dim)] animate-bounce"
                              style={{ animationDelay: `${d * 0.15}s` }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {error && (
            <p className="px-4 pt-2 text-[11px] text-[color:var(--color-danger-text)]">⚠ {error}</p>
          )}

          {/* Input */}
          <div className="px-4 py-3 flex gap-2 items-end border-t border-[color:var(--color-line)] mt-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
              placeholder="Ask anything about this deal…"
              rows={1}
              disabled={loading}
              className="flex-1 px-3 py-2 text-[12px] rounded-lg bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] resize-none leading-relaxed disabled:opacity-50"
              style={{ minHeight: '36px', maxHeight: '100px' }}
            />
            <button
              onClick={() => ask()}
              disabled={!input.trim() || loading}
              className="shrink-0 px-3 py-2 rounded-lg bg-[color:var(--color-accent)] text-white text-[12px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {loading ? '…' : '↑'}
            </button>
          </div>

          {history.length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {QUICK_QUESTIONS.slice(0, 3).map(q => (
                <button key={q} onClick={() => ask(q)} disabled={loading}
                  className="text-[10.5px] px-2 py-0.5 rounded-full border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:border-[color:var(--color-accent)] transition-colors disabled:opacity-40">
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
