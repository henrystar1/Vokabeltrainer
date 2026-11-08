import { useState } from 'react'
import { ArrowDown, ArrowUp, Trophy } from 'lucide-react'
import Button from '../ui/Button'
import { ErrorBox } from '../ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminLeagueMove, adminLeagueTier } from '../../services/plus'

export const LEAGUE_NAMES = ['Bronze', 'Silber', 'Gold', 'Saphir', 'Diamant']

/** Person in der Liga eine Stufe hoch oder runter setzen (im Personen-Fenster). */
export default function LeagueSection({ userId, name }: { userId: string; name: string }) {
  const tier = useAsync(() => adminLeagueTier(userId), [userId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = tier.data ?? 1

  async function move(delta: number) {
    setBusy(true)
    setError(null)
    try {
      await adminLeagueMove(userId, delta)
      tier.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="label-mono flex items-center gap-2"><Trophy size={13} /> Liga</h3>
      <p className="text-sm text-slate-300">{name} ist in der Stufe <b>{LEAGUE_NAMES[t - 1]}</b>{tier.data == null ? ' (noch keine Liga, Standard)' : ''}.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={busy} disabled={t >= 5} onClick={() => void move(1)}><ArrowUp size={15} /> Eine Stufe hoch</Button>
        <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={busy} disabled={t <= 1} onClick={() => void move(-1)}><ArrowDown size={15} /> Eine Stufe runter</Button>
      </div>
      {error && <ErrorBox message={error} />}
    </section>
  )
}
