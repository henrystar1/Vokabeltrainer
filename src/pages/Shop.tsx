import { useMemo, useState } from 'react'
import { Check, Coins } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import KoinBadge from '../components/profile/KoinBadge'
import { Avatar, StyledName } from '../components/profile/PlayerTag'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { AVATARS, KIND_LABEL, TAGS, THEMES } from '../features/shop/catalog'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { buyItem, equipItem, getShop, unequipItem } from '../services/koins'
import type { ShopItem, ShopKind } from '../types'

const KINDS: ShopKind[] = ['avatar', 'color', 'effect', 'tag', 'theme']

function Preview({ item, name, cosmetics }: { item: ShopItem; name: string; cosmetics: { color_id: string | null; effect_id: string | null } }) {
  if (item.kind === 'avatar') return <Avatar name={name} avatarId={item.id} size={item.price >= 700 ? 76 : 56} />
  if (item.kind === 'tag') return <span className={`tag ${TAGS[item.id]?.className ?? ''} !text-xs`}>{TAGS[item.id]?.label ?? item.name}</span>
  if (item.kind === 'color') return <StyledName name={name} colorId={item.id} className="text-xl font-semibold" />
  if (item.kind === 'effect') return <StyledName name={name} colorId={cosmetics.color_id} effectId={item.id} className="text-xl font-semibold" />
  const t = THEMES[item.id]
  return <div className="h-14 w-full rounded-xl border border-white/10" style={{ background: t?.preview ?? '#222' }} />
}

export default function Shop() {
  const { displayName, cosmetics, themeId, refreshProfile } = useAuth()
  const wallet = useWallet()
  const shop = useAsync(getShop, [])
  const [kind, setKind] = useState<ShopKind>('avatar')
  const [confirm, setConfirm] = useState<ShopItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const name = displayName ?? 'Du'

  const items = useMemo(() => (shop.data ?? []).filter((i) => i.kind === kind), [shop.data, kind])

  async function act(fn: () => Promise<void>, ok?: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      await Promise.all([shop.reload(), refreshProfile(), wallet.refresh()])
      if (ok) setMessage(ok)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const equippedIn = (k: ShopKind) => (shop.data ?? []).find((i) => i.kind === k && i.equipped)

  return (
    <div>
      <PageHeader eyebrow="Koins ausgeben" title="Shop" actions={<KoinBadge />} />
      <p className="mb-4 max-w-2xl text-sm text-slate-400">
        Profilbilder, Namensfarben, Effekte und Tags siehst du auf deinem Profil und in der Rangliste – alle anderen sehen sie auch.
        Designs ändern die Farben und den Hintergrund der ganzen Website, aber nur für dich.
      </p>

      <div role="tablist" className="glass mb-5 inline-flex flex-wrap rounded-xl p-1">
        {KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition ${kind === k ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {message && <div className="mb-4"><Notice tone="ok">{message}</Notice></div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {shop.loading && !shop.data && <Spinner />}
      {shop.error && <ErrorBox message={shop.error} onRetry={shop.reload} />}

      {shop.data && (
        <>
          {equippedIn(kind) && kind !== 'theme' && (
            <div className="mb-3">
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => unequipItem(kind), 'Abgelegt.')}>
                Aktuellen Artikel ablegen
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const affordable = wallet.balance >= item.price
              const isDefaultTheme = item.kind === 'theme' && item.id === 'theme_space'
              const equipped = item.equipped || (isDefaultTheme && !themeId)
              return (
                <Card key={item.id} className={`flex flex-col gap-3 ${equipped ? 'ring-1 ring-accent-cyan/50' : ''}`}>
                  <div className="flex min-h-[64px] items-center justify-center">
                    <Preview item={item} name={name} cosmetics={cosmetics} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.kind === 'avatar' && AVATARS[item.id] && <span className="text-lg">{AVATARS[item.id]}</span>}
                    {item.required_role && <span className="tag tag-admin">{item.required_role === 'admin' ? 'Nur Admin' : 'Nur Mods'}</span>}
                  </div>
                  {item.price > 0 && item.kind !== 'theme' && <p className="-mt-1 text-xs text-slate-500">{item.price >= 4000 ? 'Sehr selten' : item.price >= 1000 ? 'Selten' : ''}</p>}
                  {equipped ? (
                    <span className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-accent-cyan/10 text-sm text-accent-cyan">
                      <Check size={16} /> Ausgewählt
                    </span>
                  ) : item.owned ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void act(() => equipItem(item.id), 'Ausgewählt.')}>
                      Verwenden
                    </Button>
                  ) : (
                    <Button disabled={busy || !affordable} onClick={() => setConfirm(item)}>
                      <Coins size={16} /> {item.price.toLocaleString('de-DE')} Koins
                    </Button>
                  )}
                  {!item.owned && !affordable && <p className="text-xs text-slate-500">Dir fehlen {item.price - wallet.balance} Koins.</p>}
                </Card>
              )
            })}
          </div>
        </>
      )}

      {confirm && (
        <Modal title="Artikel kaufen?" onClose={() => setConfirm(null)}>
          <p className="text-sm text-slate-300">
            „{confirm.name}“ kostet <b>{confirm.price} Koins</b>. Danach hast du noch {wallet.balance - confirm.price} Koins. Gekaufte Artikel gehören dir dauerhaft.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button busy={busy} onClick={() => void act(async () => {
              await buyItem(confirm.id)
              await equipItem(confirm.id)
            }, 'Gekauft und ausgewählt!')}>
              Kaufen
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
