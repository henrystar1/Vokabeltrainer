import { useEffect } from 'react'
import PlayerTag from '../components/profile/PlayerTag'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useAsync } from '../lib/useAsync'
import { getPresence } from '../services/social'
import type { PresenceRow } from '../types'

/** Zuletzt gesehen, als Text: "gerade eben", "vor 5 Min.", "vor 3 Std.", "gestern", "vor 4 Tagen". */
export function lastSeenText(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (min < 2) return 'gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.round(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.round(h / 24)
  return d === 1 ? 'gestern' : `vor ${d} Tagen`
}

/** Wer gerade online ist und wann die anderen zuletzt da waren. */
export default function Presence() {
  const { user } = useAuth()
  const list = useAsync(getPresence, [])
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') list.reload() }, 30_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const online = list.data?.filter((x) => x.online) ?? []
  const away = list.data?.filter((x) => !x.online) ?? []
  const row = (x: PresenceRow) => (
    <li key={x.user_id} className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl px-3">
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${x.online ? 'bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]' : 'bg-slate-600'}`} />
        <PlayerTag name={x.display_name} cosmetics={x} size={34} />
        {x.user_id === user?.id && <span className="label-mono text-accent-cyan">Du</span>}
      </span>
      <span className={`shrink-0 text-xs ${x.online ? 'text-emerald-300' : 'text-slate-500'}`}>{x.online ? 'online' : lastSeenText(x.last_seen_at)}</span>
    </li>
  )

  return (
    <div>
      <PageHeader eyebrow="Community" title="Wer ist da?" />
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <EmptyState title="Noch niemand zu sehen" />}
      {list.data && list.data.length > 0 && (
        <div className="space-y-5">
          <Card className="p-2">
            <p className="label-mono px-3 pb-1 pt-2">Gerade online · {online.length}</p>
            {online.length === 0 ? <p className="px-3 pb-3 text-sm text-slate-500">Gerade ist niemand online.</p> : <ul>{online.map(row)}</ul>}
          </Card>
          {away.length > 0 && (
            <Card className="p-2">
              <p className="label-mono px-3 pb-1 pt-2">Zuletzt gesehen</p>
              <ul>{away.map(row)}</ul>
            </Card>
          )}
          <p className="text-xs text-slate-500">Als „online“ zählt, wer in den letzten 3 Minuten aktiv war. Wer nicht auftauchen möchte, schaltet es in den Einstellungen aus.</p>
        </div>
      )}
    </div>
  )
}
