import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Footprints, Heart, Users } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import CoinIcon from '../components/ui/CoinIcon'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Spinner } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { PK_COLORS, PK_HATS, PK_PREMIUM_FACTOR } from '../features/parkour/cosmetics'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { parkourEquip, parkourShopBuy, parkourShopGet, type ParkourShop } from '../services/play'

function Figure({ color, hat }: { color: string; hat?: string }) {
  return (
    <div className="relative mx-auto h-14 w-12" aria-hidden>
      {hat && <span className="absolute left-1/2 top-0 -translate-x-1/2 text-xl leading-none">{hat}</span>}
      <div className="absolute bottom-0 left-1/2 h-9 w-7 -translate-x-1/2 rounded-lg" style={{ background: color, boxShadow: `0 0 10px ${color}` }}>
        <span className="absolute right-1 top-2 h-2 w-2 rounded-sm bg-white" />
      </div>
    </div>
  )
}

export default function Parkour() {
  const wallet = useWallet()
  const shop = useAsync(parkourShopGet, [])
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const s: ParkourShop | null = shop.data ?? null

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setError(null)
    try { await fn(); await Promise.all([shop.reload(), wallet.refresh()]) } catch (e) { setError(errorMessage(e)) } finally { setBusy(null); setArmed(null) }
  }
  const buy = (item: string) => (armed === item ? void run(item, () => parkourShopBuy(item)) : setArmed(item))

  const activeColor = s?.color ? PK_COLORS[s.color]?.fill ?? '#22d3ee' : '#22d3ee'
  const activeHat = s?.hat ? PK_HATS[s.hat]?.emoji : undefined

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Spaß" title="Parkour" />
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <Footprints className="mt-1 shrink-0 text-accent-cyan" size={22} />
          <p className="text-sm text-slate-300">
            Mit bis zu 5 Leuten per Joystick durch Level voller Stacheln, Türen und Brücken. Gemeinsame Herzen, Checkpoints, Coins je nach Fortschritt und eine Bestenliste für Teams. Nach Level 8 gibt es endlos neue Zufallslevel.
          </p>
        </div>
        <Link to="/live-duell?modus=team" className="btn-primary inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 font-semibold">
          <Users size={18} /> Mit Team spielen
        </Link>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Parkour-Shop</h2>
          <span className="flex items-center gap-1.5 text-sm text-slate-300"><CoinIcon size={16} /> {wallet.balance}</span>
        </div>
        {shop.error && <ErrorBox message={errorMessage(shop.error)} />}
        {error && <ErrorBox message={error} />}
        {!s ? <Spinner /> : (
          <>
            <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-3">
              <Figure color={activeColor} hat={activeHat} />
              <p className="text-sm text-slate-300">So siehst du im Spiel aus. Deine Partnerin oder dein Partner sieht dasselbe.</p>
            </div>

            <section className="space-y-2">
              <h3 className="label-mono">Herzen</h3>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center gap-1" aria-label={`${s.hearts} von ${s.heart_max} Extra-Herzen`}>
                  {Array.from({ length: s.heart_max }, (_, i) => <Heart key={i} size={20} className={i < s.hearts ? 'fill-rose-400 text-rose-400' : 'text-slate-600'} />)}
                </div>
                <p className="min-w-[10rem] flex-1 text-xs text-slate-400">Extra-Herzen kommen zum gemeinsamen Vorrat dazu (3 Grund-Herzen plus die Herzen von euch beiden).</p>
                {s.heart_price === null ? <span className="text-sm text-slate-400">Maximum erreicht</span> : (
                  <Button busy={busy === 'heart'} disabled={wallet.balance < s.heart_price} onClick={() => buy('heart')}>
                    {armed === 'heart' ? 'Wirklich kaufen?' : 'Herz kaufen'} · {s.heart_price} <CoinIcon size={14} />
                  </Button>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="label-mono">Körperfarben</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <button type="button" onClick={() => void run('c-none', () => parkourEquip(null, s.hat))} aria-pressed={!s.color}
                  className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs ${!s.color ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                  <Figure color="#22d3ee" /> Standard
                </button>
                {Object.entries(PK_COLORS).map(([id, c]) => {
                  const key = `color:${id}`, owned = s.owned.includes(key), on = s.color === id
                  const price = s.color_price * (c.premium ? PK_PREMIUM_FACTOR : 1)
                  return (
                    <button key={id} type="button" disabled={busy === key || (!owned && wallet.balance < price)}
                      onClick={() => (owned ? void run(key, () => parkourEquip(id, s.hat)) : buy(key))} aria-pressed={on}
                      className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs disabled:opacity-50 ${on ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : armed === key ? 'border-amber-300/60 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                      <Figure color={c.rainbow ? 'linear-gradient(135deg,#f87171,#facc15,#4ade80,#60a5fa,#c084fc)' : c.fill} />
                      <span>{c.name}</span>
                      <span className="flex items-center gap-1 text-[11px]">{on ? <><Check size={12} /> an</> : owned ? 'ausrüsten' : armed === key ? 'Wirklich?' : <>{price} <CoinIcon size={11} /></>}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="label-mono">Hüte</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <button type="button" onClick={() => void run('h-none', () => parkourEquip(s.color, null))} aria-pressed={!s.hat}
                  className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs ${!s.hat ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                  <Figure color={activeColor} /> Kein Hut
                </button>
                {Object.entries(PK_HATS).map(([id, h]) => {
                  const key = `hat:${id}`, owned = s.owned.includes(key), on = s.hat === id
                  const price = s.hat_price * (h.premium ? PK_PREMIUM_FACTOR : 1)
                  return (
                    <button key={id} type="button" disabled={busy === key || (!owned && wallet.balance < price)}
                      onClick={() => (owned ? void run(key, () => parkourEquip(s.color, id)) : buy(key))} aria-pressed={on}
                      className={`flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs disabled:opacity-50 ${on ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-100' : armed === key ? 'border-amber-300/60 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-slate-300'}`}>
                      <Figure color={activeColor} hat={h.emoji} />
                      <span>{h.name}</span>
                      <span className="flex items-center gap-1 text-[11px]">{on ? <><Check size={12} /> an</> : owned ? 'ausrüsten' : armed === key ? 'Wirklich?' : <>{price} <CoinIcon size={11} /></>}</span>
                    </button>
                  )
                })}
              </div>
            </section>
            <p className="text-xs text-slate-500">Zum Kaufen zweimal tippen. Gekaufte Sachen gehören dir dauerhaft. Farbe und Hut siehst du und dein Partner im Spiel.</p>
          </>
        )}
      </Card>
    </div>
  )
}
