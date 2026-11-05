import { Trophy } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import { ManageButton } from '../components/admin/ManageUser'
import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useState } from 'react'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { adminGamblingReset, getGamblingBank, getGamblingBoard } from '../services/social'

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']
const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('de-DE')}`

/** Gambling-Bilanz: wer hat unterm Strich wie viele Coins gewonnen oder verloren? */
export default function GamblingBoard({ limit }: { limit?: number }) {
  const { isAdmin } = useAuth()
  const board = useAsync(getGamblingBoard, [])
  const bank = useAsync(getGamblingBank, [])
  const [confirm, setConfirm] = useState<{ user: string | null; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function reset() {
    if (!confirm) return
    setBusy(true); setErr(null)
    try { await adminGamblingReset(confirm.user); setConfirm(null); board.reload(); bank.reload() } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }
  const rows = board.data ? (limit ? board.data.slice(0, limit) : board.data) : null
  const losers = !limit && board.data ? [...board.data].filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, 3) : []
  return (
    <>
      {bank.data && bank.data.plays > 0 && (
        <Card className="mb-3 space-y-1">
          <p className="text-sm text-slate-400">Die Bank (alle Spieler zusammen)</p>
          <p className={`font-mono text-2xl ${bank.data.bank >= 0 ? 'text-emerald-300' : 'text-rose-400'}`}>{fmt(bank.data.bank)} Coins</p>
          <p className="text-sm text-slate-300">
            Im Schnitt {bank.data.avg_per_play >= 0 ? 'verdient die Bank' : 'verliert die Bank'} <b className={bank.data.avg_per_play >= 0 ? 'text-emerald-300' : 'text-rose-400'}>{Math.abs(bank.data.avg_per_play).toLocaleString('de-DE')}</b> Coins pro Spiel
            {' '}({bank.data.plays.toLocaleString('de-DE')} Spiele, {bank.data.players.toLocaleString('de-DE')} Spieler, {bank.data.payout_percent.toLocaleString('de-DE')} % wieder ausgezahlt).
          </p>
          <p className="text-xs text-slate-500">Plus = die Spieler haben insgesamt verloren, Minus = die Spieler haben insgesamt gewonnen.</p>
        </Card>
      )}
      {isAdmin && !limit && (
        <div className="mb-3"><Button variant="secondary" onClick={() => setConfirm({ user: null, name: 'alle' })}>Statistik zurücksetzen</Button></div>
      )}
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
                {isAdmin && !limit && (
                  <button type="button" onClick={() => setConfirm({ user: r.user_id, name: r.display_name })} className="min-h-[36px] rounded-lg px-2 text-xs text-slate-400 hover:bg-white/10 hover:text-white">Zurücksetzen</button>
                )}
                <ManageButton userId={r.user_id} name={r.display_name} onChanged={board.reload} />
              </li>
            ))}
          </ol>
        </Card>
      )}
      {confirm && (
        <Modal title="Statistik zurücksetzen?" onClose={() => setConfirm(null)}>
          <p className="text-sm text-slate-300">
            {confirm.user ? `Die Gambling-Statistik von ${confirm.name} wird gelöscht.` : 'Die Gambling-Statistik aller Spieler wird gelöscht, auch die Bank beginnt bei 0.'} Coins bleiben unverändert. Das lässt sich nicht rückgängig machen.
          </p>
          {err && <p className="mt-2 text-sm text-rose-300">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button busy={busy} onClick={() => void reset()}>Zurücksetzen</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
