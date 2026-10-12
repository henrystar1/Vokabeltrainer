import { useState } from 'react'
import { Coins, Lock, Sparkles } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { ErrorBox, Notice } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { euro, plusBuyDay, plusCancelRequest, plusRequest } from '../../services/plus'
import { useWallet } from '../koins/WalletProvider'
import { usePlus } from './PlusProvider'

const PERKS = [
  'Grammatik-Lückentexte mit KI: Thema, Klasse und Schwierigkeit frei wählbar',
  'Alle schon erzeugten Blätter ansehen und üben',
  'Test-Blatt mit passenden Sätzen zu deinen Vokabeln',
  'Besondere Farben, Effekte, Designs, Avatare und ein „+“-Tag',
]

/** Fenster „Vokabeltrainer +“: Vorteile, Anfrage stellen (Bezahlung in der Schule), einmalig einen Tag für Coins. */
export default function PlusDialog({ onClose }: { onClose: () => void }) {
  const { status, reload } = usePlus()
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await fn()
      await reload()
      await wallet.refresh()
      setDone(ok)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Vokabeltrainer +" onClose={onClose}>
      {!status ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : (
        <div className="space-y-4">
          <div className="plus-banner flex items-center gap-3 rounded-2xl p-4">
            <Sparkles size={26} className="shrink-0" />
            <div>
              <p className="font-semibold">{status.active ? 'Du hast Plus' : 'Mehr aus dem Vokabeltrainer machen'}</p>
              {status.active && (
                <p className="text-sm opacity-80">{status.is_admin ? 'Als Admin immer aktiv.' : status.until ? `Gilt bis ${formatDate(status.until)}.` : ''}</p>
              )}
            </div>
          </div>
          <ul className="space-y-1.5 text-sm text-slate-300">
            {PERKS.map((p) => (
              <li key={p} className="flex gap-2"><span className="text-fuchsia-300">+</span>{p}</li>
            ))}
          </ul>

          {!status.active && (
            <>
              <p className="text-sm text-slate-300">
                <span className="font-mono text-lg text-fuchsia-200">{euro(status.price_cents)}</span> für {status.days} Tage. Du bezahlst in der Schule, danach schaltet der Admin dich frei.
              </p>
              {status.requested ? (
                <div className="space-y-2">
                  <Notice tone="ok">Deine Anfrage ist eingegangen. Sobald du bezahlt hast, wird Plus freigeschaltet.</Notice>
                  <Button variant="secondary" busy={busy} onClick={() => void run(plusCancelRequest, 'Anfrage zurückgezogen.')}>Anfrage zurückziehen</Button>
                </div>
              ) : (
                <Button busy={busy} onClick={() => void run(plusRequest, 'Anfrage gesendet.')}><Lock size={16} /> Plus anfordern</Button>
              )}
              <div className="border-t border-white/10 pt-4">
                {status.trial_available ? (
                  <>
                    <p className="mb-2 text-sm text-slate-400">Zum Ausprobieren: einmalig {status.coin_days} {status.coin_days === 1 ? 'Tag' : 'Tage'} Plus für Coins.</p>
                    <Button
                      variant="secondary"
                      busy={busy}
                      disabled={wallet.balance < status.coin_price}
                      onClick={() => { if (window.confirm(`${status.coin_price} Coins für ${status.coin_days} Tag Plus ausgeben? Das geht nur einmal.`)) void run(plusBuyDay, 'Plus ist freigeschaltet!') }}
                    >
                      <Coins size={16} /> {status.coin_days} Tag für {status.coin_price.toLocaleString('de-DE')} Coins
                    </Button>
                    {wallet.balance < status.coin_price && <p className="mt-1 text-xs text-slate-500">Dafür fehlen dir noch {(status.coin_price - wallet.balance).toLocaleString('de-DE')} Coins.</p>}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Den Tag für Coins hast du schon genutzt (geht nur einmal).</p>
                )}
              </div>
            </>
          )}
          {status.ai_state !== 'ok' && status.ai_enabled && (
            <Notice tone="warn">
              {status.ai_state === 'no_key' ? 'Hinweis: Die KI ist gerade nicht verfügbar, weil noch kein Schlüssel hinterlegt ist.' : status.ai_state === 'empty' ? 'Hinweis: Die KI ist gerade nicht verfügbar, weil das Guthaben leer ist.' : 'Hinweis: Die KI hatte zuletzt einen Fehler.'}
            </Notice>
          )}
          {done && <Notice tone="ok">{done}</Notice>}
          {error && <ErrorBox message={error} />}
        </div>
      )}
    </Modal>
  )
}
