import { Trophy } from 'lucide-react'
import { ManageButton } from '../components/admin/ManageUser'
import CoinIcon from '../components/ui/CoinIcon'
import PlayerTag from '../components/profile/PlayerTag'
import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useAsync } from '../lib/useAsync'
import { getCoinLeaderboard, getMyCoinRank } from '../services/social'

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']

/** Wer hat die meisten Coins? Die Top 50 und dein eigener Platz. */
export default function CoinBoard() {
  const { user } = useAuth()
  const board = useAsync(getCoinLeaderboard, [])
  const myRank = useAsync(getMyCoinRank, [])
  return (
    <>
      {board.loading && !board.data && <Spinner />}
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      {board.data?.length === 0 && <EmptyState title="Noch niemand mit Coins" />}
      {board.data && board.data.length > 0 && (
        <Card className="p-2">
          <ol>
            {board.data.map((r) => {
              const me = r.user_id === user?.id
              return (
                <li key={r.user_id} className={`flex min-h-[52px] items-center gap-4 rounded-xl px-4 ${me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : ''}`}>
                  <span className={`w-8 text-center font-mono text-lg ${MEDAL[r.rank - 1] ?? 'text-slate-500'}`}>
                    {r.rank <= 3 ? <Trophy size={18} className="mx-auto" /> : r.rank}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerTag name={r.display_name} cosmetics={r} framed size={36} />
                    {me && <span className="label-mono shrink-0 text-accent-cyan">Du</span>}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-amber-300"><CoinIcon size={14} /> {r.koins.toLocaleString('de-DE')}</span>
                  <ManageButton userId={r.user_id} name={r.display_name} onChanged={board.reload} />
                </li>
              )
            })}
          </ol>
        </Card>
      )}
      {myRank.data !== null && myRank.data > 50 && <p className="mt-3 text-sm text-slate-400">Dein Platz: {myRank.data}</p>}
      <p className="mt-4 max-w-xl text-xs text-slate-500">Gezählt wird das aktuelle Guthaben. Ausgeben im Shop oder Verlieren beim Gambling kostet also Plätze.</p>
    </>
  )
}
