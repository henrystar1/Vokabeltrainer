import { Trophy } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import { ManageButton } from '../components/admin/ManageUser'
import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { getGamblingBoard } from '../services/social'

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']
const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('de-DE')}`

/** Gambling-Bilanz: wer hat unterm Strich wie viele Coins gewonnen oder verloren? */
export default function GamblingBoard({ limit }: { limit?: number }) {
  const board = useAsync(getGamblingBoard, [])
  const rows = board.data ? (limit ? board.data.slice(0, limit) : board.data) : null
  const losers = !limit && board.data ? [...board.data].filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, 3) : []
  return (
    <>
      {board.loading && !board.data && <Spinner />}
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      {rows?.length === 0 && <EmptyState title="Noch hat niemand gespielt" />}
      {losers.length > 0 && (
        <p className="mb-3 text-sm text-rose-300">
          Größte Verlierer: {losers.map((l) => `${l.display_name} (${fmt(l.net)})`).join(' · ')}
        </p>
      )}
      {rows && rows.length > 0 && (
        <Card className="p-2">
          <ol>
            {rows.map((r) => (
              <li key={r.user_id} className={`flex min-h-[52px] items-center gap-3 rounded-xl px-3 ${r.is_me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : ''}`}>
                <span className={`w-8 text-center font-mono text-lg ${MEDAL[r.rank - 1] ?? 'text-slate-500'}`}>
                  {r.rank <= 3 ? <Trophy size={18} className="mx-auto" /> : r.rank}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <PlayerTag name={r.display_name} cosmetics={r} framed size={32} />
                  <span className="text-xs text-slate-500">{r.plays.toLocaleString('de-DE')} Spiele · gesetzt {r.wagered.toLocaleString('de-DE')} · gewonnen {r.won.toLocaleString('de-DE')}</span>
                </span>
                <span className={`font-mono ${r.net > 0 ? 'text-emerald-300' : r.net < 0 ? 'text-rose-400' : 'text-slate-400'}`}>{fmt(r.net)}</span>
                <ManageButton userId={r.user_id} name={r.display_name} onChanged={board.reload} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  )
}
