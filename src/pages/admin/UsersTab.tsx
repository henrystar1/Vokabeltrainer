import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import PersonSheet, { RoleChip } from '../../components/admin/PersonSheet'
import { Avatar } from '../../components/profile/PlayerTag'
import { TextInput } from '../../components/ui/Field'
import { ErrorBox, Spinner } from '../../components/ui/States'
import { useAuth } from '../../features/auth/AuthProvider'
import { activityLabel } from '../../lib/activity'
import { formatBytes } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { adminListUsers, adminUserStatus } from '../../services/admin'

type Filter = 'all' | 'online' | 'team' | 'blocked'
const FILTERS: Array<[Filter, string]> = [['all', 'Alle'], ['online', 'Online'], ['team', 'Team'], ['blocked', 'Gesperrt']]

/**
 * Personen (nur Admins): Liste mit Online-Punkt und Tätigkeit. Antippen öffnet ein Fenster mit Status,
 * Nachricht und allen Aktionen für diese Person.
 */
export default function UsersTab() {
  const { user: me } = useAuth()
  const users = useAsync(adminListUsers, [])
  const status = useAsync(adminUserStatus, [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)

  // Status (online, was macht die Person) frisch halten.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') status.reload() }, 15_000)
    return () => window.clearInterval(t)
  }, [status.reload])

  const byId = useMemo(() => new Map((status.data ?? []).map((s) => [s.user_id, s])), [status.data])
  const open = (id: string | null) => setSelected(id)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (users.data ?? [])
      .filter((u) => (q === '' || u.display_name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)))
      .filter((u) => filter === 'all' || (filter === 'online' && byId.get(u.user_id)?.online) || (filter === 'team' && u.role !== 'user') || (filter === 'blocked' && u.blocked))
      .sort((a, b) => Number(byId.get(b.user_id)?.online ?? false) - Number(byId.get(a.user_id)?.online ?? false) || a.display_name.localeCompare(b.display_name, 'de'))
  }, [users.data, byId, query, filter])

  const onlineCount = (users.data ?? []).filter((u) => byId.get(u.user_id)?.online).length
  const total = (users.data ?? []).reduce((s, u) => s + Number(u.approx_bytes), 0)
  const current = selected ? users.data?.find((u) => u.user_id === selected) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
          <TextInput className="!pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person suchen …" aria-label="Person suchen" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`min-h-[40px] rounded-xl px-3 text-sm transition ${filter === id ? 'bg-accent-cyan/10 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.25)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'}`}
            >
              {label}{id === 'online' ? ` (${onlineCount})` : ''}
            </button>
          ))}
        </div>
      </div>
      {users.data && (
        <p className="text-xs text-slate-500">
          {users.data.length} Konten · zusammen ca. <span className="font-mono text-accent-cyan">{formatBytes(total)}</span> · Als online gilt, wer in den letzten 3 Minuten in der App war. Admins werden nur per SQL in Supabase festgelegt.
        </p>
      )}
      {users.loading && !users.data && <Spinner />}
      {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}
      {status.error && <ErrorBox message={status.error} onRetry={status.reload} />}
      {users.data && list.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Niemand gefunden.</p>}

      <ul className="grid gap-2 lg:grid-cols-2">
        {list.map((u) => {
          const st = byId.get(u.user_id)
          return (
            <li key={u.user_id}>
              <button
                type="button"
                onClick={() => open(u.user_id)}
                className={`glass flex min-h-[64px] w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-white/10 ${u.blocked ? 'border-rose-500/40' : ''}`}
              >
                <span className="relative shrink-0">
                  <Avatar name={u.display_name} size={40} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-space-900 ${st?.online ? 'bg-emerald-400' : 'bg-slate-600'}`} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{u.display_name}</span>
                    <RoleChip role={u.role} />
                    {u.blocked && <span className="rounded-full border border-rose-500/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-300">Gesperrt</span>}
                    {u.user_id === me?.id && <span className="text-xs font-normal text-slate-500">(du)</span>}
                  </span>
                  <span className={`block truncate text-xs ${st?.online ? 'text-emerald-300' : 'text-slate-500'}`}>
                    {st?.online ? activityLabel(st.activity) : st?.last_seen_at ? 'offline' : 'noch nie in der App'}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-xs text-amber-200">{u.koins} Coins</span>
              </button>
            </li>
          )
        })}
      </ul>

      {current && (
        <PersonSheet
          key={current.user_id}
          user={current}
          status={byId.get(current.user_id)}
          onClose={() => open(null)}
          onChanged={() => { users.reload(); status.reload() }}
        />
      )}
    </div>
  )
}
