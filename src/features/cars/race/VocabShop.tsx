import { useEffect, useMemo, useRef, useState } from 'react'
import { getLearningPool } from '../../../services/learning'
import { racePerkAnswer, type RacePerks } from '../../../services/cars'
import { errorMessage } from '../../../lib/errors'
import { isAnswerCorrect } from '../../learning/answer'
import { buildIndexes, makeQuestion, type Question } from '../../learning/questions'
import type { PoolVocab } from '../../../types'

/** Vokabel-Abfrage im Shop (Auto-Spawns) oder Fitnessstudio (Leben): jede richtige Antwort zählt, nach 10 gibt es die Belohnung (Server zählt und prüft). */
export default function VocabShop({ kind, perks, onPerks, onClose }: { kind: 'shop' | 'gym'; perks: RacePerks | null; onPerks: (p: RacePerks) => void; onClose: () => void }) {
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
  const step = kind === 'shop' ? perks?.shop ?? 0 : perks?.gym ?? 0
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-label={kind === 'shop' ? 'Vokabel-Shop' : 'Fitnessstudio'}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/15 bg-slate-900/95 p-4 text-white">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{kind === 'shop' ? 'Vokabel-Shop' : 'Fitnessstudio'}</h2>
          <button type="button" onClick={onClose} className="min-h-[40px] rounded-lg bg-white/15 px-3 text-sm">Schließen</button>
        </div>
        <p className="text-xs text-slate-300">{kind === 'shop' ? '10 richtige Vokabeln = 30 Minuten lang bis zu 5 statt 2 Auto-Spawns.' : '10 richtige Vokabeln = +10 Leben (höchstens +100).'}</p>
        <div className="h-2 overflow-hidden rounded bg-white/15" aria-label={`Fortschritt ${step} von 10`}><div className="h-full bg-emerald-400" style={{ width: `${step * 10}%` }} /></div>
        <p className="text-xs text-slate-400">{step}/10{perks ? (kind === 'shop' ? ` · Spawns: bis ${perks.spawn_max}${perks.spawn_sec > 0 ? ` (noch ${Math.ceil(perks.spawn_sec / 60)} Min)` : ''}` : ` · Leben: ${perks.hearts}`) : ''}</p>
        {err && <p className="text-sm text-rose-300">{err}</p>}
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
