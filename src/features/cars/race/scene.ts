import type * as T from 'three'
import { isBike } from '../stats'
import { buildSpecCar, getSpec } from '../customCar'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { roadProximity, type Track } from './track'
import { BRIDGES, CITY, GARAGES, TUNNELS, bridgeH, city, tunnelD } from './city'
import { PARK, PARK_TOP } from './parkhaus'
import { GATE, MOUNTAINS, OUT, RING, hillH, outRoads, ringPath } from './mountains'
import { trees } from './forest'
import { RAMPS, STUNT, loopPoint } from './stunt'

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
/** Band entlang der Strecke. Die Versätze sind für die Grundbreite gedacht: Werte bis zur halben Breite wachsen mit der Kurvenbreite mit, Werte weiter außen
 *  rücken um denselben Betrag nach außen. Auf der Innenseite einer engen Kurve wird der Versatz begrenzt, damit sich das Band nie überschlägt.
 *  `gravel`: Außenband des Schotterfelds (Versatz 0 = Außenkante der Fahrbahn+Randstein, 1 = Leitplanke), nur dort sichtbar, wo es Schotter gibt. */
function ribbon(THREE: THREE, t: Track, lat0: number, lat1: number, y: number, tile: number, y1 = y, gravel = false): T.BufferGeometry {
  const n = t.n
  const half = t.def.width / 2
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const off = (k: number, l: number) => {
    if (gravel) return 0
    const a = Math.abs(l)
    let v = a <= half + 1e-6 ? l * (t.hw[k] / half) : Math.sign(l) * (t.hw[k] + (a - half))
    const kk = t.k[k]
    if (kk * v > 0 && Math.abs(kk) > 1e-5) { const lim = 0.88 / Math.abs(kk); if (Math.abs(v) > lim) v = Math.sign(v) * lim }
    return v
  }
  for (let i = 0; i <= n; i++) {
    const k = i % n
    const nx = -t.tz[k], nz = t.tx[k]
    let a0 = off(k, lat0), a1 = off(k, lat1)
    if (gravel) { const sg = t.gs[k], g = t.gr[k]; a0 = sg * (t.hw[k] + 1.6); a1 = sg * (t.hw[k] + 4.5 + g); if (g <= 0) a1 = a0 }
    pos.push(t.x[k] + nx * a0, y, t.z[k] + nz * a0, t.x[k] + nx * a1, y1, t.z[k] + nz * a1)
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
  /** Nur beim Übungsfeld: Boden-Markierungen an der Kamera ausrichten (damit der Asphalt „festsitzt“). */
  focus?: (x: number, z: number) => void
  /** Schaden (0–100), Driftwinkel und Zeit sichtbar machen: dunkler, verbeult, Rauch, Reifenqualm. */
  damageCar: (g: T.Group, dmg: number, slip: number, v: number, time: number) => void
  /** Blaulicht aufs Dach setzen (Polizei). */
  addSiren: (g: T.Group) => void
  /** Blaulicht blinken lassen (Zeit in ms). */
  tickSiren: (g: T.Group, ms: number) => void
}

export function buildScene(THREE: THREE, t: Track): RaceScene {
  const th = THEMES[t.def.theme] ?? THEMES.gras
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(th.sky)
  scene.fog = new THREE.Fog(th.fog, 200, t.def.mode === 'city' ? 2300 : 1100)
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
  const mode = t.def.mode
  const mark = scene.children.length
  let focus: RaceScene['focus']
  if (mode === 'free') {
    // Endloses Übungsfeld: riesige Asphaltfläche mit Übungskreisen, folgt der Kamera, Markierungen bleiben an der Welt
    const TILE = 120, px = 512
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = px
    const g = cvs.getContext('2d')!
    g.fillStyle = '#3a3d45'; g.fillRect(0, 0, px, px)
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.04)`; g.fillRect(Math.random() * px, Math.random() * px, 2, 2) }
    g.strokeStyle = 'rgba(248,250,252,0.85)'; g.lineWidth = 3
    g.beginPath(); g.arc(px / 2, px / 2, 128, 0, Math.PI * 2); g.stroke()
    g.beginPath(); g.arc(px / 2, px / 2, 64, 0, Math.PI * 2); g.stroke()
    g.fillStyle = '#facc15'; g.beginPath(); g.arc(px / 2, px / 2, 8, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(248,250,252,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, px - 2, px - 2)
    const ft = new THREE.CanvasTexture(cvs); ft.colorSpace = THREE.SRGBColorSpace
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(9000 / TILE, 9000 / TILE); ft.anisotropy = 8
    ground.material = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.95 })
    focus = (x, z) => { const f = (v: number) => v - Math.floor(v); ft.offset.set(f((x - 4500) / TILE), f((-z - 4500) / TILE)) }
  }
  const tex = roadTex(THREE, th.road)
  const rt = tex.clone(); rt.needsUpdate = true
  const road = new THREE.Mesh(ribbon(THREE, t, -half, half, 0.02, 24), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.92, side: THREE.DoubleSide }))
  scene.add(road)
  // Schotterfeld (außen in manchen Kurven)
  if (!mode && t.gr.some((g) => g > 0)) {
    const gc = document.createElement('canvas'); gc.width = gc.height = 128
    const gg = gc.getContext('2d')!
    gg.fillStyle = th.night ? '#7c6f58' : '#c9b48a'; gg.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 900; i++) { gg.fillStyle = `rgba(${i % 2 ? 255 : 60},${i % 2 ? 245 : 50},${i % 2 ? 220 : 30},0.35)`; gg.fillRect(Math.random() * 128, Math.random() * 128, 2, 2) }
    const gt = new THREE.CanvasTexture(gc); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping
    const gm = new THREE.Mesh(ribbon(THREE, t, 0, 0, 0.035, 14, 0.035, true), new THREE.MeshStandardMaterial({ map: gt, roughness: 1, side: THREE.DoubleSide }))
    scene.add(gm)
  }
  const curbTex = stripeTex(THREE, '#e11d48', '#f8fafc')
  for (const sgn of (mode === 'disc' ? [] : [-1, 1]) as Array<-1 | 1>) {
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
  if (mode !== 'disc') scene.add(gate)
  if (mode === 'disc') {
    // Kreisfläche: weiße Randlinie außen und eine dünne Linie auf der Ideallinie (kein Rand, keine Barriere)
    const edge = new THREE.Mesh(new THREE.RingGeometry(half - 4.5, half - 3.5, 160), new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide }))
    edge.rotation.x = -Math.PI / 2; edge.position.set(0, 0.04, 0); scene.add(edge)
    const mid = new THREE.Mesh(new THREE.RingGeometry(149.6, 150.4, 160), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.55, side: THREE.DoubleSide }))
    mid.rotation.x = -Math.PI / 2; mid.position.set(0, 0.04, 0); scene.add(mid)
  }

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
    const lat = outer * (t.hw[i] + (t.gs[i] === outer ? t.gr[i] : 0) + 7)
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
  // Abstand zu JEDEM Streckenpunkt (nicht nur in der Nähe von i): sonst stehen Häuser/Bäume auf Streckenteilen, die an anderer Stelle vorbeilaufen
  const nearRoad = roadProximity(t)
  const spacing = Math.max(14, t.length / 700)
  const slots: Array<{ x: number; z: number; i: number }> = []
  for (let s0 = 0; s0 < t.length; s0 += spacing) {
    const i = Math.min(t.n - 1, Math.floor((s0 / t.length) * t.n))
    const side = rnd() < 0.5 ? -1 : 1
    const lat = side * (half + 14 + rnd() * (t.def.theme === 'stadt' ? 70 : 150))
    const x = t.x[i] - t.tz[i] * lat, z = t.z[i] + t.tx[i] * lat
    if (nearRoad(x, z, half + 14 + (t.def.theme === 'stadt' ? 30 : 16))) continue
    slots.push({ x, z, i })
  }
  const dummy = new THREE.Object3D()
  const place = (mesh: T.InstancedMesh, k: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, ry, 0); dummy.updateMatrix(); mesh.setMatrixAt(k, dummy.matrix)
  }
  const trees: typeof slots = [], rocks: typeof slots = [], houses: typeof slots = []
  for (const sl of slots) {
    if (t.def.theme === 'stadt') houses.push(sl)
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

  // Übungsfeld: keine Strecke, keine Szenerie – nur der endlose Asphalt
  if (mode === 'free' || mode === 'fill' || mode === 'city' || mode === 'stunt') while (scene.children.length > mark) scene.remove(scene.children[mark])
  if (mode === 'stunt') buildStunt(THREE, scene, ground)
  if (mode === 'city') buildCity(THREE, scene, ground, !!th.night)
  if (mode === 'fill') {
    // ausgefüllte Fläche: Asphalt im Vieleck, weiße Randlinie, keine Barriere
    const P = t.def.pts
    const shape = new THREE.Shape(P.map(([px, pz]) => new THREE.Vector2(px, -pz)))
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.92, side: THREE.DoubleSide }))
    fl.rotation.x = -Math.PI / 2; fl.position.y = 0.03; scene.add(fl)
    const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(P.map(([px, pz]) => new THREE.Vector3(px, 0.06, pz))), new THREE.LineBasicMaterial({ color: 0xf8fafc }))
    scene.add(ln)
  }
  const makeCar = (kind: string, color: string, name: string, isMe: boolean) => buildCar(THREE, kind, color, name, isMe)
  return { scene, sun, theme: th, makeCar, follow, focus, damageCar: (g, dmg, slip, v, time) => damageCar(THREE, g, dmg, slip, v, time), addSiren: (g) => addSiren(THREE, g), tickSiren }
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

/** Flugdüsen unter dem Auto (zeigen nach unten): nur im Flug sichtbar. */
function addJets(THREE: THREE, g: T.Group, len: number, wid: number): void {
  const jets = new THREE.Group()
  const flame = new THREE.MeshBasicMaterial({ color: 0x60e6ff, transparent: true, opacity: 0.9 })
  const core = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  for (const sx of [-wid * 0.3, wid * 0.3]) for (const z of [-len * 0.28, len * 0.22]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.6, 10), flame); f.rotation.x = Math.PI; f.position.set(sx, -0.45, z); jets.add(f)
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.0, 8), core); c.rotation.x = Math.PI; c.position.set(sx, -0.25, z); jets.add(c)
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(wid * 1.1, len * 0.9), new THREE.MeshBasicMaterial({ color: 0x60e6ff, transparent: true, opacity: 0.3, depthWrite: false }))
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.1; jets.add(glow)
  jets.visible = false
  g.add(jets); g.userData.jets = jets
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
  const sp = getSpec(kind)
  if (sp) {
    const g = buildSpecCar(THREE, sp, color)
    if (sp.fly) addJets(THREE, g, sp.len, sp.wid)
    if (!isMe) g.add(nameSprite(THREE, name, 2.6))
    return g
  }
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
  if (kind === 'roadster') addJets(THREE, g, b.len, b.wid)
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
function buildBike(THREE: THREE, kind0: string, color: string, name: string, isMe: boolean): T.Group {
  const hyper = kind0 === 'hyperbike'
  const kind = hyper ? 'sportbike' : kind0
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
  if (hyper) {
    // Hyper-Bike: Neonstreifen, Heckflügel und Doppelauspuff
    const neon = new THREE.MeshBasicMaterial({ color: 0x38f8ff })
    const st1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 1.5), neon); st1.position.set(0, 0.78, 0.1); lean.add(st1)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.2), dark); wing.position.set(0, 0.95, -0.85); lean.add(wing)
    for (const sx of [-0.1, 0.1]) { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), chrome); pipe.rotation.x = Math.PI / 2; pipe.position.set(sx, 0.4, -0.9); lean.add(pipe) }
  }
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
  addJets(THREE, g, 4.5, 1.95)
  return g
}


/** Stadt: Straßen (Asphalt mit Mittelstrichen), Häuserblöcke mit Fenstern, Parks mit Bäumen und die Brücke. */
function buildCity(THREE: THREE, scene: T.Scene, ground: T.Mesh, night: boolean) {
  ground.material = new THREE.MeshStandardMaterial({ color: 0x33363e, roughness: 0.95 })
  const P = CITY.pitch
  // Mittelstriche: gestrichelt, ein Instanz-Mesh
  const seg = Math.floor((CITY.half * 2) / 10)
  const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.02, 4), new THREE.MeshBasicMaterial({ color: 0xe5e7eb }), (2 * CITY.K + 1) * seg * 2)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  let n = 0
  for (let k = -CITY.K; k <= CITY.K; k++) for (let i = 0; i < seg; i++) {
    const t = -CITY.half + 5 + i * 10
    m4.compose(new THREE.Vector3(k * P, 0.04, t), q.identity(), new THREE.Vector3(1, 1, 1)); dash.setMatrixAt(n++, m4)
    m4.compose(new THREE.Vector3(t, 0.04, k * P), qy, new THREE.Vector3(1, 1, 1)); dash.setMatrixAt(n++, m4)
  }
  dash.count = n; scene.add(dash)

  // Fenster-Textur (eine Kachel = 6 m)
  const wc = document.createElement('canvas'); wc.width = wc.height = 64
  const wg = wc.getContext('2d')!
  wg.fillStyle = '#d6d3d1'; wg.fillRect(0, 0, 64, 64)
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) {
    const lit = (ix * 3 + iy * 5) % 3 === 0
    wg.fillStyle = night ? (lit ? '#fde68a' : '#1e293b') : (lit ? '#bae6fd' : '#475569'); wg.fillRect(6 + ix * 30, 8 + iy * 28, 20, 18)
  }
  const wt = new THREE.CanvasTexture(wc); wt.colorSpace = THREE.SRGBColorSpace; wt.wrapS = wt.wrapT = THREE.RepeatWrapping
  const pal = [0xe7e5e4, 0xfca5a5, 0xfde68a, 0xa5b4fc, 0x99f6e4, 0xd6a77a].map((c) => new THREE.Color(c).multiplyScalar(night ? 0.6 : 1))
  const { buildings, parks } = city()
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [], nor: number[] = []
  const face = (p: number[][], nrm: number[], u: number, v: number, c: T.Color) => {
    const b = pos.length / 3
    const uvs = [[0, 0], [u, 0], [u, v], [0, v]]
    p.forEach((a, i) => { pos.push(...a); nor.push(...nrm); uv.push(...uvs[i]); col.push(c.r, c.g, c.b) })
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  for (const b of buildings) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, h = b.h, c = pal[b.c], y0 = b.lo ?? 0
    const tw = b.w / 6, td = b.d / 6, th = (h - y0) / 6
    face([[x0, y0, z1], [x1, y0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], tw, th, c)
    face([[x1, y0, z0], [x0, y0, z0], [x0, h, z0], [x1, h, z0]], [0, 0, -1], tw, th, c)
    face([[x1, y0, z1], [x1, y0, z0], [x1, h, z0], [x1, h, z1]], [1, 0, 0], td, th, c)
    face([[x0, y0, z0], [x0, y0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], td, th, c)
    if (y0 > 0) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], 0.01, 0.01, c.clone().multiplyScalar(0.4))
    face([[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]], [0, 1, 0], 0.01, 0.01, c.clone().multiplyScalar(0.55))
  }
  const bg = new THREE.BufferGeometry()
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.setIndex(idx)
  scene.add(new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ map: wt, vertexColors: true, roughness: 0.85 })))

  // Gehwege unter jedem Block (hellgrau, leicht erhöht) und Parks
  const walk = new THREE.MeshStandardMaterial({ color: night ? 0x5b6270 : 0x9ca3af, roughness: 1 })
  for (let kx = -CITY.K; kx < CITY.K; kx++) for (let kz = -CITY.K; kz < CITY.K; kz++) {
    const cx = P * kx + P / 2, cz = P * kz + P / 2
    const park = parks.some((p) => p.x === cx && p.z === cz)
    if (cx === PARK.cx && cz === PARK.cz) {
      // Parkhaus-Block: Gehweg mit Loch über der Tiefgarage
      const sh = new THREE.Shape(), q = (x: number, z: number): [number, number] => [x - cx, -(z - cz)]
      sh.moveTo(...q(cx - 48, cz - 48)); sh.lineTo(...q(cx + 48, cz - 48)); sh.lineTo(...q(cx + 48, cz + 48)); sh.lineTo(...q(cx - 48, cz + 48)); sh.lineTo(...q(cx - 48, cz - 48))
      const hole = new THREE.Path()
      hole.moveTo(...q(PARK.x0, PARK.z0)); hole.lineTo(...q(PARK.x0, PARK.z1)); hole.lineTo(...q(PARK.x1, PARK.z1)); hole.lineTo(...q(PARK.x1, PARK.z0)); hole.lineTo(...q(PARK.x0, PARK.z0))
      sh.holes.push(hole)
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false })
      eg.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(eg, walk); m.position.set(cx, -0.05, cz); scene.add(m)
      continue
    }
    const gar = GARAGES.find((g) => g.bx === cx && g.bz === cz)
    if (gar) {
      // Garagen-Block: Gehweg mit Loch über der Rampe, sonst sähe man die Einfahrt nicht
      const sh = new THREE.Shape(), q = (x: number, z: number): [number, number] => [x - cx, -(z - cz)]
      sh.moveTo(...q(cx - 48, cz - 48)); sh.lineTo(...q(cx + 48, cz - 48)); sh.lineTo(...q(cx + 48, cz + 48)); sh.lineTo(...q(cx - 48, cz + 48)); sh.lineTo(...q(cx - 48, cz - 48))
      const tu = TUNNELS[gar.seg], hw2 = CITY.tw / 2
      const [r0, r1] = tu.r0 !== false ? [tu.a0, tu.a0 + CITY.ramp] : [tu.a1 - CITY.ramp, tu.a1]
      const [hx0, hx1, hz0, hz1] = tu.dir === 'x' ? [r0, r1, tu.c - hw2, tu.c + hw2] : [tu.c - hw2, tu.c + hw2, r0, r1]
      const hole = new THREE.Path()
      hole.moveTo(...q(hx0, hz0)); hole.lineTo(...q(hx0, hz1)); hole.lineTo(...q(hx1, hz1)); hole.lineTo(...q(hx1, hz0)); hole.lineTo(...q(hx0, hz0))
      sh.holes.push(hole)
      const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false })
      eg.rotateX(-Math.PI / 2)
      const m = new THREE.Mesh(eg, walk); m.position.set(cx, -0.05, cz); scene.add(m)
      continue
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(96, 0.3, 96), park ? new THREE.MeshStandardMaterial({ color: night ? 0x1f4a2a : 0x4d9a4a, roughness: 1 }) : walk)
    m.position.set(cx, 0.1, cz); scene.add(m)
  }
  // Wäldchen: viele Bäume (Stamm + Krone) und Büsche, darin ist man versteckt
  const NT = 38, NB = 26
  const crownG = new THREE.ConeGeometry(2.6, 7, 7), trunkG = new THREE.CylinderGeometry(0.35, 0.45, 2.4, 6), bushG = new THREE.SphereGeometry(1.5, 7, 5)
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: night ? 0x14532d : 0x15803d, roughness: 1 }), parks.length * NT)
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: night ? 0x3a2a1c : 0x78512e, roughness: 1 }), parks.length * NT)
  const bushes = new THREE.InstancedMesh(bushG, new THREE.MeshStandardMaterial({ color: night ? 0x1c5a2a : 0x2f9a45, roughness: 1 }), parks.length * NB)
  let tn = 0, bn = 0
  const hash = (a: number, b: number) => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v) }
  parks.forEach((p, pi) => {
    for (let i = 0; i < NT; i++) {
      const x = p.x + (hash(pi, i * 2) - 0.5) * (p.size - 10), z = p.z + (hash(pi, i * 2 + 1) - 0.5) * (p.size - 10), sc = 0.8 + hash(i, pi) * 0.9
      m4.compose(new THREE.Vector3(x, 1.2 * sc + 0.3, z), q.identity(), new THREE.Vector3(sc, sc, sc)); trunks.setMatrixAt(tn, m4)
      m4.compose(new THREE.Vector3(x, 2.4 * sc + 3.2 * sc, z), q.identity(), new THREE.Vector3(sc, sc, sc)); crowns.setMatrixAt(tn++, m4)
    }
    for (let i = 0; i < NB; i++) {
      const x = p.x + (hash(pi + 7, i * 3) - 0.5) * (p.size - 8), z = p.z + (hash(pi + 7, i * 3 + 1) - 0.5) * (p.size - 8), sc = 0.7 + hash(pi, i + 40) * 0.9
      m4.compose(new THREE.Vector3(x, 0.9 * sc, z), q.identity(), new THREE.Vector3(sc * 1.3, sc, sc * 1.3)); bushes.setMatrixAt(bn++, m4)
    }
  })
  crowns.count = tn; trunks.count = tn; bushes.count = bn
  scene.add(crowns, trunks, bushes)
  // Tunnel unter der Stadt: Boden mit Rampen, Seitenwände, Lampen; die Decke ist die Unterseite des Bodens
  {
    const lp: number[] = [], li: number[] = []
    const q4 = (a: number[], b: number[], c: number[], d: number[]) => { const o = lp.length / 3; lp.push(...a, ...b, ...c, ...d); li.push(o, o + 1, o + 2, o, o + 2, o + 3) }
    const hw = CITY.tw / 2
    // Punkt (Längs-/Querkoordinate) einer Röhre als Weltpunkt; Wandstücke in anderen Röhren (Kreuzungen) werden ausgelassen
    const P3 = (t: typeof TUNNELS[number], a: number, p: number, y: number): number[] => t.dir === 'x' ? [a, y, p] : [p, y, a]
    const inOther = (t: typeof TUNNELS[number], a: number, p: number): boolean => {
      const x = t.dir === 'x' ? a : p, z = t.dir === 'x' ? p : a
      return TUNNELS.some((o) => o !== t && o.dir !== t.dir && tunnelD(x, z) > 0 && (o.dir === 'x' ? x >= o.a0 && x <= o.a1 && Math.abs(z - o.c) < hw - 0.1 : z >= o.a0 && z <= o.a1 && Math.abs(x - o.c) < hw - 0.1))
    }
    for (const tu of TUNNELS) {
      for (let a = tu.a0; a < tu.a1; a += 1) {
        const xa = a, xb = a + 1, da = -tunnelD(...(tu.dir === 'x' ? [xa, tu.c] : [tu.c, xa]) as [number, number]), db = -tunnelD(...(tu.dir === 'x' ? [xb, tu.c] : [tu.c, xb]) as [number, number])
        q4(P3(tu, xa, tu.c - hw, da), P3(tu, xb, tu.c - hw, db), P3(tu, xb, tu.c + hw, db), P3(tu, xa, tu.c + hw, da))
        for (const sd of [-1, 1]) {
          if (inOther(tu, a + 0.5, tu.c + sd * hw)) continue
          q4(P3(tu, xa, tu.c + sd * hw, 0), P3(tu, xb, tu.c + sd * hw, 0), P3(tu, xb, tu.c + sd * hw, db), P3(tu, xa, tu.c + sd * hw, da))
        }
      }
    }
    // Stirnwände an geschlossenen Enden, die nicht in einer anderen Röhre münden
    for (const tu of TUNNELS) for (const [a, closed, sg] of [[tu.a0, tu.r0 === false, -1], [tu.a1, tu.r1 === false, 1]] as const) {
      if (!closed) continue
      const ox = tu.dir === 'x' ? a + sg * 1.5 : tu.c, oz = tu.dir === 'x' ? tu.c : a + sg * 1.5
      if (tunnelD(ox, oz) > 0) continue
      const d = tunnelD(tu.dir === 'x' ? a - sg * 3 : tu.c, tu.dir === 'x' ? tu.c : a - sg * 3)
      q4(P3(tu, a, tu.c - hw, 0), P3(tu, a, tu.c + hw, 0), P3(tu, a, tu.c + hw, -d), P3(tu, a, tu.c - hw, -d))
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals()
    scene.add(new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: night ? 0x1f2937 : 0x3b4250, roughness: 0.95, side: THREE.DoubleSide })))
    // Lampen an der Decke und Einfahrtsschilder
    const lampM = new THREE.MeshBasicMaterial({ color: night ? 0xfde68a : 0xfff7d6 })
    for (const tu of TUNNELS) {
      const w = (a: number, p: number): [number, number] => tu.dir === 'x' ? [a, p] : [p, a]
      for (let a = tu.a0 + CITY.ramp; a <= tu.a1 - CITY.ramp; a += 16) { const l = new THREE.Mesh(new THREE.BoxGeometry(tu.dir === 'x' ? 2.5 : 1.2, 0.12, tu.dir === 'x' ? 1.2 : 2.5), lampM); const [lx, lz] = w(a, tu.c); l.position.set(lx, -0.3, lz); scene.add(l) }
      for (const [a, sg, on] of [[tu.a0, 1, tu.r0 !== false], [tu.a1, -1, tu.r1 !== false]] as const) {
        if (!on) continue
        for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), new THREE.MeshStandardMaterial({ color: 0xf59e0b })); const [px, pz] = w(a - sg * 1.5, tu.c + side * (hw + 1)); post.position.set(px, 2, pz); scene.add(post) }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(tu.dir === 'x' ? 0.6 : CITY.tw + 3, 0.8, tu.dir === 'x' ? CITY.tw + 3 : 0.6), new THREE.MeshBasicMaterial({ color: 0xf59e0b })); const [bx, bz] = w(a - sg * 1.5, tu.c); bar.position.set(bx, 4.2, bz); scene.add(bar)
      }
    }
    // Boden mit Löchern über den Rampen (sonst sähe man die Einfahrt nicht)
    const SZ = 4500, shape = new THREE.Shape()
    shape.moveTo(-SZ, SZ); shape.lineTo(SZ, SZ); shape.lineTo(SZ, -SZ); shape.lineTo(-SZ, -SZ); shape.lineTo(-SZ, SZ)
    for (const tu of TUNNELS) for (const [a0, a1] of [...(tu.r0 !== false ? [[tu.a0, tu.a0 + CITY.ramp]] : []), ...(tu.r1 !== false ? [[tu.a1 - CITY.ramp, tu.a1]] : [])] as Array<[number, number]>) {
      const [x0, x1, z0, z1] = tu.dir === 'x' ? [a0, a1, tu.c - hw, tu.c + hw] : [tu.c - hw, tu.c + hw, a0, a1]
      const hole = new THREE.Path()
      hole.moveTo(x0, -z0); hole.lineTo(x1, -z0); hole.lineTo(x1, -z1); hole.lineTo(x0, -z1); hole.lineTo(x0, -z0)
      shape.holes.push(hole)
    }
    { const ph = new THREE.Path(); ph.moveTo(PARK.x0, -PARK.z0); ph.lineTo(PARK.x1, -PARK.z0); ph.lineTo(PARK.x1, -PARK.z1); ph.lineTo(PARK.x0, -PARK.z1); ph.lineTo(PARK.x0, -PARK.z0); shape.holes.push(ph) }
    ground.geometry.dispose()
    ground.geometry = new THREE.ShapeGeometry(shape)
    ;(ground.material as T.MeshStandardMaterial).side = THREE.DoubleSide
    ground.parent?.remove(ground); ground.position.set(0, -0.05, 0); scene.add(ground)
  }
  // Garagentore: gelbes Schild über jeder Einfahrt
  for (const g of GARAGES) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(14, 1.1, 0.5), new THREE.MeshBasicMaterial({ color: 0xf59e0b }))
    bar.position.set(g.door.x, 5.4, g.door.z); if (Math.abs(g.inn.x - g.out.x) > Math.abs(g.inn.z - g.out.z)) bar.rotation.y = Math.PI / 2
    scene.add(bar)
  }
  // Parkhaus aus Metall: Ebenen, Rampenspur (Zick-Zack), Stützen, Brüstungen, P-Schild
  {
    const steel = new THREE.MeshStandardMaterial({ color: night ? 0x64748b : 0x94a3b8, roughness: 0.5, metalness: 0.35 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.3 })
    const { x0, x1, z0, z1, laneW, ramp, floorH, floors, under } = PARK
    const conc = new THREE.MeshStandardMaterial({ color: night ? 0x3b4252 : 0x6b7280, roughness: 0.9 })
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: T.Material = steel) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); scene.add(b); return b }
    const xm = x0 + laneW, W = x1 - x0, D = z1 - z0
    for (let k = -under; k <= floors; k++) {
      const y = floorH * k
      box(x1 - xm, 0.5, D, (xm + x1) / 2, y - 0.25, (z0 + z1) / 2)
      box(laneW, 0.5, D - ramp, x0 + laneW / 2, y - 0.25, z0 + ramp + (D - ramp) / 2)
      box(W, 0.12, 0.4, (x0 + x1) / 2, y - 0.56, (z0 + z1) / 2, new THREE.MeshBasicMaterial({ color: 0xfff7d6 }))
      if (k <= 0) continue
      // Brüstung rund herum (Süden nur über Ebene 1 geschlossen genug: überall 1 m)
      box(W, 1, 0.5, (x0 + x1) / 2, y + 0.5, z1); box(0.5, 1, D, x0, y + 0.5, (z0 + z1) / 2); box(0.5, 1, D, x1, y + 0.5, (z0 + z1) / 2); box(W, 1, 0.5, (x0 + x1) / 2, y + 0.5, z0)
    }
    // Rampen (geneigte Platten) auf der Westspur
    const ang = Math.atan2(floorH, ramp), rl = Math.hypot(floorH, ramp)
    for (let k = -under; k < floors; k++) {
      const r = box(laneW, 0.5, rl, x0 + laneW / 2, floorH * k + floorH / 2 - 0.25, z0 + ramp / 2); r.rotation.x = -ang
      box(0.5, 1, rl, x0, floorH * k + floorH / 2 + 0.5, z0 + ramp / 2).rotation.x = -ang
    }
    // Stützen (vom 2. Untergeschoss bis zum Dach)
    for (let x = x0; x <= x1 + 0.1; x += W / 4) for (let z = z0; z <= z1 + 0.1; z += D / 4) box(1, floorH * (floors + under), 1, x, (floorH * (floors - under)) / 2, z, dark)
    // Betonwände der Tiefgarage (Süden bleibt über dem Boden offen: dort liegt die Einfahrt)
    const dep = floorH * under
    for (const [w, d, x, z] of [[0.6, D, x0, (z0 + z1) / 2], [0.6, D, x1, (z0 + z1) / 2], [W, 0.6, (x0 + x1) / 2, z1], [W, 0.6, (x0 + x1) / 2, z0]] as const) box(w, dep, d, x, -dep / 2, z, conc)
    // Außenwand im Erdgeschoss (Westen, Osten, Norden); Süden bleibt offen
    for (const [w, d, x, z] of [[0.6, D, x0, (z0 + z1) / 2], [0.6, D, x1, (z0 + z1) / 2], [W, 0.6, (x0 + x1) / 2, z1]] as const) box(w, floorH, d, x, floorH / 2, z, steel)
    // Einfahrt-Sturz mit P-Schild
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128
    const cg = cv.getContext('2d')!
    cg.fillStyle = '#1d4ed8'; cg.fillRect(0, 0, 128, 128); cg.fillStyle = '#fff'; cg.font = 'bold 100px sans-serif'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText('P', 64, 70)
    const tex = new THREE.CanvasTexture(cv)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
    sign.position.set(x0 + laneW / 2, PARK_TOP + 5, z0 - 0.5); scene.add(sign)
    box(0.5, 5, 0.5, x0 + laneW / 2, PARK_TOP + 2.5, z0 - 0.5, dark)
  }
  // Stadtgrenze: gestreifte Sperre rundherum, damit man nicht aus Versehen dagegen fährt
  {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32
    const cg = cv.getContext('2d')!
    for (let i = 0; i < 8; i++) { cg.fillStyle = i % 2 ? '#f8fafc' : '#dc2626'; cg.fillRect(i * 16, 0, 16, 32) }
    const bt = new THREE.CanvasTexture(cv); bt.wrapS = THREE.RepeatWrapping; bt.colorSpace = THREE.SRGBColorSpace
    const H = CITY.half, len = H * 2 + 8
    // Mauerstücke: Stadt (Süd, West, Ost), Nordmauer mit Tor und die Grenze des Außenbereichs hinter dem Tor
    const gx = (OUT.x1 + GATE) / 2, gl = OUT.x1 - GATE
    const segs: Array<[number, number, number, number]> = [
      [0, -H - 1, len, 0], [-H - 1, 0, len, Math.PI / 2], [H + 1, 0, len, Math.PI / 2],
      [-gx, H, gl, 0], [gx, H, gl, 0],
      [-OUT.x1 - 1, (OUT.z1 - OUT.x1) / 2, OUT.z1 + OUT.x1, Math.PI / 2], [OUT.x1 + 1, (OUT.z1 - OUT.x1) / 2, OUT.z1 + OUT.x1, Math.PI / 2], [0, OUT.z1 + 1, OUT.x1 * 2 + 4, 0], [0, -OUT.x1 - 1, OUT.x1 * 2 + 4, 0],
    ]
    for (const [x, z, ln, ry] of segs) {
      const t2 = bt.clone(); t2.needsUpdate = true; t2.repeat.set(ln / 8, 1)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ln, 3, 1.2), new THREE.MeshStandardMaterial({ map: t2, emissive: 0xdc2626, emissiveIntensity: night ? 0.5 : 0.18, roughness: 0.7 }))
      wall.position.set(x, 1.5, z); wall.rotation.y = ry; scene.add(wall)
      const fence = new THREE.Mesh(new THREE.PlaneGeometry(ln, 9), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }))
      fence.position.set(x, 7.5, z); fence.rotation.y = ry; scene.add(fence)
    }
    // Torpfosten
    for (const sx of [-GATE - 1, GATE + 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(2, 9, 2), new THREE.MeshStandardMaterial({ color: 0xf59e0b })); p.position.set(sx, 4.5, H); scene.add(p) }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(GATE * 2 + 4, 1.2, 2), new THREE.MeshBasicMaterial({ color: 0xf59e0b })); lintel.position.set(0, 9, H); scene.add(lintel)
  }

  // Hinter der Stadt: Wiese, Berge mit Serpentinenstraßen, Hauptstraße vom Tor
  {
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(OUT.x1 - OUT.x0, OUT.z1 - OUT.z0), new THREE.MeshStandardMaterial({ color: night ? 0x1d3a22 : 0x4a8a3c, roughness: 1 }))
    grass.rotation.x = -Math.PI / 2; grass.position.set(0, -0.02, (OUT.z0 + OUT.z1) / 2); scene.add(grass)
    // Wiese rund um die Stadt (Süd, West, Ost) bis zur Weltgrenze – darauf liegt die Rennstrecke
    const gmat = new THREE.MeshStandardMaterial({ color: night ? 0x1d3a22 : 0x4a8a3c, roughness: 1 })
    for (const [w, d, x, z] of [[1800, 180, 0, -810], [180, 1440, -810, 0], [180, 1440, 810, 0]] as const) {
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), gmat); gm.rotation.x = -Math.PI / 2; gm.position.set(x, 0, z); scene.add(gm)
    }
    // Start/Ziel der Rennstrecke (Schachbrett) mit Torbogen
    {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256
      const cg = cv.getContext('2d')!
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { cg.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cg.fillRect(j * 32, i * 32, 32, 32) }
      const st = new THREE.Mesh(new THREE.PlaneGeometry(4, 30), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }))
      st.rotation.x = -Math.PI / 2; st.position.set(0, 0.2, -RING.h); scene.add(st)
      for (const sx of [-RING.w - 2, RING.w + 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 11, 1.4), new THREE.MeshStandardMaterial({ color: 0x1f2937 })); p.position.set(sx, 5.5, -RING.h); scene.add(p) }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(RING.w * 2 + 6, 2.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xdc2626 })); bar.position.set(0, 11, -RING.h); scene.add(bar)
    }
    // Randsteine der Rennstrecke (rot/weiß) innen und außen
    {
      const rpts = ringPath(6), mat = [new THREE.MeshBasicMaterial({ color: 0xdc2626 }), new THREE.MeshBasicMaterial({ color: 0xf8fafc })]
      const geo = new THREE.BoxGeometry(1.2, 0.18, 6.2)
      const inst = [new THREE.InstancedMesh(geo, mat[0], rpts.length * 2), new THREE.InstancedMesh(geo, mat[1], rpts.length * 2)]
      const cnt = [0, 0], dm = new THREE.Object3D()
      for (let i = 0; i < rpts.length - 1; i++) {
        const [x, z] = rpts[i], [x2, z2] = rpts[i + 1], dx = x2 - x, dz = z2 - z, dl = Math.hypot(dx, dz) || 1, nx = -dz / dl, nz = dx / dl, k = i % 2
        for (const sd of [-1, 1]) { dm.position.set(x + nx * sd * (RING.w - 7.3), 0.1, z + nz * sd * (RING.w - 7.3)); dm.rotation.set(0, Math.atan2(dx, dz), 0); dm.updateMatrix(); inst[k].setMatrixAt(cnt[k]++, dm.matrix) }
      }
      inst.forEach((m, k) => { m.count = cnt[k]; m.instanceMatrix.needsUpdate = true; scene.add(m) })
    }
    // Wald an den Bergen (Instanzen: Stamm + zwei Kronen)
    {
      const ts = trees(), n = ts.length
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5b3b22, roughness: 1 }), n)
      const c1 = new THREE.InstancedMesh(new THREE.ConeGeometry(2.8, 5.5, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), n)
      const c2 = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 4.5, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), n)
      const dm = new THREE.Object3D(), col = new THREE.Color()
      ts.forEach((t, i) => {
        const h = hillH(t.x, t.z), s = t.s
        dm.rotation.set(0, 0, 0); dm.scale.set(s, s, s)
        dm.position.set(t.x, h + 1.5 * s, t.z); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix)
        dm.position.set(t.x, h + (3 + 2.2) * s, t.z); dm.updateMatrix(); c1.setMatrixAt(i, dm.matrix)
        dm.position.set(t.x, h + (3 + 5.2) * s, t.z); dm.updateMatrix(); c2.setMatrixAt(i, dm.matrix)
        const g = 0.28 + ((i * 37) % 17) / 17 * 0.18
        col.setRGB(0.08 + g * 0.2, g + (night ? 0 : 0.18), 0.1 + g * 0.15); c1.setColorAt(i, col); c2.setColorAt(i, col)
      })
      for (const m of [trunk, c1, c2]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; scene.add(m) }
    }
    for (const m of MOUNTAINS) {
      const RA = 72, RR = 44, pos: number[] = [], col: number[] = [], idx: number[] = []
      for (let i = 0; i <= RR; i++) for (let j = 0; j < RA; j++) {
        const r = (i / RR) * m.R, a = (j / RA) * Math.PI * 2
        const x = m.x + r * Math.sin(a), z = m.z + r * Math.cos(a), h = hillH(x, z), f = h / m.H
        pos.push(x, h, z)
        const c = f < 0.12 ? [0.27, 0.5, 0.22] : f < 0.5 ? [0.36, 0.45, 0.25] : f < 0.82 ? [0.45, 0.42, 0.36] : f < 0.94 ? [0.55, 0.55, 0.57] : [0.94, 0.95, 0.98]
        col.push(c[0], c[1], c[2])
      }
      for (let i = 0; i < RR; i++) for (let j = 0; j < RA; j++) {
        const a = i * RA + j, b = i * RA + (j + 1) % RA, c2 = (i + 1) * RA + j, d = (i + 1) * RA + (j + 1) % RA
        idx.push(a, c2, b, b, c2, d)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals()
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide })))
    }
    // Straßenbänder (folgen dem Gelände, Mittelstreifen als helle Linie)
    const rp: number[] = [], ri: number[] = [], rc: number[] = []
    const allRoads = outRoads()
    for (const path of allRoads) {
      const isRing = path === allRoads[allRoads.length - 1]
      const base = rp.length / 3
      for (let i = 0; i < path.length; i++) {
        const [x, z] = path[i], p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(path.length - 1, i + 1)]
        const dx = p1[0] - p0[0], dz = p1[1] - p0[1], dl = Math.hypot(dx, dz) || 1, nx = -dz / dl, nz = dx / dl
        for (const w of [-8, -0.35, 0.35, 8]) { const px = x + nx * w, pz = z + nz * w; rp.push(px, hillH(px, pz) + 0.12, pz); const l = isRing ? 0.17 : Math.abs(w) < 1 ? 0.85 : 0.2; rc.push(l, l, l * 0.95) }
      }
      for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < 3; k++) { const a = base + i * 4 + k, b = a + 1, c2 = a + 4, d = a + 5; ri.push(a, c2, b, b, c2, d) }
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); rg.setIndex(ri); rg.computeVertexNormals()
    scene.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })))
  }

  // Brücken
  for (const br of BRIDGES) {
  const step = 5, cnt = Math.round((br.bx1 - br.bx0) / step)
  const bp: number[] = [], bi: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { const o = bp.length / 3; bp.push(...a, ...b, ...c, ...d); bi.push(o, o + 1, o + 2, o, o + 2, o + 3) }
  const rp: number[] = [], ri: number[] = []
  const rquad = (a: number[], b: number[], c: number[], d: number[]) => { const o = rp.length / 3; rp.push(...a, ...b, ...c, ...d); ri.push(o, o + 1, o + 2, o, o + 2, o + 3) }
  const zc = br.bz, w = CITY.bw
  for (let i = 0; i < cnt; i++) {
    const xa = br.bx0 + i * step, xb = xa + step, ya = bridgeH(xa, zc), yb = bridgeH(xb, zc)
    quad([xa, ya + 0.05, zc - w], [xa, ya + 0.05, zc + w], [xb, yb + 0.05, zc + w], [xb, yb + 0.05, zc - w])
    quad([xa, ya - 0.8, zc + w], [xa, ya + 0.05, zc + w], [xb, yb + 0.05, zc + w], [xb, yb - 0.8, zc + w])
    quad([xa, ya + 0.05, zc - w], [xa, ya - 0.8, zc - w], [xb, yb - 0.8, zc - w], [xb, yb + 0.05, zc - w])
    quad([xa, ya - 0.8, zc - w], [xa, ya - 0.8, zc + w], [xb, yb - 0.8, zc + w], [xb, yb - 0.8, zc - w])
    if (ya > 1.5 && yb > 1.5) for (const sg of [-1, 1]) {
      const zz = zc + sg * (w - 0.4)
      rquad([xa, ya + 0.05, zz], [xb, yb + 0.05, zz], [xb, yb + 1.2, zz], [xa, ya + 1.2, zz])
    }
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); dg.setIndex(bi); dg.computeVertexNormals()
  scene.add(new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.9, side: THREE.DoubleSide })))
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri); rg.computeVertexNormals()
  scene.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6, side: THREE.DoubleSide })))
  for (let x = br.bx0 + 40; x < br.bx1 - 30; x += 40) for (const sg of [-1, 1]) {
    const hh = bridgeH(x, zc) - 0.8
    if (hh < 1) continue
    const pil = new THREE.Mesh(new THREE.BoxGeometry(1.2, hh, 1.2), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1 }))
    pil.position.set(x, hh / 2, zc + sg * (w - 1.2)); scene.add(pil)
  }
  // Mittelstrich auf der Brücke
  for (let x = br.bx0 + 10; x < br.bx1 - 10; x += 8) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(4, 0.03, 0.3), new THREE.MeshBasicMaterial({ color: 0xf8fafc }))
    d.position.set(x, bridgeH(x, zc) + 0.08, zc); scene.add(d)
  }
  }
}


/** Stunt-Park: Asphalt, Zaun, Rampen als Keile, Looping als Wendel mit Geländer. */
function buildStunt(THREE: THREE, scene: T.Scene, ground: T.Mesh) {
  ground.material = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.95 })
  const H = STUNT.half
  const fence = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 })
  for (const [x, z, w, d] of [[0, -H, 2 * H, 1], [0, H, 2 * H, 1], [-H, 0, 1, 2 * H], [H, 0, 1, 2 * H]] as number[][]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), fence); m.position.set(x, 1.1, z); scene.add(m)
  }
  // Rampen: geschlossene Keile
  const rm = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.75, side: THREE.DoubleSide })
  for (const r of RAMPS) {
    const sn = Math.sin(r.h), cs = Math.cos(r.h)
    const P = (u: number, w: number, y: number): number[] => [r.x + sn * u + cs * w, y, r.z + cs * u - sn * w]
    const a = r.wid / 2
    const pos: number[] = [], idx: number[] = []
    const quad = (p: number[][]) => { const o = pos.length / 3; p.forEach((q) => pos.push(...q)); idx.push(o, o + 1, o + 2, o, o + 2, o + 3) }
    quad([P(0, -a, r.h0), P(0, a, r.h0), P(r.len, a, r.h1), P(r.len, -a, r.h1)])
    quad([P(0, -a, 0), P(r.len, -a, 0), P(r.len, -a, r.h1), P(0, -a, r.h0)])
    quad([P(0, a, 0), P(0, a, r.h0), P(r.len, a, r.h1), P(r.len, a, 0)])
    quad([P(0, -a, 0), P(0, -a, r.h0), P(0, a, r.h0), P(0, a, 0)])
    quad([P(r.len, -a, 0), P(r.len, a, 0), P(r.len, a, r.h1), P(r.len, -a, r.h1)])
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
    scene.add(new THREE.Mesh(g, rm))
  }
  // Looping: Wendel mit Fahrfläche und Seitenwänden
  const L = STUNT.loop, w = 3.4, N = 90
  const pos: number[] = [], idx: number[] = [], wp: number[] = [], wi: number[] = []
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2
    const c = loopPoint(L, th, 0)
    const nx = Math.cos(L.h), nz = -Math.sin(L.h)
    pos.push(c.x - nx * w, c.y + 0.02, c.z - nz * w, c.x + nx * w, c.y + 0.02, c.z + nz * w)
    wp.push(c.x - nx * w, c.y + 0.02, c.z - nz * w, c.x - nx * w, c.y + 1.2, c.z - nz * w, c.x + nx * w, c.y + 0.02, c.z + nz * w, c.x + nx * w, c.y + 1.2, c.z + nz * w)
    if (i < N) { const o = i * 2; idx.push(o, o + 1, o + 3, o, o + 3, o + 2) ; const q = i * 4; wi.push(q, q + 1, q + 5, q, q + 5, q + 4, q + 2, q + 3, q + 7, q + 2, q + 7, q + 6) }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setIndex(idx); lg.computeVertexNormals()
  scene.add(new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.85, side: THREE.DoubleSide })))
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals()
  scene.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6, side: THREE.DoubleSide })))
  // Stützen und Einfahrt-Pfeiler
  for (const th of [Math.PI / 2, Math.PI * 1.5]) for (const sg of [-1, 1]) {
    const c = loopPoint(L, th, 0), p = new THREE.Mesh(new THREE.BoxGeometry(1, c.y, 1), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 1 }))
    p.position.set(c.x + sg * (w + 1), c.y / 2, c.z); scene.add(p)
  }
  for (const sg of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 })); p.position.set(L.x + sg * (w + 1.6), 3, L.z - 6); scene.add(p)
  }
  // Anfahrstreifen
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 160), new THREE.MeshBasicMaterial({ color: 0x1f2937 })); strip.rotation.x = -Math.PI / 2; strip.position.set(L.x, 0.03, L.z - 100); scene.add(strip)
}

interface Siren { red: T.Mesh; blue: T.Mesh }
const SIREN = 'siren'
/** Blaulicht-Balken auf das Dach (Dachhöhe aus den Karosserie-Teilen, ohne Namensschild). */
function addSiren(THREE: THREE, g: T.Group) {
  if (g.userData[SIREN]) return
  const bb = new THREE.Box3()
  g.traverse((o) => { if ((o as T.Mesh).isMesh) bb.expandByObject(o) })
  const top = Number.isFinite(bb.max.y) ? bb.max.y : 1.3
  const w = Math.max(0.5, Math.min(1.1, (bb.max.x - bb.min.x) * 0.55))
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.34), new THREE.MeshStandardMaterial({ color: 0x111827 }))
  base.position.set(0, top + 0.05, 0)
  const red = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.02, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2a2a }))
  const blue = new THREE.Mesh(new THREE.BoxGeometry(w / 2 - 0.02, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: 0x2a6bff }))
  red.position.set(-w / 4, top + 0.14, 0); blue.position.set(w / 4, top + 0.14, 0)
  g.add(base, red, blue)
  g.userData[SIREN] = { red, blue } as Siren
}
function tickSiren(g: T.Group, ms: number) {
  const s = g.userData[SIREN] as Siren | undefined
  if (!s) return
  const ph = Math.floor(ms / 120) % 6
  s.red.visible = ph === 0 || ph === 1 || ph === 4
  s.blue.visible = ph === 2 || ph === 3 || ph === 5
}

/** Auto-Modell für Vorschauen (Showroom): Blickrichtung +z, ohne Namensschild. */
export function makeCarModel(THREE: THREE, kind: string, color: string): T.Group {
  return buildCar(THREE, kind, color, '', true)
}
