import { useState } from 'react'
import CarArt from './CarArt'
import { carKmh } from './stats'
import { UP_LABEL, UP_MAX, UP_PARTS, upFactors, upPrice, type UpPart } from './tuning'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { carUpgrade, type CarRow } from '../../services/cars'
import type { RaceCarOption } from './race/useRaceCars'

/** Tuning: Motor, Reifen und Bremsen je Auto in bis zu 5 Stufen kaufen. */
export default function TuneTab({ cars, shop, onChanged }: { cars: RaceCarOption[]; shop: CarRow[]; onChanged: () => Promise<void> }) {
  const wallet = useWallet()
  const mine = cars.filter((c) => c.id !== 'supercar')
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const car = mine.find((c) => c.id === sel) ?? mine[0]
  if (!car) return <p className="text-sm text-slate-300">Du brauchst erst ein Auto. Kaufe eins unter „Kaufen“.</p>
  const price = shop.find((c) => c.id === car.id)?.price ?? 0
  const f = upFactors(car.up)
  const base = carKmh(car.kind, car.top)
  async function buy(part: UpPart) {
    setBusy(part); setMsg(null)
    try { const r = await carUpgrade(car.id, part); wallet.setBalance(r.koins); await onChanged(); setMsg(`${UP_LABEL[part].name} ist jetzt auf Stufe ${r[part]}.`) } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(null) }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{mine.map((c) => <button key={c.id} type="button" onClick={() => setSel(c.id)} aria-pressed={car.id === c.id} className={`w-24 rounded-xl border p-1 text-center text-xs ${car.id === c.id ? 'border-accent-cyan bg-accent-cyan/15' : 'border-white/15 hover:bg-white/10'}`}><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" /><span className="block truncate">{c.name}</span></button>)}</div>
      <p className="text-sm text-slate-300"><b>{car.name}</b> · Höchstgeschwindigkeit <b>{Math.round(base * f.top)} km/h</b>{f.top > 1 && <span className="text-emerald-300"> (+{Math.round((f.top - 1) * 100)} %)</span>}</p>
      <ul className="space-y-2">
        {UP_PARTS.map((p) => {
          const lvl = car.up[p], max = lvl >= UP_MAX, cost = upPrice(price, lvl)
          return (
            <li key={p} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{UP_LABEL[p].name} <span className="text-xs font-normal text-slate-400">Stufe {lvl}/{UP_MAX}</span></p>
                <p className="text-xs text-slate-400">{UP_LABEL[p].text}</p>
                <div className="mt-1 flex gap-1" aria-hidden="true">{Array.from({ length: UP_MAX }, (_, i) => <span key={i} className={`h-1.5 w-8 rounded-full ${i < lvl ? 'bg-accent-cyan' : 'bg-white/10'}`} />)}</div>
              </div>
              {max ? <span className="rounded-lg bg-emerald-500/20 px-3 py-2 text-sm text-emerald-300">Maximal</span>
                : <button type="button" disabled={busy !== null} onClick={() => void buy(p)} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950 disabled:opacity-40">{busy === p ? '…' : `Verbessern · ${cost.toLocaleString('de-DE')} Coins`}</button>}
            </li>
          )
        })}
      </ul>
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
    </div>
  )
}
