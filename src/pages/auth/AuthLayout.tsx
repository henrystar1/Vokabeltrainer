import type { ReactNode } from 'react'
import { Rocket } from 'lucide-react'
import StarField from '../../components/ui/StarField'

export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <StarField />
      <div className="glass w-full max-w-md animate-rise rounded-3xl p-8 shadow-glow">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-violet to-accent-cyan text-space-950">
            <Rocket size={20} />
          </div>
          <span className="font-semibold tracking-tight">Vokabeltrainer</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
