import { useEffect, useMemo, useRef, useState } from 'react'
import { getLearningPool } from '../../vocabApi'
import { racePerkAnswer, racePerkBuy, type PerkItem, type RacePerks } from '../../../services/cars'
import { errorMessage } from '../../../lib/errors'
import { isAnswerCorrect } from '../../vocabApi'
import { buildIndexes, makeQuestion, type Question } from '../../vocabApi'
import type { PoolVocab } from '../../../types'

/** Vokabel-Abfrage im Shop (Auto-Spawns) oder Fitnessstudio (Leben): jede richtige Antwort zählt, nach 10 gibt es die Belohnung (Server zählt und prüft). */
const ITEMS: Record<'shop' | 'gym', Array<{ id: PerkItem; name: string; text: string; cost: number }>> = {
  shop: [
    { id: 'spawn', name: 'Autoschlüssel-Paket', text: 'Bis zu 5 statt 2 Auto-Spawns, 30 Min', cost: 10 },
    { id: 'speed', name: 'Turnschuhe', text: '40 % schneller laufen, 30 Min', cost: 10 },
    { id: 'jump', name: 'Sprungfedern', text: 'Höher springen, 30 Min', cost: 10 },
    { id: 'armor', name: 'Schutzweste', text: 'Nur halber Schaden (Autos, Schläge, Unfälle), 30 Min', cost: 15 },
    { id: 'heal', name: 'Erste-Hilfe-Set', text: 'Sofort volle Leben', cost: 3 },
  ],
  gym: [{ id: 'hearts', name: 'Training', text: '+10 Leben (höchstens +100)', cost: 10 }],
}

/** Theke im Shop / Training im Fitnessstudio: richtige Vokabeln sammeln Punkte (Server zählt), damit kauft man Artikel. Admin bekommt alles gratis. */
export default function VocabShop({ kind, perks, isAdmin, onPerks, onBought, onClose }: { kind: 'shop' | 'gym'; perks: RacePerks | null; isAdmin: boolean; onPerks: (p: RacePerks) => void; onBought: (item: PerkItem) => void; onClose: () => void }) {
  const [pool, setPool] = useState<PoolVocab[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState<Question | null>(null)
  const [val, setVal] = useState('')
  const [fb, setFb] = useState<{ ok: boolean; text: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { let off = false; getLearningPool(null, null).then((p) => { if (!off) setPool(p) }).catch((e) => { if (!off) setErr(errorMessage(e)) }); return () => { off = true } }, [])
  const idx = useMemo(() => (pool ? buildIndexes(pool) : null), [pool])
  const next = () => {
    if (!pool || !idx || pool.length === 0) return
    const v = pool[Math.floor(Math.random() * pool.length)]
    setQ(makeQuestion(v, Math.random() < 0.5 ? 'forward' : 'backward', idx)); setVal(''); window.setTimeout(() => input.current?.focus(), 30)
  }
  useEffect(() => { if (pool && !q) next() }, [pool]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!q || !val.trim()) return
    if (fb) { setFb(null); next(); return }
    if (isAnswerCorrect(val, q.accepted, false)) {
      setFb({ ok: true, text: 'Richtig!' })
      try { onPerks(await racePerkAnswer(kind)) } catch (e) { setErr(errorMessage(e)) }
    } else setFb({ ok: false, text: `Falsch – richtig: ${q.accepted.join(' / ')}` })
  }
  const pts = kind === 'shop' ? perks?.shop ?? 0 : perks?.gym ?? 0
  const buy = async (id: PerkItem) => {
    try { onPerks(await racePerkBuy(id)); onBought(id); setErr(null); setFb({ ok: true, text: 'Gekauft!' }) } catch (e) { setErr(errorMessage(e)) }
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-auto bg-black/60 p-3" role="dialog" aria-label={kind === 'shop' ? 'Shop' : 'Fitnessstudio'}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/15 bg-slate-900/95 p-4 text-white">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{kind === 'shop' ? 'Shop – Theke' : 'Fitnessstudio'}</h2>
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-lg bg-white/15 px-3 text-sm">Schließen</button>
        </div>
        <p className="text-xs text-slate-300">{isAdmin ? 'Admin: alles gratis.' : `Du hast ${pts} richtige Vokabeln gesammelt. Beantworte unten Vokabeln, um mehr zu sammeln.`}</p>
        <ul className="space-y-1.5">
          {ITEMS[kind].map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg bg-white/10 p-2">
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{it.name}</p><p className="text-xs text-slate-300">{it.text}</p></div>
              <button type="button" onClick={() => void buy(it.id)} disabled={!isAdmin && pts < it.cost} className="min-h-[40px] shrink-0 rounded-lg bg-emerald-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-40">{isAdmin ? 'Gratis' : `${it.cost} Vok.`}</button>
            </li>
          ))}
        </ul>
        {kind === 'gym' && perks && <p className="text-xs text-slate-400">Leben: {perks.hearts}</p>}
        {err && <p className="text-sm text-rose-300">{err}</p>}
        <h3 className="pt-1 text-sm font-semibold">Vokabeln lernen</h3>
        {!pool && !err && <p className="text-sm">Lade Vokabeln …</p>}
        {pool && pool.length === 0 && <p className="text-sm">Du hast noch keine Vokabeln zum Abfragen.</p>}
        {q && (
          <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-2">
            <p className="text-lg font-semibold">{q.prompt}</p>
            <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Antwort" className="min-h-[44px] w-full rounded-lg border border-white/20 bg-slate-800 px-3" />
            {fb && <p className={`text-sm ${fb.ok ? 'text-emerald-300' : 'text-rose-300'}`} role="status">{fb.text}</p>}
            <button type="submit" className="min-h-[44px] w-full rounded-lg bg-cyan-500 font-bold text-slate-950">{fb ? 'Weiter' : 'Prüfen'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
