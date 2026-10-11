/** STL-Dateien lesen (binär und ASCII): Dreiecke, Maße und Volumen. Einheit ist Millimeter. */

export interface StlMesh {
  /** 9 Zahlen je Dreieck (x1 y1 z1 x2 y2 z2 x3 y3 z3). */
  positions: Float32Array
  triangles: number
  /** Volumen in mm³ (aus der Hülle berechnet; bei offenen Netzen nur ein Näherungswert). */
  volumeMm3: number
  /** Kantenlängen der Umhüllenden in mm. */
  size: { x: number; y: number; z: number }
  min: { x: number; y: number; z: number }
}

export const MAX_TRIANGLES = 1_500_000

function isBinaryStl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false
  const n = new DataView(buf).getUint32(80, true)
  return 84 + n * 50 === buf.byteLength
}

function finish(positions: Float32Array): StlMesh {
  const triangles = positions.length / 9
  if (triangles < 1) throw new Error('In der Datei sind keine Dreiecke.')
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let vol = 0
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]
    for (let k = 0; k < 9; k += 3) {
      const x = positions[i + k], y = positions[i + k + 1], z = positions[i + k + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
    // Vorzeichenbehaftetes Tetraeder-Volumen zum Ursprung: a · (b × c) / 6
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ, vol].every(Number.isFinite)) throw new Error('Die Datei enthält ungültige Zahlen.')
  return {
    positions,
    triangles,
    volumeMm3: Math.abs(vol),
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    min: { x: minX, y: minY, z: minZ },
  }
}

function parseBinary(buf: ArrayBuffer): StlMesh {
  const dv = new DataView(buf)
  const n = dv.getUint32(80, true)
  if (n > MAX_TRIANGLES) throw new Error('Die Datei ist zu komplex (zu viele Dreiecke).')
  const out = new Float32Array(n * 9)
  let o = 84
  for (let t = 0; t < n; t++) {
    o += 12 // Normale überspringen
    for (let k = 0; k < 9; k++) {
      out[t * 9 + k] = dv.getFloat32(o, true)
      o += 4
    }
    o += 2
  }
  return finish(out)
}

function parseAscii(text: string): StlMesh {
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g
  const nums: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    nums.push(Number(m[1]), Number(m[2]), Number(m[3]))
    if (nums.length / 9 > MAX_TRIANGLES) throw new Error('Die Datei ist zu komplex (zu viele Dreiecke).')
  }
  if (nums.length === 0 || nums.length % 9 !== 0) throw new Error('Das ist keine gültige STL-Datei.')
  return finish(Float32Array.from(nums))
}

/** Liest eine STL-Datei. Wirft eine deutsche Fehlermeldung, wenn sie nicht lesbar ist. */
export function parseStl(buf: ArrayBuffer): StlMesh {
  if (isBinaryStl(buf)) return parseBinary(buf)
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 512))).trimStart().toLowerCase()
  if (head.startsWith('solid')) return parseAscii(new TextDecoder().decode(buf))
  throw new Error('Das ist keine gültige STL-Datei.')
}

export const mm3ToCm3 = (mm3: number) => mm3 / 1000
