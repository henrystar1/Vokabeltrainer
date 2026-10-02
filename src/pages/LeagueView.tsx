import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Gift } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Card from '../components/ui/Card'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { getLeague } from '../services/play'

export const TIERS = [
  { name: 'Bronze', color: '#cd7f32' },
  { name: 'Silber', color: '#cbd5e1' },
  { name: 'Gold', color: '#fbbf24' },
  { name: 'Saphir', color: '#38bdf8' },
  { name: 'Diamant', color: '#a5f3fc' },
]

function countdown(iso: string, now: number): string {
  const ms = Math.max(0, new Date(iso).getTime() - now)
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d} Tg ${h} Std` : `${h} Std ${m} Min`
}

/** Wochenliga: eine Gruppe je Stufe, Auf- und Abstieg am Wochenende, Koins für die Top 3. */
export default function LeagueView() {
  const league = useAsync(getLeague, [])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  if (league.loading && !league.data) return <Spinner />
  if (league.error) return <ErrorBox message={league.error} onRetry={league.reload} />
  const l = league.data
  if (!l) return null
  const tier = TIERS[l.tier - 1] ?? TIERS[0]
  const rows = l.rows
  const promoCut = l.tier < TIERS.length ? 3 : 0
  const relegStart = l.relegation_active && l.tier > 1 ? rows.length - 3 : rows.length
  const last = l.last

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-4" style={{ boxShadow: `0 0 0 1px ${tier.color}55, 0 0 30px ${tier.color}22` }}>
        <div>
          <p className="label-mono">Deine Liga</p>
          <p className="text-3xl font-semibold" style={{ color: tier.color }}>{tier.name}</p>
          <p className="text-sm text-slate-400">{l.participants} Teilnehmer diese Woche</p>
        </div>
        <div className="text-right text-sm text-slate-300">
          <p className="flex items-center justify-end gap-1"><Clock size={15} /> endet in {countdown(l.ends_at, now)}</p>
          <p className="mt-1 flex items-center justify-end gap-1 text-amber-300"><Gift size={15} /> Top 3: {l.rewards.join(' / ')} Koins</p>
        </div>
      </Card>

      {last && (
        <Notice tone={last.result === 'relegated' ? 'warn' : 'info'}>
          Letzte Woche ({TIERS[last.tier - 1]?.name}): {last.rank ? `Platz ${last.rank}` : 'keine Punkte'} mit {last.points} Punkten –{' '}
          {last.result === 'promoted' ? 'Aufstieg! ' : last.result === 'relegated' ? 'Abstieg. ' : 'Stufe gehalten. '}
          {last.reward > 0 ? `+${last.reward} Koins.` : ''}
        </Notice>
      )}

      <div className="flex gap-4 text-xs text-slate-400">
        {promoCut > 0 && <span className="flex items-center gap-1 text-emerald-300"><ArrowUp size={13} /> Aufstieg: Top 3</span>}
        {l.relegation_active && l.tier > 1 && <span className="flex items-center gap-1 text-rose-300"><ArrowDown size={13} /> Abstieg: letzte 3 oder unter {l.min_points} Punkten</span>}
      </div>

      <Card className="p-2">
        {rows.length === 0 && <p className="p-4 text-sm text-slate-400">Noch niemand in dieser Liga. Lerne ein paar Vokabeln!</p>}
        <ol>
          {rows.map((r, i) => {
            const promo = i < promoCut
            const releg = i >= relegStart
            return (
              <li
                key={`${r.rank}-${r.display_name}`}
                className={`flex min-h-[52px] items-center gap-4 rounded-xl px-4 ${r.is_me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : ''}`}
              >
                <span className={`w-8 text-center font-mono ${promo ? 'text-emerald-300' : releg ? 'text-rose-300' : 'text-slate-500'}`}>{r.rank}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PlayerTag name={r.display_name} cosmetics={r} framed size={36} />
                  {r.is_me && <span className="label-mono shrink-0 text-accent-cyan">Du</span>}
                </span>
                {promo && <ArrowUp size={15} className="text-emerald-300" />}
                {releg && <ArrowDown size={15} className="text-rose-300" />}
                <span className="font-mono text-accent-cyan">{r.points}</span>
              </li>
            )
          })}
        </ol>
      </Card>
      <p className="max-w-xl text-xs text-slate-500">
        Es zählen dieselben Wochenpunkte wie in der Rangliste. Am Wochenende (Montag 00:00) steigen die Top 3 auf, wer zu wenig gelernt hat oder ganz unten steht, steigt ab.
      </p>
    </div>
  )
}
