import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import Button from './Button'

export function Spinner({ label = 'Lädt …' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" />
      {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200 sm:flex-row sm:items-center">
      <AlertTriangle size={20} className="shrink-0" />
      <p className="flex-1 text-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Erneut versuchen
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-14 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-400">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const styles = {
    info: 'border-accent-cyan/30 bg-accent-cyan/10 text-cyan-100',
    warn: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
    ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles[tone]}`}>{children}</div>
}
