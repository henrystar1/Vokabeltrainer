import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import { useAsync } from '../../lib/useAsync'
import { SECTIONS } from '../../pages/admin/ruleDefs'
import { SettingRow } from '../../pages/admin/print/PricesTab'
import { adminSetSetting, getAppSettings } from '../../services/koins'
import { ErrorBox } from '../ui/States'

const BY_KEY = new Map(SECTIONS.flatMap((s) => s.rules).map((r) => [r.key, r]))

/**
 * Nur für Admins: zeigt unter einer Seite, welche Werte dort gelten (Coins, Punkte, Limits), und lässt sie direkt ändern.
 * `info` erklärt in einem Satz, was die Seite überhaupt gibt.
 */
export default function PageRules({ title, info, keys }: { title: string; info: string; keys: string[] }) {
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const settings = useAsync(async () => (isAdmin && open ? getAppSettings() : null), [isAdmin, open])
  if (!isAdmin) return null
  return (
    <details className="no-print mt-8 rounded-xl border border-amber-300/25 bg-amber-300/[0.04] p-4" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-amber-200">
        <Settings2 size={16} aria-hidden /> Admin: Werte für „{title}“
      </summary>
      <p className="mt-3 text-sm text-slate-300">{info}</p>
      <p className="mt-1 text-xs text-slate-500">Änderungen gelten sofort für alle. Alle Zahlen findest du auch unter Verwaltung → Zahlen.</p>
      {settings.error && <div className="mt-3"><ErrorBox message={settings.error} onRetry={settings.reload} /></div>}
      {settings.data && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {keys.map((k) => {
            const def = BY_KEY.get(k)
            if (!def || settings.data?.[k] === undefined) return null
            return (
              <SettingRow
                key={k}
                s={{ key: k, value: settings.data[k], label: def.label, unit: '', hint: def.hint ?? '', min_value: 0, max_value: 1_000_000 }}
                onSaved={settings.reload}
                save={adminSetSetting}
              />
            )
          })}
        </div>
      )}
    </details>
  )
}
