import { useState, type FormEvent } from 'react'
import CoinIcon from '../components/ui/CoinIcon'
import { Link } from 'react-router-dom'
import { Gift } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import PlayerTag from '../components/profile/PlayerTag'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { formatDateTime } from '../lib/format'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listLedger, redeemCode } from '../services/koins'

const REASONS: Record<string, string> = {
  daily: 'Tagesbonus',
  code: 'Code eingelöst',
  book: 'Online-Buch gekauft',
  learn: 'Gelernt',
  review: 'Fehlermeldung bestätigt',
  shop: 'Shop-Einkauf',
  feedback: 'Feedback belohnt',
  admin: 'Geschenk vom Admin',
  quest: 'Quest abgeschlossen',
  league: 'Liga-Belohnung',
  duel: 'Duell gewonnen',
  sprint: 'Sprint',
  game_fee: 'Spiel-Eintritt',
  game_win: 'Spiel-Rekord',
  gambling_bet: 'Gambling-Einsatz',
  gambling_win: 'Gambling-Gewinn',
  choice: 'Multiple Choice',
  copy: 'Abschreiben',
  pay_in: 'Coins erhalten',
  pay_out: 'Coins verschickt',
}

const ROLE_LABEL = { user: 'Lernender', mod: 'Moderator', alphamod: 'Alphamod', admin: 'Admin' } as const

export default function Profile() {
  const { displayName, cosmetics, role } = useAuth()
  const wallet = useWallet()
  const ledger = useAsync(() => listLedger(40), [])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function redeem(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const r = await redeemCode(code.trim())
      if (r.ok) {
        setMessage(`${r.amount} Coins gutgeschrieben! Neues Guthaben: ${r.balance}.`)
        wallet.setBalance(r.balance)
        setCode('')
        ledger.reload()
      } else {
        setError(r.message)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Du" title="Profil" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <PlayerTag name={displayName ?? 'Du'} cosmetics={cosmetics} size={72} framed className="text-2xl" />
          <p className="label-mono">{ROLE_LABEL[role]}</p>
          <div className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3">
            <CoinIcon size={26} />
            <div>
              <p className="font-mono text-2xl text-amber-200">{wallet.balance.toLocaleString('de-DE')}</p>
              <p className="text-xs text-slate-400">Coins</p>
            </div>
          </div>
          <Link to="/shop" className="inline-flex min-h-[44px] items-center text-sm text-accent-cyan hover:underline">
            Zum Shop – Profilbild, Farbe, Effekt oder Design wählen →
          </Link>
        </Card>

        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Gift size={18} /> Code einlösen
          </h2>
          <p className="mt-1 text-sm text-slate-400">Hast du einen Code bekommen? Gib ihn hier ein. Jeder Code funktioniert nur einmal.</p>
          <form onSubmit={redeem} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <TextInput
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Code"
              className="font-mono tracking-widest"
            />
            <Button type="submit" busy={busy} disabled={!code.trim()}>
              Einlösen
            </Button>
          </form>
          <div className="mt-3 space-y-2">
            {message && <Notice tone="ok">{message}</Notice>}
            {error && <Notice tone="warn">{error}</Notice>}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Coin-Verlauf</h2>
      {ledger.loading && !ledger.data && <Spinner />}
      {ledger.error && <ErrorBox message={ledger.error} onRetry={ledger.reload} />}
      {ledger.data && ledger.data.length === 0 && <p className="text-sm text-slate-500">Noch keine Bewegungen.</p>}
      {ledger.data && ledger.data.length > 0 && (
        <Card className="p-2">
          <ul>
            {ledger.data.map((l) => (
              <li key={l.id} className="flex min-h-[48px] items-center justify-between gap-3 rounded-lg px-3 text-sm">
                <span>
                  {REASONS[l.reason] ?? l.reason}
                  <span className="ml-2 text-xs text-slate-500">{formatDateTime(l.created_at)}</span>
                </span>
                <span className={`font-mono ${l.amount > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {l.amount > 0 ? '+' : ''}
                  {l.amount}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-4 max-w-xl text-xs text-slate-500">
        Coins gibt es für Codes, fürs Lernen (nur Vokabeln aus Online-Büchern, begrenzt pro Tag) für sinnvolle Fehlermeldungen oder Feedback und von Freunden: Im Chat verschickst du Coins mit !pay @Name Betrag.
        Sie haben keinen Geldwert und lassen sich nicht kaufen oder auszahlen.
      </p>
    </div>
  )
}
