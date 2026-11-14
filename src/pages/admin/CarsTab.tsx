import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import CarArt from '../../features/cars/CarArt'
import { adminCarSet, adminSuperList, adminSuperSet, adminSuperSpeed, adminSuperUserSpeed, carList } from '../../services/cars'

/** Admin: Supercar (rot, bis 1000 km/h) für Mods freigeben und das Tempo je Nutzer einstellen. Den Fahrassistenten haben nur Admins. */
function SuperAccess() {
  const list = useAsync(adminSuperList, [])
  const [msg, setMsg] = useState<string | null>(null)
  const [def, setDef] = useState('')
  const [edit, setEdit] = useState<Record<string, string>>({})
  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null)
    try { await fn(); await list.reload(); if (ok) setMsg(ok) } catch (e) { setMsg(errorMessage(e)) }
  }
  const num = (v: string) => Math.floor(Number(v) || 0)
  return (
    <section className="space-y-2 rounded-xl border border-white/10 p-3">
      <h3 className="font-semibold">Supercar „Admin-Hyperion“ (rot, bis 1000 km/h)</h3>
      <p className="text-sm text-slate-400">Admins fahren es immer und haben als Einzige den Fahrassistenten (mit Drift). Mods bekommen das Auto ohne Assistent, sobald du es freigibst. Das Tempo stellst du für jeden einzeln ein (100–1000 km/h); ohne eigenen Wert gilt das Standard-Tempo.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">Standard-Tempo<input aria-label="Standard-Tempo in km/h" inputMode="numeric" placeholder="700" value={def} onChange={(e) => setDef(e.target.value)} className="min-h-[44px] w-24 rounded-lg border border-white/15 bg-space-900/60 px-3" />km/h</label>
        <button type="button" onClick={() => void run(() => adminSuperSpeed(num(def)), 'Standard-Tempo gespeichert.')} className="min-h-[44px] rounded-lg bg-accent-cyan px-3 font-semibold text-slate-950">Speichern</button>
      </div>
      <ul className="divide-y divide-white/5">
        {list.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{u.name} <span className="text-xs text-slate-400">{u.role}</span></span>
            {u.role === 'admin' ? <span className="text-xs text-emerald-300">immer · mit Assistent</span> : <label className="flex items-center gap-1.5"><input type="checkbox" checked={u.granted} onChange={(e) => void run(() => adminSuperSet(u.id, e.target.checked))} className="h-5 w-5" />freigegeben</label>}
            {u.granted && (
              <span className="flex items-center gap-1.5">
                <input aria-label={`Tempo ${u.name} in km/h`} inputMode="numeric" value={edit[u.id] ?? String(u.kmh)} onChange={(e) => setEdit({ ...edit, [u.id]: e.target.value })} className="min-h-[44px] w-24 rounded-lg border border-white/15 bg-space-900/60 px-3" />
                <button type="button" onClick={() => void run(() => adminSuperUserSpeed(u.id, num(edit[u.id] ?? String(u.kmh))), `Tempo für ${u.name} gespeichert.`)} className="min-h-[44px] rounded-lg bg-white/10 px-3">Setzen</button>
                {u.custom && <button type="button" onClick={() => void run(async () => { await adminSuperUserSpeed(u.id, null); setEdit((x) => { const { [u.id]: _drop, ...rest } = x; return rest }) }, 'Standard-Tempo gilt wieder.')} className="min-h-[44px] rounded-lg bg-white/10 px-3 text-xs">Standard</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="text-sm text-amber-200" role="status">{msg}</p>}
    </section>
  )
}

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
      <SuperAccess />
      <p className="text-sm text-slate-400">Preise in Coins. Ein abgeschaltetes Auto kann nicht mehr gekauft werden; wer es schon hat, behält es.</p>
      <ul className="divide-y divide-white/5">
        {list.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
            <CarArt kind={c.kind} color={c.color} label={c.name} className="w-20" />
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name} <span className="text-xs font-normal text-slate-400">{c.top_kmh ?? ''} km/h</span></span>
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
