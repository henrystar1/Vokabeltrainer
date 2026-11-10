import { useMemo, useState } from 'react'
import { matchSubTab } from '../lib/subTabs'
import CoinIcon from '../components/ui/CoinIcon'
import { Check, Lock, Pencil, Plus } from 'lucide-react'
import { usePlus } from '../features/plus/PlusProvider'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import KoinBadge from '../components/profile/KoinBadge'
import ItemPreview from '../components/shop/ItemPreview'
import RewardReveal from '../components/ui/RewardReveal'
import ItemEditor from '../components/shop/ItemEditor'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { AVATARS, KIND_LABEL } from '../features/shop/catalog'
import { refreshCustomItems, useCustomVersion } from '../features/shop/custom'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { adminSetItem, buyItem, equipItem, getCoinLockStatus, getMyPermissions, getShop, u100Claim, u100Status, unequipItem } from '../services/koins'
import type { ShopItem, ShopKind } from '../types'
import PlusHint from '../features/plus/PlusHint'
import ParkourShopPanel from '../features/parkour/ParkourShopPanel'
import { useSearchParams } from 'react-router-dom'

const KINDS: ShopKind[] = ['avatar', 'color', 'effect', 'tag', 'theme']

const Preview = ItemPreview

export default function Shop() {
  const { displayName, cosmetics, themeId, refreshProfile, isAdmin, isStaff } = useAuth()
  const perms = useAsync(() => (isStaff ? getMyPermissions() : Promise.resolve(null)), [isStaff])
  const canPrice = isAdmin || perms.data?.shop === true
  const [priceEdit, setPriceEdit] = useState<{ id: string; value: string } | null>(null)
  useCustomVersion()
  const [editing, setEditing] = useState<ShopItem | 'new' | null>(null)
  const wallet = useWallet()
  const plus = usePlus()
  const coinLock = useAsync(getCoinLockStatus, [])
  const shop = useAsync(getShop, [])
  const u100 = useAsync(u100Status, [])
  const [params] = useSearchParams()
  const subT = matchSubTab('/shop', params.get('t'))
  const [kind, setKind] = useState<ShopKind>(subT && subT !== 'parkour' ? (subT as ShopKind) : 'avatar')
  const [parkourTab, setParkourTab] = useState(params.get('tab') === 'parkour' || subT === 'parkour')
  const [confirm, setConfirm] = useState<ShopItem | null>(null)
  const [bought, setBought] = useState<ShopItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const name = displayName ?? 'Du'

  const U100_IDS = ['tag_u100', 'theme_u100_gold', 'theme_u100']
  const items = useMemo(() => (shop.data ?? []).filter((i) => i.kind === kind && !U100_IDS.includes(i.id)), [shop.data, kind])
  const u100Items = (shop.data ?? []).filter((i) => U100_IDS.includes(i.id))

  async function act(fn: () => Promise<void>, ok?: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      await Promise.all([shop.reload(), u100.reload(), refreshProfile(), wallet.refresh()])
      if (ok) setMessage(ok)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function savePrice(item: ShopItem) {
    const v = Number.parseInt((priceEdit?.value ?? '').replace(/\./g, ''), 10)
    if (!Number.isInteger(v) || v < 0) { setError('Bitte einen Preis ab 0 eingeben.'); return }
    await act(() => adminSetItem(item.id, v, item.active !== false), `Preis von „${item.name}“: ${v.toLocaleString('de-DE')} Coins.`)
    setPriceEdit(null)
  }

  const equippedIn = (k: ShopKind) => (shop.data ?? []).find((i) => i.kind === k && i.equipped)

  return (
    <div>
      <PageHeader
        eyebrow="Coins ausgeben"
        title="Shop"
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && <Button variant="secondary" onClick={() => setEditing('new')}><Plus size={16} /> Neuer Artikel</Button>}
            <KoinBadge />
          </div>
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-slate-400">
        Profilbilder, Namensfarben, Effekte und Tags siehst du auf deinem Profil und in der Rangliste – alle anderen sehen sie auch.
        Designs ändern die Farben und den Hintergrund der ganzen Website, aber nur für dich.
      </p>

      <div role="tablist" className="glass mb-5 inline-flex flex-wrap rounded-xl p-1">
        {KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={!parkourTab && kind === k}
            onClick={() => { setKind(k); setParkourTab(false) }}
            className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition ${!parkourTab && kind === k ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        <button role="tab" aria-selected={parkourTab} onClick={() => setParkourTab(true)}
          className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition ${parkourTab ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}>
          Parkour
        </button>
      </div>

      {parkourTab && <ParkourShopPanel />}

      {coinLock.data?.locked && <div className="mb-4"><Notice tone="warn">Dein Guthaben ist vom Admin gesperrt{coinLock.data.note ? `: ${coinLock.data.note}` : '.'} Du kannst gerade nichts kaufen, aber weiter spielen und gamblen.</Notice></div>}
      {message && <div className="mb-4"><Notice tone="ok">{message}</Notice></div>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      {!parkourTab && shop.loading && !shop.data && <Spinner />}
      {!parkourTab && shop.error && <ErrorBox message={shop.error} onRetry={shop.reload} />}

      {!parkourTab && shop.data && (
        <>
          {u100Items.length > 0 && !parkourTab && (
            <div className="mb-6 rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-400/10 via-transparent to-pink-500/10 p-4">
              <h2 className="mb-1 text-lg font-bold text-amber-200">🎈 Update 100 – Jubiläum</h2>
              <p className="mb-3 text-sm text-slate-400">Zum 100. Update: zwei Artikel nur für die ersten 10 (die Schnellsten, gratis) und ein Design für alle.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {u100Items.map((item) => {
                  const st = u100.data?.find((s) => s.item_id === item.id)
                  const left = st?.limited != null ? Math.max(0, st.limited - st.taken) : null
                  const gone = left === 0 && !item.owned
                  const equipped = item.equipped
                  return (
                    <Card key={item.id} className="flex flex-col gap-3">
                      <div className="flex min-h-[64px] items-center justify-center"><Preview item={item} name={name} cosmetics={cosmetics} /></div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{item.name}</span>
                        {left != null && <span className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] text-amber-200">{gone ? 'Vergeben' : `Noch ${left} von ${st?.limited}`}</span>}
                        {left == null && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-300">Für alle · gratis</span>}
                      </div>
                      {equipped ? (
                        <span className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-accent-cyan/10 text-sm text-accent-cyan"><Check size={16} /> Ausgewählt</span>
                      ) : item.owned ? (
                        <Button variant="secondary" disabled={busy} onClick={() => void act(() => equipItem(item.id), 'Ausgewählt.')}>Verwenden</Button>
                      ) : (
                        <Button disabled={busy || gone} onClick={() => void act(async () => {
                          const r = await u100Claim(item.id)
                          if (r === 'gone') throw new Error('Zu spät – alle 10 sind schon vergeben.')
                          await equipItem(item.id)
                        }, 'Geholt und ausgewählt! 🎉')}>{gone ? 'Leider zu spät' : 'Gratis holen'}</Button>
                      )}
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
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
                    {item.active === false && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-400">Nicht mehr im Shop</span>}
                    {item.plus_only && <span className="tag tag-plus !text-[10px]">PLUS</span>}
                    {item.required_role && <span className="tag tag-admin">{item.required_role === 'admin' ? 'Nur Admin' : 'Nur Mods'}</span>}
                    {isAdmin && item.custom && (
                      <button type="button" aria-label="Artikel bearbeiten" title="Bearbeiten" onClick={() => setEditing(item)} className="flex min-h-[36px] w-9 items-center justify-center rounded-lg text-slate-400 hover:text-white">
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                  {canPrice && (
                    priceEdit?.id === item.id ? (
                      <div className="flex items-center gap-2">
                        <input autoFocus inputMode="numeric" value={priceEdit.value} onChange={(e) => setPriceEdit({ id: item.id, value: e.target.value.replace(/[^\d]/g, '') })}
                          onKeyDown={(e) => { if (e.key === 'Enter') void savePrice(item); if (e.key === 'Escape') setPriceEdit(null) }}
                          className="min-h-[40px] w-full min-w-0 rounded-lg border border-white/10 bg-space-900/70 px-3 text-sm" aria-label="Neuer Preis" />
                        <Button variant="secondary" disabled={busy} onClick={() => void savePrice(item)}>OK</Button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setPriceEdit({ id: item.id, value: String(item.price) })} className="self-start text-xs text-accent-cyan hover:underline">Preis ändern</button>
                    )
                  )}
                  {item.price > 0 && item.kind !== 'theme' && <p className="-mt-1 text-xs text-slate-500">{item.price >= 4000 ? 'Sehr selten' : item.price >= 1000 ? 'Selten' : ''}</p>}
                  {equipped ? (
                    <span className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-accent-cyan/10 text-sm text-accent-cyan">
                      <Check size={16} /> Ausgewählt
                    </span>
                  ) : item.owned ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void act(() => equipItem(item.id), 'Ausgewählt.')}>
                      Verwenden
                    </Button>
                  ) : item.plus_only ? (
                    <Button variant="secondary" onClick={plus.openDialog}><Lock size={16} /> Mit Plus freischalten</Button>
                  ) : (
                    <Button disabled={busy || !affordable} onClick={() => setConfirm(item)}>
                      <CoinIcon size={16} /> {item.price.toLocaleString('de-DE')} Coins
                    </Button>
                  )}
                  {!item.owned && !item.plus_only && !affordable && <p className="text-xs text-slate-500">Dir fehlen {item.price - wallet.balance} Coins.</p>}
                </Card>
              )
            })}
          </div>
        </>
      )}

      {editing && (
        <ItemEditor
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            setMessage(msg)
            void refreshCustomItems().then(() => Promise.all([shop.reload(), refreshProfile()]))
          }}
        />
      )}

      {confirm && (
        <Modal title="Artikel kaufen?" onClose={() => setConfirm(null)}>
          <p className="text-sm text-slate-300">
            „{confirm.name}“ kostet <b>{confirm.price} Coins</b>. Danach hast du noch {wallet.balance - confirm.price} Coins. Gekaufte Artikel gehören dir dauerhaft.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button busy={busy} onClick={() => void act(async () => {
              await buyItem(confirm.id)
              await equipItem(confirm.id)
              setBought(confirm)
            }, 'Gekauft und ausgewählt!')}>
              Kaufen
            </Button>
          </div>
        </Modal>
      )}
      {bought && <RewardReveal gift={false} title="Gekauft!" rewards={[{ type: 'item', item: { id: bought.id, kind: bought.kind, name: bought.name, price: bought.price } }]} onClose={() => setBought(null)} />}
      <PlusHint ctx="shop" />
    </div>
  )
}
