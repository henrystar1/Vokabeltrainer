import { useEffect } from 'react'
import type { OgView } from '../../services/online'
import { HOME_LANE, HOUSE, SEAT_COLORS, SEAT_NAMES, TRACK, cellOf } from './ludoBoard'

const U = 40 // Pixel je Feld
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

/** Mensch ärgere dich nicht: Brett als SVG. Würfel und Regeln liegen auf dem Server, hier wird nur gezeichnet und gezogen. */
export default function LudoBoard({ view, busy, onRoll, onMove }: { view: OgView; busy: boolean; onRoll: () => void; onMove: (piece: number) => void }) {
  const st = view.state
  const seat = view.me.seat
  const myTurn = view.status === 'running' && seat !== null && view.turn_seat === seat
  const legal = new Set(view.mine.legal ?? [])
  const name = (s: number) => view.players.find((p) => p.seat === s)?.name ?? SEAT_NAMES[s]
  const last = st.last
  const lastText = last
    ? last.rolled ? `${name(last.seat)} hat eine ${last.dice} gewürfelt.`
      : last.nomove ? `${name(last.seat)}: ${last.dice} – kein Zug möglich${last.again ? ', nochmal würfeln' : ''}.`
      : `${name(last.seat)} zieht mit der ${last.dice}${last.caps && last.caps.length > 0 ? ` und wirft ${last.caps.map((c) => name(c.seat)).join(', ')} raus!` : '.'}`
    : null

  const needRoll = myTurn && !st.dice
  // Tastatur: Leertaste/Enter/W würfeln, Ziffern 1–4 ziehen die Figur mit dieser Nummer (wenn erlaubt)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (busy || !myTurn || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return
      if (needRoll && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyW' || e.code === 'KeyR')) { e.preventDefault(); onRoll(); return }
      const n = /^(?:Digit|Numpad)([1-4])$/.exec(e.code)
      if (n && st.dice && legal.has(Number(n[1]) - 1)) { e.preventDefault(); onMove(Number(n[1]) - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pieces: Array<{ seat: number; i: number; rel: number }> = []
  for (const s of st.seats) (st.pieces[String(s)] ?? []).forEach((rel, i) => pieces.push({ seat: s, i, rel }))

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${11 * U} ${11 * U}`} className="mx-auto w-full max-w-[460px] rounded-2xl bg-amber-100/10" role="img" aria-label="Spielbrett">
        {HOUSE.map((cells, s) => cells.map(([x, y], k) => (
          <circle key={`h${s}${k}`} cx={x * U + U / 2} cy={y * U + U / 2} r={U * 0.42} fill={SEAT_COLORS[s]} opacity={st.seats.includes(s) ? 0.28 : 0.1} />
        )))}
        {HOME_LANE.map((cells, s) => cells.map(([x, y], k) => (
          <circle key={`l${s}${k}`} cx={x * U + U / 2} cy={y * U + U / 2} r={U * 0.4} fill={SEAT_COLORS[s]} opacity={0.4} stroke="rgba(255,255,255,.3)" />
        )))}
        {TRACK.map(([x, y], i) => (
          <circle key={`t${i}`} cx={x * U + U / 2} cy={y * U + U / 2} r={U * 0.4} fill={i % 10 === 0 ? SEAT_COLORS[i / 10] : 'rgba(255,255,255,.12)'} opacity={i % 10 === 0 ? 0.7 : 1} stroke="rgba(255,255,255,.25)" />
        ))}
        {pieces.map((p) => {
          const [x, y] = cellOf(p.seat, p.rel, p.i)
          const can = myTurn && p.seat === seat && legal.has(p.i)
          return (
            <g key={`${p.seat}-${p.i}`} style={{ transform: `translate(${x * U + U / 2}px, ${y * U + U / 2}px)`, transition: 'transform .45s cubic-bezier(.3,1,.4,1)' }}
              onClick={can ? () => onMove(p.i) : undefined} className={can ? 'cursor-pointer' : undefined} role={can ? 'button' : undefined} aria-label={can ? `Figur ${p.i + 1} ziehen` : undefined}>
              {can && <circle r={U * 0.5} fill="none" stroke="#fff" strokeWidth="3" className="animate-pulse" />}
              <circle r={U * 0.34} fill={SEAT_COLORS[p.seat]} stroke="#0f172a" strokeWidth="2.5" />
              <text textAnchor="middle" dy="0.35em" fontSize={U * 0.34} fontWeight="700" fill="#0f172a">{p.i + 1}</text>
            </g>
          )
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {st.dice ? <span className="text-5xl" aria-label={`Würfel ${st.dice}`} style={{ animation: 'ludo-roll .5s ease-out' }}>{DIE[st.dice]}</span> : <span className="text-5xl opacity-30" aria-hidden>🎲</span>}
        {view.status === 'running' && (
          myTurn ? (
            st.dice ? <span className="text-sm font-semibold text-emerald-300">Tippe auf eine leuchtende Figur oder drücke ihre Zahl ({[...legal].sort().map((i) => i + 1).join(', ')}).</span>
              : <button type="button" disabled={busy} onClick={onRoll} className="min-h-[48px] rounded-xl bg-emerald-500 px-5 font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
                  Würfeln (Leertaste){st.tries > 1 ? ` (${st.tries} Versuche für eine 6)` : ''}
                </button>
          ) : <span className="text-sm text-slate-300">{name(view.turn_seat ?? 0)} ist dran …</span>
        )}
      </div>
      <style>{'@keyframes ludo-roll{0%{transform:rotate(-200deg) scale(.4);opacity:0}100%{transform:rotate(0) scale(1);opacity:1}}'}</style>
      {lastText && <p className="text-center text-sm text-slate-300" aria-live="polite">{lastText}</p>}
      <ul className="flex flex-wrap justify-center gap-2 text-xs">
        {st.seats.map((s) => (
          <li key={s} className={`rounded-full border px-3 py-1 ${view.turn_seat === s ? 'border-white/60' : 'border-white/10'} ${st.out.includes(s) ? 'line-through opacity-50' : ''}`} style={{ color: SEAT_COLORS[s] }}>
            {name(s)}{s === seat ? ' (du)' : ''} · {(st.pieces[String(s)] ?? []).filter((r) => r >= 40).length}/4 im Ziel
          </li>
        ))}
      </ul>
      <p className="text-center text-xs text-slate-500">Eine 6 bringt eine Figur ins Spiel und gibt einen Extrawurf. Wer ohne Figur auf dem Feld ist, darf dreimal würfeln.</p>
    </div>
  )
}
