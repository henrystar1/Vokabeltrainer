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
