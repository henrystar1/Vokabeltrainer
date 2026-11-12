/**
 * Wiederkehrende Hintergrund-Abfrage, die Anfragen (und damit Logs/Traffic beim Backend) spart:
 * - läuft nur bei sichtbarem Tab,
 * - ohne Bedienung (Tippen/Klicken/Wischen) seit 90 s nur noch bei jedem 4. Takt,
 * - ohne Bedienung seit 5 min gar nicht mehr (beim nächsten Tippen läuft sie spätestens im nächsten Takt wieder an).
 */
export const IDLE_SLOW_MS = 90_000
export const IDLE_STOP_MS = 300_000

let lastActivity = Date.now()
let hooked = false
function hook() {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  let t = 0
  const touch = () => { const n = Date.now(); if (n - t > 1000) { t = n; lastActivity = n } }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'pointermove']) window.addEventListener(ev, touch, { passive: true, capture: true })
}

export const idleMs = (now = Date.now()) => now - lastActivity

/** Soll ein Takt jetzt wirklich abfragen? (rein, testbar) */
export function shouldRun(idle: number, tick: number, visible: boolean): boolean {
  if (!visible) return false
  if (idle > IDLE_STOP_MS) return false
  if (idle > IDLE_SLOW_MS && tick % 4 !== 0) return false
  return true
}

export function every(fn: () => void, ms: number): number {
  hook()
  let tick = 0
  return window.setInterval(() => {
    tick++
    if (shouldRun(idleMs(), tick, document.visibilityState === 'visible')) fn()
  }, ms)
}
