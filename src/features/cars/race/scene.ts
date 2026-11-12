import type * as T from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { project, type Track } from './track'

type THREE = typeof import('three')

interface Theme { sky: number; fog: number; ground: number; road: number; hill: number; tree: number[]; sun: number; night?: boolean }
const THEMES: Record<string, Theme> = {
  gras: { sky: 0x7ec8ff, fog: 0xbfe3ff, ground: 0x3f8f3a, road: 0x3a3d45, hill: 0x4c7a4a, tree: [0x2f7d32, 0x3f9142, 0x256f2c], sun: 1.25 },
  herbst: { sky: 0xf0b078, fog: 0xf3cfa0, ground: 0x7a8a3a, road: 0x3b3a40, hill: 0x8a6a3a, tree: [0xc8651b, 0xd9922e, 0xa84a1a], sun: 1.1 },
  schnee: { sky: 0xb9d7f2, fog: 0xe2eef8, ground: 0xeaf2f8, road: 0x454a52, hill: 0xc9d8e6, tree: [0x2c5d4a, 0x3a7260, 0x244d3e], sun: 1.15 },
  stadt: { sky: 0x8fb4d8, fog: 0xc4d2e0, ground: 0x6b6f73, road: 0x2f3136, hill: 0x8f98a3, tree: [0x4a8a4a, 0x5c9a58, 0x3d7b3d], sun: 1.1 },
  wueste: { sky: 0xffd9a0, fog: 0xf7dfb8, ground: 0xd9b46b, road: 0x4a4540, hill: 0xb98a4e, tree: [0x6f8f3a, 0x7d9a45, 0x5d7a30], sun: 1.4 },
  nacht: { sky: 0x0b1030, fog: 0x121a45, ground: 0x182338, road: 0x22252d, hill: 0x1b2748, tree: [0x1a3a40, 0x1d4a4f, 0x15343a], sun: 0.35, night: true },
}

function stripeTex(THREE: THREE, a: string, b: string, n = 2): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 8 * n; c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = a; g.fillRect(0, 0, c.width, 32); g.fillStyle = b; g.fillRect(0, 32, c.width, 32)
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace
  return t
}

function roadTex(THREE: THREE, base: number): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#' + base.toString(16).padStart(6, '0'); g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2) }
  g.fillStyle = '#e9edf5'
  g.fillRect(6, 0, 5, 256); g.fillRect(245, 0, 5, 256)             // Randlinien
  for (let y = 0; y < 256; y += 64) g.fillRect(125, y, 6, 32)        // gestrichelte Mittellinie
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  return t
}

/** Band entlang der Strecke zwischen zwei seitlichen Versätzen (lat0 → lat1) in Höhe y; v-Wiederholung pro `tile` Meter. */
function ribbon(THREE: THREE, t: Track, lat0: number, lat1: number, y: number, tile: number, y1 = y): T.BufferGeometry {
  const n = t.n
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let i = 0; i <= n; i++) {
    const k = i % n
    const nx = -t.tz[k], nz = t.tx[k]
    pos.push(t.x[k] + nx * lat0, y, t.z[k] + nz * lat0, t.x[k] + nx * lat1, y1, t.z[k] + nz * lat1)
    const v = (i * (t.length / n)) / tile
    uv.push(0, v, 1, v)
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export interface RaceScene {
  scene: T.Scene
  sun: T.DirectionalLight
  theme: Theme
  /** Auto-Modell (Blickrichtung +z). */
  makeCar: (kind: string, color: string, name: string, isMe: boolean) => T.Group
}

export function buildScene(THREE: THREE, t: Track): RaceScene {
  const th = THEMES[t.def.theme] ?? THEMES.gras
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(th.sky)
  scene.fog = new THREE.Fog(th.fog, 140, 620)
  scene.add(new THREE.HemisphereLight(th.night ? 0x4a5a9a : 0xdfeeff, th.ground, th.night ? 0.55 : 1.0))
  const sun = new THREE.DirectionalLight(th.night ? 0x8fa6ff : 0xfff2d6, th.sun)
  sun.position.set(120, 220, 80)
  scene.add(sun)

  // Himmel: großer Farbverlauf und Sonne/Mond
  const sc = document.createElement('canvas'); sc.width = 4; sc.height = 256
  const sg = sc.getContext('2d')!
  const gr = sg.createLinearGradient(0, 0, 0, 256)
  gr.addColorStop(0, '#' + new THREE.Color(th.sky).multiplyScalar(th.night ? 0.5 : 0.75).getHexString()); gr.addColorStop(0.6, '#' + th.fog.toString(16).padStart(6, '0')); gr.addColorStop(1, '#' + th.fog.toString(16).padStart(6, '0'))
  sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256)
  const skyTex = new THREE.CanvasTexture(sc); skyTex.colorSpace = THREE.SRGBColorSpace
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }))
  scene.add(dome)
  const orb = new THREE.Mesh(new THREE.SphereGeometry(th.night ? 26 : 34, 16, 12), new THREE.MeshBasicMaterial({ color: th.night ? 0xeaf0ff : 0xfff3c4, fog: false }))
  orb.position.set(420, 330, 520)
  scene.add(orb)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05
  scene.add(ground)

  // Straße, Randsteine, Leitplanken
  const half = t.def.width / 2
  const tex = roadTex(THREE, th.road)
  const rt = tex.clone(); rt.needsUpdate = true
  const road = new THREE.Mesh(ribbon(THREE, t, -half, half, 0.02, 24), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.92, side: THREE.DoubleSide }))
  scene.add(road)
  const curbTex = stripeTex(THREE, '#e11d48', '#f8fafc')
  for (const sgn of [-1, 1] as const) {
    const a = sgn * half, b = sgn * (half + 1.6)
    scene.add(new THREE.Mesh(ribbon(THREE, t, Math.min(a, b), Math.max(a, b), 0.05, 2.4), new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.8, side: THREE.DoubleSide })))
    const gA = sgn * (half + 4.5)
    scene.add(new THREE.Mesh(ribbon(THREE, t, gA, gA, 0, 6, 1.1), new THREE.MeshStandardMaterial({ color: th.night ? 0x4a5a8a : 0xb8c2cc, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide })))
    // Randstreifen neben der Leitplanke
    const shoulder = sgn * (half + 1.6)
    scene.add(new THREE.Mesh(ribbon(THREE, t, Math.min(shoulder, sgn * (half + 4.5)), Math.max(shoulder, sgn * (half + 4.5)), 0.01, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color(th.ground).multiplyScalar(0.85), roughness: 1, side: THREE.DoubleSide })))
  }

  // Startlinie (Schachbrett) und Torbogen
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32
  const cg = cv.getContext('2d')!
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { cg.fillStyle = (x + y) % 2 ? '#0b0b0b' : '#f8fafc'; cg.fillRect(x * 8, y * 8, 8, 8) }
  const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace
  const line = new THREE.Mesh(new THREE.PlaneGeometry(t.def.width, 4), new THREE.MeshBasicMaterial({ map: ct }))
  line.position.set(t.x[0], 0.06, t.z[0])
  line.rotation.order = 'YXZ'
  line.rotation.set(-Math.PI / 2, Math.atan2(t.tx[0], t.tz[0]), 0)
  scene.add(line)
  const gate = new THREE.Group()
  const poleM = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 })
  for (const sgn of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2), poleM); p.position.set(sgn * (half + 2.5), 4.5, 0); gate.add(p) }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(t.def.width + 7, 2.6, 1.2), new THREE.MeshBasicMaterial({ map: ct }))
  bar.position.set(0, 9, 0); gate.add(bar)
  gate.position.set(t.x[0], 0, t.z[0])
  gate.rotation.y = Math.atan2(t.tx[0], t.tz[0])
  scene.add(gate)

  // Kurvenschilder: Pfeile außen in engen Kurven (zeigen die Kurvenrichtung schon von Weitem)
  const arrowCv = document.createElement('canvas'); arrowCv.width = 128; arrowCv.height = 128
  const ag = arrowCv.getContext('2d')!
  ag.fillStyle = '#facc15'; ag.fillRect(0, 0, 128, 128); ag.fillStyle = '#111'; ag.fillRect(8, 8, 112, 112); ag.fillStyle = '#facc15'
  ag.beginPath(); ag.moveTo(34, 24); ag.lineTo(94, 64); ag.lineTo(34, 104); ag.lineTo(52, 64); ag.closePath(); ag.fill()
  const arrowTex = new THREE.CanvasTexture(arrowCv); arrowTex.colorSpace = THREE.SRGBColorSpace
  const signGeo = new THREE.PlaneGeometry(4, 4)
  const signMat = new THREE.MeshBasicMaterial({ map: arrowTex, side: THREE.DoubleSide, fog: true })
  const signMatL = signMat.clone(); const tl = arrowTex.clone(); tl.repeat.x = -1; tl.offset.x = 1; tl.needsUpdate = true; signMatL.map = tl
  const step = Math.max(1, Math.round(10 / (t.length / t.n)))
  for (let i = 0; i < t.n; i += step) {
    const kk = t.k[i]
    if (Math.abs(kk) < 0.0075) continue
    const outer = kk > 0 ? -1 : 1   // Rechtskurve → außen = links
    const nx = -t.tz[i], nz = t.tx[i]
    const lat = outer * (half + 7)
    const s = new THREE.Mesh(signGeo, kk > 0 ? signMat : signMatL)
    s.position.set(t.x[i] + nx * lat, 3.6, t.z[i] + nz * lat)
    s.lookAt(s.position.x - t.tx[i] * 20, 3.6, s.position.z - t.tz[i] * 20)
    scene.add(s)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x555b66 }))
    post.position.set(s.position.x, 1.8, s.position.z)
    scene.add(post)
  }

  // Landschaft: Bäume/Felsen/Häuser abseits der Strecke, Berge am Horizont
  const rnd = (() => { let a = 1234 + t.def.id * 977; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 } })()
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 })
  const treeMats = th.tree.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }))
  const coneGeo = new THREE.ConeGeometry(3.2, 9, 7), trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6)
  const rockGeo = new THREE.DodecahedronGeometry(3, 0), rockMat = new THREE.MeshStandardMaterial({ color: th.hill, roughness: 1, flatShading: true })
  const houseGeo = new RoundedBoxGeometry(12, 14, 12, 2, 0.6)
  const cityMats = [0x9aa5b4, 0xb7a58f, 0x8896ab].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
  const placed: Array<[number, number]> = []
  for (let k = 0, tries = 0; k < 360 && tries < 2600; tries++) {
    const x = (rnd() - 0.5) * 760, z = (rnd() - 0.5) * 760
    const p = project(t, x, z)
    if (p.dist < half + 14) continue
    if (placed.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 36)) continue
    placed.push([x, z]); k++
    if (t.def.theme === 'stadt' && p.dist < half + 90) {
      const h = new THREE.Mesh(houseGeo, cityMats[Math.floor(rnd() * 3)])
      const sc2 = 0.8 + rnd() * 1.6
      h.scale.set(1, sc2, 1); h.position.set(x, 7 * sc2, z); h.rotation.y = Math.atan2(t.tx[p.i], t.tz[p.i])
      scene.add(h); continue
    }
    if (t.def.theme === 'wueste' && rnd() < 0.5) { const r = new THREE.Mesh(rockGeo, rockMat); const s2 = 0.6 + rnd() * 2; r.scale.set(s2, s2 * (0.7 + rnd()), s2); r.position.set(x, s2, z); r.rotation.y = rnd() * 6; scene.add(r); continue }
    const g = new THREE.Group()
    const cone = new THREE.Mesh(coneGeo, treeMats[Math.floor(rnd() * treeMats.length)]); cone.position.y = 7.5
    const tr = new THREE.Mesh(trunkGeo, trunk); tr.position.y = 1.5
    g.add(tr, cone)
    const s3 = 0.7 + rnd() * 0.9
    g.scale.setScalar(s3); g.position.set(x, 0, z)
    scene.add(g)
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: th.hill, roughness: 1, flatShading: true })
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, d = 620 + rnd() * 160
    const h = 90 + rnd() * 160
    const m = new THREE.Mesh(new THREE.ConeGeometry(120 + rnd() * 90, h, 7), hillMat)
    m.position.set(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d)
    scene.add(m)
  }
  if (th.night) {
    // Leuchtstreifen am Rand
    const glow = new THREE.MeshBasicMaterial({ color: 0x38f8ff })
    for (let i = 0; i < t.n; i += 3) for (const sgn of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.8), glow)
      m.position.set(t.x[i] - t.tz[i] * sgn * (half + 1.9), 0.4, t.z[i] + t.tx[i] * sgn * (half + 1.9))
      m.rotation.y = Math.atan2(t.tx[i], t.tz[i])
      scene.add(m)
    }
  }

  const makeCar = (kind: string, color: string, name: string, isMe: boolean) => buildCar(THREE, kind, color, name, isMe)
  return { scene, sun, theme: th, makeCar }
}

interface Body { len: number; wid: number; hgt: number; cabLen: number; cabH: number; cabZ: number; wheelR: number; spoiler?: boolean; bed?: boolean; open?: boolean; tall?: boolean }
const BODIES: Record<string, Body> = {
  kleinwagen: { len: 3.9, wid: 1.8, hgt: 0.75, cabLen: 2.1, cabH: 0.7, cabZ: -0.1, wheelR: 0.36 },
  limousine: { len: 4.8, wid: 1.9, hgt: 0.72, cabLen: 2.5, cabH: 0.62, cabZ: -0.2, wheelR: 0.38 },
  kombi: { len: 4.8, wid: 1.9, hgt: 0.78, cabLen: 3.2, cabH: 0.7, cabZ: -0.45, wheelR: 0.38 },
  suv: { len: 4.7, wid: 2.0, hgt: 0.95, cabLen: 3.0, cabH: 0.78, cabZ: -0.35, wheelR: 0.5, tall: true },
  pickup: { len: 5.3, wid: 2.0, hgt: 0.95, cabLen: 1.9, cabH: 0.75, cabZ: 0.7, wheelR: 0.5, bed: true },
  cabrio: { len: 4.3, wid: 1.85, hgt: 0.65, cabLen: 1.4, cabH: 0.4, cabZ: 0.1, wheelR: 0.38, open: true },
  sportwagen: { len: 4.5, wid: 1.95, hgt: 0.55, cabLen: 1.9, cabH: 0.5, cabZ: -0.1, wheelR: 0.37, spoiler: true },
  bus: { len: 6.6, wid: 2.2, hgt: 1.7, cabLen: 6.2, cabH: 0.3, cabZ: 0, wheelR: 0.5, tall: true },
}

function nameSprite(THREE: THREE, name: string, y: number): T.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64
  const g = c.getContext('2d')!
  g.font = 'bold 32px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#000b'; g.fillText(name.slice(0, 14), 129, 44); g.fillStyle = '#fff'; g.fillText(name.slice(0, 14), 128, 42)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }))
  s.scale.set(5, 1.25, 1); s.position.y = y; s.renderOrder = 10
  return s
}

/** Schönes Auto aus abgerundeten Teilen: Karosserie, Kabine mit Glas, Räder mit Felgen, Lichter, je Art Besonderheiten. */
function buildCar(THREE: THREE, kind: string, color: string, name: string, isMe: boolean): T.Group {
  const b = BODIES[kind] ?? BODIES.kleinwagen
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.55 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x15202e, roughness: 0.05, metalness: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.7 })
  const clearance = b.wheelR * 0.75
  const body = new THREE.Mesh(new RoundedBoxGeometry(b.wid, b.hgt, b.len, 4, 0.22), paint)
  body.position.y = clearance + b.hgt / 2
  g.add(body)
  if (b.cabH > 0.35 && !b.open) {
    const cab = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.86, b.cabH, b.cabLen, 4, 0.2), glass)
    cab.position.set(0, clearance + b.hgt + b.cabH / 2 - 0.06, b.cabZ)
    const roof = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.84, 0.08, b.cabLen * 0.82, 2, 0.04), paint)
    roof.position.set(0, clearance + b.hgt + b.cabH - 0.02, b.cabZ)
    g.add(cab, roof)
  } else if (b.open) {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.7, 0.22, b.cabLen, 2, 0.08), dark); seat.position.set(0, clearance + b.hgt + 0.02, b.cabZ)
    const ws = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.84, 0.32, 0.08, 2, 0.03), glass); ws.position.set(0, clearance + b.hgt + 0.25, b.cabZ + b.cabLen / 2); ws.rotation.x = -0.5
    g.add(seat, ws)
  }
  if (b.bed) {
    const bed = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.92, 0.5, 2.2, 2, 0.06), dark)
    bed.position.set(0, clearance + b.hgt + 0.1, -1.4)
    g.add(bed)
  }
  if (b.spoiler) {
    const w = new THREE.Mesh(new RoundedBoxGeometry(b.wid * 0.95, 0.07, 0.5, 2, 0.03), dark); w.position.set(0, clearance + b.hgt + 0.55, -b.len / 2 + 0.3)
    for (const sx of [-0.7, 0.7]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.14), dark); p.position.set(sx, clearance + b.hgt + 0.3, -b.len / 2 + 0.3); g.add(p) }
    g.add(w)
  }
  // Rennstreifen
  if (kind === 'sportwagen' || kind === 'cabrio') {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, b.len * 0.98), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }))
    st.position.set(0, clearance + b.hgt + 0.115, 0); g.add(st)
  }
  // Räder
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.25, metalness: 0.9 })
  const wheels: T.Group[] = []
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const w = new THREE.Group()
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(b.wheelR, b.wheelR, 0.34, 20), tyre); tr.rotation.z = Math.PI / 2
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(b.wheelR * 0.62, b.wheelR * 0.62, 0.36, 12), rim); rm.rotation.z = Math.PI / 2
    w.add(tr, rm)
    w.position.set(sx * (b.wid / 2 - 0.05), b.wheelR, sz * (b.len / 2 - b.wheelR * 1.5))
    w.name = sz > 0 ? 'front' : 'rear'
    g.add(w); wheels.push(w)
  }
  // Lichter
  const head = new THREE.MeshBasicMaterial({ color: 0xfff6c8 }), tail = new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.06), head); h.position.set(sx * b.wid * 0.34, clearance + b.hgt * 0.6, b.len / 2 + 0.01)
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), tail); r.position.set(sx * b.wid * 0.34, clearance + b.hgt * 0.65, -b.len / 2 - 0.01)
    g.add(h, r)
  }
  // weicher Schatten
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(b.wid * 1.25, b.len * 1.12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.07
  g.add(sh)
  if (!isMe) g.add(nameSprite(THREE, name, b.hgt + b.cabH + 2.2))
  g.userData.wheels = wheels
  g.userData.wheelR = b.wheelR
  return g
}
