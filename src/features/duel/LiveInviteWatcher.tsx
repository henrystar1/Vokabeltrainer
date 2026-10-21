import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Zap } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Avatar } from '../../components/profile/PlayerTag'
import { liveMyInvites, liveRespond, type LiveInvite } from '../../services/play'
import { useAuth } from '../auth/AuthProvider'

const POLL_MS = 5_000

/** Fragt regelmäßig nach Einladungen zu einem Live-Duell und zeigt sie als Karte an. */
export default function LiveInviteWatcher() {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [invites, setInvites] = useState<LiveInvite[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId || !profileReady || blocked) { setInvites([]); return }
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      const r = await liveMyInvites().catch(() => null)
      if (alive && r) setInvites(r)
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    document.addEventListener('visibilitychange', load)
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [userId, profileReady, blocked])

  const inv = invites.find((i) => !hidden.includes(i.duel_id))
  // Während einer Runde oder in der Lobby selbst keine Karte
  if (!inv || /^\/live-duell\//.test(pathname) || /^\/(sprint|lernen|test)/.test(pathname)) return null

  async function answer(accept: boolean) {
    if (!inv) return
    setBusy(true)
    try {
      await liveRespond(inv.duel_id, accept)
      setHidden((h) => [...h, inv.duel_id])
      if (accept) nav(`/live-duell/${inv.duel_id}`)
    } catch {
      setHidden((h) => [...h, inv.duel_id])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alertdialog" aria-label="Einladung zum Live-Duell" className="fixed inset-x-3 top-4 z-[70] mx-auto max-w-md animate-rise rounded-2xl border border-fuchsia-400/50 bg-space-800/95 p-4 shadow-glow backdrop-blur">
      <p className="flex items-center gap-3">
        <span className="relative"><Avatar name={inv.host_name} avatarId={inv.host_avatar_id} colorId={inv.host_color_id} size={44} /><Zap size={16} className="absolute -bottom-1 -right-1 rounded-full bg-fuchsia-500 p-0.5 text-white" /></span>
        <span className="min-w-0"><b className="block truncate">{inv.host_name}</b><span className="text-sm text-slate-300">lädt dich zu einem Live-Duell ein ({inv.players} Spieler)</span></span>
      </p>
      <div className="mt-3 flex gap-2">
        <Button busy={busy} onClick={() => void answer(true)}>Beitreten</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void answer(false)}>Ablehnen</Button>
      </div>
    </div>
  )
}
