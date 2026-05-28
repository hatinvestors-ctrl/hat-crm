import { Link } from 'react-router-dom'
import Button from '../components/ui/Button'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-[color:var(--color-bg)]">
      <div className="text-[64px] font-bold text-[color:var(--color-text-faint)] leading-none tabular-nums">404</div>
      <h1 className="text-[16px] font-semibold text-[color:var(--color-text)] mt-2">Page not found</h1>
      <p className="text-[13px] text-[color:var(--color-text-muted)] mt-1">The page you're looking for doesn't exist.</p>
      <Link to="/" className="mt-5"><Button>Back to dashboard</Button></Link>
    </div>
  )
}
