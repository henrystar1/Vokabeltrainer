import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Footprints, Zap } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Avatar } from '../../components/profile/PlayerTag'
import { liveMyInvites, liveRespond, teamMyInvites, teamRespond } from '../../services/play'
import { useAuth } from '../auth/AuthProvider'

const POLL_MS = 5_000

interface Invite { kind: 'live' | 'team'; id: string; host_name: string; host_avatar_id: string | null; host_color_id: string | null; text: string }

/** Fragt regelmäßig nach Einladungen zu einem Live-Duell und zeigt sie als Karte an. */
export default function LiveInviteWatcher() {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [invites, setInvites] = useState<Invite[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId || !profileReady || blocked) { setInvites([]); return }
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      const [lv, tm] = await Promise.all([liveMyInvites().catch(() => null), teamMyInvites().catch(() => null)])
      if (!alive || (!lv && !tm)) return
      setInvites([
        ...(lv ?? []).map((i): Invite => ({ kind: 'live', id: i.duel_id, host_name: i.host_name, host_avatar_id: i.host_avatar_id, host_color_id: i.host_color_id, text: `lädt dich zu einem Live-Duell ein (${i.players} Spieler)` })),
        ...(tm ?? []).map((i): Invite => ({ kind: 'team', id: i.run_id, host_name: i.host_name, host_avatar_id: i.host_avatar_id, host_color_id: i.host_color_id, text: i.kind === 'parkour' ? 'lädt dich zum Team-Parkour ein (Joystick-Spiel mit bis zu 5 Personen)' : 'lädt dich zum Vokabel-Parcours ein' })),
      ])
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    document.addEventListener('visibilitychange', load)
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [userId, profileReady, blocked])

  const inv = invites.find((i) => !hidden.includes(i.id))
  // Während einer Runde oder in der Lobby selbst keine Karte
  if (!inv || /^\/(live-duell|team)\//.test(pathname) || /^\/(sprint|lernen|test)/.test(pathname)) return null

  async function answer(accept: boolean) {
    if (!inv) return
    setBusy(true)
    try {
      await (inv.kind === 'team' ? teamRespond(inv.id, accept) : liveRespond(inv.id, accept))
      setHidden((h) => [...h, inv.id])
      if (accept) nav(inv.kind === 'team' ? `/team/${inv.id}` : `/live-duell/${inv.id}`)
    } catch {
      setHidden((h) => [...h, inv.id])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alertdialog" aria-label="Einladung zum Spiel" className="fixed inset-x-3 top-4 z-[70] mx-auto max-w-md animate-rise rounded-2xl border border-fuchsia-400/50 bg-space-800/95 p-4 shadow-glow backdrop-blur">
      <p className="flex items-center gap-3">
        <span className="relative"><Avatar name={inv.host_name} avatarId={inv.host_avatar_id} colorId={inv.host_color_id} size={44} />{inv.kind === 'team' ? <Footprints size={16} className="absolute -bottom-1 -right-1 rounded-full bg-cyan-500 p-0.5 text-white" /> : <Zap size={16} className="absolute -bottom-1 -right-1 rounded-full bg-fuchsia-500 p-0.5 text-white" />}</span>
        <span className="min-w-0"><b className="block truncate">{inv.host_name}</b><span className="text-sm text-slate-300">{inv.text}</span></span>
      </p>
      <div className="mt-3 flex gap-2">
        <Button busy={busy} onClick={() => void answer(true)}>Beitreten</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void answer(false)}>Ablehnen</Button>
      </div>
    </div>
  )
}
