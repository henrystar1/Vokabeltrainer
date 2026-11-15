import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Layers, X } from 'lucide-react'
import { useAsync } from '../../lib/useAsync'
import { getCardBox } from '../../services/learning'
import { useSettings } from '../settings/SettingsProvider'
import { useLocks } from '../locks/LocksProvider'
import { fachColor, groupByFach } from './cardBox'

const KEY = 'vt-cardbox-dock'
export const readDockOpen = (): boolean => { try { return localStorage.getItem(KEY) !== 'closed' } catch { return true } }
export const saveDockOpen = (v: boolean): void => { try { localStorage.setItem(KEY, v ? 'open' : 'closed') } catch { /* egal */ } }

/** Karteikasten immer sichtbar: schmale Leiste am rechten Rand (große Bildschirme) oder Reiter mit Schublade (kleine). Ein Fach anklicken = nur dieses Fach lernen. */
export default function CardBoxDock({ open, onOpen }: { open: boolean; onOpen: (v: boolean) => void }) {
  const { settings } = useSettings()
  const { locked } = useLocks()
  const loc = useLocation()
  const [drawer, setDrawer] = useState(false)
  const box = useAsync(() => getCardBox(settings.learn_language, null), [settings.learn_language])
  const last = useRef(Date.now())
  useEffect(() => {
    // nach dem Lernen frisch laden, aber höchstens einmal pro Minute
    if (Date.now() - last.current > 60_000) { last.current = Date.now(); box.reload() }
    setDrawer(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])
  const groups = useMemo(() => groupByFach(box.data ?? []), [box.data])
  const total = box.data?.length ?? 0
  if (locked.has('learn')) return null

  const toggle = (v: boolean) => { onOpen(v); saveDockOpen(v) }
  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-white"><Layers size={15} className="text-accent-cyan" /> Karteikasten</span>
        <span className="text-xs text-slate-500">{total} Karten</span>
      </div>
      {total === 0 ? (
        <p className="text-xs text-slate-400">{box.loading ? 'Lädt …' : 'Noch keine aktiven Karten.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {groups.map((g, i) => {
            const f = i + 1
            return (
              <li key={f}>
                <Link to={`/lernen?fach=${f}`} className="block rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 transition hover:bg-white/10" aria-label={`Fach ${f}: ${g.length} Karten, nur dieses Fach lernen`}>
                  <span className="flex items-baseline justify-between text-xs"><span className="text-slate-300">Fach {f}</span><span className="text-base font-bold" style={{ color: fachColor(f) }}>{g.length}</span></span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full" style={{ width: `${total ? Math.max((g.length / total) * 100, g.length ? 5 : 0) : 0}%`, background: fachColor(f) }} /></span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <Link to="/lernen" className="inline-flex min-h-[32px] items-center gap-1 text-xs text-accent-cyan hover:underline">Lernen <ChevronRight size={13} /></Link>
    </div>
  )
  return (
    <>
      {open && (
        <aside aria-label="Karteikasten" className="glass fixed right-3 top-20 z-20 hidden w-52 rounded-2xl p-3 xl:block">
          <button type="button" aria-label="Karteikasten einklappen" onClick={() => toggle(false)} className="absolute right-1.5 top-1.5 rounded p-1 text-slate-500 hover:text-white"><X size={13} /></button>
          {body}
        </aside>
      )}
      {!open && (
        <button type="button" onClick={() => toggle(true)} aria-label="Karteikasten einblenden" className="glass fixed right-0 top-24 z-20 hidden min-h-[44px] items-center gap-1 rounded-l-xl px-2 text-accent-cyan xl:flex"><Layers size={16} /></button>
      )}
      <button type="button" onClick={() => setDrawer(true)} aria-label="Karteikasten öffnen" className="glass fixed right-0 top-24 z-20 flex min-h-[44px] items-center rounded-l-xl px-2 text-accent-cyan xl:hidden"><Layers size={18} /></button>
      {drawer && (
        <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-label="Karteikasten">
          <button type="button" aria-label="Schließen" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <div className="glass absolute right-0 top-0 h-full w-64 overflow-y-auto rounded-l-2xl p-4">
            <button type="button" aria-label="Schließen" onClick={() => setDrawer(false)} className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-white"><X size={16} /></button>
            <div className="mt-6">{body}</div>
          </div>
        </div>
      )}
    </>
  )
}
