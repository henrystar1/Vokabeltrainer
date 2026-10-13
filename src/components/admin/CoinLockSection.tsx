import { useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import Button from '../ui/Button'
import { TextInput } from '../ui/Field'
import { ErrorBox, Notice } from '../ui/States'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { adminCoinLocks, adminSetCoinLock } from '../../services/koins'

/** Coins einer Person sperren: nur noch Gambling und Spiele, kein Kaufen, kein Verschenken. */
export default function CoinLockSection({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const locks = useAsync(adminCoinLocks, [])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const current = locks.data?.find((l) => l.user_id === userId)

  async function set(locked: boolean) {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      await adminSetCoinLock(userId, locked, note)
      setMsg(locked ? 'Coins gesperrt.' : 'Coins entsperrt.')
      setNote('')
      locks.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (isAdmin) return null
  return (
    <section className="space-y-2">
      <h3 className="label-mono flex items-center gap-2"><Lock size={13} /> Coin-Sperre</h3>
      {current ? (
        <>
          <Notice tone="warn">Seit {formatDateTime(current.locked_at)} gesperrt{current.note ? `: ${current.note}` : ''}. {name} kann nur noch spielen und gamblen.</Notice>
          <Button variant="secondary" className="!min-h-[40px] !px-3 text-sm" busy={busy} onClick={() => void set(false)}><Unlock size={15} /> Entsperren</Button>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500">Gesperrte Personen können nichts mehr kaufen oder verschenken. Gambling und Spiele gehen weiter, Gewinne und Belohnungen kommen an.</p>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput className="!min-h-[40px] min-w-[10rem] flex-1" maxLength={200} placeholder="Grund (sieht die Person)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Grund" />
            <Button variant="danger" className="!min-h-[40px] !px-3 text-sm" busy={busy}
              onClick={() => { if (window.confirm(`Coins von ${name} sperren?`)) void set(true) }}><Lock size={15} /> Sperren</Button>
          </div>
        </>
      )}
      {msg && <Notice tone="ok">{msg}</Notice>}
      {error && <ErrorBox message={error} />}
    </section>
  )
}
