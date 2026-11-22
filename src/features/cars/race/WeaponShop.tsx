import { useEffect, useState } from 'react'
import { raceGearBuy, raceGearList } from '../../../services/cars'
import { errorMessage } from '../../../lib/errors'
import { GEAR, gearFromList, type GearId, type GearSet } from './gear'

/** Waffenladen: Schussweste, Helm, Schlagstock, Pistole kaufen (Münzen, Admin gratis). */
export default function WeaponShop({ isAdmin, coins, owned, onOwned, onKoins, onClose }: {
  isAdmin: boolean; coins: number | null; owned: GearSet; onOwned: (g: GearSet) => void; onKoins: (k: number) => void; onClose: () => void
}) {
  const [busy, setBusy] = useState<GearId | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { void raceGearList().then((l) => onOwned(gearFromList(l))).catch(() => undefined) }, [onOwned])
  const buy = (id: GearId) => {
    setBusy(id); setMsg('')
    void raceGearBuy(id).then((r) => { onKoins(r.koins); onOwned({ ...owned, [id]: true }); setMsg('Gekauft – du trägst es jetzt!') }).catch((e) => setMsg(errorMessage(e))).finally(() => setBusy(null))
  }
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-label="Waffenladen">
      <div className="max-h-full w-full max-w-md overflow-auto rounded-2xl border border-orange-400/60 bg-slate-900/95 p-4 text-white shadow-2xl">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-orange-300">Waffenladen</h2><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-white/10 px-3 text-sm font-bold">Schließen</button></div>
        <p className="mb-2 text-xs text-slate-300">{coins !== null ? `Deine Coins: ${coins}` : ''}{isAdmin ? ' · Admin: alles gratis' : ''}</p>
        <ul className="grid gap-2">
          {GEAR.map((it) => (
            <li key={it.id} className="flex items-center gap-3 rounded-xl bg-white/10 p-2">
              <span className="text-3xl" aria-hidden>{it.icon}</span>
              <span className="min-w-0 flex-1"><b className="block text-sm">{it.name}</b><span className="block text-xs text-slate-300">{it.desc}</span></span>
              {owned[it.id] ? <span className="rounded-lg bg-emerald-500/30 px-2 py-1 text-xs font-bold text-emerald-200">Besitz ✓</span>
                : <button type="button" disabled={busy !== null} onClick={() => buy(it.id)} className="min-h-[44px] rounded-lg bg-orange-400 px-3 text-sm font-bold text-slate-950 disabled:opacity-50">{isAdmin ? 'Gratis' : `${it.price} 🪙`}</button>}
            </li>
          ))}
        </ul>
        {msg && <p className="mt-2 text-sm font-bold text-amber-200" role="status">{msg}</p>}
      </div>
    </div>
  )
}
