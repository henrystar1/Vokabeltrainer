import type * as T from 'three'
import { isBike } from '../stats'
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
  /** Himmel, Boden und Berge: wandert jedes Bild mit der Kamera mit (große Strecken). */
  follow: T.Group
  /** Schaden (0–100), Driftwinkel und Zeit sichtbar machen: dunkler, verbeult, Rauch, Reifenqualm. */
  damageCar: (g: T.Group, dmg: number, slip: number, v: number, time: number) => void
}

export function buildScene(THREE: THREE, t: Track): RaceScene {
  const th = THEMES[t.def.theme] ?? THEMES.gras
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(th.sky)
  scene.fog = new THREE.Fog(th.fog, 200, 1100)
  const follow = new THREE.Group()
  scene.add(follow)
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
  follow.add(dome)
  const orb = new THREE.Mesh(new THREE.SphereGeometry(th.night ? 26 : 34, 16, 12), new THREE.MeshBasicMaterial({ color: th.night ? 0xeaf0ff : 0xfff3c4, fog: false }))
  orb.position.set(420, 330, 520)
  follow.add(orb)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05
  follow.add(ground)

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
  const coneGeo = new THREE.ConeGeometry(3.2, 9, 7), trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6)
  const rockGeo = new THREE.DodecahedronGeometry(3, 0), rockMat = new THREE.MeshStandardMaterial({ color: th.hill, roughness: 1, flatShading: true })
  const houseGeo = new RoundedBoxGeometry(12, 14, 12, 2, 0.6)
  const cityMats = [0x9aa5b4, 0xb7a58f, 0x8896ab].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
  // Bäume, Felsen, Häuser entlang der Strecke (als Instanzen: wenige Zeichenaufrufe, auch bei 15 km)
  const spacing = Math.max(14, t.length / 700)
  const slots: Array<{ x: number; z: number; i: number }> = []
  for (let s0 = 0; s0 < t.length; s0 += spacing) {
    const i = Math.min(t.n - 1, Math.floor((s0 / t.length) * t.n))
    const side = rnd() < 0.5 ? -1 : 1
    const lat = side * (half + 14 + rnd() * (t.def.theme === 'stadt' ? 70 : 150))
    const x = t.x[i] - t.tz[i] * lat, z = t.z[i] + t.tx[i] * lat
    if (project(t, x, z, i).dist < half + 12) continue
    slots.push({ x, z, i })
  }
  const dummy = new THREE.Object3D()
  const place = (mesh: T.InstancedMesh, k: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, ry, 0); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix)
  }
  const trees: typeof slots = [], rocks: typeof slots = [], houses: typeof slots = []
  for (const sl of slots) {
    if (t.def.theme === 'stadt' && project(t, sl.x, sl.z, sl.i).dist < half + 90) houses.push(sl)
    else if (t.def.theme === 'wueste' && rnd() < 0.5) rocks.push(sl)
    else trees.push(sl)
  }
  if (trees.length) {
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), trees.length)
    const trunks = new THREE.InstancedMesh(trunkGeo, trunk, trees.length)
    trees.forEach((tr, k) => {
      const s3 = 0.7 + rnd() * 0.9
      place(cones, k, tr.x, 7.5 * s3, tr.z, s3, s3, s3, 0); place(trunks, k, tr.x, 1.5 * s3, tr.z, s3, s3, s3, 0)
      cones.setColorAt(k, new THREE.Color(th.tree[Math.floor(rnd() * th.tree.length)]))
    })
    scene.add(cones, trunks)
  }
  if (rocks.length) {
    const im = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length)
    rocks.forEach((r, k) => { const s2 = 0.6 + rnd() * 2; place(im, k, r.x, s2, r.z, s2, s2 * (0.7 + rnd()), s2, rnd() * 6) })
    scene.add(im)
  }
  if (houses.length) {
    const im = new THREE.InstancedMesh(houseGeo, cityMats[0], houses.length)
    houses.forEach((h, k) => { const s2 = 0.8 + rnd() * 1.6; place(im, k, h.x, 7 * s2, h.z, 1, s2, 1, Math.atan2(t.tx[h.i], t.tz[h.i])); im.setColorAt(k, new THREE.Color(cityMats[Math.floor(rnd() * 3)].color)) })
    scene.add(im)
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: th.hill, roughness: 1, flatShading: true })
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, d = 620 + rnd() * 160
    const h = 90 + rnd() * 160
    const m = new THREE.Mesh(new THREE.ConeGeometry(120 + rnd() * 90, h, 7), hillMat)
    m.position.set(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d)
    follow.add(m)
  }
  if (th.night) {
    // Leuchtstreifen am Rand
    const glowGeo = new THREE.BoxGeometry(0.5, 0.5, 1.8)
    const cnt = Math.ceil(t.n / 3) * 2
    const gl = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0x38f8ff }), cnt)
    let q = 0
    for (let i = 0; i < t.n; i += 3) for (const sgn of [-1, 1]) {
      place(gl, q++, t.x[i] - t.tz[i] * sgn * (half + 1.9), 0.4, t.z[i] + t.tx[i] * sgn * (half + 1.9), 1, 1, 1, Math.atan2(t.tx[i], t.tz[i]))
    }
    gl.count = q
    scene.add(gl)
  }

  const makeCar = (kind: string, color: string, name: string, isMe: boolean) => buildCar(THREE, kind, color, name, isMe)
  return { scene, sun, theme: th, makeCar, follow, damageCar: (g, dmg, slip, v, time) => damageCar(THREE, g, dmg, slip, v, time) }
}

interface Body { len: number; wid: number; hgt: number; cabLen: number; cabH: number; cabZ: number; wheelR: number; spoiler?: boolean; bed?: boolean; open?: boolean; tall?: boolean; cage?: boolean; scoop?: boolean; formula?: boolean; track?: number; wheelW?: number; stripe?: boolean }
const BODIES: Record<string, Body> = {
  kleinwagen: { len: 3.9, wid: 1.8, hgt: 0.75, cabLen: 2.1, cabH: 0.7, cabZ: -0.1, wheelR: 0.36 },
  limousine: { len: 4.8, wid: 1.9, hgt: 0.72, cabLen: 2.5, cabH: 0.62, cabZ: -0.2, wheelR: 0.38 },
  kombi: { len: 4.8, wid: 1.9, hgt: 0.78, cabLen: 3.2, cabH: 0.7, cabZ: -0.45, wheelR: 0.38 },
  suv: { len: 4.7, wid: 2.0, hgt: 0.95, cabLen: 3.0, cabH: 0.78, cabZ: -0.35, wheelR: 0.5, tall: true },
  pickup: { len: 5.3, wid: 2.0, hgt: 0.95, cabLen: 1.9, cabH: 0.75, cabZ: 0.7, wheelR: 0.5, bed: true },
  cabrio: { len: 4.3, wid: 1.85, hgt: 0.65, cabLen: 1.4, cabH: 0.4, cabZ: 0.1, wheelR: 0.38, open: true },
  sportwagen: { len: 4.5, wid: 1.95, hgt: 0.55, cabLen: 1.9, cabH: 0.5, cabZ: -0.1, wheelR: 0.37, spoiler: true },
  bus: { len: 6.6, wid: 2.2, hgt: 1.7, cabLen: 6.2, cabH: 0.3, cabZ: 0, wheelR: 0.5, tall: true },
  oldtimer: { len: 4.4, wid: 1.8, hgt: 0.85, cabLen: 1.8, cabH: 0.8, cabZ: -0.2, wheelR: 0.42, tall: true },
  buggy: { len: 3.4, wid: 1.9, hgt: 0.4, cabLen: 1.2, cabH: 0, cabZ: -0.1, wheelR: 0.55, open: true, cage: true },
  monstertruck: { len: 4.8, wid: 2.4, hgt: 1.15, cabLen: 2.1, cabH: 0.85, cabZ: -0.3, wheelR: 1.15, tall: true },
  muscle: { len: 4.9, wid: 1.95, hgt: 0.68, cabLen: 1.9, cabH: 0.5, cabZ: -0.55, wheelR: 0.41, scoop: true, stripe: true },
  rallye: { len: 4.1, wid: 1.85, hgt: 0.82, cabLen: 2.2, cabH: 0.6, cabZ: -0.2, wheelR: 0.41, spoiler: true, scoop: true },
  gt: { len: 4.7, wid: 2.0, hgt: 0.5, cabLen: 1.8, cabH: 0.45, cabZ: -0.1, wheelR: 0.39, spoiler: true, stripe: true },
  hypercar: { len: 4.6, wid: 2.05, hgt: 0.42, cabLen: 1.6, cabH: 0.4, cabZ: 0, wheelR: 0.39, spoiler: true, stripe: true },
  rennwagen: { len: 5.0, wid: 0.9, hgt: 0.42, cabLen: 0.8, cabH: 0.35, cabZ: -0.2, wheelR: 0.42, formula: true, track: 1.85, wheelW: 0.55 },
  roadster: { len: 4.2, wid: 1.85, hgt: 0.5, cabLen: 1.0, cabH: 0.3, cabZ: -0.1, wheelR: 0.37, open: true, stripe: true },
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
  if (isBike(kind)) return buildBike(THREE, kind, color, name, isMe)
  if (kind === 'supercar') return buildSupercar(THREE, color, name, isMe)
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
  if (b.cage) {
    const bar = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.3 })
    for (const sx of [-0.8, 0.8]) for (const [z0, z1] of [[-0.7, -0.3], [0.5, 0.2]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), bar); p.position.set(sx, clearance + b.hgt + 0.5, (z0 + z1) / 2); p.rotation.x = (z1 - z0) * 0.9; g.add(p)
    }
    for (const z of [-0.5, 0.35]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), bar); t.rotation.z = Math.PI / 2; t.position.set(0, clearance + b.hgt + 1.05, z); g.add(t) }
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.5, 0.7, 2, 0.1), dark); seat.position.set(0, clearance + b.hgt + 0.25, -0.15); g.add(seat)
  }
  if (b.scoop) {
    const sc = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.2, 0.9, 2, 0.08), dark)
    sc.position.set(0, clearance + b.hgt + 0.1, b.len * 0.22)
    g.add(sc)
  }
  if (b.formula) {
    const nose = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 1.6, 3, 0.14), paint); nose.position.set(0, clearance + 0.38, b.len / 2 - 0.5); g.add(nose)
    const fw = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.07, 0.45, 2, 0.03), dark); fw.position.set(0, 0.2, b.len / 2 + 0.1); g.add(fw)
    for (const sx of [-0.55, 0.55]) { const pod = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 1.8, 3, 0.15), paint); pod.position.set(sx, clearance + 0.3, -0.2); g.add(pod) }
    const rw = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.07, 0.5, 2, 0.03), dark); rw.position.set(0, clearance + 1.05, -b.len / 2 + 0.2); g.add(rw)
    for (const sx of [-0.4, 0.4]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.2), dark); p.position.set(sx, clearance + 0.75, -b.len / 2 + 0.25); g.add(p) }
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 })); helmet.position.set(0, clearance + 0.78, -0.1); g.add(helmet)
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 14, Math.PI), dark); halo.rotation.set(0, Math.PI / 2, 0); halo.position.set(0, clearance + 0.7, 0.05); g.add(halo)
  }
  // Rennstreifen
  if (b.stripe || kind === 'sportwagen' || kind === 'cabrio') {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, b.len * 0.98), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 }))
    st.position.set(0, clearance + b.hgt + 0.115, 0); g.add(st)
  }
  // Räder
  const tyre = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9 })
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.25, metalness: 0.9 })
  const wheels: T.Group[] = []
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const w = new THREE.Group()
    const ww = b.wheelW ?? 0.34
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(b.wheelR, b.wheelR, ww, 20), tyre); tr.rotation.z = Math.PI / 2
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(b.wheelR * 0.62, b.wheelR * 0.62, ww + 0.02, 12), rim); rm.rotation.z = Math.PI / 2
    w.add(tr, rm)
    w.position.set(sx * ((b.track ?? b.wid) / 2 - 0.05), b.wheelR, sz * (b.len / 2 - b.wheelR * 1.5))
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
  if (kind === 'roadster') {
    // Düsen unter dem Heck: nur im Flug sichtbar
    const jets = new THREE.Group()
    const flame = new THREE.MeshBasicMaterial({ color: 0x60e6ff, transparent: true, opacity: 0.9 })
    for (const sx of [-0.55, 0.55]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 10), flame); f.rotation.x = -Math.PI / 2; f.position.set(sx, 0.35, -b.len / 2 - 0.55); jets.add(f) }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(b.wid * 1.1, b.len * 0.9), new THREE.MeshBasicMaterial({ color: 0x60e6ff, transparent: true, opacity: 0.35, depthWrite: false }))
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; jets.add(glow)
    jets.visible = false
    g.add(jets); g.userData.jets = jets
  }
  g.userData.wheels = wheels
  g.userData.paint = paint
  g.userData.paint0 = new THREE.Color(color)
  g.userData.body = body
  g.userData.len = b.len
  g.userData.wid = b.wid
  g.userData.wheelR = b.wheelR
  return g
}

/** Zeigt Beschädigung (dunkler Lack, schiefe Karosserie, Rauch, Feuer) und Reifenqualm beim Driften. */
function damageCar(THREE: THREE, g: T.Group, dmg: number, slip: number, v: number, time: number): void {
  const d = Math.min(1, dmg / 100)
  const paint = g.userData.paint as T.MeshStandardMaterial | undefined
  const body = g.userData.body as T.Mesh | undefined
  if (paint && body) {
    paint.color.copy(g.userData.paint0 as T.Color).lerp(new THREE.Color(0x1c1c1c), d * 0.7)
    body.rotation.z = Math.sin(g.id * 12.9) * d * 0.09
    body.rotation.x = d * 0.05
    body.scale.set(1 - d * 0.06, 1 - d * 0.1, 1 - d * 0.08)
  }
  type Puff = T.Mesh & { userData: { ph: number } }
  let puffs = g.userData.puffs as Puff[] | undefined
  if (!puffs) {
    const geo = new THREE.SphereGeometry(0.45, 8, 6)
    puffs = Array.from({ length: 14 }, (_, k) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0, depthWrite: false })) as unknown as Puff
      m.userData.ph = k / 14; m.visible = false; g.add(m); return m
    })
    g.userData.puffs = puffs
  }
  const len = (g.userData.len as number) ?? 4.5, wid = (g.userData.wid as number) ?? 1.9
  const smoke = d > 0.4, fire = d > 0.85, tyre = Math.abs(slip) > 0.2 && v > 10
  puffs.forEach((m, k) => {
    const on = smoke || tyre
    m.visible = on
    if (!on) return
    const ph = (time * (fire ? 1.6 : 1) + m.userData.ph) % 1
    const mat = m.material as T.MeshBasicMaterial
    if (smoke && (k % 2 === 0 || !tyre)) {
      m.position.set((Math.sin(k * 3.1) * 0.3), 0.8 + ph * 2.6, len / 2 - 0.4 - ph * 1.2)
      m.scale.setScalar(0.6 + ph * 1.8)
      mat.color.set(fire ? (ph < 0.4 ? 0xff7a1a : 0x2a2a2a) : 0x555555)
      mat.opacity = (1 - ph) * (fire ? 0.85 : 0.55)
    } else {
      const side = k % 4 < 2 ? -1 : 1
      m.position.set(side * wid * 0.45, 0.25 + ph * 0.5, -len / 2 + 0.3 - ph * 1.4)
      m.scale.setScalar(0.5 + ph * 1.6)
      mat.color.set(0xdddddd)
      mat.opacity = (1 - ph) * 0.5
    }
  })
}

const tyreMat = (THREE: THREE) => new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.9 })

/** Motorrad (Sportbike, Chopper, Crossbike): Fahrer, Tank, Gabel, Lenker. Alles in `lean`, damit es sich in Kurven neigt. */
function buildBike(THREE: THREE, kind: string, color: string, name: string, isMe: boolean): T.Group {
  const g = new THREE.Group()
  const lean = new THREE.Group()
  g.add(lean)
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.6, metalness: 0.3 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.2, metalness: 0.9 })
  const suit = new THREE.MeshStandardMaterial({ color: kind === 'chopper' ? 0x3b2a1a : 0x1f2937, roughness: 0.7 })
  const helm = new THREE.MeshStandardMaterial({ color: kind === 'crossbike' ? 0xf8fafc : 0xfacc15, roughness: 0.25, metalness: 0.2 })
  const cfg = kind === 'chopper' ? { r: 0.36, wb: 2.1, fork: 0.5, bar: 1.15 } : kind === 'crossbike' ? { r: 0.4, wb: 1.35, fork: 0.35, bar: 1.2 } : { r: 0.33, wb: 1.4, fork: 0.35, bar: 0.95 }
  const wheels: T.Group[] = []
  for (const sz of [1, -1]) {
    const w = new THREE.Group()
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(cfg.r, cfg.r, 0.17, 20), tyreMat(THREE)); tr.rotation.z = Math.PI / 2
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(cfg.r * 0.62, cfg.r * 0.62, 0.19, 12), chrome); rm.rotation.z = Math.PI / 2
    w.add(tr, rm)
    w.position.set(0, cfg.r, sz * cfg.wb / 2)
    w.name = sz > 0 ? 'front' : 'rear'
    lean.add(w); wheels.push(w)
  }
  // Rahmen, Motor, Tank, Sitz, Heck
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.28, cfg.wb * 0.62, 2, 0.05), dark); frame.position.set(0, cfg.r + 0.34, -0.05); lean.add(frame)
  const engine = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.34, 0.5, 2, 0.08), kind === 'chopper' ? chrome : dark); engine.position.set(0, cfg.r + 0.2, 0.05); lean.add(engine)
  const tank = new THREE.Mesh(new RoundedBoxGeometry(0.32, kind === 'chopper' ? 0.22 : 0.28, 0.6, 3, 0.1), paint); tank.position.set(0, cfg.r + 0.64, cfg.wb * 0.14); lean.add(tank)
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.1, 0.7, 2, 0.04), dark); seat.position.set(0, cfg.r + 0.56, -cfg.wb * 0.17); lean.add(seat)
  if (kind === 'sportbike') {
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.2, 0.7, 3, 0.09), paint); tail.position.set(0, cfg.r + 0.68, -cfg.wb * 0.38); tail.rotation.x = 0.25; lean.add(tail)
    const fair = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.45, 3, 0.14), paint); fair.position.set(0, cfg.r + 0.68, cfg.wb / 2 - 0.2); lean.add(fair)
    const ws = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.26, 0.05, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0x15202e, roughness: 0.05, metalness: 0.9 })); ws.position.set(0, cfg.r + 0.98, cfg.wb / 2 - 0.35); ws.rotation.x = -0.6; lean.add(ws)
  } else {
    const fender = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.05, 0.7, 2, 0.02), paint); fender.position.set(0, cfg.r * 2 + (kind === 'crossbike' ? 0.18 : 0.06), cfg.wb / 2 + (kind === 'crossbike' ? 0.1 : 0)); lean.add(fender)
    const rf = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.05, 0.8, 2, 0.02), paint); rf.position.set(0, cfg.r * 2 + 0.05, -cfg.wb / 2); lean.add(rf)
  }
  // Gabel und Lenker
  for (const sx of [-0.09, 0.09]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, cfg.r + cfg.bar * 0.55 + cfg.fork, 6), chrome)
    f.position.set(sx, cfg.r + (cfg.bar * 0.55) / 2 + cfg.fork / 2 - 0.1, cfg.wb / 2 - (kind === 'chopper' ? 0.35 : 0.14)); f.rotation.x = kind === 'chopper' ? 0.5 : 0.28; lean.add(f)
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, kind === 'sportbike' ? 0.55 : 0.8, 6), chrome); bar.rotation.z = Math.PI / 2
  bar.position.set(0, cfg.bar, cfg.wb / 2 - (kind === 'chopper' ? 0.62 : 0.3)); lean.add(bar)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6c8 })); lamp.position.set(0, cfg.bar - 0.2, cfg.wb / 2 + 0.05); lean.add(lamp)
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2a2a })); tailL.position.set(0, cfg.r + 0.62, -cfg.wb / 2 - 0.1); lean.add(tailL)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.9, 8), chrome); pipe.rotation.x = Math.PI / 2; pipe.position.set(0.2, cfg.r + 0.12, -cfg.wb * 0.25); lean.add(pipe)
  // Fahrer
  const back = kind === 'chopper' ? -0.35 : kind === 'sportbike' ? 0.5 : 0.15
  const torso = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.5, 0.26, 3, 0.1), suit); torso.position.set(0, cfg.r + 0.98, -cfg.wb * 0.12 + back * 0.15); torso.rotation.x = back; lean.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), helm); head.position.set(0, cfg.r + 1.4, -cfg.wb * 0.06 + back * 0.35); lean.add(head)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.1), dark); visor.position.set(0, cfg.r + 1.4, -cfg.wb * 0.06 + back * 0.35 + 0.12); lean.add(visor)
  for (const sx of [-0.2, 0.2]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.62, 8), suit)
    arm.position.set(sx, (cfg.r + 1.05 + cfg.bar) / 2 - 0.05, cfg.wb * 0.02 + 0.12); arm.rotation.x = 1.0; arm.rotation.z = sx > 0 ? -0.12 : 0.12; lean.add(arm)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.62, 8), suit)
    leg.position.set(sx * 1.05, cfg.r + 0.42, -cfg.wb * 0.04); leg.rotation.x = -0.9; lean.add(leg)
  }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, cfg.wb + 0.9), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }))
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.07; g.add(sh)
  if (!isMe) g.add(nameSprite(THREE, name, 2.9))
  g.userData.wheels = wheels
  g.userData.wheelR = cfg.r
  g.userData.lean = lean
  g.userData.paint = paint
  g.userData.paint0 = new THREE.Color(color)
  g.userData.body = tank
  g.userData.len = cfg.wb + 0.8
  g.userData.wid = 0.8
  return g
}

/** Admin-Supercar: flaches, rotes Coupé mit Fließheck, Entenbürzel und runden Scheinwerfern (eigener Entwurf). */
function buildSupercar(THREE: THREE, color: string, name: string, isMe: boolean): T.Group {
  const g = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.65 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f1a28, roughness: 0.04, metalness: 0.95 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dee8, roughness: 0.15, metalness: 0.95 })
  const c0 = 0.26
  const L = 4.5, W = 1.85
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, 0.46, L, 5, 0.2), paint); body.position.y = c0 + 0.23; g.add(body)
  for (const sx of [-0.68, 0.68]) {
    const hip = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 1.7, 4, 0.18), paint); hip.position.set(sx, c0 + 0.38, -1.05); g.add(hip)
    const fen = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.34, 1.2, 4, 0.15), paint); fen.position.set(sx * 0.95, c0 + 0.42, 1.45); g.add(fen)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xfff2b0, emissiveIntensity: 0.9 })); lamp.scale.set(1, 1, 0.55); lamp.position.set(sx * 0.92, c0 + 0.6, 2.03); g.add(lamp)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16), chrome); ring.position.copy(lamp.position); ring.position.z += 0.02; g.add(ring)
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.1, 0.12, 2, 0.04), paint); mirror.position.set(sx * 1.08, c0 + 0.88, 0.55); g.add(mirror)
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.6), dark); intake.position.set(sx * 1.1, c0 + 0.38, -0.7); g.add(intake)
  }
  const cab = new THREE.Mesh(new RoundedBoxGeometry(W * 0.78, 0.42, 1.7, 4, 0.18), glass); cab.position.set(0, c0 + 0.66, -0.15); g.add(cab)
  const roof = new THREE.Mesh(new RoundedBoxGeometry(W * 0.74, 0.07, 1.15, 3, 0.03), paint); roof.position.set(0, c0 + 0.88, -0.25); g.add(roof)
  const slope = new THREE.Mesh(new RoundedBoxGeometry(W * 0.76, 0.08, 1.35, 3, 0.04), paint); slope.position.set(0, c0 + 0.76, -1.15); slope.rotation.x = -0.34; g.add(slope)
  const hood = new THREE.Mesh(new RoundedBoxGeometry(W * 0.72, 0.06, 1.3, 3, 0.03), paint); hood.position.set(0, c0 + 0.5, 1.35); hood.rotation.x = 0.07; g.add(hood)
  const duck = new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, 0.07, 0.5, 3, 0.03), paint); duck.position.set(0, c0 + 0.7, -2.15); duck.rotation.x = 0.18; g.add(duck)
  const lip = new THREE.Mesh(new RoundedBoxGeometry(W * 0.9, 0.08, 0.3, 2, 0.03), dark); lip.position.set(0, c0 + 0.06, 2.2); g.add(lip)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.75, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0xff1a1a })); bar.position.set(0, c0 + 0.5, -2.26); g.add(bar)
  for (const sx of [-0.4, 0.4]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), chrome); ex.rotation.x = Math.PI / 2; ex.position.set(sx, c0 + 0.12, -2.3); g.add(ex) }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 1.3), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 })); stripe.position.set(0, c0 + 0.535, 1.4); stripe.rotation.x = 0.07; g.add(stripe)
  const wheels: T.Group[] = []
  const rimM = new THREE.MeshStandardMaterial({ color: 0xe5c07b, roughness: 0.25, metalness: 0.9 })
  for (const [sx, sz, r, w] of [[-1, 1, 0.35, 0.3], [1, 1, 0.35, 0.3], [-1, -1, 0.38, 0.36], [1, -1, 0.38, 0.36]] as const) {
    const wh = new THREE.Group()
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 22), tyreMat(THREE)); tr.rotation.z = Math.PI / 2
    const rm = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.64, r * 0.64, w + 0.02, 14), rimM); rm.rotation.z = Math.PI / 2
    wh.add(tr, rm)
    wh.position.set(sx * (W / 2 - 0.1), r, sz * (sz > 0 ? 1.4 : 1.4))
    wh.name = sz > 0 ? 'front' : 'rear'
    g.add(wh); wheels.push(wh)
  }
  const shd = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, L * 1.12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }))
  shd.rotation.x = -Math.PI / 2; shd.position.y = 0.07; g.add(shd)
  if (!isMe) g.add(nameSprite(THREE, name, 2.6))
  g.userData.wheels = wheels
  g.userData.wheelR = 0.36
  g.userData.paint = paint
  g.userData.paint0 = new THREE.Color(color)
  g.userData.body = body
  g.userData.len = L
  g.userData.wid = W
  return g
}
