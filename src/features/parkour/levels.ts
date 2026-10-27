/**
 * Team-Parkour: Level als Kachelkarten (12 Zeilen hoch). Zeichen:
 *   # fester Block      ^ Stacheln (tödlich)      k Checkpoint        X Ausgang (beide müssen hinein)
 *   a b c  Druckplatte (Kanal a/b/c, gedrückt solange jemand darauf steht)
 *   A B C  Tür: zu, solange der Kanal nicht gedrückt ist
 *   J       Sprungpad (schleudert hoch, ca. 8 Kacheln)
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

export class Builder {
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
  /** Löscht Boden (Abgrund) von Spalte x0 bis x1. */
  clear(x0: number, x1: number): this { return this.rect(x0, 10, x1, 11, '.') }
  /** Boden (Zeilen 10 und 11) von Spalte x0 bis x1. */
  ground(x0: number, x1: number): this { return this.rect(x0, 10, x1, 11, '#') }
  spikes(x0: number, x1: number, y = 9): this { return this.rect(x0, y, x1, y, '^') }
  /** Schwebende Plattform (eine Kachel hoch) mit Oberkante in Zeile y. */
  plat(x0: number, x1: number, y: number): this { return this.rect(x0, y, x1, y, '#') }
  /** Block bis zum Boden, Oberkante in Zeile top. */
  pillar(x0: number, x1: number, top: number): this { return this.rect(x0, top, x1, 9, '#') }
  pad(x: number, y = 9): this { return this.set(x, y, 'J') }
  /** Ende (Spalte hinter der letzten Plattform) des zuletzt gebauten sky-Abschnitts. */
  skyEnd = 0
  /**
   * Höhen-Jump&Run: ab dem Sprungpad bei x schweben Plattformen in der Luft (tops = Zeile der Oberkante je Plattform, gaps = Lücke
   * davor). Mit pit fehlt darunter der Boden: Absturz = Stacheln. Ohne pit fällt man nur zurück auf den Boden und versucht es neu.
   */
  sky(x: number, tops: number[], gaps: number[], w = 2, pit = false): this {
    let c = x + 4
    tops.forEach((t, i) => {
      if (i > 0) c += gaps[i - 1] ?? 3
      this.plat(c, c + w - 1, t)
      c += w
    })
    this.skyEnd = c
    if (pit) this.clear(x + 1, c - 1)
    return this
  }
  plate(ch: string, x: number, y = 9): this { return this.set(x, y, ch) }
  /** Tür über die ganze Höhe (Zeile 0 bis 9), nicht überspringbar. */
  door(ch: string, x: number): this { return this.rect(x, 0, x, 9, ch.toUpperCase()) }
  bridge(ch: string, x0: number, x1: number, y = 8): this { return this.rect(x0, y, x1, y, String.fromCharCode(ch.charCodeAt(0) + 23)) }
  cp(x: number): this { return this.set(x, 9, 'k') }
  /** Platte – Tür – Platte (jeweils 4 Kacheln Abstand): einer hält, einer geht, dann hält der andere von drüben. */
  chain(ch: string, x: number): this { return this.plate(ch, x).door(ch, x + 4).plate(ch, x + 8) }
  /** Platte – 12 Kacheln Brücke über Stacheln – Platte. Die Brücke steht nur, solange jemand auf einer Platte steht. */
  bridgeGap(ch: string, x: number): this { return this.plate(ch, x).bridge(ch, x + 3, x + 14).spikes(x + 3, x + 14).plate(ch, x + 17) }
  /** Vier Stufen (je 2 Kacheln höher) hoch auf einen Turm mit Platte oben. */
  tower(ch: string, x: number, up = true): this {
    const xs = [x, x + 4, x + 8, x + 12]
    const tops = [8, 6, 4, 2]
    const t = xs.map((_, i) => tops[up ? i : 3 - i])
    xs.forEach((px, i) => this.pillar(px, px + 1, t[i]))
    // In den Lücken zwischen den Stufen liegen unten Stacheln: wer hineinfällt, startet am Checkpoint neu und steckt nicht fest
    for (let i = 0; i < 3; i++) this.spikes(xs[i] + 2, xs[i + 1] - 1)
    const top = up ? x + 12 : x
    return this.plate(ch, top, 1)
  }
  exit(x: number): this { return this.rect(x, 7, x + 1, 9, 'X') }
  /** Wie build, aber auf die ersten `cols` Spalten beschnitten. */
  buildCropped(cols: number, name: string, hint: string): Level {
    return parse(name, hint, this.g.map((r) => r.slice(0, cols).join('')))
  }
  build(name: string, hint: string): Level {
    const rows = this.g.map((r) => r.join(''))
    return parse(name, hint, rows)
  }
}

export function parse(name: string, hint: string, rows: string[]): Level {
  const cols = Math.max(...rows.map((r) => r.length))
  const padded = rows.map((r) => r.padEnd(cols, '.'))
  // Schluchten (kein Boden in Zeile 10 und 11) bekommen unten Stacheln: Absturz = Stacheln, sonst nichts kostet ein Herz.
  if (padded.length === ROWS) {
    const bottom = padded[ROWS - 1].split('')
    for (let x = 0; x < cols; x++) if (padded[ROWS - 2][x] === '.' && bottom[x] === '.') bottom[x] = '^'
    padded[ROWS - 1] = bottom.join('')
  }
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

const level1 = new Builder(86)
  .ground(0, 11).ground(15, 26).ground(27, 85)
  .spikes(20, 21)
  .cp(29)
  .plate('a', 33).door('a', 38).plate('a', 42)
  .cp(44)
  .pillar(47, 48, 7).plate('b', 47, 6).door('b', 54).plate('b', 58)
  .cp(61)
  .pad(63).pillar(67, 70, 3)
  .exit(79)
  .build('1 · Aufwärmen', 'Eine Platte hält die Tür offen. Einer hält, einer geht durch und hält von drüben für den anderen. Spring zweimal (Doppelsprung) auf die Säule. Am Ende wartet ein Sprungpad: tritt darauf, steuere nach rechts und lande oben auf der hohen Mauer.')

const level2 = new Builder(122)
  .ground(0, 8)
  .plat(11, 13, 8).plat(17, 19, 7).plat(23, 24, 8).plat(28, 30, 7)
  .ground(33, 121)
  .cp(35)
  .plate('a', 38).bridge('a', 41, 52).spikes(41, 52).plate('a', 55)
  .cp(57)
  .plate('c', 60).door('c', 64).plate('c', 68)
  .spikes(71, 73)
  .plate('a', 77).door('a', 81).plate('a', 85)
  .cp(87)
  .pillar(90, 91, 7).plate('b', 90, 6).door('b', 95).plate('b', 98)
  .cp(101).pad(104).spikes(105, 107).pillar(108, 111, 3)
  .exit(116)
  .build('2 · Schlucht', 'Die Brücke steht nur, solange jemand auf der Platte steht. Danach hält der andere von der anderen Seite. Mit Doppelsprung (Sprungknopf zweimal) kommt ihr auf hohe Blöcke. Vor der letzten Mauer liegen Stacheln: das Sprungpad trägt euch darüber.')

const level3 = new Builder(140)
  .ground(0, 139)
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
  .cp(109).pad(111).sky(111, [4, 3, 4, 3], [3, 3, 3], 2, false)
level3.exit(level3.skyEnd + 4)
const level3b = level3.build('3 · Gipfel', 'Alles zusammen: Treppen, lange Brücke und viele Türen. Am Ende geht es mit dem Sprungpad hoch hinauf: springt von Plattform zu Plattform über den Wolken. Wer fällt, landet unten und probiert es nochmal.')


const level4 = new Builder(140)
  .ground(0, 8)
  .plat(11, 12, 8).plat(16, 17, 7).plat(21, 22, 6).plat(26, 27, 7).plat(31, 32, 8).plat(36, 37, 7).plat(41, 42, 8)
  .ground(46, 139)
  .cp(48)
  .spikes(52, 55).chain('a', 58)
  .cp(68)
  .spikes(72, 74).spikes(77, 79).cp(80)
  .pillar(82, 83, 7).plate('b', 82, 6).door('b', 88).plate('b', 91)
  .cp(93)
  .chain('c', 96).spikes(106, 107)
  .cp(109).pad(111).sky(111, [4, 3, 2, 3], [3, 4, 3], 2, true)
level4.exit(level4.skyEnd + 5)
const level4b = level4.build('4 · Zacken', 'Schmale Plattformen über dem Abgrund und breitere Stachelfelder. Zwei Sprünge hintereinander sind hier Pflicht. Am Ende trägt euch das Sprungpad in die Höhe: unter den Plattformen lauern jetzt Stacheln, ein Absturz kostet ein Herz.')

const level5 = new Builder(150)
  .ground(0, 149)
  .cp(8)
  .tower('a', 10).door('a', 26).pillar(31, 32, 7).plate('a', 31, 6)
  .cp(36).spikes(40, 43)
  .tower('b', 44).door('b', 61).cp(63).pillar(66, 67, 7).plate('b', 66, 6)
  .spikes(75, 78)
  .cp(80)
  .bridgeGap('c', 82)
  .cp(102).pad(104).spikes(105, 108).pillar(109, 112, 3)
  .cp(114).pad(117).spikes(118, 120).pillar(121, 125, 3)
  .exit(130)
  .build('5 · Turm', 'Auf dem Turm liegt eine Platte, die die Tür offen hält. Hinter der Tür hält der andere die Tür von einer niedrigen Säule aus offen. Am Ende braucht ihr zweimal das Sprungpad: über die Stacheln auf die Mauer, und gleich danach noch einmal über breitere Stacheln auf eine noch höhere Mauer.')

const level6 = new Builder(150)
  .ground(0, 149)
  .cp(12)
  .plate('a', 16).bridge('a', 19, 30).spikes(19, 30).plate('a', 33).cp(34).plate('b', 36)
  .bridge('b', 39, 50).spikes(39, 50).plate('b', 53).cp(55)
  .chain('c', 58).spikes(69, 72).chain('a', 75)
  .cp(85)
  .pillar(88, 89, 8).pillar(92, 93, 6).plate('b', 92, 5).door('b', 99).plate('b', 102)
  .cp(104).spikes(107, 109)
  .cp(112).pad(114).sky(114, [4, 3, 2, 3, 4], [4, 3, 4, 3], 2, true)
level6.exit(level6.skyEnd + 4)
const level6b = level6.build('6 · Doppelbrücke', 'Auf der Mittelinsel gibt es zwei Platten: erst hält einer die erste Brücke, dann der andere die zweite. Zum Schluss geht es mit dem Sprungpad hoch über eine lange Plattformreihe, darunter Stacheln.')

const level7 = new Builder(124)
  .ground(0, 123)
  .cp(10)
  .spikes(14, 17).spikes(20, 23).spikes(25, 29).spikes(32, 34)
  .cp(37)
  .chain('a', 40).bridgeGap('b', 51)
  .cp(70)
  .chain('c', 73).spikes(84, 88)
  .pillar(91, 92, 7).plate('b', 91, 6).door('b', 97).plate('b', 100)
  .spikes(103, 104).cp(106)
  .spikes(109, 113).spikes(116, 118)
  .exit(121)
  .build('7 · Stachelfeld', 'Viele Stacheln hintereinander. Zwischen den Feldern bleiben nur kleine sichere Inseln, plant eure Sprünge.')

const level8 = new Builder(150)
  .ground(0, 149)
  .cp(10)
  .spikes(14, 17).spikes(20, 23)
  .cp(26)
  .tower('a', 30).door('a', 47).pillar(52, 53, 7).plate('a', 52, 6).spikes(58, 62).cp(70)
  .bridgeGap('c', 74).plate('b', 94).cp(92)
  .bridge('b', 97, 108).spikes(97, 108).plate('b', 111).cp(113)
  .chain('a', 116).spikes(127, 131)
  .chain('c', 134)
  .exit(146)
  .build('8 · Finale', 'Türme, Doppelbrücke, Türketten und Stachelfelder in einem Lauf. Wer hier ankommt, ist ein echtes Team.')

export const LEVELS: Level[] = [level1, level2, level3b, level4b, level5, level6b, level7, level8]
