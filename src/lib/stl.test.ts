import { describe, expect, it } from 'vitest'
import { mm3ToCm3, parseStl } from './stl'

/** Würfel mit Kantenlänge s (12 Dreiecke, nach außen zeigend). */
function cubeTriangles(s: number, ox = 0, oy = 0, oz = 0): number[][] {
  const v = (x: number, y: number, z: number) => [x * s + ox, y * s + oy, z * s + oz]
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [[...a, ...b, ...c], [...a, ...c, ...d]]
  return [
    ...quad(v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)), // unten (−z)
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)), // oben (+z)
    ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)), // −y
    ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)), // +y
    ...quad(v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)), // −x
    ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)), // +x
  ]
}

function toBinary(tris: number[][]): ArrayBuffer {
  const buf = new ArrayBuffer(84 + tris.length * 50)
  const dv = new DataView(buf)
  dv.setUint32(80, tris.length, true)
  tris.forEach((t, i) => {
    let o = 84 + i * 50 + 12
    for (const n of t) {
      dv.setFloat32(o, n, true)
      o += 4
    }
  })
  return buf
}

function toAscii(tris: number[][]): ArrayBuffer {
  const body = tris
    .map((t) => `facet normal 0 0 0\n outer loop\n  vertex ${t[0]} ${t[1]} ${t[2]}\n  vertex ${t[3]} ${t[4]} ${t[5]}\n  vertex ${t[6]} ${t[7]} ${t[8]}\n endloop\nendfacet`)
    .join('\n')
  return new TextEncoder().encode(`solid test\n${body}\nendsolid test\n`).buffer as ArrayBuffer
}

describe('parseStl', () => {
  it('liest einen binären Würfel: Volumen und Maße', () => {
    const m = parseStl(toBinary(cubeTriangles(10)))
    expect(m.triangles).toBe(12)
    expect(m.volumeMm3).toBeCloseTo(1000, 3)
    expect(mm3ToCm3(m.volumeMm3)).toBeCloseTo(1, 5)
    expect(m.size).toEqual({ x: 10, y: 10, z: 10 })
  })

  it('liest einen ASCII-Würfel gleich wie den binären', () => {
    const a = parseStl(toAscii(cubeTriangles(20, 5, 5, 5)))
    expect(a.volumeMm3).toBeCloseTo(8000, 2)
    expect(a.min).toEqual({ x: 5, y: 5, z: 5 })
  })

  it('Volumen hängt nicht von der Lage ab', () => {
    expect(parseStl(toBinary(cubeTriangles(10, -500, 300, 7))).volumeMm3).toBeCloseTo(1000, 0)
  })

  it('erkennt ASCII-Dateien, deren Kopf mit "solid" beginnt, auch wenn sie nicht binär sind', () => {
    expect(() => parseStl(toAscii([]))).toThrow(/gültige|Dreiecke/)
  })

  it('lehnt andere Dateien ab', () => {
    expect(() => parseStl(new TextEncoder().encode('Hallo Welt, das ist keine STL-Datei und viel zu kurz').buffer as ArrayBuffer)).toThrow(/keine gültige STL/)
    expect(() => parseStl(new ArrayBuffer(10))).toThrow(/keine gültige STL/)
  })

  it('lehnt Dateien mit ungültigen Zahlen ab', () => {
    const tri = cubeTriangles(10)
    tri[0][0] = NaN
    expect(() => parseStl(toBinary(tri))).toThrow(/ungültige/)
  })
})
