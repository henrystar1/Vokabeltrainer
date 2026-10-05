import { useState } from 'react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { getAppSettings, staffSetSetting } from '../../services/koins'

interface Rule { key: string; label: string; hint?: string }

/** Alle einstellbaren Werte, nach Themen gruppiert. Nur Alphamods und Admins sehen diese Seite. */
const SECTIONS: Array<{ title: string; text?: string; rules: Rule[] }> = [
  {
    title: 'Rangliste & Punkte',
    rules: [
      { key: 'points_per_answer', label: 'Punkte pro richtiger Antwort', hint: 'Rangliste und Liga' },
      { key: 'points_daily_cap', label: 'Richtige Antworten pro Tag, die zählen', hint: 'Mehr Antworten bringen dann keine Punkte' },
      { key: 'points_active_day', label: 'Bonus für jeden aktiven Tag' },
      { key: 'points_accuracy_bonus', label: 'Maximaler Trefferquoten-Bonus pro Tag', hint: 'Bei 100 % richtig der volle Bonus' },
      { key: 'points_accuracy_min', label: 'Trefferquoten-Bonus ab so vielen Antworten' },
    ],
  },
  {
    title: 'Tages-Quests',
    text: 'Wie viel man für die Quests schaffen muss. Die Coins-Belohnungen stehen unter „Coins & Shop“.',
    rules: [
      { key: 'quest_goal_answers', label: 'Fleißig: richtige Antworten' },
      { key: 'quest_goal_perfect', label: 'Fehlerfrei: Mindestfragen der Runde' },
      { key: 'quest_goal_sprint', label: 'Sprinter: richtige Antworten im Sprint' },
      { key: 'quest_goal_duel', label: 'Herausforderer: Duelle' },
    ],
  },
  {
    title: 'Lernen: Wartezeit zwischen den Phasen',
    text: 'Nach einer Antwort kommt eine Vokabel erst nach dieser Zeit wieder dran (in Minuten, 0 = sofort). 60 = 1 Stunde, 1440 = 1 Tag.',
    rules: [
      { key: 'learn_gap_l1', label: 'Stufe 1 → wieder nach (Min.)' },
      { key: 'learn_gap_l2', label: 'Stufe 2 → wieder nach (Min.)' },
      { key: 'learn_gap_l3', label: 'Stufe 3 → wieder nach (Min.)' },
      { key: 'learn_gap_l4', label: 'Stufe 4 → wieder nach (Min.)' },
    ],
  },
  {
    title: 'Multiple Choice (Übung)',
    text: 'Bringt bewusst weniger als normales Lernen und ändert den Lernstand nicht.',
    rules: [
      { key: 'mc_points_per_answer', label: 'Ranglistenpunkte pro richtiger Antwort' },
      { key: 'mc_daily_cap', label: 'Richtige Antworten pro Tag, die zählen' },
      { key: 'mc_coin_every', label: '1 Coin je so viele richtige Antworten' },
      { key: 'mc_coin_cap', label: 'Coins pro Tag höchstens' },
    ],
  },
  {
    title: 'Gambling',
    text: 'Chancen in Promille (1000 = immer). Erwartung pro Einsatz = Gewinnchance × Faktor + Jackpot × Jackpot-Faktor; unter 1000 ‰ Summe bleibt es ein Verlustgeschäft.',
    rules: [
      { key: 'gambling_win_permille', label: 'Gewinnchance (‰)', hint: 'Drei gleiche Symbole' },
      { key: 'gambling_jackpot_permille', label: 'Jackpot-Chance (‰)', hint: 'Dreimal die 7' },
      { key: 'gambling_mult_win', label: 'Gewinn-Faktor', hint: 'Einsatz × Faktor' },
      { key: 'gambling_mult_jackpot', label: 'Jackpot-Faktor' },
      { key: 'gambling_max_bet', label: 'Höchster Einsatz (Coins)' },
    ],
  },
  {
    title: 'Spiele',
    rules: [
      { key: 'game_fee', label: 'Eintritt pro Runde (Coins)' },
      { key: 'game_record_reward', label: 'Coins für einen neuen Rekord', hint: 'Wer die Bestenliste des Spiels übertrifft' },
    ],
  },
  {
    title: 'Chat',
    rules: [
      { key: 'chat_per_minute', label: 'Nachrichten pro Minute und Person', hint: 'Gegen Spam' },
      { key: 'timeout_max', label: 'Stummschalten: längste Dauer (Min.)', hint: 'Normale Mods können immer nur 1 Minute' },
    ],
  },
]

export default function RulesTab() {
  const settings = useAsync(getAppSettings, [])
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
      <Notice tone="info">Änderungen gelten sofort für alle – auch rückwirkend für die Ranglisten, weil die Punkte bei jedem Aufruf neu berechnet werden.</Notice>
      {settings.error && <ErrorBox message={settings.error} />}
      {error && <ErrorBox message={error} />}
      {settings.loading && !settings.data && <Spinner />}
      {settings.data &&
        SECTIONS.map((s) => (
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
          </Card>
        ))}
    </div>
  )
}
