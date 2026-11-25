/* Service Worker: zeigt Push-Nachrichten an (auch bei geschlossener App) und öffnet beim Tippen die richtige Seite. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'Vokabeltrainer', body: event.data ? event.data.text() : '' } }
  const title = d.title || 'Vokabeltrainer'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || 'vokabeltrainer',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rel = (event.notification.data && event.notification.data.url) || '/'
  const target = new URL(rel.replace(/^\//, ''), self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.focus()
          if ('navigate' in c) return c.navigate(target)
          return undefined
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

/* Offline-Hülle: die App (Seiten, Skripte, Bilder, Schriften) wird zwischengespeichert, damit sie ohne Internet startet. Daten (Supabase) laufen nie über den Cache. */
const SHELL = 'vt-shell-v1'
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('vt-shell-') && k !== SHELL).map((k) => caches.delete(k))))))
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // Seite: erst Netz (immer die neueste Version), ohne Netz die gemerkte Startseite
    event.respondWith(fetch(req).then((res) => { const c = res.clone(); void caches.open(SHELL).then((ch) => ch.put(self.registration.scope, c)); return res }).catch(() => caches.match(self.registration.scope).then((r) => r || caches.match(req)).then((r) => r || new Response('Offline', { status: 503 }))))
    return
  }
  // Dateien: aus dem Cache, im Hintergrund erneuern
  event.respondWith(caches.open(SHELL).then((ch) => ch.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok) void ch.put(req, res.clone()); return res }).catch(() => hit || new Response('', { status: 504 }))
    return hit || net
  })))
})
