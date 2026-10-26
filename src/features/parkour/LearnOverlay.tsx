import { useEffect, useRef, useState } from 'react'
import { isAnswerCorrect } from '../learning/answer'
import type { Question } from '../learning/questions'
import { useSettings } from '../settings/SettingsProvider'
import { loadLearnPool, nextQuestion, type LearnPool } from './parkourLearn'

/**
 * Frage-Fenster im Parkour. Es müssen `need` Vokabeln richtig beantwortet werden.
 * retry = true: falsche Antworten zeigen die Lösung, dann kommt eine neue Frage (Levelwechsel).
 * retry = false: schon eine falsche Antwort beendet es mit "nicht geschafft" (Speedup).
 */
export default function LearnOverlay({ title, need, retry, onDone }: { title: string; need: number; retry: boolean; onDone: (ok: boolean) => void }) {
  const { settings } = useSettings()
  const [pool, setPool] = useState<LearnPool | null>(null)
  const [q, setQ] = useState<Question | null>(null)
  const [text, setText] = useState('')
  const [res, setRes] = useState<null | { ok: boolean }>(null)
  const [good, setGood] = useState(0)
  const asked = useRef(new Set<string>())
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const input = useRef<HTMLInputElement>(null)

  const ask = (p: LearnPool) => {
    const nq = nextQuestion(p, asked.current)
    if (!nq) { doneRef.current(true); return }
    asked.current.add(nq.vocabularyId)
    setQ(nq); setText(''); setRes(null)
  }

  useEffect(() => {
    let alive = true
    void loadLearnPool().then((p) => {
      if (!alive) return
      if (p.vocab.length === 0) { doneRef.current(true); return } // nichts zum Abfragen: nicht blockieren
      setPool(p); ask(p)
    })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (q && !res) input.current?.focus() }, [q, res])

  const submit = () => {
    if (!q || res) return
    const ok = isAnswerCorrect(text, q.accepted, settings.case_sensitive)
    setRes({ ok })
    if (ok) setGood((g) => g + 1)
  }
  const next = () => {
    if (!res || !pool) return
    const total = good // schon inklusive dieser Antwort
    if (res.ok) { if (total >= need) { doneRef.current(true); return } ask(pool); return }
    if (!retry) { doneRef.current(false); return }
    ask(pool)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-4 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-fuchsia-300">{title}</p>
        <p className="mb-3 text-xs text-slate-400">Richtig: {good} von {need}</p>
        {!q ? (
          <p className="py-6 text-center text-sm text-slate-300">Lade Vokabeln …</p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (res) next(); else submit() }}>
            <p className="mb-1 text-xs text-slate-400">{q.direction === 'forward' ? 'Auf Fremdsprache:' : 'Auf Deutsch:'}</p>
            <p className="mb-3 break-words text-2xl font-bold text-white">{q.prompt}</p>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} disabled={!!res}
              autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Antwort"
              className="mb-3 w-full rounded-xl border border-white/20 bg-slate-800 px-3 py-3 text-base text-white outline-none focus:border-fuchsia-300" />
            {res && (
              <p className={`mb-3 rounded-xl px-3 py-2 text-sm ${res.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
                {res.ok ? 'Richtig!' : `Falsch. Richtig wäre: ${q.accepted.join(' / ')}`}
                {!res.ok && !retry && ' – das Upgrade ist weg.'}
              </p>
            )}
            <button type="submit" className="min-h-[48px] w-full rounded-xl border border-fuchsia-300/60 bg-fuchsia-400/25 text-sm font-semibold text-white active:bg-fuchsia-400/45">
              {res ? (res.ok && good >= need ? 'Weiter' : res.ok ? 'Nächste Vokabel' : retry ? 'Nochmal eine andere' : 'OK') : 'Prüfen'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
