import { useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import Button from '../../components/ui/Button'
import { ErrorBox, Notice } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { currentSubscription, disablePush, enablePush, getPushStatus, pushSupport, pushTest, type PushStatus } from '../../services/push'

/** Schalter für Push-Nachrichten auf diesem Gerät, auch wenn die App geschlossen ist. */
export default function PushSettings() {
  const support = pushSupport()
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    try {
      setStatus(await getPushStatus())
      setOn(!!(await currentSubscription()))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  useEffect(() => { void load() }, [])

  async function toggle() {
    if (!status?.public_key) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      if (on) {
        await disablePush()
        setMsg('Push-Nachrichten sind auf diesem Gerät aus.')
      } else {
        await enablePush(status.public_key)
        setMsg('Eingeschaltet. Schick dir gleich eine Test-Nachricht.')
      }
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const sent = await pushTest()
      setMsg(sent ? 'Test gesendet. Sperre das Gerät oder schließe die App, dann kommt die Mitteilung in wenigen Sekunden.' : 'Es konnte nichts gesendet werden. Ist Push auf dem Server eingerichtet?')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-space-900/50 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-slate-100"><BellRing size={16} className="text-accent-cyan" aria-hidden /> Mitteilungen auch bei geschlossener App</p>
      <p className="text-xs text-slate-400">Du bekommst @-Erwähnungen, Geflüster, Nachrichten vom Team und „Druck fertig“ als echte Mitteilung, auch wenn die App zu ist. Es gelten deine Schalter oben. Ist die App gerade offen, kommt stattdessen der Hinweis am Rand.</p>
      {support === 'ios-install' && (
        <Notice tone="warn">Auf dem iPad geht das nur, wenn du die App zum Home-Bildschirm hinzufügst: In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“, und die App dort öffnen. Dafür brauchst du iPadOS 16.4 oder neuer.</Notice>
      )}
      {(support === 'no-sw' || support === 'no-push') && <Notice tone="warn">Dieser Browser unterstützt keine Push-Nachrichten.</Notice>}
      {support === 'ok' && status && !status.configured && <Notice tone="warn">Push ist auf dem Server noch nicht eingerichtet. Sag deinem Admin Bescheid.</Notice>}
      {error && <ErrorBox message={error} />}
      {msg && <Notice tone="ok">{msg}</Notice>}
      {support === 'ok' && status?.configured && (
        <div className="flex flex-wrap gap-2">
          <Button variant={on ? 'secondary' : 'primary'} busy={busy} onClick={() => void toggle()}>{on ? 'Auf diesem Gerät ausschalten' : 'Auf diesem Gerät einschalten'}</Button>
          {on && <Button variant="secondary" busy={busy} onClick={() => void test()}>Test-Nachricht senden</Button>}
        </div>
      )}
      {status && status.devices > 0 && <p className="text-xs text-slate-500">{status.devices} Gerät{status.devices === 1 ? '' : 'e'} angemeldet.</p>}
    </div>
  )
}
