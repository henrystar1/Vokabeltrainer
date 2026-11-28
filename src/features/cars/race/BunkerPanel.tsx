import { useEffect, useRef, useState } from 'react'
import { raceKskBuy, raceKskGet, raceKskSet } from '../../../services/cars'
import { errorMessage } from '../../../lib/errors'
import { KSK_ITEMS, QUAD_COLORS, parseLoadout, type KskItem, type KskLoadout, type QuadWeapon } from './bunker'
import { MOUNTAINS, WORLD } from './mountains'
import { BUNKER } from './bunker'

/** Quad-Schmiede im Bunker: Farbe, Heckwaffe und Ausrüstung (Münzen, Admin gratis). */
export function QuadTunePanel({ isAdmin, coins, loadout, onLoadout, onKoins, onClose }: {
  isAdmin: boolean; coins: number | null; loadout: KskLoadout; onLoadout: (l: KskLoadout) => void; onKoins: (k: number) => void; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { void raceKskGet().then((j) => onLoadout(parseLoadout(j))).catch(() => undefined) }, [onLoadout])
  const save = (color: string, weapon: QuadWeapon) => {
    onLoadout({ ...loadout, color, weapon }) // sofort sichtbar, Server bestätigt
    setBusy(true); setMsg('')
    void raceKskSet(color, weapon).then((j) => onLoadout(parseLoadout(j))).catch((e) => setMsg(errorMessage(e))).finally(() => setBusy(false))
  }
  const buy = (id: KskItem) => {
    setBusy(true); setMsg('')
    void raceKskBuy(id).then((r) => { onKoins(r.koins); onLoadout({ ...loadout, items: [...loadout.items, id] }); setMsg('Eingebaut!') }).catch((e) => setMsg(errorMessage(e))).finally(() => setBusy(false))
  }
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-label="Quad-Schmiede">
      <div className="max-h-full w-full max-w-md overflow-auto rounded-2xl border border-cyan-400/60 bg-slate-900/95 p-4 text-white shadow-2xl">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-cyan-300">KSK-Quad-Schmiede</h2><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-white/10 px-4 text-sm font-bold">Fertig</button></div>
        <p className="mb-2 text-xs text-slate-300">{coins !== null ? `Deine Coins: ${coins}` : ''}{isAdmin ? ' · Admin: alles gratis' : ''}</p>
        <h3 className="mb-1 text-sm font-bold">Farbe</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {QUAD_COLORS.map((c) => (
            <button key={c.hex} type="button" disabled={busy} aria-label={c.name} aria-pressed={loadout.color === c.hex} onClick={() => save(c.hex, loadout.weapon)} className={`h-11 w-11 rounded-full border-2 ${loadout.color === c.hex ? 'border-cyan-300 ring-2 ring-cyan-300' : 'border-white/40'}`} style={{ background: c.hex }} />
          ))}
        </div>
        <h3 className="mb-1 text-sm font-bold">Waffe auf dem Heck</h3>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} aria-pressed={loadout.weapon === 'minigun'} onClick={() => save(loadout.color, 'minigun')} className={`min-h-[48px] rounded-xl border px-3 text-sm font-bold ${loadout.weapon === 'minigun' ? 'border-cyan-300 bg-cyan-500/30' : 'border-white/30 bg-white/10'}`}>Minigun</button>
          <button type="button" disabled={busy || !loadout.items.includes('w_rocket')} aria-pressed={loadout.weapon === 'rocket'} onClick={() => save(loadout.color, 'rocket')} className={`min-h-[48px] rounded-xl border px-3 text-sm font-bold disabled:opacity-40 ${loadout.weapon === 'rocket' ? 'border-cyan-300 bg-cyan-500/30' : 'border-white/30 bg-white/10'}`}>Raketenwerfer</button>
        </div>
        <h3 className="mb-1 text-sm font-bold">Ausrüstung</h3>
        <ul className="grid gap-2">
          {KSK_ITEMS.map((it) => (
            <li key={it.id} className="flex items-center gap-3 rounded-xl bg-white/10 p-2">
              <span className="text-3xl" aria-hidden>{it.icon}</span>
              <span className="min-w-0 flex-1"><b className="block text-sm">{it.name}</b><span className="block text-xs text-slate-300">{it.desc}</span></span>
              {loadout.items.includes(it.id) ? <span className="rounded-lg bg-emerald-500/30 px-2 py-1 text-xs font-bold text-emerald-200">Eingebaut ✓</span>
                : <button type="button" disabled={busy} onClick={() => buy(it.id)} className="min-h-[44px] rounded-lg bg-cyan-400 px-3 text-sm font-bold text-slate-950 disabled:opacity-50">{isAdmin ? 'Gratis' : `${it.price} Coins`}</button>}
            </li>
          ))}
        </ul>
        {msg && <p className="mt-2 text-sm font-bold text-cyan-200" role="status">{msg}</p>}
      </div>
    </div>
  )
}

export interface DronePlayer { id: string; name: string; x: number; z: number; kind: string; wk: boolean }
export interface DroneData { me: { x: number; z: number; h: number }; players: DronePlayer[] }

/** Drohnen-Computer: Draufsicht auf die Karte mit allen Spielern (live), Zoom und Verfolgen. */
export function DronePanel({ getData, onClose, onCams }: { getData: () => DroneData; onClose: () => void; onCams?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [follow, setFollow] = useState<string | null>(null)
  const [list, setList] = useState<DronePlayer[]>([])
  const st = useRef({ zoom: 1, follow: null as string | null, cx: 0, cz: 0 })
  st.current.zoom = zoom; st.current.follow = follow
  useEffect(() => {
    st.current.cx = BUNKER.ex; st.current.cz = BUNKER.ez
    const id = window.setInterval(() => {
      const cv = ref.current, g = cv?.getContext('2d'); if (!cv || !g) return
      const d = getData(), s = st.current, t = performance.now() / 1000
      setList((o) => (o.length === d.players.length && o.every((p, i) => p.id === d.players[i].id) ? o : d.players))
      const f = s.follow ? d.players.find((p) => p.id === s.follow) : null
      const tx = f ? f.x : s.follow === 'me' ? d.me.x : s.cx, tz = f ? f.z : s.follow === 'me' ? d.me.z : s.cz
      s.cx += (tx - s.cx) * 0.25; s.cz += (tz - s.cz) * 0.25
      const w = cv.width, h = cv.height, span = (WORLD.x1 - WORLD.x0) / s.zoom, k = Math.min(w, h) / span
      const X = (x: number) => w / 2 + (x - s.cx) * k, Y = (z: number) => h / 2 - (z - s.cz) * k
      g.fillStyle = '#031017'; g.fillRect(0, 0, w, h)
      g.strokeStyle = '#0b3a47'; g.lineWidth = 1
      for (let x = Math.ceil(WORLD.x0 / 120) * 120; x <= WORLD.x1; x += 120) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), h); g.stroke() }
      for (let z = Math.ceil(WORLD.z0 / 120) * 120; z <= WORLD.z1; z += 120) { g.beginPath(); g.moveTo(0, Y(z)); g.lineTo(w, Y(z)); g.stroke() }
      g.strokeStyle = '#22d3ee'; g.lineWidth = 2; g.strokeRect(X(WORLD.x0), Y(WORLD.z1), (WORLD.x1 - WORLD.x0) * k, (WORLD.z1 - WORLD.z0) * k)
      g.fillStyle = '#134e4a'; for (const m of MOUNTAINS) { g.beginPath(); g.arc(X(m.x), Y(m.z), m.R * k, 0, 7); g.fill() }
      g.fillStyle = '#facc15'; g.fillRect(X(BUNKER.ex) - 4, Y(BUNKER.ez) - 4, 8, 8)
      g.font = 'bold 12px monospace'
      for (const p of d.players) {
        g.fillStyle = p.wk ? '#4ade80' : '#f59e0b'; g.beginPath(); g.arc(X(p.x), Y(p.z), 5, 0, 7); g.fill()
        g.fillStyle = '#e2e8f0'; g.fillText(p.name + (p.kind === 'quad' ? ' (Quad)' : ''), X(p.x) + 8, Y(p.z) + 4)
        if (s.follow === p.id) { g.strokeStyle = '#f87171'; g.beginPath(); g.arc(X(p.x), Y(p.z), 11 + Math.sin(t * 6) * 2, 0, 7); g.stroke() }
      }
      g.fillStyle = '#22d3ee'; g.beginPath(); g.arc(X(d.me.x), Y(d.me.z), 5, 0, 7); g.fill(); g.fillText('Du', X(d.me.x) + 8, Y(d.me.z) + 4)
      g.fillStyle = 'rgba(34,211,238,0.07)'; g.fillRect(0, (t * 80) % h, w, 8)
      g.fillStyle = '#4ade80'; g.fillText(`DROHNE · ${d.players.length} Spieler · Zoom ×${s.zoom.toFixed(1)}`, 10, 18)
    }, 120)
    return () => window.clearInterval(id)
  }, [getData])
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black/85 p-3 text-white" role="dialog" aria-label="Drohnen-Computer">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-black text-cyan-300">Drohnen-Computer</h2>
        <button type="button" onClick={() => setZoom((z) => Math.min(12, z * 1.6))} className="min-h-[44px] min-w-[44px] rounded-lg bg-white/10 text-lg font-bold" aria-label="Hineinzoomen">＋</button>
        <button type="button" onClick={() => setZoom((z) => Math.max(0.8, z / 1.6))} className="min-h-[44px] min-w-[44px] rounded-lg bg-white/10 text-lg font-bold" aria-label="Herauszoomen">－</button>
        <button type="button" onClick={() => setFollow(follow === 'me' ? null : 'me')} className={`min-h-[44px] rounded-lg px-3 text-sm font-bold ${follow === 'me' ? 'bg-cyan-500/40' : 'bg-white/10'}`}>Mich</button>
        {onCams && <button type="button" onClick={onCams} className="min-h-[44px] rounded-lg bg-cyan-500/40 px-3 text-sm font-bold">📹 Wandkameras</button>}
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-red-500/70 px-4 text-sm font-bold">Schließen</button>
      </div>
      <p className="mb-2 rounded-lg bg-cyan-500/15 p-2 text-xs text-cyan-100">Das ist die Spionage-Karte von oben: Jeder Punkt ist ein Spieler in der Stadt (<b className="text-green-300">grün</b> = zu Fuß, <b className="text-amber-300">orange</b> = im Fahrzeug, <b className="text-cyan-300">blau</b> = du, gelbes Quadrat = Bunker). Tippe unten auf einen Namen, dann folgt die Drohne ihm live. „Wandkameras“ schaltet auf die Überwachungskameras an den Häusern. ＋ / － zoomt, „Mich“ folgt dir.</p>
      <canvas ref={ref} width={900} height={560} className="min-h-0 w-full flex-1 rounded-xl border border-cyan-500/50 bg-black object-contain" />
      <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-auto">
        {list.length === 0 && <span className="text-sm text-slate-300">Gerade sind keine anderen Spieler in der Stadt.</span>}
        {list.map((p) => <button key={p.id} type="button" onClick={() => { setFollow(follow === p.id ? null : p.id); if (follow !== p.id) setZoom((z) => Math.max(z, 4)) }} className={`min-h-[40px] rounded-lg px-3 text-sm font-bold ${follow === p.id ? 'bg-red-500/60' : 'bg-white/10'}`}>{p.name}</button>)}
      </div>
    </div>
  )
}
