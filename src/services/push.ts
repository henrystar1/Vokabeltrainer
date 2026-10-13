import { rpc } from './rpc'

/** Web Push: Geräte anmelden, damit Nachrichten auch bei geschlossener App ankommen (z. B. iPad). */

export interface PushStatus { configured: boolean; public_key: string | null; devices: number }
export const getPushStatus = () => rpc<PushStatus>('push_status')
export const pushTest = () => rpc<boolean>('push_test')
const pushSubscribeRpc = (endpoint: string, p256dh: string, auth: string, ua: string) =>
  rpc<void>('push_subscribe', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_ua: ua })
const pushUnsubscribeRpc = (endpoint: string | null) => rpc<void>('push_unsubscribe', { p_endpoint: endpoint })

export interface PushOverview {
  url: boolean
  public_key: boolean
  secret: boolean
  pg_net: boolean
  devices: number
  users: number
  log: { title: string; status: string; created_at: string; name: string | null }[]
}
export const adminPushOverview = () => rpc<PushOverview>('admin_push_overview')

/** VAPID-Schlüssel (URL-sicheres Base64) → Bytes für die Push-Anmeldung. */
export function urlBase64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export type PushSupport = 'ok' | 'no-sw' | 'no-push' | 'ios-install'

/** Kann dieses Gerät Push? Auf dem iPad geht es nur, wenn die App zum Home-Bildschirm hinzugefügt wurde (iOS ab 16.4). */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'no-sw'
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  if (ios && !standalone) return 'ios-install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'no-push'
  return 'ok'
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Fragt nach Erlaubnis (muss durch einen Klick ausgelöst werden), meldet das Gerät an und speichert es. */
export async function enablePush(publicKey: string): Promise<void> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Die Erlaubnis für Mitteilungen wurde nicht erteilt. Du kannst sie in den Einstellungen von iPadOS/Browser ändern.')
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) as BufferSource })
  }
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!json.endpoint || !p256dh || !auth) throw new Error('Das Gerät hat keine gültige Push-Anmeldung geliefert.')
  await pushSubscribeRpc(json.endpoint, p256dh, auth, navigator.userAgent.slice(0, 180))
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (sub) {
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => false)
    await pushUnsubscribeRpc(endpoint)
  } else {
    await pushUnsubscribeRpc(null)
  }
}
