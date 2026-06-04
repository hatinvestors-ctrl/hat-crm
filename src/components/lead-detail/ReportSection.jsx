import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'

const TYPES = [
  { key: 'lender',     label: '🏦 Lender',     desc: 'Funding request to Rob' },
  { key: 'agent',      label: '🏠 Agent',       desc: 'Cash offer to listing agent' },
  { key: 'seller',     label: '👤 Seller',      desc: 'Direct seller outreach' },
  { key: 'wholesaler', label: '📦 Wholesaler',  desc: 'Investor-to-investor' },
  { key: 'general',    label: '📋 General',     desc: 'Full internal summary' },
]

const LENGTHS = [
  { key: 'brief',    label: 'Brief',    desc: '~150 words' },
  { key: 'standard', label: 'Standard', desc: '~350 words' },
  { key: 'detailed', label: 'Detailed', desc: '~600 words' },
]

export default function ReportSection({ lead }) {
  const [reportType, setReportType] = useState('lender')
  const [length,     setLength]     = useState('standard')
  const [subject,    setSubject]    = useState('')
  const [reportText, setReportText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState(null)
  const [copied,     setCopied]     = useState(false)

  const hasReport = !!reportText

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: { ...lead, recent_notes: [] }, recipient_type: reportType, length }),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { throw new Error('Report timed out. Try "Brief" or "Standard" length instead.') }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      setSubject(data.subject)
      setReportText(data.report)
    } catch (e) {
      setError(e.message || 'Something went wrong.')
    } finally {
      setGenerating(false)
    }
  }

  function copyToClipboard() {
    const full = subject ? `Subject: ${subject}\n\n${reportText}` : reportText
    navigator.clipboard.writeText(full)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openInGmail() {
    const params = new URLSearchParams({ view: 'cm', fs: '1', su: subject || '', body: reportText || '' })
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  function downloadPDF() {
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${subject || 'HAT Investors Report'}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; max-width: 700px; margin: 40px auto; color: #222; }
        h2 { font-size: 18px; margin-bottom: 4px; }
        .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
        pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
      </style>
    </head><body>
      <h2>HAT Investors</h2>
      ${subject ? `<div class="sub">Subject: ${subject}</div>` : ''}
      <pre>${(reportText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 500)
  }

  return (
    <Card title="📄 Generate Report">
      {/* Recipient type tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setReportType(t.key)}
            title={t.desc}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${
              reportType === t.key
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Length + Generate row */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[11px] text-[color:var(--color-text-dim)] uppercase tracking-wider">Length:</span>
        <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold">
          {LENGTHS.map(l => (
            <button
              key={l.key}
              onClick={() => setLength(l.key)}
              title={l.desc}
              className={`px-3 py-1 transition-colors ${
                length === l.key
                  ? 'bg-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={generate}
          loading={generating}
          disabled={generating}
        >
          {generating ? 'Generating…' : hasReport ? '↺ Regenerate' : '⚡ Generate'}
        </Button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
          {error}
        </div>
      )}

      {hasReport && (
        <div className="space-y-2">
          {/* Subject line */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full mt-1 text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>

          {/* Report body */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Report</label>
            <textarea
              value={reportText}
              onChange={e => setReportText(e.target.value)}
              rows={16}
              className="w-full mt-1 text-[13px] px-3 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-y leading-relaxed font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={copyToClipboard}
              className="flex-1 py-2 rounded-md border border-[color:var(--color-line)] text-[12.5px] font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
            <button
              onClick={openInGmail}
              className="flex-1 py-2 rounded-md bg-[color:var(--color-accent)] text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              ✉ Open in Gmail
            </button>
            <button
              onClick={downloadPDF}
              className="flex-1 py-2 rounded-md border border-[color:var(--color-line)] text-[12.5px] font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
            >
              📄 Download PDF
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
