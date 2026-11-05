import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { memoLeaderboard, type MemoGame } from '../services/tasks'

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']

/** Rangliste für Pi (Stellen ohne Tipp) und Flaggen (Lernpunkte = Summe der Fächer), Migration 0062. */
export default function MemoBoard({ game }: { game: MemoGame }) {
  const rows = useAsync(() => memoLeaderboard(game), [game])
  const unit = game === 'pi' ? 'Stellen' : 'Lernpunkte'
  return (
    <>
      {rows.loading && !rows.data && <Spinner />}
      {rows.error && <ErrorBox message={rows.error} onRetry={rows.reload} />}
      {rows.data && rows.data.length === 0 && (
        <EmptyState title="Noch niemand auf der Rangliste" text={game === 'pi' ? 'Lerne Pi unter „Auswendig“ und tippe die Stellen ein.' : 'Lerne Flaggen unter „Auswendig“ im Karteikasten.'} />
      )}
      {rows.data && rows.data.length > 0 && (
        <Card className="p-2">
          <ol className="space-y-1">
            {rows.data.map((r) => (
              <li key={r.user_id} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${r.is_me ? 'bg-accent-cyan/10 text-accent-cyan' : ''}`}>
                <span className={`w-8 text-right font-mono ${MEDAL[r.rank - 1] ?? 'text-slate-400'}`}>{r.rank}.</span>
                <span className="min-w-0 flex-1 truncate">{r.display_name}{r.is_me ? ' (du)' : ''}</span>
                <span className="font-mono">{r.best} <span className="text-xs text-slate-500">{unit}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  )
}
