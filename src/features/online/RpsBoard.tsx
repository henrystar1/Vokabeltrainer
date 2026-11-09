import type { OgView } from '../../services/online'

const SYMBOL: Record<string, string> = { rock: '✊', paper: '✋', scissors: '✌️' }
const LABEL: Record<string, string> = { rock: 'Stein', paper: 'Papier', scissors: 'Schere' }

/** Schnick Schnack Schnuck: beide wählen geheim, dann wird aufgedeckt. Wer zuerst 2 Runden gewinnt, siegt. */
export default function RpsBoard({ view, busy, onPick }: { view: OgView; busy: boolean; onPick: (p: string) => void }) {
  const seat = view.me.seat ?? 0
  const opp = view.players.find((p) => p.seat !== null && p.seat !== seat)
  const score = view.state.score
  const rounds = view.state.rounds
  const last = rounds[rounds.length - 1]
  const mine = (r: { a: string; b: string }) => (seat === 0 ? r.a : r.b)
  const theirs = (r: { a: string; b: string }) => (seat === 0 ? r.b : r.a)
  const over = view.status === 'finished'
  return (
    <div className="space-y-4 text-center">
      <p className="font-mono text-3xl">{score[String(seat)] ?? 0} : {score[String(1 - seat)] ?? 0}</p>
      <p className="text-xs text-slate-400">Wer zuerst {view.state.to_win} Runden gewinnt, siegt. Unentschieden zählt nicht.</p>

      {last && (
        <div className="flex items-center justify-center gap-6 rounded-2xl border border-white/10 bg-white/5 p-4" aria-live="polite">
          <div><div className="text-5xl" style={{ animation: 'rps-pop .5s ease-out both' }}>{SYMBOL[mine(last)]}</div><div className="text-xs text-slate-400">Du</div></div>
          <div className="text-sm font-semibold text-slate-300">{last.w === null ? 'Unentschieden' : last.w === seat ? 'Punkt für dich!' : `Punkt für ${opp?.name ?? 'den Gegner'}`}</div>
          <div><div className="text-5xl" style={{ animation: 'rps-pop .5s ease-out .15s both' }}>{SYMBOL[theirs(last)]}</div><div className="text-xs text-slate-400">{opp?.name ?? 'Gegner'}</div></div>
        </div>
      )}
      <style>{'@keyframes rps-pop{0%{transform:scale(.2) rotate(-25deg);opacity:0}70%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}'}</style>

      {!over && (
        <>
          <p className="text-sm text-slate-300">
            {view.mine.pick ? `Du hast ${LABEL[view.mine.pick]} gewählt. ${view.mine.opp_picked ? '' : `Warte auf ${opp?.name ?? 'den Gegner'} …`}` : `Wähle jetzt${view.mine.opp_picked ? ' (dein Gegner hat schon gewählt)' : ''}!`}
          </p>
          <div className="grid grid-cols-3 gap-3">
            {Object.keys(SYMBOL).map((k) => (
              <button key={k} type="button" disabled={busy || !!view.mine.pick} onClick={() => onPick(k)}
                className={`min-h-[96px] rounded-2xl border text-5xl transition hover:scale-105 disabled:opacity-60 ${view.mine.pick === k ? 'border-emerald-300 bg-emerald-400/15' : 'border-white/10 bg-white/5'}`}>
                {SYMBOL[k]}<span className="block text-xs text-slate-300">{LABEL[k]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {rounds.length > 1 && (
        <ol className="flex flex-wrap justify-center gap-2 text-xs text-slate-400">
          {rounds.slice(0, -1).map((r, i) => (
            <li key={i} className="rounded-lg bg-white/5 px-2 py-1">{SYMBOL[mine(r)]} vs {SYMBOL[theirs(r)]} {r.w === null ? '=' : r.w === seat ? '✓' : '✗'}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
