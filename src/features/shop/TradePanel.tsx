import { useState } from 'react'
import { Check, X } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import { useWallet } from '../koins/WalletProvider'
import { tradeAccept, tradeBid, tradeBidCancel, tradeBuy, tradeCancel, tradeDecline, tradeList, tradeMarket } from '../../services/koins'

const num = (v: string) => Number.parseInt(v.replace(/\D/g, ''), 10)

/** Handel: limitierte Artikel zwischen Spielern verkaufen, kaufen oder ein Gegenangebot machen. */
export default function TradePanel({ onChanged }: { onChanged: () => void }) {
  const market = useAsync(tradeMarket, [])
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [price, setPrice] = useState<Record<string, string>>({})

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true); setError(null); setMsg(null)
    try { await fn(); await market.reload(); onChanged(); setMsg(ok) } catch (e) { setError(errorMessage(e)); await market.reload() } finally { setBusy(false) }
  }
  const val = (k: string) => price[k] ?? ''
  const set = (k: string, v: string) => setPrice((p) => ({ ...p, [k]: v.replace(/\D/g, '') }))
  const d = market.data

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-slate-400">Hier handelst du limitierte Artikel mit anderen. Du legst den Preis fest, Käufer können ihn annehmen oder ein anderes Gebot abgeben, und du entscheidest. Coins gehen ohne Bonus an den Verkäufer.</p>
      {msg && <Notice tone="ok">{msg}</Notice>}
      {error && <ErrorBox message={error} />}
      {market.loading && !d && <Spinner />}
      {market.error && <ErrorBox message={market.error} onRetry={market.reload} />}
      {d && (
        <>
          <section>
            <h2 className="mb-2 font-semibold">Meine limitierten Artikel</h2>
            {d.mine.length === 0 ? <p className="text-sm text-slate-500">Du besitzt noch keinen limitierten Artikel.</p> : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.mine.filter((m) => !m.listed).map((m) => (
                  <Card key={m.item_id} className="space-y-2">
                    <p className="font-medium">{m.name}</p>
                    <div className="flex gap-2">
                      <input inputMode="numeric" placeholder="Preis in Coins" value={val('l' + m.item_id)} onChange={(e) => set('l' + m.item_id, e.target.value)} aria-label={`Preis für ${m.name}`}
                        className="min-h-[44px] w-full min-w-0 rounded-lg border border-white/10 bg-space-900/70 px-3 text-sm" />
                      <Button disabled={busy || !num(val('l' + m.item_id))} onClick={() => void run(async () => { await tradeList(m.item_id, num(val('l' + m.item_id))) }, 'Angebot eingestellt.')}>Anbieten</Button>
                    </div>
                  </Card>
                ))}
                {d.mine.every((m) => m.listed) && <p className="text-sm text-slate-500">Alle deine Artikel sind gerade im Angebot.</p>}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Angebote</h2>
            {d.offers.length === 0 && <p className="text-sm text-slate-500">Gerade bietet niemand etwas an.</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.offers.map((o) => (
                <Card key={o.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.name}</span>
                    <span className="inline-flex items-center gap-1 text-sm text-amber-200"><CoinIcon size={14} /> {o.price.toLocaleString('de-DE')}</span>
                  </div>
                  <p className="text-xs text-slate-500">von {o.seller}{o.bid_count > 0 ? ` · ${o.bid_count} Gebot${o.bid_count > 1 ? 'e' : ''}` : ''}</p>
                  {o.mine ? (
                    <>
                      {o.bids.length === 0 && <p className="text-xs text-slate-400">Noch keine Gebote.</p>}
                      {o.bids.map((b) => (
                        <div key={b.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
                          <span className="min-w-0 flex-1 truncate">{b.name}</span>
                          <span className="inline-flex items-center gap-1 text-amber-200"><CoinIcon size={13} /> {b.price.toLocaleString('de-DE')}</span>
                          <button type="button" aria-label="Gebot annehmen" title="Annehmen" disabled={busy} onClick={() => void run(() => tradeAccept(b.id), 'Verkauft!')} className="flex min-h-[36px] w-9 items-center justify-center rounded-lg text-emerald-300 hover:bg-white/10"><Check size={16} /></button>
                          <button type="button" aria-label="Gebot ablehnen" title="Ablehnen" disabled={busy} onClick={() => void run(() => tradeDecline(b.id), 'Gebot abgelehnt.')} className="flex min-h-[36px] w-9 items-center justify-center rounded-lg text-rose-300 hover:bg-white/10"><X size={16} /></button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input inputMode="numeric" placeholder="Neuer Preis" value={val('p' + o.id)} onChange={(e) => set('p' + o.id, e.target.value)} aria-label="Neuer Preis"
                          className="min-h-[40px] w-full min-w-0 rounded-lg border border-white/10 bg-space-900/70 px-3 text-sm" />
                        <Button variant="secondary" disabled={busy || !num(val('p' + o.id))} onClick={() => void run(async () => { await tradeList(o.item_id, num(val('p' + o.id))) }, 'Preis geändert.')}>Ändern</Button>
                      </div>
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => tradeCancel(o.id), 'Angebot zurückgezogen.')}>Zurückziehen</Button>
                    </>
                  ) : o.owned ? (
                    <p className="text-xs text-slate-400">Das hast du schon.</p>
                  ) : (
                    <>
                      <Button disabled={busy || wallet.balance < o.price} onClick={() => void run(() => tradeBuy(o.id), `„${o.name}“ gekauft! Du findest ihn jetzt im Shop zum Auswählen.`)}>
                        Für {o.price.toLocaleString('de-DE')} Coins kaufen
                      </Button>
                      {wallet.balance < o.price && <p className="text-xs text-slate-500">Dir fehlen {(o.price - wallet.balance).toLocaleString('de-DE')} Coins.</p>}
                      <div className="flex gap-2">
                        <input inputMode="numeric" placeholder={o.my_bid ? `Dein Gebot: ${o.my_bid}` : 'Dein Gebot'} value={val('b' + o.id)} onChange={(e) => set('b' + o.id, e.target.value)} aria-label="Dein Gebot"
                          className="min-h-[40px] w-full min-w-0 rounded-lg border border-white/10 bg-space-900/70 px-3 text-sm" />
                        <Button variant="secondary" disabled={busy || !num(val('b' + o.id))} onClick={() => void run(() => tradeBid(o.id, num(val('b' + o.id))), 'Gebot abgegeben. Der Verkäufer entscheidet.')}>Bieten</Button>
                      </div>
                      {o.my_bid_id && <button type="button" className="self-start text-xs text-accent-cyan hover:underline" onClick={() => void run(() => tradeBidCancel(o.my_bid_id!), 'Gebot zurückgezogen.')}>Mein Gebot zurückziehen</button>}
                    </>
                  )}
                </Card>
              ))}
            </div>
          </section>

          {d.history.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">Zuletzt verkauft</h2>
              <ul className="space-y-1 text-sm text-slate-300">
                {d.history.map((h, i) => <li key={i}>{h.name} · <span className="text-amber-200">{h.price.toLocaleString('de-DE')} Coins</span> <span className="text-xs text-slate-500">({new Date(h.at).toLocaleDateString('de-DE')})</span></li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
