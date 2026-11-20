import { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminFootSet, adminSeatsSet, carBuy, carUpgrade, raceSuperInfo, type CarRow } from '../../services/cars'
import { setFootSpeeds } from './race/foot'
import { setSeats } from './stats'
import { useWallet } from '../koins/WalletProvider'
import RaceMenu from './race/RaceMenu'
import AdminCarBuilder from './AdminCarBuilder'
import { useAuthOptional } from '../auth/AuthProvider'
import type { RaceCarOption } from './race/useRaceCars'
import { getColor, getPick, setColor, setPick } from './carPrefs'
import { SUPERCAR, canFly, carKmh, isBike, kindStats } from './stats'
import { UP_LABEL, UP_MAX, UP_PARTS, upFactors, upPrice, type UpPart } from './tuning'

const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#38bdf8', '#3b82f6', '#8b5cf6', '#ec4899', '#f8fafc', '#94a3b8', '#111827']

interface Entry { id: string; name: string; kind: string; color: string; price: number; owned: boolean; top: number | null; up: RaceCarOption['up'] | null; special?: boolean }

/** Drehbares 3D-Bild des Autos auf einer Drehscheibe (Ziehen dreht von Hand, sonst dreht es sich langsam). */
export function Turntable({ kind, color }: { kind: string; color: string }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ set: (k: string, c: string) => void } | null>(null)
  const latest = useRef({ kind, color }); latest.current = { kind, color }
  const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false, raf = 0, cleanup = () => undefined as void
    void (async () => {
      try {
        const THREE = await import('three')
        const { makeCarModel } = await import('./race/scene')
        const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js')
        const el = host.current
        if (dead || !el) return
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
        el.appendChild(renderer.domElement)
        renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab'
        const scene = new THREE.Scene()
        const pm = new THREE.PMREMGenerator(renderer)
        scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
        const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
        const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(4, 7, 5); key.castShadow = true
        key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6
        const rim = new THREE.DirectionalLight(0x5ad1ff, 1.6); rim.position.set(-6, 3, -5)
        scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.25))
        // Drehscheibe mit leuchtendem Ring
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.35, metalness: 0.6 }))
        disc.position.y = -0.09; disc.receiveShadow = true
        const ring = new THREE.Mesh(new THREE.TorusGeometry(3.42, 0.035, 12, 96), new THREE.MeshBasicMaterial({ color: 0x22d3ee }))
        ring.rotation.x = Math.PI / 2; ring.position.y = 0.01
        scene.add(disc, ring)
        const stage = new THREE.Group(); scene.add(stage)
        let model: import('three').Group | null = null
        const set = (k: string, c: string) => {
          if (model) { stage.remove(model); model.traverse((o) => { const m = o as import('three').Mesh; if (m.isMesh) { m.geometry.dispose(); const mat = m.material; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat.dispose() } }) }
          model = makeCarModel(THREE, k, c)
          model.traverse((o) => { if ((o as import('three').Mesh).isMesh) { o.castShadow = true } })
          stage.add(model)
        }
        api.current = { set }
        set(latest.current.kind, latest.current.color)
        let yaw = 0.6, drag = false, lastX = 0, idle = 0, t0 = performance.now()
        const dom = renderer.domElement
        const down = (e: PointerEvent) => { drag = true; lastX = e.clientX; idle = 0; dom.setPointerCapture(e.pointerId); dom.style.cursor = 'grabbing' }
        const move = (e: PointerEvent) => { if (!drag) return; yaw += (e.clientX - lastX) * 0.012; lastX = e.clientX }
        const up = () => { drag = false; dom.style.cursor = 'grab' }
        dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up)
        const resize = () => {
          const w = el.clientWidth || 600, h = el.clientHeight || 340
          renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix()
        }
        resize()
        const ro = new ResizeObserver(resize); ro.observe(el)
        const tick = (now: number) => {
          const dt = Math.min(0.05, (now - t0) / 1000); t0 = now
          if (!drag) { idle += dt; if (idle > 1.2) yaw += dt * 0.55 }
          stage.rotation.y = yaw
          const bike = isBike(latest.current.kind)
          cam.position.set(0, bike ? 2.2 : 2.4, bike ? 6.2 : 7.4); cam.lookAt(0, bike ? 0.9 : 0.8, 0)
          renderer.render(scene, cam)
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        cleanup = () => {
          cancelAnimationFrame(raf); ro.disconnect()
          dom.removeEventListener('pointerdown', down); dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerup', up); dom.removeEventListener('pointercancel', up)
          pm.dispose(); renderer.dispose(); dom.remove(); api.current = null
        }
        if (dead) cleanup()
      } catch { setErr(true) }
    })()
    return () => { dead = true; cleanup() }
  }, [])
  useEffect(() => { api.current?.set(kind, color) }, [kind, color])
  return (
    <div ref={host} className="h-[300px] w-full sm:h-[360px]" role="img" aria-label="Drehbares 3D-Bild des Autos">
      {err && <p className="grid h-full place-items-center text-sm text-slate-400">3D-Ansicht nicht verfügbar</p>}
    </div>
  )
}

/** Eine Fahrwert-Zeile mit Balken (animiert) und Zuwachs. */
function Stat({ label, value, max, unit, gain }: { label: string; value: number; max: number; unit: string; gain: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-300"><span>{label}</span><span className="font-semibold tabular-nums">{value}{unit}{gain > 0 && <span className="ml-1 text-emerald-300">+{gain}</span>}</span></div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-300 to-amber-300 transition-all duration-700 ease-out" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
    </div>
  )
}

/** Admin: Sitzplätze je Auto und Lauf-/Sprinttempo der Spielfigur (gilt für alle). */
function FootSettings() {
  const info = useAsync(raceSuperInfo, [])
  const [seats, setSeatsV] = useState<string | null>(null)
  const [walk, setWalk] = useState<string | null>(null)
  const [run, setRun] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const d = info.data
  const v = { seats: seats ?? String(d?.seats ?? 4), walk: walk ?? String(d?.walk ?? 4.4), run: run ?? String(d?.run ?? 7.6) }
  const num = (t: string) => Number(t.replace(',', '.')) || 0
  async function save() {
    setMsg(null)
    try {
      await adminSeatsSet(Math.floor(num(v.seats)))
      await adminFootSet(num(v.walk), num(v.run))
      setSeats(Math.floor(num(v.seats))); setFootSpeeds(num(v.walk), num(v.run))
      await info.reload(); setSeatsV(null); setWalk(null); setRun(null); setMsg('Gespeichert.')
    } catch (e) { setMsg(errorMessage(e)) }
  }
  const inp = 'min-h-[44px] w-20 rounded-lg border border-white/15 bg-space-900/60 px-3'
  return (
    <section className="space-y-2 rounded-xl border border-white/10 p-3">
      <h3 className="font-semibold">Mitfahren und Laufen (Admin)</h3>
      <p className="text-sm text-slate-400">Wie viele Leute in ein Auto passen (der Erste fährt, die anderen fahren mit) und wie schnell die Figur läuft und sprintet.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">Sitzplätze<input aria-label="Sitzplätze pro Auto" inputMode="numeric" value={v.seats} onChange={(e) => setSeatsV(e.target.value)} className={inp} />(1–8)</label>
        <label className="flex items-center gap-2">Laufen<input aria-label="Lauftempo in Metern pro Sekunde" inputMode="decimal" value={v.walk} onChange={(e) => setWalk(e.target.value)} className={inp} />m/s</label>
        <label className="flex items-center gap-2">Sprint<input aria-label="Sprinttempo in Metern pro Sekunde" inputMode="decimal" value={v.run} onChange={(e) => setRun(e.target.value)} className={inp} />m/s</label>
        <button type="button" onClick={() => void save()} className="min-h-[44px] rounded-lg bg-accent-cyan px-3 font-semibold text-slate-950">Speichern</button>
      </div>
      {msg && <p className="text-sm text-amber-200" role="status">{msg}</p>}
    </section>
  )
}

/** Showroom: Autos in 3D ansehen, wechseln, kaufen, umlackieren, tunen und von hier aus losfahren. */
export default function Showroom({ shop, cars, superOk, assistOk, onChanged }: { shop: CarRow[]; cars: RaceCarOption[]; superOk: boolean; assistOk: boolean; onChanged: () => Promise<void> }) {
  const wallet = useWallet()
  const isAdmin = useAuthOptional()?.isAdmin ?? false
  const entries = useMemo<Entry[]>(() => {
    const own = new Map(cars.map((c) => [c.id, c]))
    const list: Entry[] = shop.filter((c) => c.owned || c.active !== false).map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, price: c.price, owned: c.owned, top: c.top_kmh, up: own.get(c.id)?.up ?? null }))
    if (superOk) { const s = own.get(SUPERCAR.id); list.unshift({ id: SUPERCAR.id, name: SUPERCAR.name, kind: SUPERCAR.kind, color: SUPERCAR.color, price: 0, owned: true, top: s?.top ?? SUPERCAR.top, up: s?.up ?? null, special: true }) }
    return list
  }, [shop, cars, superOk])
  const [idx, setIdx] = useState(0)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pop, setPop] = useState<{ key: number; text: string } | null>(null)
  const [view, setView] = useState<null | 'race' | 'lobby'>(null)
  // gemerktes Lieblingsauto beim ersten Anzeigen auswählen
  const started = useRef(false)
  useEffect(() => {
    if (started.current || entries.length === 0) return
    started.current = true
    const p = getPick(), i = entries.findIndex((e) => e.id === p)
    setIdx(i >= 0 ? i : Math.max(0, entries.findIndex((e) => e.owned)))
  }, [entries])
  const cur = entries[Math.min(idx, Math.max(0, entries.length - 1))]
  if (!cur) return <p className="text-sm text-slate-300">Keine Autos verfügbar.</p>
  const color = colors[cur.id] ?? getColor(cur.id) ?? cur.color
  const go = (d: number) => { const n = (idx + d + entries.length) % entries.length; setIdx(n); setPick(entries[n].id); setMsg(null); setView(null) }
  const up = cur.up ?? { motor: 0, reifen: 0, bremse: 0 }
  const f = upFactors(up), ks = kindStats(cur.kind), base = carKmh(cur.kind, cur.top)
  const stat = { top: Math.round(base * f.top), acc: Math.round(ks.acc * f.acc * 10) / 10, turn: Math.round(ks.turn * f.turn * 100) / 100, brake: Math.round(ks.brake * f.brake) }

  async function buy() {
    setBusy('buy'); setMsg(null)
    try { wallet.setBalance(await carBuy(cur.id)); await onChanged(); setMsg(`${cur.name} steht jetzt in deiner Garage.`) } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(null) }
  }
  async function tune(part: UpPart) {
    setBusy(part); setMsg(null)
    const before = stat.top
    try {
      const r = await carUpgrade(cur.id, part); wallet.setBalance(r.koins); await onChanged()
      const after = Math.round(base * upFactors({ ...up, [part]: r[part] }).top)
      const txt = part === 'motor' ? `+${after - before} km/h` : part === 'reifen' ? '+4 % Lenkung' : '+6 % Bremsen'
      setPop({ key: Date.now(), text: txt }); setTimeout(() => setPop((p) => (p && Date.now() - p.key >= 1700 ? null : p)), 1800)
    } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(null) }
  }
  const paint = (c: string | null) => { setColor(cur.id, c); setColors((o) => { const n = { ...o }; if (c) n[cur.id] = c; else delete n[cur.id]; return n }); void onChanged() }
  const racer: RaceCarOption | undefined = cars.find((c) => c.id === cur.id)
  const raceCar = racer ? { id: racer.id, name: 'Du', kind: racer.kind, color, top: racer.top, up: racer.up } : null

  if (view && raceCar) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setView(null)} className="min-h-[44px] rounded-lg border border-white/15 px-4 text-sm hover:bg-white/10">← zurück zum Showroom</button>
        <RaceMenu key={view + cur.id + color} car={raceCar} assistOk={cur.id === SUPERCAR.id && assistOk} only={view} onClose={() => setView(null)} />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_50%_20%,#1e3a5f_0%,#0b1220_62%,#05080f_100%)] shadow-2xl">
        <Turntable kind={cur.kind} color={color} />
        <button type="button" onClick={() => go(-1)} aria-label="Vorheriges Auto" className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl text-white backdrop-blur hover:bg-black/70">‹</button>
        <button type="button" onClick={() => go(1)} aria-label="Nächstes Auto" className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-2xl text-white backdrop-blur hover:bg-black/70">›</button>
        <div className="pointer-events-none absolute left-4 top-3">
          <p className="text-2xl font-black tracking-tight text-white [text-shadow:0_2px_10px_#000]">{cur.name}</p>
          <p className="text-xs text-slate-300">{idx + 1} / {entries.length}{canFly(cur.kind) ? ' · ✈ kann fliegen' : ''}{isBike(cur.kind) ? ' · Motorrad' : ''}</p>
        </div>
        {pop && <p key={pop.key} className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 animate-[vt-rise_1.7s_ease-out_forwards] text-4xl font-black text-emerald-300 [text-shadow:0_0_18px_#10b981,0_2px_8px_#000]">{pop.text}</p>}
        <style>{'@keyframes vt-rise{0%{opacity:0;transform:translate(-50%,24px) scale(.7)}20%{opacity:1;transform:translate(-50%,0) scale(1.15)}100%{opacity:0;transform:translate(-50%,-70px) scale(1)}}'}</style>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">{cur.owned ? <span className="text-emerald-300">In deiner Garage{cur.special ? ' (Admin-Auto)' : ''}</span> : <>Preis: <b>{cur.price.toLocaleString('de-DE')} Coins</b></>}</p>
        {!cur.owned && <button type="button" disabled={busy !== null} onClick={() => void buy()} className="min-h-[44px] rounded-lg bg-accent-cyan px-6 font-bold text-slate-950 disabled:opacity-40">{busy === 'buy' ? '…' : `Kaufen · ${cur.price.toLocaleString('de-DE')} Coins`}</button>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <Stat label="Höchstgeschwindigkeit" value={stat.top} max={420} unit=" km/h" gain={stat.top - base} />
          <Stat label="Beschleunigung" value={stat.acc} max={42} unit="" gain={Math.round((stat.acc - ks.acc) * 10) / 10} />
          <Stat label="Lenkung" value={stat.turn} max={2.8} unit="" gain={Math.round((stat.turn - ks.turn) * 100) / 100} />
          <Stat label="Bremsen" value={stat.brake} max={56} unit="" gain={stat.brake - ks.brake} />
        </div>
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-sm font-semibold">Farbe</p>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Farbe ${c}`} aria-pressed={color.toLowerCase() === c} onClick={() => paint(c)} className={`h-8 w-8 rounded-full border-2 ${color.toLowerCase() === c ? 'border-white' : 'border-white/20'}`} style={{ background: c }} />)}
            <label className="flex items-center gap-1 text-xs text-slate-300">eigene <input type="color" value={color} onChange={(e) => paint(e.target.value)} className="h-8 w-10 cursor-pointer rounded bg-transparent" aria-label="Eigene Farbe" /></label>
            {getColor(cur.id) && <button type="button" onClick={() => paint(null)} className="rounded-lg border border-white/15 px-2 py-1 text-xs hover:bg-white/10">Originalfarbe</button>}
          </div>
          <p className="text-xs text-slate-400">Die Farbe wird auf diesem Gerät gemerkt und gilt im Rennen und online.</p>
        </div>
      </div>
      {cur.owned && !cur.special && (
        <ul className="grid gap-2 md:grid-cols-3">
          {UP_PARTS.map((p) => {
            const lvl = up[p], max = lvl >= UP_MAX, cost = upPrice(cur.price, lvl)
            return (
              <li key={p} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="font-semibold">{UP_LABEL[p].name} <span className="text-xs font-normal text-slate-400">Stufe {lvl}/{UP_MAX}</span></p>
                <p className="text-xs text-slate-400">{UP_LABEL[p].text}</p>
                <div className="mt-1 flex gap-1" aria-hidden="true">{Array.from({ length: UP_MAX }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < lvl ? 'bg-accent-cyan' : 'bg-white/10'}`} />)}</div>
                {max ? <p className="mt-2 rounded-lg bg-emerald-500/20 px-3 py-2 text-center text-sm text-emerald-300">Maximal</p>
                  : <button type="button" disabled={busy !== null} onClick={() => void tune(p)} className="mt-2 min-h-[44px] w-full rounded-lg bg-accent-cyan px-3 font-semibold text-slate-950 disabled:opacity-40">{busy === p ? '…' : `Verbessern · ${cost.toLocaleString('de-DE')}`}</button>}
              </li>
            )
          })}
        </ul>
      )}
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" disabled={!cur.owned} onClick={() => setView('lobby')} className="min-h-[56px] rounded-xl border border-accent-cyan px-6 text-lg font-bold text-accent-cyan hover:bg-accent-cyan/10 disabled:opacity-40">Offene Lobby</button>
        <button type="button" disabled={!cur.owned} onClick={() => setView('race')} className="min-h-[56px] rounded-xl bg-accent-cyan px-6 text-lg font-bold text-slate-950 disabled:opacity-40">Rennen</button>
      </div>
      {!cur.owned && <p className="text-xs text-slate-400">Kaufe das Auto, um damit zu fahren.</p>}
      {isAdmin && <FootSettings />}
      {isAdmin && <AdminCarBuilder onSaved={onChanged} />}
    </div>
  )
}
