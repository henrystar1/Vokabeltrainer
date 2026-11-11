import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { delayMs, groupWords, pivotIndex, textStats, tokenize } from '../features/speedread/engine'

function load(): { wpm: number; variable: boolean; size: number; font: number } {
  try { const j = JSON.parse(localStorage.getItem('speedread') ?? '{}') as Record<string, number | boolean>; return { wpm: Number(j.wpm) || 350, variable: j.variable !== false, size: Number(j.size) || 1, font: Number(j.font) || 48 } } catch { return { wpm: 350, variable: true, size: 1, font: 48 } }
}

/** Schnelllesen: Text einfügen, Zeichen zählen und Wort für Wort in der Bildmitte blitzen lassen (RSVP). */
export default function SpeedRead() {
  const init = useMemo(load, [])
  const [text, setText] = useState('')
  const [wpm, setWpm] = useState(init.wpm)
  const [variable, setVariable] = useState(init.variable)
  const [size, setSize] = useState(init.size)
  const [font, setFont] = useState(init.font)
  const [running, setRunning] = useState(false)
  const [pos, setPos] = useState(0)
  const stats = useMemo(() => textStats(text), [text])
  const groups = useMemo(() => groupWords(tokenize(text), size), [text, size])
  const posRef = useRef(0)
  posRef.current = pos

  useEffect(() => { try { localStorage.setItem('speedread', JSON.stringify({ wpm, variable, size, font })) } catch { /* ohne Speicher */ } }, [wpm, variable, size, font])
  useEffect(() => { setPos(0); setRunning(false) }, [text, size])
  useEffect(() => {
    if (!running) return
    if (posRef.current >= groups.length) { setRunning(false); return }
    const t = window.setTimeout(() => {
      if (posRef.current + 1 >= groups.length) { setRunning(false); setPos(groups.length - 1) } else setPos(posRef.current + 1)
    }, delayMs(groups[posRef.current] ?? '', wpm, variable))
    return () => window.clearTimeout(t)
  }, [running, pos, groups, wpm, variable])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT')) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      if (e.code === 'ArrowLeft') setPos((p) => Math.max(0, p - 5))
      if (e.code === 'ArrowRight') setPos((p) => Math.min(Math.max(groups.length - 1, 0), p + 5))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length, running])

  function toggle() {
    if (groups.length === 0) return
    if (!running && pos >= groups.length - 1) setPos(0)
    setRunning((r) => !r)
  }

  const cur = groups[pos] ?? ''
  const chars = [...cur]
  const pivot = size === 1 ? pivotIndex(cur) : Math.min(pivotIndex(cur.split(' ')[0] ?? ''), chars.length - 1)
  const left = Math.max(0, Math.round(((groups.length - pos) * (60 / wpm) * size)))
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Wörter blitzen in der Mitte auf, ohne dass die Augen wandern müssen" title="Schnelllesen" />
      <Card>
        <label className="block space-y-1.5">
          <span className="label-mono">Text einfügen</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Hier den Text einfügen …" className="w-full rounded-xl border border-white/15 bg-space-900/60 p-3 text-sm" />
        </label>
        <p className="mt-2 text-sm text-slate-300" aria-live="polite">
          <b>{stats.chars.toLocaleString('de-DE')}</b> Zeichen · <b>{stats.charsNoSpaces.toLocaleString('de-DE')}</b> ohne Leerzeichen · <b>{stats.words.toLocaleString('de-DE')}</b> Wörter · <b>{stats.sentences}</b> Sätze · Lesezeit bei {wpm} Wörtern/min: <b>{stats.minutesAt(wpm) < 1 ? `${Math.round(stats.minutesAt(wpm) * 60)} s` : `${stats.minutesAt(wpm).toFixed(1).replace('.', ',')} min`}</b>
        </p>
      </Card>
      <Card>
        <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl bg-black/50" aria-live="off">
          <span className="pointer-events-none absolute left-1/2 top-2 h-4 w-px -translate-x-1/2 bg-rose-500/60" aria-hidden />
          <span className="pointer-events-none absolute bottom-2 left-1/2 h-4 w-px -translate-x-1/2 bg-rose-500/60" aria-hidden />
          {cur === '' ? <span className="text-sm text-slate-500">Füge oben einen Text ein und drücke Start.</span> : (
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-baseline font-mono" style={{ fontSize: font }}>
              <span className="justify-self-end whitespace-pre text-white">{chars.slice(0, pivot).join('')}</span>
              <span className="text-rose-500">{chars[pivot] ?? ''}</span>
              <span className="justify-self-start whitespace-pre text-white">{chars.slice(pivot + 1).join('')}</span>
            </div>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-accent-cyan" style={{ width: groups.length ? `${((pos + 1) / groups.length) * 100}%` : '0%' }} /></div>
        <p className="mt-1 text-xs text-slate-400">{groups.length ? `${pos + 1} von ${groups.length} · noch ca. ${mm(left)}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggle} disabled={groups.length === 0} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950 disabled:opacity-40">{running ? <><Pause size={16} />Pause</> : <><Play size={16} />Start</>}</button>
          <button type="button" onClick={() => { setRunning(false); setPos(0) }} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/15 px-3 hover:bg-white/10"><RotateCcw size={16} />Von vorn</button>
          <span className="text-xs text-slate-500">Leertaste = Start/Pause · ←/→ = 5 zurück/vor</span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1"><span className="label-mono">Tempo: {wpm} Wörter/min</span><input type="range" min={100} max={1200} step={25} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} className="w-full" /></label>
          <label className="space-y-1"><span className="label-mono">Schriftgröße: {font}</span><input type="range" min={24} max={96} step={4} value={font} onChange={(e) => setFont(Number(e.target.value))} className="w-full" /></label>
          <label className="space-y-1"><span className="label-mono">Wörter pro Blitz</span>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3"><option value={1}>1 Wort</option><option value={2}>2 Wörter</option><option value={3}>3 Wörter</option></select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 self-end"><input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} className="h-5 w-5" /><span className="text-sm">Variable Geschwindigkeit (lange Wörter und Satzenden etwas länger)</span></label>
        </div>
      </Card>
    </div>
  )
}
