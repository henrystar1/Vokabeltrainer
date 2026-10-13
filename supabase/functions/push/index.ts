// Edge Function „push“: verschickt eine Web-Push-Nachricht an alle Geräte einer Person.
// Aufgerufen von der Datenbank (pg_net) mit dem geheimen Header x-push-secret. Einrichtung: README.md
// @ts-nocheck – läuft in Deno (Supabase), nicht im Vite-Build.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, message: 'POST nötig' }, 405)
  const secret = Deno.env.get('PUSH_SECRET') ?? ''
  if (!secret || req.headers.get('x-push-secret') !== secret) return json({ ok: false, message: 'Nicht erlaubt' }, 401)

  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
  const priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  if (!pub || !priv) return json({ ok: false, message: 'VAPID-Schlüssel fehlen' }, 500)

  let msg: { user_id?: string; title?: string; body?: string; url?: string; tag?: string }
  try {
    msg = await req.json()
  } catch {
    return json({ ok: false, message: 'Ungültige Anfrage' }, 400)
  }
  if (!msg.user_id || !msg.title) return json({ ok: false, message: 'user_id und title nötig' }, 400)

  webpush.setVapidDetails(subject, pub, priv)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: subs, error } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', msg.user_id)
  if (error) return json({ ok: false, message: error.message }, 500)

  const payload = JSON.stringify({ title: msg.title, body: msg.body ?? '', url: msg.url ?? '/', tag: msg.tag ?? 'vokabeltrainer' })
  let sent = 0
  const dead: string[] = []
  await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) dead.push(s.id)
    }
  }))
  if (dead.length) await db.from('push_subscriptions').delete().in('id', dead)
  if (sent) await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('user_id', msg.user_id)
  return json({ ok: true, sent, removed: dead.length })
})
