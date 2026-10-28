/** Auftritte im Parkour: Admins wählen im Shop, Mods nur die vom Admin freigegebenen. */
export type Look = 'blackhole' | 'hammer' | 'piano' | 'guitar'

export interface HoleAnim {
  x: number
  y: number
  /** Sekunden seit dem Start */
  t: number
  /** in = die Figur erscheint, out = die Figur verschwindet */
  kind: 'in' | 'out'
  lv: number
  face: 1 | -1
  look: Look
  /** Oberkante des sichtbaren Bildes in Weltkoordinaten (plus Rand): Animationen bleiben auch in hohen Ebenen im Bild. */
  top?: number
}
