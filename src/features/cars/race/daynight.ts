/** Tag-Nacht-Takt: 5 Minuten Tag, 5 Minuten Nacht, mit je ca. 16 Sekunden Übergang. Gemeinsame Uhr (UTC-Sekunden) für alle Spieler. */
export const DAY_SEC = 300
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** 0 = Tag, 1 = Nacht */
export function nightness(sec: number): number {
  const x = ((sec % (DAY_SEC * 2)) + DAY_SEC * 2) % (DAY_SEC * 2)
  if (x >= DAY_SEC / 2 && x < DAY_SEC * 1.5) return smooth(-8, 8, x - DAY_SEC)
  return 1 - smooth(-8, 8, x < DAY_SEC / 2 ? x : x - DAY_SEC * 2)
}
