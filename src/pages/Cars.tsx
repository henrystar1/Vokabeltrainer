import { useState } from 'react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { errorMessage } from '../lib/errors'
import { useWallet } from '../features/koins/WalletProvider'
import CarArt from '../features/cars/CarArt'
import CarRun from '../features/cars/CarRun'
import RaceMenu from '../features/cars/race/RaceMenu'
import RaceBoard from '../features/cars/race/RaceBoard'
import TuneTab from '../features/cars/TuneTab'
import { useRaceCars } from '../features/cars/race/useRaceCars'
import { Link } from 'react-router-dom'
import { carBuy, carList } from '../services/cars'
import { carKmh } from '../features/cars/stats'
import { upFactors } from '../features/cars/tuning'

const MAX_KMH = 320
/** Höchstgeschwindigkeit als Zahl und Balken. */
function Speed({ kind, kmh }: { kind: string; kmh: number | null }) {
  const v = carKmh(kind, kmh)
  return (
    <div className="mt-1" title="Höchstgeschwindigkeit im Rennen">
      <div className="flex justify-between text-xs text-slate-300"><span>Höchstgeschwindigkeit</span><span className="font-semibold">{v} km/h</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-500" style={{ width: `${Math.min(100, (v / MAX_KMH) * 100)}%` }} /></div>
    </div>
  )
}

/** Autohaus: Autos kaufen und in der Garage sammeln. */
export default function Cars() {
  const wallet = useWallet()
  const list = useAsync(carList, [])
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<'shop' | 'tune' | 'race' | 'rank' | 'drive'>('shop')
  const [pick, setPick] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const cars = list.data ?? []
  const owned = cars.filter((c) => c.owned)
  const rc = useRaceCars()
  const drive = rc.cars.find((c) => c.id === pick) ?? rc.cars.find((c) => c.id !== 'supercar') ?? rc.cars[0]

  async function buy(id: string, name: string) {
    setBusy(id); setMsg(null)
    try { wallet.setBalance(await carBuy(id)); setMsg(`${name} steht jetzt in deiner Garage.`); await list.reload() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Kaufe Autos mit deinen Coins und sammle sie in deiner Garage" title="Autohaus" />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      <div className="flex gap-2" role="tablist" aria-label="Bereich">
        {([['shop', 'Kaufen'], ['tune', 'Tuning'], ['race', 'Rennen'], ['rank', 'Rangliste'], ['drive', 'Autobahn']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[44px] rounded-lg border px-4 ${tab === k ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`}>{l}</button>)}
      </div>
      {tab === 'tune' && <Card><TuneTab cars={rc.cars} shop={cars} onChanged={rc.reload} /></Card>}
      {tab === 'race' && (
        <Card>
          {!drive ? <p className="text-sm text-slate-300">Du brauchst erst ein Auto. Kaufe eins unter „Kaufen“.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">{rc.cars.map((c) => <button key={c.id} type="button" onClick={() => setPick(c.id)} aria-pressed={drive.id === c.id} className={`w-24 rounded-xl border p-1 text-center text-xs ${drive.id === c.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" />{c.name}</button>)}</div>
              <p className="text-sm text-slate-300">Dein Auto: <b>{drive.name}</b> · {Math.round(carKmh(drive.kind, drive.top) * upFactors(drive.up).top)} km/h{drive.id === 'supercar' && rc.assistOk ? ' · Fahrassistent mit F oder dem Knopf im Rennen' : ''}{drive.kind === 'roadster' ? ' · fliegen mit E oder dem Knopf (2 s, danach 20 s laden)' : ''}</p>
              <RaceMenu key={drive.id} car={{ id: drive.id, name: 'Du', kind: drive.kind, color: drive.color, top: drive.top, up: drive.up }} assistOk={drive.id === 'supercar' && rc.assistOk} />
              <p className="text-sm"><Link to="/mehrspieler" className="text-accent-cyan hover:underline">Online-Rennen mit Freunden starten →</Link></p>
            </div>
          )}
        </Card>
      )}
      {tab === 'rank' && <Card><RaceBoard cars={cars} /></Card>}
      {tab === 'drive' && (
        <Card>
          {!drive ? <p className="text-sm text-slate-300">Du brauchst erst ein Auto. Kaufe eins unter „Kaufen“.</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">{rc.cars.map((c) => <button key={c.id} type="button" onClick={() => setPick(c.id)} aria-pressed={drive.id === c.id} className={`w-24 rounded-xl border p-1 text-center text-xs ${drive.id === c.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" />{c.name}</button>)}</div>
              <CarRun car={drive} />
            </div>
          )}
        </Card>
      )}
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
      {tab === 'shop' && owned.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">Meine Garage ({owned.length})</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {owned.map((c) => <li key={c.id} className="rounded-xl bg-white/5 p-2 text-center"><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" /><p className="text-xs">{c.name}</p><p className="text-[11px] text-slate-400">{carKmh(c.kind, c.top_kmh)} km/h</p></li>)}
          </ul>
        </Card>
      )}
      {tab === 'shop' && <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cars.map((c) => (
          <li key={c.id}>
            <Card>
              <CarArt kind={c.kind} color={c.color} label={c.name} className="w-full rounded-xl bg-gradient-to-b from-slate-700/40 to-slate-900/60" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1"><p className="font-semibold">{c.name}</p><p className="text-sm text-slate-400">{c.price.toLocaleString('de-DE')} Coins</p></div>
                {c.owned
                  ? <span className="rounded-lg bg-emerald-500/20 px-3 py-2 text-sm text-emerald-300">In der Garage</span>
                  : <button type="button" disabled={busy !== null} onClick={() => void buy(c.id, c.name)} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950 disabled:opacity-40">{busy === c.id ? '…' : 'Kaufen'}</button>}
              </div>
              <Speed kind={c.kind} kmh={c.top_kmh} />
            </Card>
          </li>
        ))}
      </ul>}
    </div>
  )
}
