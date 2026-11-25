/** Registriert den Service Worker (nötig für Push-Nachrichten bei geschlossener App). Fehler sind unkritisch. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined)
  })
}

/** Holt die neueste Version: App-Zwischenspeicher leeren, Service Worker abmelden und die Seite neu laden (Daten und Anmeldung bleiben erhalten). */
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
  } catch { /* trotzdem neu laden */ }
  window.location.reload()
}
