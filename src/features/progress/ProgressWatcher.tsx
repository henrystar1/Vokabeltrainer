import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowUp, Check, Puzzle, Target, X } from 'lucide-react'
import CoinIcon from '../../components/ui/CoinIcon'
import { useAuth } from '../auth/AuthProvider'
import { useWallet } from '../koins/WalletProvider'
import { usePlus } from '../plus/PlusProvider'
import { claimQuest, watchProgress, type WatchProgress, type WatchRow } from '../../services/play'
import { OG_NAMES, type OgKind } from '../../services/online'
import { detectOvertakes, type Snapshot } from './overtakes'
import { every } from '../../lib/poll'

const POLL_MS = 150_000
const MIN_GAP_MS = 20_000

const TITLE: Record<string, string> = {
  answers: 'Fleißig', perfect: 'Fehlerfrei', sprint: 'Sprinter', duel: 'Herausforderer',
  plus_answers: 'Plus: Vielschreiber', plus_games: 'Plus: Spieler',
  pro_answers: 'Pro: Wissensdurst', pro_perfect: 'Pro: Perfektionist', pro_sprint: 'Pro: Blitz', pro_duel: 'Pro: Duell-Meister', pro_games: 'Pro: Dauerspieler',
}

const CSS = `
@keyframes ov-up{0%{transform:translateY(64px)}55%{transform:translateY(-8px) scale(1.06)}100%{transform:translateY(-34px) scale(1)}}
@keyframes ov-down{0%{transform:translateY(-34px)}55%{transform:translateY(10px) scale(.96)}100%{transform:translateY(34px) scale(.94);opacity:.75}}
@keyframes ov-in{0%{transform:translateY(-30px);opacity:0}100%{transform:translateY(0);opacity:1}}
@keyframes ov-whoosh{0%{opacity:0;transform:translateX(-30px)}50%{opacity:1}100%{opacity:0;transform:translateX(30px)}}
@media (prefers-reduced-motion: reduce){.ov-a{animation-duration:.01s!important;animation-delay:0s!important}}
`

/** Läuft im Hintergrund: Quest geschafft → gleich abholbar; in der Wochenrangliste jemanden überholt → Animation. */
export default function ProgressWatcher() {
  const { user, profileReady, blocked } = useAuth()
  const wallet = useWallet()
  const plus = usePlus()
  const loc = useLocation()
  const [claimable, setClaimable] = useState<WatchProgress['claimable']>([])
  const [invites, setInvites] = useState<NonNullable<WatchProgress['invites']>>([])
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [passed, setPassed] = useState<{ me: Snapshot; who: WatchRow[]; fromRank: number | null } | null>(null)
  const prev = useRef<Snapshot | null>(null)
  const lastRun = useRef(0)
  const userId = user?.id

  const run = useCallback(async (force = false) => {
    if (!userId || !profileReady || blocked) return
    if (document.visibilityState !== 'visible') return
    if (!force && Date.now() - lastRun.current < MIN_GAP_MS) return
    lastRun.current = Date.now()
    try {
      const w = await watchProgress()
      setClaimable(w.claimable)
      setInvites(w.invites ?? [])
      const cur: Snapshot = { rank: w.rank, points: w.points, rows: w.rows }
      const who = detectOvertakes(prev.current, cur)
      if (who.length > 0) setPassed({ me: cur, who, fromRank: prev.current?.rank ?? null })
      prev.current = cur
    } catch {
      /* Hinweise sind nicht kritisch */
    }
  }, [userId, profileReady, blocked])

  useEffect(() => { void run(true) }, [run])
  useEffect(() => { void run() }, [loc.pathname, run])
  useEffect(() => {
    const t = every(() => void run(), POLL_MS)
    const v = () => void run()
    document.addEventListener('visibilitychange', v)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', v) }
  }, [run])
  useEffect(() => {
    if (!passed) return
    const t = window.setTimeout(() => setPassed(null), 5200)
    return () => window.clearTimeout(t)
  }, [passed])

  const shown = claimable.filter((q) => !dismissed.has(q.id))
  const q = shown[0]
  const inv = invites.filter((i) => !dismissed.has(`g${i.id}`))[0]
  const onGame = loc.pathname.startsWith('/mehrspieler')

  async function claim() {
    if (!q || busy) return
    setBusy(true)
    try {
      wallet.setBalance(await claimQuest(q.id as never))
      void plus.reload()
    } catch {
      /* z. B. schon abgeholt oder gesperrt: nicht immer wieder anzeigen */
      setDismissed((d) => new Set(d).add(q.id))
    } finally {
      setBusy(false)
      setClaimable((c) => c.filter((x) => x.id !== q.id))
      void run(true)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      {q && (
        <div className="fixed inset-x-0 bottom-24 z-[55] flex justify-center px-4 md:bottom-6" role="status">
          <div className="ov-a flex w-full max-w-md items-center gap-3 rounded-2xl border border-emerald-300/40 bg-slate-900/95 p-3 shadow-xl backdrop-blur" style={{ animation: 'ov-in .4s ease-out both' }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"><Target size={20} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">Quest geschafft: {TITLE[q.family] ?? 'Quest'}{q.stage > 1 ? ` (Stufe ${q.stage})` : ''}</p>
              <p className="flex items-center gap-1 text-xs text-slate-300"><CoinIcon size={14} /> {q.reward.toLocaleString('de-DE')} Coins warten{shown.length > 1 ? ` · noch ${shown.length - 1} weitere` : ''}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void claim()} className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-emerald-500 px-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60">
              <Check size={16} /> Abholen
            </button>
            <button type="button" aria-label="Später" onClick={() => setDismissed((d) => new Set(d).add(q.id))} className="flex min-h-[44px] w-9 items-center justify-center text-slate-500 hover:text-slate-200"><X size={16} /></button>
          </div>
        </div>
      )}
      {inv && !onGame && !q && (
        <div className="fixed inset-x-0 bottom-24 z-[55] flex justify-center px-4 md:bottom-6" role="status">
          <div className="ov-a flex w-full max-w-md items-center gap-3 rounded-2xl border border-cyan-300/40 bg-slate-900/95 p-3 shadow-xl backdrop-blur" style={{ animation: 'ov-in .4s ease-out both' }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300"><Puzzle size={20} aria-hidden /></span>
            <p className="min-w-0 flex-1 text-sm text-white"><b>{inv.host}</b> lädt dich zu {OG_NAMES[inv.kind as OgKind] ?? 'einem Spiel'} ein.</p>
            <Link to={`/mehrspieler/${inv.id}`} className="inline-flex min-h-[44px] items-center rounded-xl bg-cyan-400 px-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Ansehen</Link>
            <button type="button" aria-label="Später" onClick={() => setDismissed((d) => new Set(d).add(`g${inv.id}`))} className="flex min-h-[44px] w-9 items-center justify-center text-slate-500 hover:text-slate-200"><X size={16} /></button>
          </div>
        </div>
      )}
      {passed && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-4" role="status">
          <div className="ov-a relative w-full max-w-sm overflow-hidden rounded-2xl border border-yellow-300/50 bg-slate-900/95 px-4 py-3 text-center shadow-2xl backdrop-blur" style={{ animation: 'ov-in .4s ease-out both' }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-300">Wochenrangliste</p>
            <div className="relative mx-auto my-2 h-[104px] w-48">
              <span aria-hidden className="ov-a absolute inset-x-0 top-1/2 text-2xl text-yellow-300/80" style={{ animation: 'ov-whoosh 1.2s ease-out .3s both' }}>💨</span>
              <div className="ov-a absolute left-0 top-1/2 -mt-5 flex h-10 w-[46%] items-center justify-center truncate rounded-xl bg-slate-700 px-2 text-sm text-slate-200" style={{ animation: 'ov-down 1.3s cubic-bezier(.3,1,.4,1) .2s both' }}>{passed.who[0].display_name}</div>
              <div className="ov-a absolute right-0 top-1/2 -mt-5 flex h-10 w-[46%] items-center justify-center gap-1 rounded-xl bg-yellow-400 px-2 text-sm font-bold text-slate-950" style={{ animation: 'ov-up 1.3s cubic-bezier(.3,1,.4,1) .2s both' }}><ArrowUp size={14} /> Du</div>
            </div>
            <p className="text-sm font-semibold text-white">
              Du hast {passed.who.length === 1 ? passed.who[0].display_name : `${passed.who[0].display_name} und ${passed.who.length - 1} weitere`} überholt!
            </p>
            {passed.me.rank !== null && <p className="text-xs text-slate-400">{passed.fromRank !== null && passed.fromRank !== passed.me.rank ? `Platz ${passed.fromRank} → ` : ''}Platz {passed.me.rank} · {passed.me.points} Punkte</p>}
          </div>
        </div>
      )}
    </>
  )
}
