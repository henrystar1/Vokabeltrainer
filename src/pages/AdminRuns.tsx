import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, RefreshCw } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { adminOpenRuns, type AdminRun } from '../services/play'

/** Admin: alle offenen und laufenden Parkour- und Deathrun-Läufe, mit Zuschauen als unsichtbarer Geist. */
export default function AdminRuns() {
  const { isAdmin } = useAuth()
  const [runs, setRuns] = useState<AdminRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try { setRuns(await adminOpenRuns()); setError(null) } catch (e) { setError(errorMessage(e)) }
  }
  useEffect(() => {
    if (!isAdmin) return
    void load()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 4000)
    return () => window.clearInterval(t)
  }, [isAdmin])

  if (!isAdmin) return <Notice tone="warn">Nur für Admins.</Notice>
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader eyebrow="Admin" title="Offene Läufe" />
      <Card className="space-y-3">
        <p className="text-sm text-slate-300">Alle offenen Lobbys und laufenden Parkours und Deathruns. „Zuschauen“ schickt dich als Geist hinein: Niemand sieht dich, du zählst nicht als Mitspieler und kannst frei fliegen oder einer Person folgen.</p>
        {error && <ErrorBox message={error} />}
        {!runs ? <Spinner /> : runs.length === 0 ? <p className="text-sm text-slate-400">Gerade läuft nichts.</p> : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {r.kind === 'deathrun' ? 'Deathrun' : 'Team-Parkour'}{r.is_open ? ' (offen)' : ''} · {r.status === 'lobby' ? 'Lobby' : 'läuft'}{r.bots > 0 ? ` · ${r.bots} Bots` : ''}
                  </p>
                  <p className="truncate text-xs text-slate-400">{r.players.join(', ')}</p>
                </div>
                <Link to={`/team/${r.id}?zuschauen=1`} className="btn-primary inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold"><Eye size={16} /> Zuschauen</Link>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" onClick={() => void load()}><RefreshCw size={14} /> Aktualisieren</Button>
      </Card>
    </div>
  )
}
