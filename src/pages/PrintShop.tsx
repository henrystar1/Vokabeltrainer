import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldCheck, ShoppingBag, FilePlus2, PackageSearch, Target } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { usePrintTodo } from '../features/print/hooks'
import { errorMessage } from '../lib/errors'
import { ACTIVE_STATUSES, euro } from '../lib/printShop'
import { getMyPrintOrders, getPrintGoal, getPrintInfo, type PrintGoal, type PrintInfo, type PrintOrder } from '../services/printShop'
import MyOrdersTab from './print/MyOrdersTab'
import RequestTab from './print/RequestTab'
import ShopTab from './print/ShopTab'

type Tab = 'shop' | 'anfrage' | 'bestellungen'

/** 3D-Druck-Shop: fertige Modelle, eigene Anfragen und der Stand der eigenen Bestellungen. */
export default function PrintShop() {
  const { isAdmin } = useAuth()
  const todo = usePrintTodo()
  const [params, setParams] = useSearchParams()
  const tab: Tab = (['shop', 'anfrage', 'bestellungen'] as const).find((t) => t === params.get('t')) ?? 'shop'
  const setTab = useCallback((t: Tab) => setParams(t === 'shop' ? {} : { t }, { replace: true }), [setParams])

  const [info, setInfo] = useState<PrintInfo | null>(null)
  const [goal, setGoal] = useState<PrintGoal | null>(null)
  const [orders, setOrders] = useState<PrintOrder[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const loadOrders = useCallback(async () => {
    try {
      const [o, i] = await Promise.all([getMyPrintOrders(), getPrintInfo()])
      setOrders(o)
      setInfo(i)
      setFetchedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => { void loadOrders(); getPrintGoal().then(setGoal, () => undefined) }, [loadOrders])

  // Laufende Bestellungen: alle 8 Sekunden neu laden, solange die Seite sichtbar ist (Live-Fortschritt).
  const hasActive = (orders ?? []).some((o) => ACTIVE_STATUSES.includes(o.status))
  useEffect(() => {
    if (!hasActive) return
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void loadOrders() }, 8000)
    return () => window.clearInterval(t)
  }, [hasActive, loadOrders])

  const activeCount = (orders ?? []).filter((o) => ACTIVE_STATUSES.includes(o.status)).length
  const attention = (orders ?? []).filter((o) => o.status === 'preis_vorgeschlagen' || o.status === 'lieferbereit').length

  const tabBtn = (id: Tab, label: string, icon: React.ReactNode, badge?: number, hot?: boolean) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`relative inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition sm:flex-none ${
        tab === id ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
      }`}
    >
      {icon} {label}
      {badge ? <span className={`rounded-full px-1.5 text-[11px] font-semibold ${hot ? 'bg-amber-400 text-space-950' : 'bg-white/15 text-slate-100'}`}>{badge}</span> : null}
    </button>
  )

  return (
    <div>
      <PageHeader eyebrow="Vom Drucker direkt zu dir" title="3D-Druck-Shop" />

      {goal?.visible && <GoalBar goal={goal} />}

      {isAdmin && todo && (
        <Link to="/verwaltung?bereich=druck" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm transition hover:bg-amber-400/10">
          <span className="inline-flex items-center gap-2 text-amber-100"><ShieldCheck size={16} />
            <b>{todo.todo}</b> {todo.todo === 1 ? 'Auftrag wartet' : 'Aufträge warten'}
            {todo.druckt > 0 && <> · {todo.druckt} im Druck</>}
            {todo.lieferbereit > 0 && <> · {todo.lieferbereit} zur Übergabe bereit</>}
            {todo.preis_vorgeschlagen > 0 && <> · {todo.preis_vorgeschlagen} warten auf Antwort</>}
          </span>
          <span className="text-amber-200/80">Warteschlange öffnen →</span>
        </Link>
      )}

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={() => void loadOrders()} /></div>}
      {!info && !error && <Spinner />}

      {info && (
        <>
          {!info.open && <div className="mb-4"><Notice tone="warn">Bestellungen sind gerade geschlossen. Du kannst dich trotzdem umsehen.</Notice></div>}
          {info.banned && <div className="mb-4"><Notice tone="warn">Du kannst im Moment nichts bestellen.{info.ban_reason ? ` Grund: ${info.ban_reason}` : ''}</Notice></div>}
          {attention > 0 && tab !== 'bestellungen' && (
            <button type="button" onClick={() => setTab('bestellungen')} className="mb-4 w-full text-left">
              <Notice tone="ok">Es gibt Neuigkeiten zu deinen Bestellungen – hier ansehen.</Notice>
            </button>
          )}

          <div role="tablist" className="mb-5 flex gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-space-800/40 p-1.5">
            {tabBtn('shop', 'Shop', <ShoppingBag size={16} />)}
            {tabBtn('anfrage', 'Eigene Anfrage', <FilePlus2 size={16} />)}
            {tabBtn('bestellungen', 'Meine Bestellungen', <PackageSearch size={16} />, activeCount, attention > 0)}
          </div>

          {tab === 'shop' && <ShopTab info={info} onOrdered={() => void loadOrders()} onShowOrders={() => setTab('bestellungen')} />}
          {tab === 'anfrage' && <RequestTab info={info} onOrdered={() => void loadOrders()} onShowOrders={() => setTab('bestellungen')} />}
          {tab === 'bestellungen' && (orders ? <MyOrdersTab orders={orders} fetchedAt={fetchedAt} onChanged={() => void loadOrders()} onShop={() => setTab('shop')} /> : <Spinner />)}
        </>
      )}
    </div>
  )
}

/** Wie weit ist das Ziel (z. B. Claude Pro) schon verdient? */
function GoalBar({ goal }: { goal: Extract<PrintGoal, { visible: true }> }) {
  const pct = Math.max(0, goal.percent)
  const reached = pct >= 100
  return (
    <section aria-label="Verdienst-Ziel" className="glass mb-5 overflow-hidden rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><Target size={16} className="text-accent-cyan" /> Pro-Abo-Ziel</h2>
        <span className="text-sm tabular-nums text-slate-300">{euro(goal.earned_cents)} <span className="text-slate-500">von {euro(goal.goal_cents)}</span></span>
      </div>
      <div className="relative mt-3 h-4 overflow-hidden rounded-full bg-space-700" role="progressbar" aria-valuenow={Math.min(100, Math.round(pct))} aria-valuemin={0} aria-valuemax={100} aria-label="Ziel erreicht">
        <div className={`h-full rounded-full transition-[width] duration-1000 ${reached ? 'bg-emerald-400' : 'bg-gradient-to-r from-accent-violet to-accent-cyan'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {reached ? 'Geschafft! Das Ziel ist erreicht – danke an alle Besteller. 🎉' : <><b className="text-slate-100">{pct.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</b> sind schon verdient. Mit jeder Bestellung kommt das Ziel näher.</>}
      </p>
    </section>
  )
}

