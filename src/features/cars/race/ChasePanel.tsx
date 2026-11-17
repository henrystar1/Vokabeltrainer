import { useEffect, useState } from 'react'

export interface ChaseUi {
  /** Ersteller: Einladungen sind raus, Antworten laufen ein */
  lobby?: { id: string; bandit: string; invited: Record<string, 'wait' | 'yes' | 'no'>; bots: number }
  /** Einladung an mich */
  incoming?: { id: string; fn: string; role: 'bandit' | 'cop'; bots: number }
  /** Ich habe zugesagt und warte auf den Start */
  waiting?: boolean
  active?: { role: 'bandit' | 'cop'; t0: number; banditName: string; bots: number }
  over?: { win: 'police' | 'bandit'; mine: boolean }
}
export interface ChaseApi {
  invite: (ids: string[], bandit: string, bots: number) => void
  start: () => void
  cancel: () => void
  answer: (ok: boolean) => void
}
export interface Peer { id: string; name: string }

const MAX_MS = 6 * 60 * 1000
const ME = 'me'

/** Menü und Hinweise der Polizeijagd (Stadt-Lobby): Leute einladen, Bandit wählen, Polizei-Bots, Einladung annehmen, laufende Jagd, Ergebnis. */
export default function ChasePanel({ ui, peers, open, onClose, api, meName, myId }: { ui: ChaseUi; peers: Peer[]; open: boolean; onClose: () => void; api: ChaseApi; meName: string; myId: string }) {
  const [sel, setSel] = useState<string[]>([])
  const [bandit, setBandit] = useState(ME)
  const [bots, setBots] = useState(2)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!ui.active) return; const i = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(i) }, [ui.active])
  const here = peers.filter((p) => p.id !== myId)
  const picked = sel.filter((id) => here.some((p) => p.id === id))
  const banditId = bandit === ME || !picked.includes(bandit) ? ME : bandit
  const nameOf = (id: string) => (id === ME || id === myId ? meName : peers.find((p) => p.id === id)?.name ?? 'Spieler')
  const left = ui.active ? Math.max(0, Math.ceil((MAX_MS - (now - ui.active.t0)) / 1000)) : 0
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <>
      {ui.incoming && !ui.active && (
        <div className="absolute inset-x-2 top-2 z-40 mx-auto max-w-sm rounded-2xl border border-sky-400/60 bg-slate-900/95 p-4 text-center text-white" role="alertdialog" aria-label="Einladung zur Polizeijagd">
          <p className="font-semibold">🚓 {ui.incoming.fn} lädt dich zur Polizeijagd ein</p>
          <p className="mt-1 text-sm text-slate-300">Du wärst {ui.incoming.role === 'bandit' ? 'der Bandit' : 'Polizei'}.{ui.incoming.bots > 0 ? ` Dazu ${ui.incoming.bots} Polizei-Bots.` : ''}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => api.answer(true)} className="min-h-[44px] rounded-lg bg-emerald-500 px-4 font-semibold text-slate-950">Mitmachen</button>
            <button type="button" onClick={() => api.answer(false)} className="min-h-[44px] rounded-lg bg-white/10 px-4">Nein</button>
          </div>
        </div>
      )}
      {ui.waiting && !ui.active && <p className="absolute inset-x-2 top-2 z-40 mx-auto max-w-xs rounded-xl bg-slate-900/90 px-3 py-2 text-center text-sm text-white">Zugesagt – warte auf den Start …</p>}
      {ui.active && (
        <div className={`pointer-events-none absolute inset-x-2 top-2 z-30 mx-auto max-w-xs rounded-xl px-3 py-2 text-center text-sm font-semibold text-white ${ui.active.role === 'bandit' ? 'bg-rose-700/85' : 'bg-blue-700/85'}`} role="status">
          {ui.active.role === 'bandit' ? '🏴‍☠️ Du bist der Bandit: entkomme der Polizei!' : `🚓 Du bist Polizei: ramme ${ui.active.banditName}!`}
          <span className="ml-2 font-mono tabular-nums">{mm(left)}</span>
        </div>
      )}
      {ui.over && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/50 p-4" role="dialog" aria-label="Ergebnis der Polizeijagd">
          <div className="w-full max-w-xs rounded-2xl bg-slate-900/95 p-5 text-center text-white">
            <p className="text-3xl">{ui.over.mine ? '🏆' : '😬'}</p>
            <p className="mt-1 text-lg font-bold">{ui.over.win === 'police' ? 'Die Polizei hat den Bandit gefangen!' : 'Der Bandit ist entkommen!'}</p>
            <p className="mt-1 text-sm text-slate-300">{ui.over.mine ? 'Ihr habt gewonnen.' : 'Diesmal verloren.'}</p>
          </div>
        </div>
      )}
      {open && !ui.active && (
        <div className="absolute inset-x-2 top-14 z-30 mx-auto max-h-[75%] max-w-sm overflow-auto rounded-2xl border border-white/20 bg-slate-900/95 p-4 text-sm text-white" role="dialog" aria-label="Polizeijagd">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">🚓 Polizeijagd</h3><button type="button" onClick={onClose} className="min-h-[36px] rounded-lg bg-white/10 px-3 text-xs">Schließen</button></div>
          {ui.lobby ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-300">Einladungen sind raus. Bandit: <b>{nameOf(ui.lobby.bandit === ME ? myId : ui.lobby.bandit)}</b>. Polizei-Bots: {ui.lobby.bots}.</p>
              <ul className="space-y-1">
                {Object.entries(ui.lobby.invited).map(([id, st]) => <li key={id} className="flex justify-between rounded bg-white/5 px-2 py-1"><span>{nameOf(id)}</span><span className={st === 'yes' ? 'text-emerald-300' : st === 'no' ? 'text-rose-300' : 'text-slate-400'}>{st === 'yes' ? 'dabei' : st === 'no' ? 'nein' : 'wartet …'}</span></li>)}
              </ul>
              <div className="flex gap-2">
                <button type="button" onClick={api.start} className="min-h-[44px] flex-1 rounded-lg bg-accent-cyan font-semibold text-slate-950">Jagd starten</button>
                <button type="button" onClick={api.cancel} className="min-h-[44px] rounded-lg bg-white/10 px-3">Abbrechen</button>
              </div>
              <p className="text-xs text-slate-400">Startet, sobald der Bandit zugesagt hat (oder du es bist) und mindestens ein Polizist oder Bot dabei ist.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-300">Wen einladen? (nur wer gerade in der Stadt ist)</p>
                {here.length === 0 && <p className="text-xs text-slate-400">Gerade ist niemand sonst in der Stadt. Du kannst trotzdem mit Polizei-Bots spielen.</p>}
                <ul className="space-y-1">
                  {here.map((p) => (
                    <li key={p.id}><label className="flex min-h-[40px] items-center gap-2 rounded bg-white/5 px-2"><input type="checkbox" className="h-5 w-5" checked={picked.includes(p.id)} onChange={(e) => setSel((o) => (e.target.checked ? [...o, p.id] : o.filter((x) => x !== p.id)))} />{p.name}</label></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-300">Wer ist der Bandit?</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Bandit">
                  {[ME, ...picked].map((id) => <button key={id} type="button" role="radio" aria-checked={banditId === id} onClick={() => setBandit(id)} className={`min-h-[40px] rounded-lg px-3 ${banditId === id ? 'bg-rose-600 font-bold' : 'bg-white/10'}`}>{id === ME ? 'Ich' : nameOf(id)}</button>)}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-300">Polizei-Bots</p>
                <div className="flex gap-1" role="group" aria-label="Anzahl Polizei-Bots">
                  {[0, 1, 2, 3, 4, 6].map((n) => <button key={n} type="button" onClick={() => setBots(n)} aria-pressed={bots === n} className={`min-h-[40px] flex-1 rounded-lg ${bots === n ? 'bg-blue-600 font-bold' : 'bg-white/10'}`}>{n}</button>)}
                </div>
              </div>
              <button type="button" disabled={picked.length === 0 && bots === 0 && banditId === ME} onClick={() => api.invite(picked, banditId === ME ? ME : banditId, bots)} className="min-h-[48px] w-full rounded-lg bg-accent-cyan font-semibold text-slate-950 disabled:opacity-40">{picked.length > 0 ? 'Einladen' : 'Mit Bots starten'}</button>
              <p className="text-xs text-slate-400">Der Bandit fährt ein schnelleres, fliegendes Auto und ist immer auf der Karte zu sehen. Die Polizei hat Blaulicht und ist etwas langsamer. Rammt ein Polizist den Bandit, gewinnt die Polizei. Nach 6 Minuten gewinnt der Bandit.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}
