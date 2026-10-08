import { useState } from 'react'
import { Wrench } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Field, Select, TextInput } from '../ui/Field'
import { ErrorBox, Notice } from '../ui/States'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminAdjustPoints } from '../../services/admin'
import { adminGrantItem, adminGrantKoins, adminListItems, adminListUserItems, adminRevokeItem } from '../../services/koins'

const MAX = 1_000_000_000

/** Kleiner Schraubenschlüssel neben einem Namen – nur für Admins sichtbar. */
export function ManageButton({ userId, name, onChanged }: { userId: string; name: string; onChanged?: () => void }) {
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  if (!isAdmin) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${name} verwalten`} title="Verwalten (Coins, Artikel, Punkte)" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-accent-cyan">
        <Wrench size={15} />
      </button>
      {open && <ManageUser userId={userId} name={name} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  )
}

type Tab = 'coins' | 'items' | 'points'

/** Schnellaktionen für eine Person: Coins buchen (auch sehr hohe Beträge auf einmal), Artikel schenken/entziehen, Punkte. */
export default function ManageUser({ userId, name, onClose, onChanged }: { userId: string; name: string; onClose: () => void; onChanged?: () => void }) {
  const { user, refreshProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('coins')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [pts, setPts] = useState('')
  const [giftItem, setGiftItem] = useState('')
  const [equip, setEquip] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const items = useAsync(adminListItems, [])
  const owned = useAsync(() => adminListUserItems(userId), [userId])

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      setMessage(ok)
      onChanged?.()
      if (userId === user?.id) await refreshProfile()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const n = Number.parseInt(amount.replace(/\./g, ''), 10)
  const validAmount = Number.isInteger(n) && n !== 0 && Math.abs(n) <= MAX
  const p = Number.parseInt(pts, 10)
  const tabs: Array<[Tab, string]> = [['coins', 'Coins'], ['items', 'Artikel'], ['points', 'Punkte']]

  return (
    <Modal title={`${name} verwalten`} onClose={onClose}>
      <div role="tablist" className="glass mb-4 inline-flex rounded-xl p-1">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${tab === k ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}>{l}</button>
        ))}
      </div>
      {message && <div className="mb-3"><Notice tone="ok">{message}</Notice></div>}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      {tab === 'coins' && (
        <div className="space-y-3">
          <Field label="Betrag" hint={`Plus = schenken, Minus = abziehen (höchstens bis 0). Bis ${MAX.toLocaleString('de-DE')} auf einmal.`}>
            <TextInput inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="z. B. 50000 oder -2000" />
          </Field>
          <Field label="Notiz (optional)"><TextInput value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button disabled={busy || !validAmount} onClick={() => void run(() => adminGrantKoins(userId, n, note), `${name}: ${n > 0 ? '+' : ''}${n.toLocaleString('de-DE')} Coins.`)}>
            {n < 0 ? 'Abziehen' : 'Überweisen'}
          </Button>
        </div>
      )}

      {tab === 'items' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Field label="Artikel schenken">
              <Select value={giftItem} onChange={(e) => setGiftItem(e.target.value)}>
                <option value="">– Artikel wählen –</option>
                {(['avatar', 'color', 'effect', 'tag', 'theme'] as const).map((k) => (
                  <optgroup key={k} label={{ avatar: 'Profilbilder', color: 'Namensfarben', effect: 'Effekte', tag: 'Tags', theme: 'Designs' }[k]}>
                    {items.data?.filter((i) => i.kind === k).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={equip} onChange={(e) => setEquip(e.target.checked)} /> Gleich anziehen</label>
            <Button disabled={busy || !giftItem} onClick={() => void run(async () => { await adminGrantItem(userId, giftItem, equip); owned.reload() }, 'Artikel verschenkt.')}>Schenken</Button>
          </div>
          <div>
            <p className="label-mono mb-1">Besitzt</p>
            {owned.data?.length === 0 && <p className="text-sm text-slate-500">Keine Artikel.</p>}
            <ul className="space-y-1">
              {owned.data?.map((o) => (
                <li key={o.item_id} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm">
                  <span>{o.name}{o.equipped && <span className="ml-2 text-xs text-accent-cyan">getragen</span>}</span>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await adminRevokeItem(userId, o.item_id); owned.reload() }, 'Artikel entzogen.')}>Entziehen</Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab === 'points' && (
        <div className="space-y-3">
          <Field label="Ranglistenpunkte" hint="Plus oder Minus."><TextInput inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/[^\d-]/g, ''))} /></Field>
          <Button disabled={busy || !Number.isInteger(p) || p === 0} onClick={() => void run(() => adminAdjustPoints(userId, p, 'Schnellaktion'), `${name}: ${p > 0 ? '+' : ''}${p} Punkte.`)}>Buchen</Button>
        </div>
      )}
    </Modal>
  )
}
