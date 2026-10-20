/**
 * Hält das fokussierte Eingabefeld sichtbar, wenn die Bildschirmtastatur (iPad/Handy) aufgeht.
 * Safari scrollt sonst manchmal weit nach unten oder lässt das Feld unter der Tastatur.
 */
export function installKeepFocusVisible(): () => void {
  const vv = window.visualViewport
  let timer = 0

  const isField = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement

  const reveal = () => {
    const el = document.activeElement
    if (!isField(el)) return
    const r = el.getBoundingClientRect()
    const top = vv?.offsetTop ?? 0
    const height = vv?.height ?? window.innerHeight
    if (r.top < top + 8 || r.bottom > top + height - 8) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }
  const later = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(reveal, 320)
  }

  document.addEventListener('focusin', later)
  vv?.addEventListener('resize', later)
  return () => {
    window.clearTimeout(timer)
    document.removeEventListener('focusin', later)
    vv?.removeEventListener('resize', later)
  }
}
