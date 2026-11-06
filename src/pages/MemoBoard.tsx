import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { useState } from 'react'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { adminMemoDelete, memoLeaderboard, type MemoGame } from '../services/tasks'

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']

/** Rangliste für Pi (Stellen ohne Tipp) und Flaggen (Lernpunkte = Summe der Fächer), Migration 0062. */
export default function MemoBoard({ game }: { game: MemoGame }) {
  const { isAdmin } = useAuth()
  const rows = useAsync(() => memoLeaderboard(game), [game])
  const [err, setErr] = useState<string | null>(null)
  async function del(user: string | null, name: string) {
    if (!window.confirm(user ? `Rekord von ${name} löschen?` : 'ALLE Rekorde dieser Rangliste löschen?')) return
    try { await adminMemoDelete(game, user); rows.reload() } catch (e) { setErr(errorMessage(e)) }
  }
  const unit = game === 'pi' ? 'Stellen' : 'Lernpunkte'
  return (
    <>
      {err && <ErrorBox message={err} onRetry={() => setErr(null)} />}
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
                {isAdmin && <button type="button" className="text-xs text-rose-300 hover:underline" onClick={() => void del(r.user_id, r.display_name)}>löschen</button>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {isAdmin && rows.data && rows.data.length > 0 && <button type="button" className="mt-2 text-xs text-rose-300 hover:underline" onClick={() => void del(null, '')}>Admin: alle Rekorde dieser Rangliste löschen</button>}
    </>
  )
}
