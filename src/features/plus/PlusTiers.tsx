import { useState } from 'react'
import { Check, Crown } from 'lucide-react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox, Notice } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { plusBuy, type PlusStatus, type PlusTier } from '../../services/plus'
import { useWallet } from '../koins/WalletProvider'
import { usePlus } from './PlusProvider'

/** Die Stufen zum Kaufen (nur mit Coins). */
export default function PlusTiers({ status }: { status: PlusStatus }) {
  const wallet = useWallet()
  const { reload } = usePlus()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function buy(t: PlusTier) {
    if (!window.confirm(`${t.label} Plus für ${t.price.toLocaleString('de-DE')} Coins kaufen?`)) return
    setBusy(t.id)
    setError(null)
    setDone(null)
    try {
      const st = await plusBuy(t.id)
      await Promise.all([reload(), wallet.refresh()])
      setDone(st.lifetime ? 'Du hast Plus jetzt für immer!' : `Plus ist aktiv, bis ${formatDate(st.until)}.`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {status.active && !status.is_admin && (
        <Notice tone="ok">{status.lifetime ? 'Du hast Plus für immer.' : `Dein Plus läuft bis ${formatDate(status.until)}. Wenn du jetzt kaufst, wird die Zeit angehängt.`}</Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {status.tiers.map((t) => {
          const afford = wallet.balance >= t.price
          const best = t.id === 'life'
          return (
            <div key={t.id} className={`relative flex flex-col gap-2 rounded-2xl border p-4 ${best ? 'plus-banner border-fuchsia-300/40' : 'glass border-white/10'}`}>
              {best && <Crown size={16} className="absolute right-3 top-3" aria-hidden />}
              <p className="font-semibold">{t.label}</p>
              <p className="flex items-center gap-1 font-mono text-lg"><CoinIcon size={16} /> {t.price.toLocaleString('de-DE')}</p>
              {t.days > 1 && t.days < 36500 && <p className="text-xs opacity-70">{Math.round(t.price / t.days).toLocaleString('de-DE')} Coins pro Tag</p>}
              <Button
                variant={best ? 'primary' : 'secondary'}
                className="mt-auto !min-h-[44px]"
                busy={busy === t.id}
                disabled={status.lifetime || !afford || busy !== null}
                onClick={() => void buy(t)}
              >
                {status.lifetime ? <><Check size={16} /> Aktiv</> : afford ? 'Kaufen' : 'Zu wenig Coins'}
              </Button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-500">Bezahlt wird nur mit Coins, die du im Vokabeltrainer verdient hast. Du hast {wallet.balance.toLocaleString('de-DE')} Coins.</p>
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <ErrorBox message={error} />}
    </div>
  )
}
