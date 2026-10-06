import { useState } from 'react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { getAppSettings, staffSetSetting, type MyPermissions } from '../../services/koins'
import { SECTIONS } from './ruleDefs'

/** Zahlen einstellen. Mods sehen nur, was ihnen freigegeben wurde. */
export default function RulesTab({ perms }: { perms: MyPermissions }) {
  const settings = useAsync(getAppSettings, [])
  const may = (key: string) => perms.admin || perms.settings_all || perms.setting_keys.includes(key)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(key: string) {
    const v = Number.parseInt(draft[key], 10)
    if (!Number.isInteger(v) || v < 0) return setError('Bitte eine Zahl ab 0 eingeben.')
    setError(null)
    try {
      await staffSetSetting(key, v)
      setSaved(key)
      settings.reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="space-y-5">
      <Notice tone="info">Änderungen gelten sofort für alle – auch rückwirkend für die Ranglisten, weil die Punkte bei jedem Aufruf neu berechnet werden.{!perms.admin && !perms.settings_all && ' Du siehst nur die Zahlen, die ein Admin dir freigegeben hat.'}</Notice>
      {settings.error && <ErrorBox message={settings.error} />}
      {error && <ErrorBox message={error} />}
      {settings.loading && !settings.data && <Spinner />}
      {settings.data &&
        SECTIONS.map((s) => ({ ...s, rules: s.rules.filter((r) => may(r.key)) }))
          .filter((s) => s.rules.length > 0)
          .map((s) => (
          <Card key={s.title} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              {s.text && <p className="mt-1 text-sm text-slate-400">{s.text}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {s.rules.map((r) => (
                <div key={r.key} className="flex items-end gap-2">
                  <Field label={r.label} hint={r.hint}>
                    <TextInput
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draft[r.key] ?? String(settings.data?.[r.key] ?? 0)}
                      onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })}
                    />
                  </Field>
                  <Button variant="secondary" onClick={() => void save(r.key)}>{saved === r.key ? '✓' : 'Speichern'}</Button>
                </div>
              ))}
            </div>
            {s.title === 'Gambling' && <GamblingValue value={(k) => { const d = Number.parseInt(draft[k] ?? '', 10); return Number.isInteger(d) && d >= 0 ? d : (settings.data?.[k] ?? 0) }} />}
          </Card>
        ))}
    </div>
  )
}

/** Rückfluss je 1000 Coins Einsatz: Gewinnchance × Faktor + Jackpot-Chance × Jackpot-Faktor (Chancen in ‰). */
function GamblingValue({ value }: { value: (key: string) => number }) {
  const win = Math.min(value('gambling_win_permille'), 1000)
  const jack = Math.min(value('gambling_jackpot_permille'), 1000)
  const back = win * value('gambling_mult_win') + jack * value('gambling_mult_jackpot')
  const tone = back < 1000 ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : back === 1000 ? 'border-amber-300/40 bg-amber-500/10 text-amber-200' : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
  const text =
    back < 1000
      ? `Verlust für die Spieler: Von 1000 Coins Einsatz kommen im Schnitt nur ${back} zurück, die Seite behält ${1000 - back}.`
      : back === 1000
        ? 'Genau fair: Im Schnitt kommt der Einsatz komplett zurück.'
        : `Gewinn für die Spieler: Von 1000 Coins Einsatz kommen im Schnitt ${back} zurück – die Spieler verdienen ${back - 1000} je 1000 Coins, die Coin-Menge wächst.`
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`} aria-live="polite">
      <p className="font-mono text-lg font-semibold">Aktueller Wert: {back}</p>
      <p className="mt-1">{text}</p>
      <p className="mt-1 text-xs opacity-80">Unter 1000 = Verlust, ab 1000 = fair oder Gewinn. Der Wert rechnet schon mit, was du gerade eintippst (vor dem Speichern).</p>
    </div>
  )
}
