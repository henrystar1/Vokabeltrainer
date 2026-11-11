import { useState } from 'react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { errorMessage } from '../lib/errors'
import { useWallet } from '../features/koins/WalletProvider'
import CarArt from '../features/cars/CarArt'
import { carBuy, carList } from '../services/cars'

/** Autohaus: Autos kaufen und in der Garage sammeln. */
export default function Cars() {
  const wallet = useWallet()
  const list = useAsync(carList, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const cars = list.data ?? []
  const owned = cars.filter((c) => c.owned)

  async function buy(id: string, name: string) {
    setBusy(id); setMsg(null)
    try { wallet.setBalance(await carBuy(id)); setMsg(`${name} steht jetzt in deiner Garage.`); await list.reload() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Kaufe Autos mit deinen Coins und sammle sie in deiner Garage" title="Autohaus" />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
      {owned.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Meine Garage ({owned.length})</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {owned.map((c) => <li key={c.id} className="rounded-xl bg-white/5 p-2 text-center"><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" /><p className="text-xs">{c.name}</p></li>)}
          </ul>
        </Card>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cars.map((c) => (
          <li key={c.id}>
            <Card>
              <CarArt kind={c.kind} color={c.color} label={c.name} className="w-full rounded-xl bg-gradient-to-b from-slate-700/40 to-slate-900/60" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div><p className="font-semibold">{c.name}</p><p className="text-sm text-slate-400">{c.price.toLocaleString('de-DE')} Coins</p></div>
                {c.owned
                  ? <span className="rounded-lg bg-emerald-500/20 px-3 py-2 text-sm text-emerald-300">In der Garage</span>
                  : <button type="button" disabled={busy !== null} onClick={() => void buy(c.id, c.name)} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950 disabled:opacity-40">{busy === c.id ? '…' : 'Kaufen'}</button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
