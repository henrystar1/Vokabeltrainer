import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { myRunPerks, type RunPerks } from '../../services/play'

/** Darf ich Parkour-Läufe ansehen und wie trete ich auf? Admins: ja + Schwarzes Loch. Mods: nach Einstellung des Admins (Hammer). `ready` erst nach der Antwort des Servers. */
export function useRunPerks(): RunPerks & { ready: boolean } {
  const { isAdmin, user } = useAuth()
  const [p, setP] = useState<RunPerks | null>(null)
  useEffect(() => {
    let alive = true
    if (!user) return
    myRunPerks().then((r) => { if (alive) setP(r) }).catch(() => { if (alive) setP({ spectate: isAdmin, look: isAdmin ? 'blackhole' : null }) })
    return () => { alive = false }
  }, [user?.id, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps
  return { spectate: p?.spectate ?? isAdmin, look: p?.look ?? (isAdmin ? 'blackhole' : null), ready: p !== null }
}
