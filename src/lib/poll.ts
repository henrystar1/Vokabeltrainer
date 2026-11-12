/** Wiederkehrende Abfrage, die nur läuft, solange der Tab sichtbar ist (spart Anfragen und damit Logs/Traffic beim Backend). */
export function every(fn: () => void, ms: number): number {
  return window.setInterval(() => { if (document.visibilityState === 'visible') fn() }, ms)
}
