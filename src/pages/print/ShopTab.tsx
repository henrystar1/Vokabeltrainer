import { useState } from 'react'
import { Box, Cuboid, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorBox, Spinner } from '../../components/ui/States'
import { useSignedUrls } from '../../features/print/hooks'
import { useAuth } from '../../features/auth/AuthProvider'
import { useAsync } from '../../lib/useAsync'
import { euro } from '../../lib/printShop'
import { getPrintProducts, type PrintInfo, type PrintProduct } from '../../services/printShop'
import ProductDialog from './ProductDialog'

export default function ShopTab({ info, onOrdered, onShowOrders }: { info: PrintInfo; onOrdered: () => void; onShowOrders: () => void }) {
  const { isAdmin } = useAuth()
  const products = useAsync(getPrintProducts, [])
  const list = products.data ?? []
  const urls = useSignedUrls(list.map((p) => p.image_path))
  const [open, setOpen] = useState<PrintProduct | null>(null)

  if (products.loading && !products.data) return <Spinner />
  if (products.error) return <ErrorBox message={products.error} onRetry={products.reload} />
  if (list.length === 0) {
    return (
      <EmptyState
        title="Der Shop füllt sich gerade"
        text={isAdmin ? 'Lege unter Verwaltung → 3D-Druck → Katalog dein erstes Produkt an.' : 'Hier gibt es bald fertige Modelle. Bis dahin kannst du unter „Eigene Anfrage“ etwas Eigenes drucken lassen.'}
        action={isAdmin ? <Link to="/verwaltung?bereich=druck-katalog" className="btn-primary">Katalog öffnen</Link> : undefined}
      />
    )
  }

  return (
    <>
      {isAdmin && (
        <div className="mb-4 flex justify-end">
          <Link to="/verwaltung?bereich=druck-katalog" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-slate-200 transition hover:bg-white/10">
            <Settings2 size={15} /> Katalog bearbeiten
          </Link>
        </div>
      )}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((p, i) => (
          <li key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              className="glass group flex w-full flex-col overflow-hidden rounded-2xl text-left transition hover:-translate-y-1 hover:border-accent-cyan/40 hover:shadow-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-cyan"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-space-700 to-space-900">
                {p.image_path && urls[p.image_path] ? (
                  <img src={urls[p.image_path]} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-600"><Box size={56} /></div>
                )}
                {p.model_path && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/15 bg-space-950/70 px-2.5 py-1 text-[11px] font-medium text-cyan-200 backdrop-blur"><Cuboid size={12} /> 3D-Ansicht</span>
                )}
                {p.colors.length > 0 && (
                  <span className="absolute bottom-3 left-3 flex -space-x-1.5" aria-hidden>
                    {p.colors.slice(0, 6).map((c) => <span key={c.id} className="h-4 w-4 rounded-full border border-white/40" style={{ background: c.hex }} />)}
                    {p.colors.length > 6 && <span className="pl-2.5 text-[11px] text-white/80">+{p.colors.length - 6}</span>}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="truncate text-base font-semibold">{p.name}</h3>
                  <span className="shrink-0 font-semibold text-accent-cyan">{euro(p.price_cents)}</span>
                </div>
                {p.description && <p className="line-clamp-2 text-sm text-slate-400">{p.description}</p>}
                <span className="mt-2 text-xs font-medium text-slate-500 transition group-hover:text-accent-cyan">Ansehen &amp; vorbestellen →</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {open && <ProductDialog product={open} info={info} onClose={() => setOpen(null)} onOrdered={onOrdered} onShowOrders={onShowOrders} />}
    </>
  )
}
