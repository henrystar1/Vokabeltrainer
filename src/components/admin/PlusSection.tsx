import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import Button from '../ui/Button'
import { TextInput } from '../ui/Field'
import { ErrorBox, Notice } from '../ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { adminPlusGetSettings, adminPlusGrant, adminPlusOverview, adminPlusRevoke } from '../../services/plus'

/** Plus für eine Person vergeben oder entziehen (im Personen-Fenster). */
export default function PlusSection({ userId, name }: { userId: string; name: string }) {
  const overview = useAsync(adminPlusOverview, [])
  const settings = useAsync(adminPlusGetSettings, [])
  const [days, setDays] = useState('')
  const [paid, setPaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const def = (k: string) => String(settings.data?.find((s) => s.key === k)?.value ?? '')
  const daysVal = days || def('plus_days')
  const paidVal = paid === '' ? def('plus_price_eur') : paid
  const current = overview.data?.active.find((a) => a.user_id === userId)

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      overview.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const d = Number.parseInt(daysVal, 10)
  const cents = Math.round(Number(paidVal.replace(',', '.')) * 100)
  const valid = Number.isInteger(d) && d >= 1 && d <= 365 && Number.isFinite(cents) && cents >= 0

  return (
    <section className="space-y-2">
      <h3 className="label-mono flex items-center gap-2"><Sparkles size={13} /> Vokabeltrainer +</h3>
      <p className="text-sm text-slate-300">{current ? `Plus aktiv bis ${formatDate(current.until)}.` : 'Kein Plus.'}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs text-slate-400">Tage
          <TextInput className="!min-h-[40px] w-24" inputMode="numeric" value={daysVal} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-slate-400">Bezahlt in €
          <TextInput className="!min-h-[40px] w-28" inputMode="decimal" value={paidVal} onChange={(e) => setPaid(e.target.value)} />
        </label>
        <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={busy} disabled={!valid}
          onClick={() => { if (window.confirm(`${name}: ${d} Tage Plus vergeben (${(cents / 100).toFixed(2).replace('.', ',')} € bezahlt)? Der Betrag zählt zum Pro-Abo-Ziel.`)) void run(() => adminPlusGrant(userId, d, cents, ''), 'Plus vergeben.') }}>
          Plus vergeben
        </Button>
        {current && (
          <Button variant="danger" className="!min-h-[40px] !px-3 text-sm" busy={busy}
            onClick={() => { if (window.confirm(`Plus von ${name} beenden?`)) void run(() => adminPlusRevoke(userId), 'Plus beendet.') }}>
            Plus entziehen
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">Bei „Bezahlt“ 0 € gilt es als Geschenk und zählt nicht zum Ziel.</p>
      {msg && <Notice tone="ok">{msg}</Notice>}
      {error && <ErrorBox message={error} />}
    </section>
  )
}
