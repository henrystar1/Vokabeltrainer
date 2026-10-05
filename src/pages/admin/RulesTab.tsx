import { useState } from 'react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { getAppSettings, getModEditable, staffSetSetting, type MyPermissions } from '../../services/koins'
import { SECTIONS } from './ruleDefs'

/** Zahlen einstellen. Mods sehen nur, was ihnen freigegeben wurde. */
export default function RulesTab({ perms }: { perms: MyPermissions }) {
  const settings = useAsync(getAppSettings, [])
  const editable = useAsync(getModEditable, [])
  const may = (key: string) => perms.alphamod || perms.settings_all || !!editable.data?.[key]
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
      <Notice tone="info">Änderungen gelten sofort für alle – auch rückwirkend für die Ranglisten, weil die Punkte bei jedem Aufruf neu berechnet werden.{!perms.alphamod && !perms.settings_all && ' Du siehst nur die Zahlen, die ein Admin dir freigegeben hat.'}</Notice>
      {settings.error && <ErrorBox message={settings.error} />}
      {error && <ErrorBox message={error} />}
      {settings.loading && !settings.data && <Spinner />}
      {settings.data &&
        editable.data &&
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
          </Card>
        ))}
    </div>
  )
}
