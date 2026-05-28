import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'

export default function LoginPage({ signIn, signUp }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setInfo(null); setLoading(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        navigate(location.state?.from || '/', { replace: true })
      } else {
        await signUp(email, password, fullName)
        setInfo('Check your email to confirm, then sign in.')
        setMode('signin')
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[color:var(--color-bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-6 h-6 rounded-sm bg-[color:var(--color-accent)] text-white flex items-center justify-center text-[12px] font-bold">H</div>
          <span className="text-[15px] font-semibold text-[color:var(--color-text)]">HatInvestors CRM</span>
        </div>

        <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-6">
          <h1 className="text-[16px] font-semibold text-[color:var(--color-text)]">
            {mode === 'signin' ? 'Sign in' : 'Create your account'}
          </h1>
          <p className="text-[12.5px] text-[color:var(--color-text-muted)] mt-0.5">
            {mode === 'signin' ? 'Welcome back to the pipeline.' : 'Track every Jacksonville deal in one place.'}
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            {mode === 'signup' && (
              <Input label="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} required />
            )}
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <Input
              label="Password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />

            {error && (
              <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">
                {error}
              </div>
            )}
            {info && (
              <div className="p-2 bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] text-[12px] rounded">
                {info}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>

        <div className="mt-4 text-center text-[12px] text-[color:var(--color-text-dim)]">
          {mode === 'signin' ? (
            <>Need an account? <button onClick={() => setMode('signup')} className="text-[color:var(--color-accent-text)] hover:underline">Sign up</button></>
          ) : (
            <>Already have an account? <button onClick={() => setMode('signin')} className="text-[color:var(--color-accent-text)] hover:underline">Sign in</button></>
          )}
        </div>
      </div>
    </div>
  )
}
