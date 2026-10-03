import { useState } from 'react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { getAppSettings, getModEditable, staffSetSetting } from '../../services/koins'

/** Regeln, die auch Mods einstellen dürfen (Punkte der Rangliste, Chat-Tempo). */
const RULES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'points_per_answer', label: 'Punkte pro richtiger Antwort', hint: 'Rangliste und Liga' },
  { key: 'points_daily_cap', label: 'Richtige Antworten pro Tag, die zählen', hint: 'Limit pro Tag – mehr Antworten bringen keine Punkte' },
  { key: 'points_active_day', label: 'Bonus für jeden aktiven Tag', hint: 'Punkte, sobald man an einem Tag etwas beantwortet' },
  { key: 'points_accuracy_bonus', label: 'Maximaler Trefferquoten-Bonus pro Tag', hint: 'Bei 100 % richtig gibt es den vollen Bonus' },
  { key: 'points_accuracy_min', label: 'Trefferquoten-Bonus ab so vielen Antworten', hint: 'Schützt vor Glückstreffern bei wenigen Antworten' },
  { key: 'bot_snake', label: 'Bot-Stärke Snake (höchstes Ziel in Äpfeln)', hint: 'Das Ziel des Bots liegt zufällig zwischen 25 % und 100 % davon' },
  { key: 'bot_tetris', label: 'Bot-Stärke Tetris (höchstes Ziel in Punkten)', hint: 'Höher = schwerer zu schlagen' },
  { key: 'bot_blast', label: 'Bot-Stärke Block Blast (höchstes Ziel in Punkten)', hint: 'Höher = schwerer zu schlagen' },
  { key: 'chat_per_minute', label: 'Chat: Nachrichten pro Minute und Person', hint: 'Gegen Spam' },
]

export default function RulesTab() {
  const settings = useAsync(getAppSettings, [])
  const editable = useAsync(getModEditable, [])
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

  const rules = RULES.filter((r) => editable.data?.[r.key])
  return (
    <div className="space-y-4">
      <Notice tone="info">
        Änderungen gelten sofort für alle – auch rückwirkend für die Wochen- und Monatsrangliste, weil die Punkte bei jedem Aufruf neu berechnet werden.
      </Notice>
      {(settings.error || editable.error) && <ErrorBox message={(settings.error || editable.error) ?? ''} />}
      {error && <ErrorBox message={error} />}
      {(settings.loading || editable.loading) && !settings.data && <Spinner />}
      <Card className="grid gap-4 sm:grid-cols-2">
        {settings.data &&
          rules.map((r) => (
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
      </Card>
      <p className="text-xs text-slate-500">
        Punkte pro Tag = min(richtige Antworten, Limit) × Punkte pro Antwort + Aktivitäts-Bonus + Trefferquoten-Bonus. Zahlen mit Coins ändert nur ein Admin.
      </p>
    </div>
  )
}
