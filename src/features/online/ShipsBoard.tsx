import { useState } from 'react'
import type { OgView, Ship, ShipsShot } from '../../services/online'
import { FLEET, SIZE, canPlace, hitSet, randomFleet, shipCells } from './ships'

const COLS = 'ABCDEFGHIJ'

function Grid({ children, onCell, label }: { children: (r: number, c: number) => { cls: string; text?: string }; onCell?: (r: number, c: number) => void; label: string }) {
  return (
    <div role="grid" aria-label={label} className="mx-auto grid w-full max-w-[360px] grid-cols-[repeat(11,minmax(0,1fr))] gap-[2px] text-[10px] text-slate-500">
      <div />
      {Array.from({ length: SIZE }, (_, c) => <div key={c} className="text-center">{COLS[c]}</div>)}
      {Array.from({ length: SIZE }, (_, r) => (
        <div key={r} className="contents">
          <div className="flex items-center justify-center">{r + 1}</div>
          {Array.from({ length: SIZE }, (_, c) => {
            const x = children(r, c)
            return (
              <button key={c} type="button" role="gridcell" aria-label={`${COLS[c]}${r + 1}`} disabled={!onCell} onClick={() => onCell?.(r, c)}
                className={`flex aspect-square items-center justify-center rounded-[3px] text-xs ${x.cls}`}>{x.text}</button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Schiffe versenken: erst Flotte setzen (Antippen, Drehen, Zufall), dann abwechselnd schießen; bei Treffer nochmal. */
export default function ShipsBoard({ view, busy, onPlace, onShoot }: { view: OgView; busy: boolean; onPlace: (s: Ship[]) => void; onShoot: (r: number, c: number) => void }) {
  const seat = view.me.seat ?? 0
  const [fleet, setFleet] = useState<Ship[]>([])
  const [horizontal, setHorizontal] = useState(true)
  const opp = view.players.find((p) => p.seat !== null && p.seat !== seat)

  if (view.state.phase === 'placing') {
    if (view.mine.placed) return <p className="text-center text-sm text-slate-300">Deine Flotte steht. Warte, bis {opp?.name ?? 'dein Gegner'} fertig ist …</p>
    const nextLen = FLEET[fleet.length]
    const cells = new Set(fleet.flatMap(shipCells))
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-slate-300">
          {nextLen ? <>Setze das Schiff mit <b>{nextLen}</b> Feldern: tippe aufs Startfeld.</> : 'Alle Schiffe gesetzt. Bestätige deine Flotte.'}
        </p>
        <Grid label="Deine Flotte setzen" onCell={nextLen ? (r, c) => { const s = { len: nextLen, r, c, h: horizontal }; if (canPlace(s, fleet)) setFleet([...fleet, s]) } : undefined}>
          {(r, c) => ({ cls: cells.has(r * SIZE + c) ? 'bg-sky-400' : 'bg-white/10 hover:bg-white/20' })}
        </Grid>
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <button type="button" className="min-h-[44px] rounded-xl border border-white/10 px-3 hover:bg-white/10" onClick={() => setHorizontal((h) => !h)}>Richtung: {horizontal ? 'waagerecht' : 'senkrecht'}</button>
          <button type="button" className="min-h-[44px] rounded-xl border border-white/10 px-3 hover:bg-white/10" onClick={() => setFleet(randomFleet())}>Zufällig</button>
          <button type="button" className="min-h-[44px] rounded-xl border border-white/10 px-3 hover:bg-white/10" disabled={fleet.length === 0} onClick={() => setFleet(fleet.slice(0, -1))}>Zurück</button>
          <button type="button" className="min-h-[44px] rounded-xl bg-emerald-500 px-4 font-semibold text-slate-950 disabled:opacity-50" disabled={fleet.length !== FLEET.length || busy} onClick={() => onPlace(fleet)}>Flotte bestätigen</button>
        </div>
      </div>
    )
  }

  const myShots: ShipsShot[] = view.state.shots[String(seat)] ?? []
  const theirShots: ShipsShot[] = view.state.shots[String(1 - seat)] ?? []
  const shot = new Map(myShots.map((s) => [s.r * SIZE + s.c, s]))
  const sunkCells = new Set(myShots.flatMap((s) => (s.sunk ? shipCells(s.sunk) : [])))
  const myShips = view.mine.ships ?? []
  const myCells = new Set(myShips.flatMap(shipCells))
  const hitOnMe = hitSet(theirShots)
  const missOnMe = new Set(theirShots.filter((s) => s.res === 'miss').map((s) => s.r * SIZE + s.c))
  const myTurn = view.status === 'running' && view.turn_seat === seat
  const oppCells = new Set((view.mine.opp_ships ?? []).flatMap(shipCells))
  const lastMine = myShots[myShots.length - 1]
  const lastTheirs = theirShots[theirShots.length - 1]

  return (
    <div className="space-y-4">
      <p className={`text-center text-sm font-semibold ${myTurn ? 'text-emerald-300' : 'text-slate-300'}`} aria-live="polite">
        {view.status === 'finished' ? '' : myTurn ? 'Du bist dran: schieß aufs Wasser des Gegners!' : `${opp?.name ?? 'Der Gegner'} ist dran …`}
      </p>
      <div>
        <h3 className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Gewässer von {opp?.name ?? 'Gegner'}</h3>
        <Grid label="Gegnerisches Gewässer" onCell={myTurn && !busy ? (r, c) => { if (!shot.has(r * SIZE + c)) onShoot(r, c) } : undefined}>
          {(r, c) => {
            const i = r * SIZE + c
            const s = shot.get(i)
            if (s?.res === 'miss') return { cls: 'bg-slate-600', text: '·' }
            if (s) return { cls: sunkCells.has(i) ? 'bg-rose-700 text-white' : 'bg-rose-500 text-white', text: '✕' }
            if (oppCells.has(i)) return { cls: 'bg-slate-400/50' }
            return { cls: myTurn ? 'bg-sky-500/20 hover:bg-sky-400/40' : 'bg-sky-500/10' }
          }}
        </Grid>
        {lastMine && <p className="mt-1 text-center text-xs text-slate-400">Dein letzter Schuss: {COLS[lastMine.c]}{lastMine.r + 1} – {lastMine.res === 'miss' ? 'Wasser' : lastMine.res === 'hit' ? 'Treffer! Nochmal!' : `Schiff (${lastMine.sunk?.len}) versenkt! Nochmal!`}</p>}
      </div>
      <div>
        <h3 className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Deine Flotte</h3>
        <Grid label="Deine Flotte">
          {(r, c) => {
            const i = r * SIZE + c
            if (hitOnMe.has(i)) return { cls: 'bg-rose-500 text-white', text: '✕' }
            if (myCells.has(i)) return { cls: 'bg-sky-400' }
            if (missOnMe.has(i)) return { cls: 'bg-slate-600', text: '·' }
            return { cls: 'bg-sky-500/10' }
          }}
        </Grid>
        {lastTheirs && <p className="mt-1 text-center text-xs text-slate-400">Letzter Schuss von {opp?.name ?? 'Gegner'}: {COLS[lastTheirs.c]}{lastTheirs.r + 1} – {lastTheirs.res === 'miss' ? 'Wasser' : lastTheirs.res === 'hit' ? 'Treffer' : 'Schiff versenkt'}</p>}
      </div>
    </div>
  )
}
