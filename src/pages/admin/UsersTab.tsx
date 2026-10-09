import { useState } from 'react'
import { Ban, BookOpen, Crown, Gift, Plus, RotateCcw, ShieldCheck, ShieldOff, Trash2, UserCheck } from 'lucide-react'
import { ManageButton } from '../../components/admin/ManageUser'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { Field, Select, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import { formatBytes, formatDate, formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import {
  adminDeleteBook,
  adminAdjustPoints,
  adminDeleteUser,
  adminListPointAdjustments,
  adminListUserBooks,
  adminListUsers,
  adminResetProgress,
  adminSetBlocked,
  adminSetRole,
} from '../../services/admin'
import { adminGrantItem, adminListItems, adminListUserItems, adminRevokeItem } from '../../services/koins'
import type { AdminUser } from '../../types'

type Confirm =
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'block'; user: AdminUser }
  | { kind: 'points'; user: AdminUser }
  | { kind: 'gift'; user: AdminUser }
  | null

const ROLE_LABEL = { user: 'Nutzer', mod: 'Mod', alphamod: 'Alphamod', admin: 'Admin' } as const

/** Benutzerverwaltung (nur Admins): Rollen, Sperren, Zurücksetzen, Speicher einsehen und löschen. */
export default function UsersTab() {
  const { user: me, refreshProfile } = useAuth()
  const users = useAsync(adminListUsers, [])
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [pts, setPts] = useState('')
  const [ptsReason, setPtsReason] = useState('')
  const adjustments = useAsync(adminListPointAdjustments, [])
  const items = useAsync(adminListItems, [])
  const userItems = useAsync(() => (confirm?.kind === 'gift' ? adminListUserItems(confirm.user.user_id) : Promise.resolve([])), [confirm?.kind, confirm?.kind === 'gift' ? confirm.user.user_id : ''])
  const [giftItem, setGiftItem] = useState('')
  const [giftEquip, setGiftEquip] = useState(true)

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fn()
      setMessage(ok)
      setConfirm(null)
      users.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const total = (users.data ?? []).reduce((s, u) => s + Number(u.approx_bytes), 0)

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-400">
        Speicherangaben sind Schätzungen (Texte + Zeilenaufwand). Inhalte anderer Nutzer siehst du nicht, nur Anzahl und Größe.
        Admins werden ausschließlich per SQL in Supabase festgelegt.
      </p>
      {users.data && (
        <p className="text-sm text-slate-400">
          {users.data.length} Konten · zusammen ca. <span className="font-mono text-accent-cyan">{formatBytes(total)}</span>
        </p>
      )}
      {message && <Notice tone="ok">{message}</Notice>}
      {error && <ErrorBox message={error} />}
      {users.loading && !users.data && <Spinner />}
      {users.error && <ErrorBox message={users.error} onRetry={users.reload} />}

      {users.data?.map((u) => {
        const isMe = u.user_id === me?.id
        const protectedUser = isMe || u.role === 'admin'
        return (
          <div key={u.user_id} className={`glass rounded-2xl p-4 ${u.blocked ? 'border-rose-500/40' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {u.display_name}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      u.role === 'admin'
                        ? 'border-accent-violet/50 text-accent-violet'
                        : u.role === 'alphamod'
                          ? 'border-amber-300/60 text-amber-300'
                          : u.role === 'mod'
                          ? 'border-accent-cyan/40 text-accent-cyan'
                          : 'border-white/15 text-slate-400'
                    }`}
                  >
                    {ROLE_LABEL[u.role]}
                  </span>
                  {u.blocked && <span className="rounded-full border border-rose-500/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-300">Gesperrt</span>}
                  {isMe && <span className="text-xs font-normal text-slate-500">(du)</span>}
                </p>
                <p className="truncate text-xs text-slate-500">{u.email ?? 'ohne E-Mail'}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Seit {formatDate(u.created_at)} · zuletzt angemeldet {formatDateTime(u.last_sign_in_at)}
                </p>
              </div>
              <div className="text-right text-xs text-slate-400">
                <p className="font-mono text-sm text-accent-cyan">{formatBytes(Number(u.approx_bytes))}</p>
                <p className="font-mono text-xs text-amber-200">{u.koins} Coins</p>
                <p>
                  {u.book_count} Bücher{u.public_book_count > 0 ? ` (${u.public_book_count} online)` : ''} · {u.vocab_count} Vokabeln
                </p>
                <p>
                  {u.progress_count} Lernstände · {u.session_count} Runden · {u.answer_count} Antworten
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" onClick={() => setOpen(open === u.user_id ? null : u.user_id)}>
                <BookOpen size={15} /> Bücher
              </Button>
              <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" onClick={() => { setPts(''); setPtsReason(''); setConfirm({ kind: 'points', user: u }) }}>
                <Plus size={15} /> Punkte ±
              </Button>
              <ManageButton userId={u.user_id} name={u.display_name} onChanged={users.reload} />
              <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" onClick={() => { setGiftItem(''); setGiftEquip(true); setConfirm({ kind: 'gift', user: u }) }}>
                <Gift size={15} /> Artikel
              </Button>
              {!protectedUser && (
                <>
                  <Button
                    variant="secondary"
                    className="!min-h-[40px] !px-3 text-sm"
                    disabled={busy}
                    onClick={() => void run(() => adminSetRole(u.user_id, u.role === 'mod' ? 'user' : 'mod'), u.role === 'mod' ? 'Mod-Rechte entzogen.' : `${u.display_name} ist jetzt Mod.`)}
                  >
                    {u.role === 'mod' ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                    {u.role === 'mod' ? 'Mod entziehen' : 'Zum Mod machen'}
                  </Button>
                  <Button
                    variant="secondary"
                    className="!min-h-[40px] !px-3 text-sm"
                    disabled={busy}
                    onClick={() => void run(() => adminSetRole(u.user_id, u.role === 'alphamod' ? 'user' : 'alphamod'), u.role === 'alphamod' ? 'Alphamod-Rechte entzogen.' : `${u.display_name} ist jetzt Alphamod.`)}
                  >
                    <Crown size={15} /> {u.role === 'alphamod' ? 'Alphamod entziehen' : 'Zum Alphamod machen'}
                  </Button>
                  {u.blocked ? (
                    <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" disabled={busy} onClick={() => void run(() => adminSetBlocked(u.user_id, false), 'Konto entsperrt.')}>
                      <UserCheck size={15} /> Entsperren
                    </Button>
                  ) : (
                    <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" onClick={() => setConfirm({ kind: 'block', user: u })}>
                      <Ban size={15} /> Sperren
                    </Button>
                  )}
                  <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" onClick={() => setConfirm({ kind: 'reset', user: u })}>
                    <RotateCcw size={15} /> Zurücksetzen
                  </Button>
                  <Button variant="danger" className="!min-h-[40px] !px-3 text-sm" onClick={() => setConfirm({ kind: 'delete', user: u })}>
                    <Trash2 size={15} /> Konto löschen
                  </Button>
                </>
              )}
            </div>

            {open === u.user_id && <UserBooks userId={u.user_id} onChanged={users.reload} />}
          </div>
        )
      })}

      {confirm && (
        <Modal
          title={confirm.kind === 'gift' ? `Artikel von ${confirm.user.display_name}` : confirm.kind === 'points' ? `Ranglistenpunkte: ${confirm.user.display_name}` : confirm.kind === 'reset' ? 'Fortschritt zurücksetzen?' : confirm.kind === 'delete' ? 'Konto löschen?' : 'Konto sperren?'}
          onClose={() => setConfirm(null)}
        >
          {confirm.kind === 'points' && (
            <div className="space-y-3">
              <Field label="Punkte (minus zum Abziehen)" hint="z. B. 50 oder -20">
                <TextInput type="number" inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value)} />
              </Field>
              <Field label="Grund (optional)">
                <TextInput value={ptsReason} maxLength={200} onChange={(e) => setPtsReason(e.target.value)} />
              </Field>
              {adjustments.data && adjustments.data.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-400">
                  {adjustments.data.slice(0, 8).map((a) => (
                    <li key={a.id}>{a.display_name ?? '?'}: <span className={a.points > 0 ? 'text-emerald-300' : 'text-rose-300'}>{a.points > 0 ? '+' : ''}{a.points}</span> {a.reason && `· ${a.reason}`} · {formatDateTime(a.created_at)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {confirm.kind === 'gift' && (
            <div className="space-y-3">
              <Field label="Artikel" hint="Kostet den Nutzer nichts. Profilbilder, Farben, Effekte, Themes und Tags.">
                <Select value={giftItem} onChange={(e) => setGiftItem(e.target.value)}>
                  <option value="">Auswählen …</option>
                  {([['avatar', 'Profilbilder'], ['color', 'Farben'], ['effect', 'Effekte'], ['theme', 'Themes'], ['tag', 'Tags']] as const).map(([k, l]) => (
                    <optgroup key={k} label={l}>
                      {items.data?.filter((i) => i.kind === k).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={giftEquip} onChange={(e) => setGiftEquip(e.target.checked)} />
                Gleich anziehen (der Nutzer trägt es sofort)
              </label>
              <div>
                <p className="label-mono mb-2">Besitzt bereits</p>
                {userItems.loading && !userItems.data && <p className="text-sm text-slate-500">Lädt …</p>}
                {userItems.data?.length === 0 && <p className="text-sm text-slate-500">Noch keine Artikel.</p>}
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {userItems.data?.map((it) => (
                    <li key={it.item_id} className="flex min-h-[40px] items-center justify-between gap-2 rounded-lg bg-white/5 px-3 text-sm">
                      <span className="truncate">{it.name} <span className="text-xs text-slate-500">{it.equipped ? '· getragen' : ''}</span></span>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                        onClick={() => void adminRevokeItem(confirm.user.user_id, it.item_id).then(() => { userItems.reload(); if (confirm.user.user_id === me?.id) void refreshProfile() }).catch((e) => setError(errorMessage(e)))}
                      >
                        Entziehen
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {confirm.kind !== 'points' && confirm.kind !== 'gift' && <Notice tone="warn">
            {confirm.kind === 'reset' &&
              `Lernstände, Lernrunden, Antworten und Statistik von ${confirm.user.display_name} werden gelöscht. Konto und Bücher bleiben bestehen.`}
            {confirm.kind === 'delete' &&
              `${confirm.user.display_name} wird samt allen privaten Büchern und dem gesamten Lernfortschritt endgültig gelöscht. Öffentliche Bücher dieses Nutzers gehen an dich über. Das kann nicht rückgängig gemacht werden.`}
            {confirm.kind === 'block' &&
              `${confirm.user.display_name} kann sich nicht mehr anmelden und verliert sofort den Zugriff. Alle Daten bleiben erhalten; du kannst das Konto jederzeit entsperren.`}
          </Notice>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Abbrechen</Button>
            <Button
              variant={confirm.kind === 'points' || confirm.kind === 'gift' ? 'primary' : 'danger'}
              busy={busy}
              disabled={(confirm.kind === 'points' && !Number.isInteger(Number.parseInt(pts, 10))) || (confirm.kind === 'gift' && !giftItem)}
              onClick={() => {
                const u = confirm.user
                if (confirm.kind === 'reset') void run(() => adminResetProgress(u.user_id), `Fortschritt von ${u.display_name} zurückgesetzt.`)
                if (confirm.kind === 'delete') void run(() => adminDeleteUser(u.user_id), `${u.display_name} wurde gelöscht.`)
                if (confirm.kind === 'points') void run(async () => { await adminAdjustPoints(u.user_id, Number.parseInt(pts, 10), ptsReason); adjustments.reload() }, `${u.display_name}: ${Number.parseInt(pts, 10) > 0 ? '+' : ''}${pts} Punkte.`)
                if (confirm.kind === 'gift') void run(async () => { await adminGrantItem(u.user_id, giftItem, giftEquip); if (u.user_id === me?.id) await refreshProfile() }, `${u.display_name} hat den Artikel bekommen${giftEquip ? ' und trägt ihn jetzt' : ''}.`)
                if (confirm.kind === 'block') void run(() => adminSetBlocked(u.user_id, true), `${u.display_name} ist gesperrt.`)
              }}
            >
              {confirm.kind === 'gift' ? 'Schenken' : confirm.kind === 'points' ? 'Buchen' : confirm.kind === 'reset' ? 'Zurücksetzen' : confirm.kind === 'delete' ? 'Endgültig löschen' : 'Sperren'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function UserBooks({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const books = useAsync(() => adminListUserBooks(userId), [userId])
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(id: string) {
    if (pending !== id) {
      setPending(id)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await adminDeleteBook(id)
      setPending(null)
      books.reload()
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      {books.loading && !books.data && <Spinner />}
      {books.error && <ErrorBox message={books.error} onRetry={books.reload} />}
      {error && <ErrorBox message={error} />}
      {books.data && books.data.length === 0 && <p className="text-sm text-slate-500">Keine eigenen Bücher.</p>}
      {books.data?.map((b) => (
        <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-space-900/50 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {b.name} {b.is_public && <span className="text-xs text-accent-cyan">· online</span>}
            </p>
            <p className="text-xs text-slate-500">
              {b.language.toUpperCase()} · {b.vocab_count} Vokabeln · {b.page_count} Seiten · {formatBytes(Number(b.approx_bytes))}
            </p>
          </div>
          <Button
            variant="danger"
            busy={busy && pending === b.id}
            className="!min-h-[40px] !px-3 text-xs"
            onClick={() => void remove(b.id)}
          >
            {pending === b.id ? 'Sicher? Nochmal tippen' : <><Trash2 size={14} /> Löschen</>}
          </Button>
        </div>
      ))}
    </div>
  )
}
