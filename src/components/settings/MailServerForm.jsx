import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'

const SECURITY_OPTIONS = [
  { value: 'tls',  label: 'STARTTLS (port 587)' },
  { value: 'ssl',  label: 'SSL / TLS (port 465)' },
  { value: 'none', label: 'None (port 25)' },
]

const DEFAULT_PORTS = { tls: 587, ssl: 465, none: 25 }

export default function MailServerForm({ workspace, canEdit, onUpdated }) {
  const s = workspace?.settings || {}

  const [fromEmail,  setFromEmail]  = useState(s.mail_from_email   || 'hatinvestors@gmail.com')
  const [fromName,   setFromName]   = useState(s.mail_from_name    || 'HatInvestors CRM')
  const [smtpHost,   setSmtpHost]   = useState(s.mail_smtp_host    || 'smtp.gmail.com')
  const [smtpPort,   setSmtpPort]   = useState(s.mail_smtp_port    ?? 587)
  const [smtpUser,   setSmtpUser]   = useState(s.mail_smtp_user    || 'hatinvestors@gmail.com')
  const [smtpPass,   setSmtpPass]   = useState(s.mail_smtp_password || '')
  const [security,   setSecurity]   = useState(s.mail_smtp_secure === true ? 'ssl' : 'tls')

  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testMsg,  setTestMsg]  = useState(null)
  const [error,    setError]    = useState(null)
  const [dirty,    setDirty]    = useState(false)

  const mark = () => { setDirty(true); setSaved(false); setTestMsg(null) }

  const handleSecurityChange = (val) => {
    setSecurity(val)
    setSmtpPort(DEFAULT_PORTS[val])
    mark()
  }

  const reset = () => {
    setFromEmail(s.mail_from_email   || 'hatinvestors@gmail.com')
    setFromName(s.mail_from_name     || 'HatInvestors CRM')
    setSmtpHost(s.mail_smtp_host     || 'smtp.gmail.com')
    setSmtpPort(s.mail_smtp_port     ?? 587)
    setSmtpUser(s.mail_smtp_user     || 'hatinvestors@gmail.com')
    setSmtpPass(s.mail_smtp_password || '')
    setSecurity(s.mail_smtp_secure === true ? 'ssl' : 'tls')
    setDirty(false); setSaved(false); setError(null); setTestMsg(null)
  }

  const buildNextSettings = () => ({
    ...(workspace.settings || {}),
    mail_from_email:    fromEmail.trim(),
    mail_from_name:     fromName.trim(),
    mail_smtp_host:     smtpHost.trim(),
    mail_smtp_port:     Number(smtpPort),
    mail_smtp_user:     smtpUser.trim(),
    mail_smtp_password: smtpPass,
    mail_smtp_secure:   security === 'ssl',
    mail_smtp_starttls: security === 'tls',
  })

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    const { data, error: e } = await supabase
      .from('workspaces')
      .update({ settings: buildNextSettings() })
      .eq('id', workspace.id)
      .select()
      .single()
    setSaving(false)
    if (e) setError(e.message)
    else { setSaved(true); setDirty(false); onUpdated?.(data) }
  }

  const sendTestEmail = async () => {
    setTesting(true); setTestMsg(null); setError(null)
    try {
      const res = await fetch('/.netlify/functions/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspace.id,
          to: fromEmail.trim(),
          subject: 'HatInvestors CRM — Mail server test',
          body: 'Your mail server is configured correctly. Emails from HatInvestors CRM will be sent from this address.',
          _test: true,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Test failed.')
      setTestMsg({ ok: true, text: `Test email sent to ${fromEmail}.` })
    } catch (err) {
      setTestMsg({ ok: false, text: err.message })
    } finally {
      setTesting(false)
    }
  }

  const inputCls = 'h-8 px-2 text-[12.5px] rounded-md bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] disabled:opacity-50 w-full'
  const labelCls = 'text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] block mb-1'

  const isConfigured = smtpHost && smtpUser && smtpPass && fromEmail

  return (
    <Card
      title="Mail Server"
      action={canEdit && dirty && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>
          <Button size="sm" onClick={save} loading={saving}>Save changes</Button>
        </div>
      )}
    >
      <p className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed mb-4">
        Configure the SMTP server used to send emails from the Compose Email feature on lead pages.
        All emails will be sent from the address below.
      </p>

      {error    && <div className="p-2 bg-[color:var(--color-danger-soft)]  text-[color:var(--color-danger-text)]  text-[12px] rounded mb-3">{error}</div>}
      {saved    && <div className="p-2 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded mb-3">Settings saved.</div>}
      {testMsg  && (
        <div className={`p-2 text-[12px] rounded mb-3 ${testMsg.ok ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' : 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]'}`}>
          {testMsg.text}
        </div>
      )}

      <div className="space-y-4">
        {/* Sender identity */}
        <div>
          <div className="text-[11.5px] font-semibold text-[color:var(--color-text-muted)] uppercase tracking-wide mb-2">Sender identity</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>From email address <span className="text-[color:var(--color-danger-text)]">*</span></label>
              <input
                type="email"
                value={fromEmail}
                disabled={!canEdit}
                placeholder="you@example.com"
                onChange={e => { setFromEmail(e.target.value); mark() }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Display name</label>
              <input
                type="text"
                value={fromName}
                disabled={!canEdit}
                placeholder="HatInvestors CRM"
                onChange={e => { setFromName(e.target.value); mark() }}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* SMTP server */}
        <div>
          <div className="text-[11.5px] font-semibold text-[color:var(--color-text-muted)] uppercase tracking-wide mb-2">SMTP server</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Host <span className="text-[color:var(--color-danger-text)]">*</span></label>
              <input
                type="text"
                value={smtpHost}
                disabled={!canEdit}
                placeholder="smtp.gmail.com"
                onChange={e => { setSmtpHost(e.target.value); mark() }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input
                type="number"
                value={smtpPort}
                disabled={!canEdit}
                min="1"
                max="65535"
                onChange={e => { setSmtpPort(Number(e.target.value)); mark() }}
                className={inputCls + ' tabular-nums'}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className={labelCls}>Security</label>
            <div className="flex flex-wrap gap-2">
              {SECURITY_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-[12.5px] text-[color:var(--color-text)]">
                  <input
                    type="radio"
                    name="smtp-security"
                    value={opt.value}
                    checked={security === opt.value}
                    disabled={!canEdit}
                    onChange={() => handleSecurityChange(opt.value)}
                    className="accent-[color:var(--color-accent)]"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Credentials */}
        <div>
          <div className="text-[11.5px] font-semibold text-[color:var(--color-text-muted)] uppercase tracking-wide mb-2">Credentials</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username <span className="text-[color:var(--color-danger-text)]">*</span></label>
              <input
                type="text"
                value={smtpUser}
                disabled={!canEdit}
                placeholder="you@example.com"
                autoComplete="off"
                onChange={e => { setSmtpUser(e.target.value); mark() }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Password <span className="text-[color:var(--color-danger-text)]">*</span></label>
              <input
                type="password"
                value={smtpPass}
                disabled={!canEdit}
                placeholder="••••••••"
                autoComplete="new-password"
                onChange={e => { setSmtpPass(e.target.value); mark() }}
                className={inputCls}
              />
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-[color:var(--color-text-dim)]">
            For Gmail, use an <strong>App Password</strong> (not your account password). Enable 2-Step Verification, then go to Google Account → Security → App Passwords.
          </p>
        </div>
      </div>

      {/* Test button */}
      <div className="mt-4 pt-3 border-t border-[color:var(--color-line)] flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={sendTestEmail}
          loading={testing}
          disabled={!isConfigured || !canEdit || dirty}
        >
          Send test email
        </Button>
        {dirty && <span className="text-[11.5px] text-[color:var(--color-text-dim)]">Save changes before testing.</span>}
        {!isConfigured && !dirty && <span className="text-[11.5px] text-[color:var(--color-text-dim)]">Fill in all required fields to enable testing.</span>}
      </div>
    </Card>
  )
}
