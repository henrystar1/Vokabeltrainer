import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import CarArt from '../../features/cars/CarArt'
import { adminCarSet, carList } from '../../services/cars'

/** Admin: Preise der Autos und ob sie im Autohaus angeboten werden. */
export default function CarsTab() {
  const list = useAsync(carList, [])
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  async function save(id: string, price: number, active: boolean) {
    setMsg(null)
    try { await adminCarSet(id, price, active); setMsg('Gespeichert.'); await list.reload() } catch (e) { setMsg(errorMessage(e)) }
  }
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-slate-400">Preise in Coins. Ein abgeschaltetes Auto kann nicht mehr gekauft werden; wer es schon hat, behält es.</p>
      <ul className="divide-y divide-white/5">
        {list.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
            <CarArt kind={c.kind} color={c.color} label={c.name} className="w-20" />
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
            <input aria-label={`Preis ${c.name}`} inputMode="numeric" value={edit[c.id] ?? String(c.price)} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} className="min-h-[44px] w-28 rounded-lg border border-white/15 bg-space-900/60 px-3" />
            <button type="button" onClick={() => void save(c.id, Math.max(0, Math.floor(Number(edit[c.id] ?? c.price) || 0)), c.active)} className="min-h-[44px] rounded-lg bg-accent-cyan px-3 font-semibold text-slate-950">Preis speichern</button>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={c.active} onChange={(e) => void save(c.id, c.price, e.target.checked)} className="h-5 w-5" />im Angebot</label>
          </li>
        ))}
      </ul>
      {msg && <p className="text-sm text-slate-300" role="status">{msg}</p>}
    </div>
  )
}
