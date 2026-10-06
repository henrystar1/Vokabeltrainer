import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  busy?: boolean
}

const STYLES: Record<Variant, string> = {
  primary: 'btn-primary btn-fx',
  secondary:
    'btn-fx inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 font-medium text-slate-100 transition hover:bg-white/10 active:scale-[0.98]',
  ghost:
    'btn-fx inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 font-medium text-slate-300 transition hover:bg-white/5 hover:text-white',
  danger:
    'btn-fx inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 font-medium text-rose-300 transition hover:bg-rose-500/20',
}

export default function Button({ variant = 'primary', busy = false, className = '', disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`${STYLES[variant]} disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}
