import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import { TextInput } from '../../components/ui/Field'
import { ErrorBox, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { adminGoalAdd, adminGoalBreakdown, adminGoalDelete, adminPlusGetSettings, adminPlusSetSetting, euro } from '../../services/plus'
import { SettingRow } from './print/PricesTab'

const GROUPS: { title: string; text?: string; keys: string[] }[] = [
  { title: 'Preise (nur Coins)', text: 'Plus wird nur mit Coins gekauft. Du kannst es weiterhin im Personen-Fenster vergeben.', keys: ['plus_price_d1', 'plus_price_d7', 'plus_price_d30', 'plus_price_d90', 'plus_price_life'] },
  { title: 'Vorteile', keys: ['plus_coin_mult', 'plus_points_mult', 'plus_gamble_boost_percent', 'plus_revive_price', 'plus_revive_max'] },
  { title: 'KI-Grenzen', text: 'Setze zusätzlich im OpenAI-Konto ein Ausgabenlimit. Das hier ist die zweite Sicherung.', keys: ['ai_enabled', 'ai_user_month_eur', 'ai_user_day_gens', 'ai_global_month_eur', 'ai_max_items', 'ai_test_sentences'] },
  { title: 'Modellpreise (für die Kostenberechnung)', keys: ['ai_usd_in', 'ai_usd_out', 'ai_usd_eur'] },
]

/** Plus-Einstellungen und Aufschlüsselung des Pro-Abo-Balkens mit manuellen Ein- und Abbuchungen. */
export default function PlusMoneyTab() {
  const settings = useAsync(adminPlusGetSettings, [])
  const goal = useAsync(adminGoalBreakdown, [])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(sign: 1 | -1) {
    const cents = Math.round(Number(amount.replace(',', '.')) * 100) * sign
    if (!Number.isFinite(cents) || cents === 0) { setError('Bitte einen Betrag eingeben.'); return }
    setBusy(true)
    setError(null)
    try {
      await adminGoalAdd(cents, note)
      setAmount('')
      setNote('')
      goal.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (settings.loading && !settings.data) return <Spinner />
  if (settings.error) return <ErrorBox message={settings.error} onRetry={settings.reload} />
  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s]))
  const g = goal.data

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {GROUPS.map((grp) => (
          <section key={grp.title} className="glass space-y-3 rounded-2xl p-5">
            <h3 className="text-base font-semibold">{grp.title}</h3>
            {grp.text && <p className="text-sm text-slate-400">{grp.text}</p>}
            {grp.keys.map((k) => byKey.get(k)).filter((s) => !!s).map((s) => (
              <SettingRow key={s!.key} s={s!} save={adminPlusSetSetting} onSaved={() => { settings.reload(); goal.reload() }} />
            ))}
          </section>
        ))}
      </div>

      <section className="glass h-fit space-y-3 rounded-2xl p-5">
        <h3 className="text-base font-semibold">Verdienst fürs Pro-Abo</h3>
        {goal.loading && !g && <Spinner />}
        {goal.error && <ErrorBox message={goal.error} onRetry={goal.reload} />}
        {g && (
          <>
            <dl className="space-y-1 text-sm">
              {([
                ['3D-Druck (übergeben)', g.print_cents],
                ['Vokabeltrainer + (verkauft)', g.plus_cents],
                ['Manuelle Buchungen', g.manual_cents],
                ['KI-Kosten (abgezogen)', -g.ai_cost_cents],
                ['Neues Ziel / Anpassung', g.offset_cents],
              ] as Array<[string, number]>).map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-slate-400">{k}</dt><dd className="font-mono">{euro(v)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-white/10 pt-1 font-semibold"><dt>Gesamt</dt><dd className="font-mono text-accent-cyan">{euro(g.total_cents)} / {euro(g.goal_cents)}</dd></div>
            </dl>
            <div className="border-t border-white/10 pt-3">
              <p className="mb-2 text-sm text-slate-300">Betrag ein- oder abbuchen (z. B. aus Versehen bestätigt):</p>
              <div className="flex flex-wrap items-end gap-2">
                <TextInput className="!min-h-[40px] w-28" inputMode="decimal" placeholder="Betrag €" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Betrag in Euro" />
                <TextInput className="!min-h-[40px] min-w-[8rem] flex-1" placeholder="Notiz" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Notiz" />
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" className="!min-h-[40px]" busy={busy} onClick={() => void add(1)}>+ Einbuchen</Button>
                <Button variant="danger" className="!min-h-[40px]" busy={busy} onClick={() => void add(-1)}>− Abbuchen</Button>
              </div>
              {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
              <ul className="mt-3 space-y-1">
                {g.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm">
                    <span className="min-w-0"><span className={`font-mono ${e.cents < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{e.cents > 0 ? '+' : ''}{euro(e.cents)}</span> <span className="text-xs text-slate-500">{formatDateTime(e.created_at)}{e.note ? ` · ${e.note}` : ''}</span></span>
                    <button type="button" aria-label="Buchung löschen" className="p-1 text-slate-500 hover:text-rose-300" onClick={() => { if (window.confirm('Diese Buchung löschen?')) void adminGoalDelete(e.id).then(goal.reload).catch((x) => setError(errorMessage(x))) }}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
