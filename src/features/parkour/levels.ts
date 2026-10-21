/**
 * Team-Parkour: Level als Kachelkarten (12 Zeilen hoch). Zeichen:
 *   # fester Block      ^ Stacheln (tödlich)      k Checkpoint        X Ausgang (beide müssen hinein)
 *   a b c  Druckplatte (Kanal a/b/c, gedrückt solange jemand darauf steht)
 *   A B C  Tür: zu, solange der Kanal nicht gedrückt ist
 *   x y z  Brücke: nur da, solange Kanal a/b/c gedrückt ist
 * Alles ist so gebaut, dass man es nur zu zweit schafft (Platte halten, Räuberleiter, Brücke halten).
 */
export const TILE = 32
export const ROWS = 12
export const VIEW_W = 704
export const VIEW_H = ROWS * TILE

export interface Level {
  name: string
  hint: string
  cols: number
  rows: string[]
  plates: Array<{ ch: string; x: number; y: number }>
  checkpoints: number[]
  exit: { x: number; y: number; w: number; h: number }
}

class Builder {
  readonly g: string[][]
  constructor(readonly cols: number) {
    this.g = Array.from({ length: ROWS }, () => Array<string>(cols).fill('.'))
  }
  set(x: number, y: number, ch: string): this {
    if (x >= 0 && x < this.cols && y >= 0 && y < ROWS) this.g[y][x] = ch
    return this
  }
  rect(x0: number, y0: number, x1: number, y1: number, ch: string): this {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, ch)
    return this
  }
  /** Boden (Zeilen 10 und 11) von Spalte x0 bis x1. */
  ground(x0: number, x1: number): this { return this.rect(x0, 10, x1, 11, '#') }
  spikes(x0: number, x1: number, y = 9): this { return this.rect(x0, y, x1, y, '^') }
  /** Schwebende Plattform (eine Kachel hoch) mit Oberkante in Zeile y. */
  plat(x0: number, x1: number, y: number): this { return this.rect(x0, y, x1, y, '#') }
  /** Block bis zum Boden, Oberkante in Zeile top. */
  pillar(x0: number, x1: number, top: number): this { return this.rect(x0, top, x1, 9, '#') }
  plate(ch: string, x: number, y = 9): this { return this.set(x, y, ch) }
  /** Tür über die ganze Höhe (Zeile 0 bis 9), nicht überspringbar. */
  door(ch: string, x: number): this { return this.rect(x, 0, x, 9, ch.toUpperCase()) }
  bridge(ch: string, x0: number, x1: number, y = 8): this { return this.rect(x0, y, x1, y, String.fromCharCode(ch.charCodeAt(0) + 23)) }
  cp(x: number): this { return this.set(x, 9, 'k') }
  exit(x: number): this { return this.rect(x, 7, x + 1, 9, 'X') }
  build(name: string, hint: string): Level {
    const rows = this.g.map((r) => r.join(''))
    return parse(name, hint, rows)
  }
}

export function parse(name: string, hint: string, rows: string[]): Level {
  const cols = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => r.padEnd(cols, '.'))
  const plates: Level['plates'] = []
  const checkpoints: number[] = []
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
  padded.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = row[x]
      if (ch === 'a' || ch === 'b' || ch === 'c') plates.push({ ch, x, y })
      else if (ch === 'k') checkpoints.push(x)
      else if (ch === 'X') { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    }
  })
  return { name, hint, cols, rows: padded, plates, checkpoints, exit: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } }
}

const level1 = new Builder(72)
  .ground(0, 11).ground(15, 26).ground(27, 71)
  .spikes(20, 21)
  .cp(29)
  .plate('a', 33).door('a', 38).plate('a', 42)
  .cp(44)
  .pillar(47, 48, 7).plate('b', 47, 6).door('b', 54).plate('b', 58)
  .cp(61)
  .exit(66)
  .build('1 · Aufwärmen', 'Eine Platte hält die Tür offen. Einer hält, einer geht durch und hält von drüben für den anderen. Spring zweimal (Doppelsprung) auf die Säule. Noch höher geht es mit Räuberleiter: spring auf den Kopf deines Partners.')

const level2 = new Builder(104)
  .ground(0, 8)
  .plat(11, 13, 8).plat(17, 19, 7).plat(23, 24, 8).plat(28, 30, 7)
  .ground(33, 103)
  .cp(35)
  .plate('a', 38).bridge('a', 41, 52).spikes(41, 52).plate('a', 55)
  .cp(57)
  .plate('c', 60).door('c', 64).plate('c', 68)
  .spikes(71, 73)
  .plate('a', 77).door('a', 81).plate('a', 85)
  .cp(87)
  .pillar(90, 91, 7).plate('b', 90, 6).door('b', 95).plate('b', 98)
  .exit(101)
  .build('2 · Schlucht', 'Die Brücke steht nur, solange jemand auf der Platte steht. Danach hält der andere von der anderen Seite. Mit Doppelsprung (Sprungknopf zweimal) kommt ihr auf hohe Blöcke.')

const level3 = new Builder(110)
  .ground(0, 109)
  .pillar(13, 14, 8).pillar(17, 18, 6).pillar(21, 34, 4)
  .spikes(27, 28, 3)
  .cp(37)
  .plate('a', 40).bridge('a', 43, 54).spikes(43, 54).plate('a', 57)
  .cp(59)
  .pillar(62, 63, 7).plate('b', 62, 6).door('b', 67).plate('b', 70)
  .cp(72)
  .plate('c', 74).door('c', 78).plate('c', 81)
  .spikes(84, 85)
  .plate('a', 88).door('a', 93).plate('a', 96)
  .cp(97)
  .pillar(99, 100, 7).plate('b', 99, 6).door('b', 104).plate('b', 106)
  .exit(108)
  .build('3 · Gipfel', 'Alles zusammen: Treppen, lange Brücke und viele Türen. Stacheln und Abgründe bringen euch zum Checkpoint zurück.')

export const LEVELS: Level[] = [level1, level2, level3]
