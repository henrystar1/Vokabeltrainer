import { useState } from 'react'
import { Notice, EmptyState, ErrorBox, Spinner } from '../../../components/ui/States'
import Button from '../../../components/ui/Button'
import { errorMessage } from '../../../lib/errors'
import { formatDate } from '../../../lib/format'
import { useAsync } from '../../../lib/useAsync'
import { adminPrintListBans, adminPrintUnban } from '../../../services/printShop'

/** Wer im Shop gesperrt ist. Gesperrt wird in der Warteschlange über „Sperren“ bei einer Bestellung. */
export default function BansTab() {
  const bans = useAsync(adminPrintListBans, [])
  const [error, setError] = useState<string | null>(null)
  if (bans.loading && !bans.data) return <Spinner />
  if (bans.error) return <ErrorBox message={bans.error} onRetry={bans.reload} />

  async function unban(id: string) {
    try { await adminPrintUnban(id); bans.reload() } catch (e) { setError(errorMessage(e)) }
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">Gesperrte können nichts mehr bestellen oder hochladen. Gesperrt wird in der Warteschlange mit „Sperren“ bei einer Bestellung; ihre offenen Anfragen werden dabei abgelehnt und Coins erstattet.</Notice>
      {error && <Notice tone="warn">{error}</Notice>}
      {bans.data?.length === 0 && <EmptyState title="Niemand gesperrt" />}
      <ul className="space-y-2">
        {bans.data?.map((b) => (
          <li key={b.user_id} className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
            <div>
              <p className="font-medium">{b.user_name}</p>
              <p className="text-xs text-slate-500">seit {formatDate(b.created_at)}{b.until ? ` · bis ${formatDate(b.until)}` : ' · unbefristet'}{b.reason ? ` · ${b.reason}` : ''}{b.active ? '' : ' · abgelaufen'}</p>
            </div>
            <Button variant="secondary" onClick={() => void unban(b.user_id)}>Entsperren</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
