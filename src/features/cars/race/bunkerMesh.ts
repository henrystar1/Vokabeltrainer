import type * as T from 'three'
import { BUNKER, BK, hatchK, liftY, type QuadWeapon } from './bunker'
import { makeQuadModel, setQuadWeapon } from './quad'
import { makeWalkerModel } from './walkerMesh'
import { addIronSuit } from './ironSuit'

type THREE = typeof T

export interface BunkerView {
  /** Halle + Schacht (nur sichtbar, wenn man drin ist oder hineinschaut) */
  hall: T.Group
  /** Oberfläche: Luke, Tastenfeld, Leuchte (immer sichtbar) */
  surface: T.Group
  /** Pro Frame: Lukenfortschritt 0…1, Fahrstuhl 0…1 (oben…unten), ob die Halle gezeichnet wird, Zeit in s */
  update: (o: { hatch: number; lift: number; moving: boolean; showHall: boolean; t: number; dt: number }) => void
  setQuad: (color: string, weapon: QuadWeapon) => void
  dispose: () => void
}

/** Statische Quader/Zylinder je Material zu einem Mesh verschmelzen (wenige Draw-Calls trotz sehr vieler Details). */
class Batch {
  private pos = new Map<T.Material, number[]>()
  private nor = new Map<T.Material, number[]>()
  constructor(private THREE: THREE) {}
  private push(m: T.Material, g: T.BufferGeometry, x: number, y: number, z: number, e: T.Euler): void {
    g.applyMatrix4(new this.THREE.Matrix4().compose(new this.THREE.Vector3(x, y, z), new this.THREE.Quaternion().setFromEuler(e), new this.THREE.Vector3(1, 1, 1)))
    const p = this.pos.get(m) ?? [], n = this.nor.get(m) ?? []
    for (const v of g.getAttribute('position').array) p.push(v)
    for (const v of g.getAttribute('normal').array) n.push(v)
    this.pos.set(m, p); this.nor.set(m, n); g.dispose()
  }
  box(m: T.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0): void {
    this.push(m, new this.THREE.BoxGeometry(w, h, d).toNonIndexed(), x, y, z, new this.THREE.Euler(rx, ry, 0))
  }
  cyl(m: T.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 10): void {
    this.push(m, new this.THREE.CylinderGeometry(r, r, len, seg).toNonIndexed(), x, y, z, new this.THREE.Euler(axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? Math.PI / 2 : 0))
  }
  build(parent: T.Object3D): void {
    for (const [m, p] of this.pos) {
      const geo = new this.THREE.BufferGeometry()
      geo.setAttribute('position', new this.THREE.Float32BufferAttribute(p, 3)); geo.setAttribute('normal', new this.THREE.Float32BufferAttribute(this.nor.get(m) ?? [], 3))
      parent.add(new this.THREE.Mesh(geo, m))
    }
  }
}

/** Animierter Bildschirm (Canvas-Textur) */
interface Screen { cv: HTMLCanvasElement; tex: T.CanvasTexture; kind: 'radar' | 'graph' | 'text' | 'map' | 'logo' | 'quad'; seed: number }

export function buildBunker(THREE: THREE, scene: T.Scene): BunkerView {
  const by = BUNKER.y, C = BUNKER.ceil
  const lm = (c: number, rough = 0.85, metal = 0.1, em = 0, emi = 1.2) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, emissive: em, emissiveIntensity: em ? emi : 0 })
  const concrete = lm(0x6f757c, 0.95, 0.02, 0x14171a, 1), concreteD = lm(0x4a5058, 0.95, 0.02, 0x0c0e10, 1), floorM = lm(0x3a3f45, 0.55, 0.15, 0x0c0e10, 1)
  const steel = lm(0x8a93a0, 0.35, 0.8, 0x15181c, 1), dark = lm(0x1b1e23, 0.6, 0.5), black = lm(0x0a0b0d, 0.5, 0.4)
  const yellow = lm(0xf2c200, 0.6, 0.1, 0x3a2e00, 1), red = lm(0xc81e1e, 0.5, 0.2, 0x300606, 1), orange = lm(0xea7a10, 0.55, 0.2), olive = lm(0x3d4a32, 0.8, 0.1, 0x0c1008, 1), sand = lm(0x8a7a52, 0.8, 0.1)
  const lamp = lm(0xffffff, 0.3, 0, 0xffffff, 2.2), cyan = lm(0x22d3ee, 0.3, 0.3, 0x22d3ee, 1.6), green = lm(0x22c55e, 0.4, 0.2, 0x22c55e, 1.4)
  const glass = new THREE.MeshStandardMaterial({ color: 0x66e0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.22, emissive: 0x0a6a80, emissiveIntensity: 0.6, depthWrite: false })
  const holo = new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.55, wireframe: true, depthWrite: false })
  const holoFill = new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.18, depthWrite: false })
  const paints = [red, yellow, cyan, orange, green, steel]

  const hall = new THREE.Group(); hall.visible = false; scene.add(hall)
  const surface = new THREE.Group(); scene.add(surface)
  const dyn: Array<(o: { t: number }) => void> = []
  const screens: Screen[] = []
  const disposables: Array<{ dispose: () => void }> = []

  const cx = (BUNKER.x0 + BUNKER.x1) / 2, cz = (BUNKER.z0 + BUNKER.z1) / 2, W = BUNKER.x1 - BUNKER.x0, D = BUNKER.z1 - BUNKER.z0
  const B = new Batch(THREE)
  // ── Hülle: Boden, Wände, Decke mit Aussparung für den Schacht ──
  B.box(floorM, W, 0.6, D, cx, by - 0.3, cz)
  for (let i = 0; i <= 8; i++) { B.box(concreteD, 0.12, 0.02, D, BUNKER.x0 + (W / 8) * i, by + 0.01, cz); B.box(concreteD, W, 0.02, 0.12, cx, by + 0.012, BUNKER.z0 + (D / 8) * i) }
  B.box(concrete, W + 2, C + 1, 1, cx, by + C / 2, BUNKER.z0 - 0.5); B.box(concrete, W + 2, C + 1, 1, cx, by + C / 2, BUNKER.z1 + 0.5)
  B.box(concrete, 1, C + 1, D, BUNKER.x0 - 0.5, by + C / 2, cz); B.box(concrete, 1, C + 1, D, BUNKER.x1 + 0.5, by + C / 2, cz)
  const sh = BUNKER.shaft, ex = BUNKER.ex, sz0 = BUNKER.z0, sz1 = BUNKER.z0 + sh * 2
  B.box(concreteD, W + 2, 1, D - (sz1 - sz0), cx, by + C + 0.5, (sz1 + BUNKER.z1) / 2)
  B.box(concreteD, ex - sh - BUNKER.x0 + 1, 1, sz1 - sz0, (BUNKER.x0 - 1 + ex - sh) / 2, by + C + 0.5, (sz0 + sz1) / 2)
  B.box(concreteD, BUNKER.x1 - ex - sh + 1, 1, sz1 - sz0, (ex + sh + BUNKER.x1 + 1) / 2, by + C + 0.5, (sz0 + sz1) / 2)
  // Schachtwände bis zur Oberfläche
  const sH = 0 - (by + C)
  B.box(concrete, sh * 2 + 1.2, sH, 0.6, ex, by + C + sH / 2, sz0 - 0.3); B.box(concrete, sh * 2 + 1.2, sH, 0.6, ex, by + C + sH / 2, sz1 + 0.3)
  B.box(concrete, 0.6, sH, sz1 - sz0, ex - sh - 0.3, by + C + sH / 2, (sz0 + sz1) / 2); B.box(concrete, 0.6, sH, sz1 - sz0, ex + sh + 0.3, by + C + sH / 2, (sz0 + sz1) / 2)
  for (let y = by + C + 4; y < -1; y += 6) for (const sx of [-1, 1]) { B.box(yellow, 0.1, 0.12, sz1 - sz0 - 0.4, ex + sx * (sh - 0.05), y, (sz0 + sz1) / 2); B.box(lamp, 0.08, 0.1, 0.5, ex + sx * (sh - 0.1), y + 0.5, (sz0 + sz1) / 2) }
  for (const sx of [-1, 1]) B.box(steel, 0.12, sH, 0.12, ex + sx * (sh - 0.4), by + C + sH / 2, sz0 + 0.6)
  // Wandpaneele, Rippen, Warnstreifen
  for (let i = 0; i < 16; i++) { const x = BUNKER.x0 + 2.5 + i * (W - 5) / 15; B.box(concreteD, 0.5, C, 0.3, x, by + C / 2, BUNKER.z1 - 0.15); B.box(steel, 0.2, 0.2, 0.34, x, by + 1, BUNKER.z1 - 0.15) }
  for (let i = 0; i < 12; i++) { const z = BUNKER.z0 + 3 + i * (D - 6) / 11; for (const sx of [BUNKER.x0, BUNKER.x1]) B.box(concreteD, 0.3, C, 0.5, sx + (sx === BUNKER.x0 ? 0.15 : -0.15), by + C / 2, z) }
  for (const sx of [BUNKER.x0, BUNKER.x1]) { const k = sx === BUNKER.x0 ? 1 : -1; for (let i = 0; i < 20; i++) B.box(i % 2 ? black : yellow, 0.06, 0.4, 2, sx + k * 0.33, by + 0.5, BUNKER.z0 + 2 + i * 3.9) }
  // Deckenträger, Rohre, Kabeltrassen, Leuchtbänder
  for (let i = 0; i < 10; i++) B.box(steel, W, 0.5, 0.45, cx, by + C - 0.35, BUNKER.z0 + 10 + i * 7)
  for (let i = 0; i < 6; i++) B.box(lamp, 0.7, 0.1, D - 14, BUNKER.x0 + 8 + i * 13, by + C - 0.15, cz + 6)
  for (const y of [C - 1.1, C - 1.7]) for (const sx of [BUNKER.x0 + 1.4, BUNKER.x1 - 1.4]) B.cyl(steel, 0.22, D - 4, sx, by + y, cz, 'z', 12)
  B.cyl(red, 0.16, D - 4, BUNKER.x0 + 1.4, by + C - 2.2, cz, 'z', 10); B.cyl(cyan, 0.1, D - 4, BUNKER.x1 - 1.4, by + C - 2.2, cz, 'z', 8)
  B.box(steel, 0.9, 0.1, D - 6, cx, by + C - 1.0, cz + 4)
  for (let i = 0; i < 9; i++) B.box(dark, 1.0, 0.05, 0.3, cx, by + C - 0.93, BUNKER.z0 + 10 + i * 8)
  // Lüftungsgitter und Türen
  for (const i of [0, 4]) { const vx = BUNKER.x0 + 14 + i * 13; B.box(dark, 3, 1.6, 0.2, vx, by + 6.8, BUNKER.z1 - 0.4); for (let k = 0; k < 6; k++) B.box(steel, 2.8, 0.06, 0.1, vx, by + 6.2 + k * 0.25, BUNKER.z1 - 0.52) }
  B.box(steel, 5, 5, 0.4, BUNKER.x0 + 7, by + 2.5, BUNKER.z1 - 0.3); B.box(yellow, 5.4, 0.3, 0.45, BUNKER.x0 + 7, by + 5.1, BUNKER.z1 - 0.3); B.box(red, 0.4, 0.6, 0.5, BUNKER.x0 + 4.6, by + 2.4, BUNKER.z1 - 0.3)
  B.box(steel, 4, 4.2, 0.4, BUNKER.x1 - 7, by + 2.1, BUNKER.z1 - 0.3); B.box(green, 0.3, 0.3, 0.5, BUNKER.x1 - 9.2, by + 3, BUNKER.z1 - 0.3)

  // ── Fahrstuhlkäfig (bewegt sich) ──
  const cage = new THREE.Group(); cage.position.set(ex, 0, BUNKER.z0 + sh); hall.add(cage)
  const CB = new Batch(THREE)
  CB.box(steel, sh * 2 - 0.6, 0.35, sh * 2 - 0.6, 0, -0.18, 0); CB.box(yellow, sh * 2 - 0.2, 0.08, 0.3, 0, 0.01, sh - 0.6); CB.box(black, sh * 2 - 0.2, 0.08, 0.3, 0, 0.01, -sh + 0.6)
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) CB.box(dark, 0.22, 3.4, 0.22, sx * (sh - 0.5), 1.7, sz * (sh - 0.5))
  CB.box(steel, sh * 2 - 0.4, 0.25, sh * 2 - 0.4, 0, 3.5, 0); CB.box(lamp, 2, 0.08, 2, 0, 3.35, 0)
  for (const sx of [-1, 1]) { CB.box(steel, 0.08, 0.1, sh * 2 - 1, sx * (sh - 0.5), 1.1, 0); CB.box(steel, sh * 2 - 1, 0.1, 0.08, 0, 1.1, sx * (sh - 0.5)) }
  CB.box(dark, 0.6, 1.1, 0.2, sh - 1, 0.6, -sh + 0.6); CB.box(green, 0.3, 0.2, 0.05, sh - 1, 0.9, -sh + 0.72)
  CB.build(cage)

  // ── Bildschirme (Canvas) ──
  const mkScreen = (kind: Screen['kind'], w: number, h: number, seed: number): T.Mesh => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.max(64, Math.round(256 * h / w))
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
    screens.push({ cv, tex, kind, seed }); disposables.push(tex)
    const geo = new THREE.PlaneGeometry(w, h); disposables.push(geo)
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }))
  }
  const place = (m: T.Object3D, x: number, y: number, z: number, ry = 0, rx = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, 0); hall.add(m); return m }
  const wallZ = BUNKER.z1 - 0.35
  B.box(black, 40, 8.6, 0.3, cx, by + 6.1, wallZ + 0.05)
  const kinds: Screen['kind'][] = ['radar', 'map', 'graph', 'text', 'graph', 'radar', 'text', 'map']
  for (let i = 0; i < 8; i++) { const sx = cx - 17.5 + i * 5; place(mkScreen(kinds[i], 4.6, 3.6, i * 7 + 1), sx, by + 7.9, wallZ - 0.12, Math.PI); place(mkScreen(kinds[(i + 3) % 8], 4.6, 3.6, i * 5 + 3), sx, by + 4.2, wallZ - 0.12, Math.PI) }
  place(mkScreen('logo', 9, 3, 1), BUNKER.x1 - 0.42, by + 6, 1430, -Math.PI / 2); place(mkScreen('logo', 9, 3, 2), BUNKER.x0 + 0.42, by + 6, 1412, Math.PI / 2)
  // Arbeitsplätze mit Monitoren und Stühlen
  for (let i = 0; i < 6; i++) {
    const x = BK.drone.x - 25 + i * 10, z = BUNKER.z1 - 8
    if (Math.abs(x - BK.drone.x) < 8) continue
    B.box(dark, 4.4, 0.18, 1.8, x, by + 1.05, z); B.box(steel, 0.2, 1.05, 1.5, x - 2, by + 0.52, z); B.box(steel, 0.2, 1.05, 1.5, x + 2, by + 0.52, z)
    B.box(black, 1.4, 0.04, 0.5, x, by + 1.16, z - 0.3); B.box(black, 0.3, 0.4, 0.3, x + 1.5, by + 0.3, z - 0.2)
    place(mkScreen(kinds[(i * 3) % 8], 1.5, 0.95, i * 11), x - 0.9, by + 1.95, z + 0.3, Math.PI, -0.06); place(mkScreen(kinds[(i * 3 + 1) % 8], 1.5, 0.95, i * 13), x + 0.9, by + 1.95, z + 0.3, Math.PI, -0.06)
    B.box(black, 0.1, 0.6, 0.1, x - 0.9, by + 1.45, z + 0.45); B.box(black, 0.1, 0.6, 0.1, x + 0.9, by + 1.45, z + 0.45)
    B.box(dark, 0.9, 0.12, 0.9, x, by + 0.6, z - 1.5); B.box(dark, 0.9, 0.9, 0.12, x, by + 1.1, z - 1.95); B.cyl(steel, 0.08, 0.55, x, by + 0.3, z - 1.5)
  }
  // ── Drohnen-Konsole: drei Schirme, Pult, Stuhl, Drohne im Dock ──
  {
    const x = BK.drone.x, z = BK.drone.z + 1.6
    B.box(dark, 21, 0.24, 2.8, x, by + 1.1, z); B.box(steel, 21, 1.1, 0.3, x, by + 0.55, z + 1.3); B.box(black, 6, 0.06, 1, x, by + 1.26, z - 0.4); B.box(cyan, 6.2, 0.04, 0.06, x, by + 1.24, z - 0.9)
    for (let i = -1; i <= 1; i++) { place(mkScreen(i === 0 ? 'map' : 'radar', 5.6, 3.1, 40 + i), x + i * 5.8, by + 3.3, z + 0.9 - Math.abs(i) * 0.5, Math.PI + i * 0.35, -0.08); B.box(black, 5.8, 3.3, 0.14, x + i * 5.8 + i * 0.03, by + 3.3, z + 1.05 - Math.abs(i) * 0.5, Math.PI + i * 0.35) }
    B.box(dark, 1.1, 0.12, 1.1, x, by + 0.65, z - 2.6); B.box(dark, 1.1, 1.1, 0.14, x, by + 1.2, z - 3.1); B.cyl(steel, 0.09, 0.65, x, by + 0.32, z - 2.6)
    B.box(red, 0.6, 0.05, 0.4, x + 7, by + 1.27, z - 0.3); B.box(cyan, 0.5, 0.04, 0.3, x - 7, by + 1.27, z - 0.3)
    const dock = new THREE.Group(); dock.position.set(x + 13.6, by + 1.25, z + 0.2); hall.add(dock)
    const db = new Batch(THREE); db.box(steel, 3, 0.2, 3, 0, 0, 0); db.box(cyan, 2.6, 0.04, 2.6, 0, 0.12, 0); db.box(black, 0.9, 0.25, 0.9, 0, 0.45, 0); db.box(dark, 0.5, 0.22, 0.5, 0, 0.3, 0)
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) { db.box(black, 0.9, 0.06, 0.06, sx * 0.55, 0.5, sz * 0.55, Math.atan2(sz, sx) + Math.PI / 2); db.cyl(dark, 0.06, 0.3, sx * 0.95, 0.5, sz * 0.95) }
    db.build(dock)
    const rotors: T.Mesh[] = []
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.02, 14), glass); r.position.set(sx * 0.95, 0.68, sz * 0.95); dock.add(r); rotors.push(r); disposables.push(r.geometry) }
    dyn.push((o) => { dock.position.y = by + 1.5 + Math.sin(o.t * 1.6) * 0.18; for (const r of rotors) r.rotation.y = o.t * 30 })
  }
  // ── Strategietisch mit Hologramm ──
  {
    const x = BK.table.x, z = BK.table.z
    B.box(dark, 8.6, 0.5, 4.6, x, by + 0.9, z); B.box(steel, 8, 0.7, 4, x, by + 0.35, z); B.box(black, 8.2, 0.06, 4.2, x, by + 1.17, z); B.box(cyan, 8.4, 0.05, 0.1, x, by + 1.2, z - 2.2); B.box(cyan, 8.4, 0.05, 0.1, x, by + 1.2, z + 2.2)
    const hg = new THREE.Group(); hg.position.set(x, by + 2.4, z); hall.add(hg)
    const mk = (geo: T.BufferGeometry, mat: T.Material) => { disposables.push(geo); const m = new THREE.Mesh(geo, mat); hg.add(m); return m }
    const globe = mk(new THREE.IcosahedronGeometry(1.1, 2), holo), core = mk(new THREE.IcosahedronGeometry(0.8, 1), holoFill)
    const ring = mk(new THREE.TorusGeometry(1.6, 0.02, 6, 48), holo), ring2 = mk(new THREE.TorusGeometry(1.35, 0.02, 6, 48), holo)
    ring.rotation.x = Math.PI / 2.4; ring2.rotation.x = -Math.PI / 2.8
    const cityM = new THREE.Group(); cityM.position.set(0, -1.1, 0); hg.add(cityM)
    for (let i = 0; i < 28; i++) { const h = 0.1 + ((i * 37) % 11) / 14; const g = new THREE.BoxGeometry(0.28, h, 0.28); disposables.push(g); const b = new THREE.Mesh(g, holoFill); b.position.set(((i % 7) - 3) * 0.5, h / 2 - 0.1, (Math.floor(i / 7) - 1.5) * 0.5); cityM.add(b) }
    dyn.push((o) => { globe.rotation.y = o.t * 0.5; core.rotation.y = -o.t * 0.8; ring.rotation.z = o.t * 0.6; ring2.rotation.z = -o.t * 0.4; cityM.rotation.y = o.t * 0.15 })
  }
  // ── Quad-Podest (Drehteller) mit Portal, Montagearm, Werkzeugwand und Terminal ──
  const pad = BK.pad
  B.cyl(dark, pad.r, 0.5, pad.x, by + 0.25, pad.z, 'y', 32); B.cyl(yellow, pad.r - 0.2, 0.02, pad.x, by + 0.52, pad.z, 'y', 32)
  const quadSlot = new THREE.Group(); quadSlot.position.set(pad.x, by + 0.55, pad.z); hall.add(quadSlot)
  let quadMesh: T.Group | null = null
  const setQuad = (color: string, weapon: QuadWeapon) => {
    if (quadMesh) { quadSlot.remove(quadMesh); quadMesh.traverse((o) => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose() }) }
    quadMesh = makeQuadModel(THREE, color); const r1 = quadMesh.userData.rider as T.Group | undefined; if (r1) r1.visible = false
    setQuadWeapon(quadMesh, weapon); quadMesh.scale.setScalar(1.7); quadSlot.add(quadMesh)
  }
  setQuad('#3d4a32', 'minigun')
  dyn.push((o) => { quadSlot.rotation.y = o.t * 0.3 })
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; B.box(i % 2 ? lamp : cyan, 0.4, 0.06, 0.4, pad.x + Math.cos(a) * (pad.r - 0.35), by + 0.55, pad.z + Math.sin(a) * (pad.r - 0.35)) }
  for (const sx of [-1, 1]) { B.box(steel, 0.5, C - 1.5, 0.5, pad.x + sx * (pad.r + 1.2), by + (C - 1.5) / 2, pad.z + 2); B.box(yellow, 0.52, 0.5, 0.52, pad.x + sx * (pad.r + 1.2), by + 1, pad.z + 2) }
  B.box(steel, pad.r * 2 + 3, 0.6, 0.6, pad.x, by + C - 1.6, pad.z + 2)
  for (const dx of [-3, 0, 3]) { B.box(black, 0.9, 0.5, 0.9, pad.x + dx, by + C - 2.1, pad.z + 2); B.cyl(lamp, 0.35, 0.05, pad.x + dx, by + C - 2.4, pad.z + 2) }
  // Gelenkarm (Roboterarm) – gemeinsam für Podest und Werkstatt
  const robotArm = (px: number, pz: number, arm: T.Material, reach: number, motion: (o: { t: number }, j1: T.Group, j2: T.Group, j3: T.Group) => void) => {
    const base = new THREE.Group(); base.position.set(px, by, pz); hall.add(base)
    const ab = new Batch(THREE); ab.cyl(dark, 0.85, 0.8, 0, 0.4, 0); ab.cyl(yellow, 0.9, 0.12, 0, 0.82, 0); ab.build(base)
    const j1 = new THREE.Group(); j1.position.y = 0.9; base.add(j1)
    const a1 = new Batch(THREE); a1.cyl(steel, 0.33, 0.5, 0, 0.1, 0); a1.box(arm, 0.52, 3.3, 0.52, 0, 1.65, 0); a1.build(j1)
    const j2 = new THREE.Group(); j2.position.set(0, 3.3, 0); j1.add(j2)
    const a2 = new Batch(THREE); a2.cyl(steel, 0.31, 0.8, 0, 0, 0, 'x'); a2.box(arm, 0.44, 0.44, reach, 0, 0, reach / 2); a2.box(yellow, 0.48, 0.12, 0.5, 0, 0.28, 0.2); a2.build(j2)
    const j3 = new THREE.Group(); j3.position.set(0, 0, reach); j2.add(j3)
    const a3 = new Batch(THREE); a3.cyl(steel, 0.23, 0.55, 0, 0, 0, 'x'); a3.box(dark, 0.32, 0.32, 0.8, 0, 0, 0.45); a3.box(steel, 0.08, 0.5, 0.12, -0.2, 0, 1.05); a3.box(steel, 0.08, 0.5, 0.12, 0.2, 0, 1.05); a3.build(j3)
    dyn.push((o) => motion(o, j1, j2, j3))
  }
  robotArm(pad.x - pad.r - 2.2, pad.z - 1, orange, 3, (o, j1, j2, j3) => { j1.rotation.y = -0.6 + Math.sin(o.t * 0.55) * 0.5; j2.rotation.x = 0.4 + Math.sin(o.t * 0.9) * 0.3; j3.rotation.x = Math.sin(o.t * 1.7) * 0.5 })
  {
    const x = BK.tune.x, z = BK.tune.z
    B.box(dark, 4, 1.2, 1.2, x, by + 0.6, z + 1.4); B.box(steel, 4.1, 0.1, 1.3, x, by + 1.25, z + 1.4); B.box(black, 3.6, 0.06, 0.9, x, by + 1.3, z + 1.3)
    place(mkScreen('quad', 3.6, 1.7, 77), x, by + 2.3, z + 1.05, Math.PI, 0.1); B.box(black, 3.8, 1.9, 0.15, x, by + 2.3, z + 1.15, 0, 0.1)
    for (let i = 0; i < 5; i++) B.box(i % 2 ? green : cyan, 0.2, 0.06, 0.2, x - 1.4 + i * 0.7, by + 1.34, z + 1.7)
    for (let i = 0; i < 6; i++) B.cyl(paints[i % 6], 0.35, 0.55, BUNKER.x0 + 3.2 + i * 1.1, by + 0.3, BK.pad.z - 9)
    B.box(olive, 7, 2.4, 0.2, BUNKER.x0 + 6.5, by + 2.0, BK.pad.z - 11.8)
    for (let i = 0; i < 14; i++) B.box(steel, 0.12, 0.9 + (i % 3) * 0.3, 0.1, BUNKER.x0 + 3.4 + i * 0.45, by + 2.2, BK.pad.z - 11.6)
    for (let i = 0; i < 5; i++) B.cyl(black, 0.55, 0.4, BUNKER.x0 + 3.5, by + 0.2 + i * 0.42, BK.pad.z + 13, 'y', 14)
  }
  // ── Iron-Man-Werkstatt: Podest, Anzug im Bau, zwei Greifarme, Regale, Förderband ──
  {
    const f = BK.forge
    B.cyl(dark, 3.4, 0.5, f.x, by + 0.25, f.z, 'y', 24); B.cyl(yellow, 3.2, 0.02, f.x, by + 0.52, f.z, 'y', 24); B.cyl(cyan, 2.2, 0.03, f.x, by + 0.54, f.z, 'y', 24)
    B.box(steel, 8.6, 0.6, 0.6, f.x, by + C - 1.6, f.z); for (const sx of [-1, 1]) B.box(steel, 0.5, C - 1.4, 0.5, f.x + sx * 4.3, by + (C - 1.4) / 2, f.z)
    const stand = new THREE.Group(); stand.position.set(f.x, by + 0.55, f.z); hall.add(stand)
    let suit: T.Group | null = null, suitT0 = -99
    const mkSuit = () => {
      if (suit) { stand.remove(suit); suit.traverse((o) => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose() }) }
      suit = makeWalkerModel(THREE, '#dc2626', '#7f1d1d'); suit.scale.setScalar(1.3); addIronSuit(THREE, suit); stand.add(suit)
    }
    mkSuit()
    for (const k of [-1, 1]) robotArm(f.x + k * 4.6, f.z + 1.2, red, 3.4, (o, j1, j2, j3) => { const w = Math.sin(o.t * 0.8 + (k > 0 ? 0 : 1.7)); j1.rotation.y = k * (-1.25 + w * 0.18); j2.rotation.x = 0.55 + w * 0.2; j3.rotation.x = -0.25 + Math.sin(o.t * 2.3 + k) * 0.25 })
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff1a8 })); spark.visible = false; hall.add(spark); disposables.push(spark.geometry)
    dyn.push((o) => {
      // alle 16 s beginnt der Anzug neu zu entstehen (Teile fliegen heran), die Arme „schweißen“
      if (o.t - suitT0 > 16) { suitT0 = o.t; mkSuit() }
      spark.visible = o.t - suitT0 < 8 && Math.sin(o.t * 40) > 0
      spark.position.set(f.x + Math.sin(o.t * 3) * 0.5, by + 1.6 + Math.sin(o.t * 1.3) * 0.7, f.z + 0.6)
      if (suit) suit.rotation.y = o.t * 0.4
    })
    for (let i = 0; i < 5; i++) { for (let k = 0; k < 3; k++) B.box(dark, 0.2, 0.15, 0.9, BUNKER.x1 - 1.6, by + 0.8 + k * 1.2, 1409 + i * 1.8); B.box(steel, 0.12, 3.8, 0.12, BUNKER.x1 - 1.6, by + 1.9, 1409 + i * 1.8) }
    for (let i = 0; i < 12; i++) B.box(i % 2 ? red : yellow, 0.55, 0.5, 0.55, BUNKER.x1 - 1.6, by + 0.75 + (i % 3) * 1.2, 1409.3 + Math.floor(i / 3) * 1.8)
    B.box(dark, 1.4, 0.7, 14, f.x, by + 0.35, f.z + 12); B.box(black, 1.1, 0.05, 13.6, f.x, by + 0.72, f.z + 12)
    for (let i = 0; i < 14; i++) B.cyl(steel, 0.12, 1.3, f.x, by + 0.6, f.z + 5.4 + i, 'x', 6)
    for (let i = 0; i < 6; i++) B.box(i % 2 ? red : steel, 0.5, 0.35, 0.7, f.x, by + 0.9, f.z + 6 + i * 2)
  }
  // ── Waffenregal, Munitionskisten, Fässer, Löscher ──
  for (let i = 0; i < 4; i++) { B.box(dark, 0.3, 3, 4, BUNKER.x0 + 1.6, by + 1.5, 1442 + i * 4.5); for (let k = 0; k < 4; k++) B.box(black, 0.2, 0.12, 3.6, BUNKER.x0 + 1.75, by + 0.5 + k * 0.7, 1442 + i * 4.5); for (let k = 0; k < 6; k++) B.box(olive, 0.14, 0.14, 0.9, BUNKER.x0 + 1.9, by + 1.3, 1440.5 + i * 4.5 + k * 0.55) }
  for (let i = 0; i < 8; i++) B.box(i % 2 ? olive : sand, 1.2, 0.7, 0.8, BUNKER.x0 + 3.2, by + 0.35 + (i % 2) * 0.7, 1396 + Math.floor(i / 2) * 1.5)
  for (let i = 0; i < 5; i++) B.cyl(i % 2 ? red : olive, 0.45, 1.1, BUNKER.x1 - 3, by + 0.55, 1393 + i * 1.1, 'y', 12)
  B.cyl(red, 0.14, 0.6, BUNKER.x0 + 1, by + 1.3, BUNKER.z0 + 14, 'y', 8)
  // Leitlinien am Boden
  B.box(yellow, 0.35, 0.02, 24, BK.lift.x, by + 0.02, BK.lift.z + 12.5); B.box(yellow, 30, 0.02, 0.35, BK.lift.x - 15, by + 0.02, BK.lift.z + 6); B.box(cyan, 0.3, 0.02, 20, BK.lift.x + 14, by + 0.02, BK.lift.z + 22)
  B.build(hall)

  // ── Oberfläche: Luke, Rahmen, Tastenfeld, Leuchten ──
  const SB = new Batch(THREE)
  const hs = sh + 0.8
  for (const sx of [-1, 1]) { SB.box(concreteD, 0.9, 0.35, hs * 2 + 1.8, ex + sx * (hs + 0.45), 0.12, BUNKER.ez); SB.box(concreteD, hs * 2, 0.35, 0.9, ex, 0.12, BUNKER.ez + sx * (hs + 0.45)) }
  for (let i = 0; i < 12; i++) { SB.box(i % 2 ? black : yellow, 0.9, 0.04, 0.9, ex - hs - 0.45, 0.31, BUNKER.ez - hs + i); SB.box(i % 2 ? black : yellow, 0.9, 0.04, 0.9, ex + hs + 0.45, 0.31, BUNKER.ez - hs + i) }
  SB.cyl(steel, 0.18, 3.2, BUNKER.kx, 1.6, BUNKER.kz, 'y', 10); SB.box(dark, 0.9, 1.1, 0.5, BUNKER.kx, 3.0, BUNKER.kz); SB.box(black, 0.9, 0.5, 0.52, BUNKER.kx, 2.0, BUNKER.kz)
  for (let i = 0; i < 9; i++) SB.box(i % 3 === 1 ? green : steel, 0.12, 0.12, 0.05, BUNKER.kx - 0.25 + (i % 3) * 0.25, 2.2 - Math.floor(i / 3) * 0.15, BUNKER.kz - 0.28)
  SB.build(surface)
  const kpScr = mkScreen('text', 0.8, 0.8, 5); kpScr.position.set(BUNKER.kx, 3.1, BUNKER.kz - 0.27); kpScr.rotation.y = Math.PI; surface.add(kpScr)
  const slabGeo = new THREE.BoxGeometry(hs, 0.5, hs * 2); disposables.push(slabGeo)
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 0.8, metalness: 0.2 })
  const slabs = [-1, 1].map((sx) => { const m = new THREE.Mesh(slabGeo, slabMat); m.position.set(ex + sx * hs / 2, 0.05, BUNKER.ez); surface.add(m); return m })
  const hazard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, hs * 2), new THREE.MeshStandardMaterial({ color: 0xf2c200, emissive: 0x3a2e00 })); hazard.position.set(ex, 0.31, BUNKER.ez); surface.add(hazard); disposables.push(hazard.geometry)
  const beacon = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); beacon.position.set(ex + hs + 0.45, 1.6, BUNKER.ez + hs + 0.45); surface.add(beacon); disposables.push(beacon.geometry)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 6), steel); post.position.set(beacon.position.x, 0.7, beacon.position.z); surface.add(post); disposables.push(post.geometry)
  const shaftGlow = new THREE.Mesh(new THREE.BoxGeometry(hs * 2 - 0.4, 0.04, hs * 2 - 0.4), new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0 })); shaftGlow.position.set(ex, -0.4, BUNKER.ez); surface.add(shaftGlow); disposables.push(shaftGlow.geometry)

  // ── Bildschirm-Zeichnung (nur wenn sichtbar, ca. 8 Bilder/s) ──
  let lastDraw = -1
  const drawScreen = (s: Screen, t: number) => {
    const g = s.cv.getContext('2d'); if (!g) return
    const w = s.cv.width, h = s.cv.height
    g.fillStyle = '#04141c'; g.fillRect(0, 0, w, h)
    g.strokeStyle = '#0e7490'; g.lineWidth = 1
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke() }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke() }
    g.strokeStyle = '#22d3ee'; g.fillStyle = '#22d3ee'; g.font = 'bold 14px monospace'
    const a = t * 1.2 + s.seed
    if (s.kind === 'radar') {
      const r = Math.min(w, h) * 0.42
      g.beginPath(); g.arc(w / 2, h / 2, r, 0, 7); g.stroke(); g.beginPath(); g.arc(w / 2, h / 2, r / 2, 0, 7); g.stroke()
      g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); g.stroke()
      g.fillStyle = '#4ade80'; for (let i = 0; i < 5; i++) { const aa = s.seed * 3 + i * 1.7, rr = r * (0.3 + ((i * 37 + s.seed) % 10) / 16); g.fillRect(w / 2 + Math.cos(aa) * rr, h / 2 + Math.sin(aa) * rr, 4, 4) }
    } else if (s.kind === 'graph') {
      g.beginPath(); for (let x = 0; x <= w; x += 4) { const y = h / 2 + Math.sin(x * 0.05 + a * 2) * h * 0.25 + Math.sin(x * 0.17 + s.seed) * h * 0.1; if (x) g.lineTo(x, y); else g.moveTo(x, y) } g.stroke()
      g.fillStyle = '#f59e0b'; for (let i = 0; i < 8; i++) { const bh = Math.abs(Math.sin(a + i * 0.8)) * h * 0.4; g.fillRect(8 + i * 18, h - bh, 12, bh) }
    } else if (s.kind === 'map') {
      g.strokeStyle = '#155e75'; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(0, 18 + i * h / 7); g.lineTo(w, 18 + i * h / 7 + ((i * 23 + s.seed) % 20) - 10); g.stroke() }
      g.strokeStyle = '#22d3ee'; g.beginPath(); g.arc(w * (0.3 + 0.4 * Math.abs(Math.sin(a * 0.3))), h * 0.5, 14 + Math.sin(a * 3) * 3, 0, 7); g.stroke()
      g.fillStyle = '#f87171'; g.fillRect(w * 0.6, h * 0.35, 6, 6); g.fillRect(w * 0.25, h * 0.7, 6, 6)
    } else if (s.kind === 'text') {
      g.fillStyle = '#4ade80'; for (let i = 0; i < 9; i++) { const n = 6 + ((i * 7 + Math.floor(t * 2) + s.seed) % 18); g.fillText('█'.repeat(n % 12) + ' ' + (1000 + ((i * 131 + Math.floor(t * 3)) % 9000)), 8, 16 + i * 16) }
    } else if (s.kind === 'quad') {
      g.fillStyle = '#22d3ee'; g.font = 'bold 22px monospace'; g.fillText('KSK QUAD-SCHMIEDE', 12, 32); g.font = 'bold 14px monospace'; g.fillStyle = '#e5e7eb'
      g.fillText('FARBE · WAFFE · AUSRÜSTUNG', 12, 56); g.fillStyle = '#4ade80'; g.fillText('> [G] zum Anpassen', 12, h - 16)
      g.strokeStyle = '#22d3ee'; g.strokeRect(12, 70, w - 24, h - 110); g.fillStyle = '#0e7490'; g.fillRect(24 + ((t * 40) % (w - 60)), 90, 20, 8)
    } else {
      g.fillStyle = '#4ade80'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.fillText('KSK', w / 2, h * 0.62); g.font = 'bold 16px monospace'; g.fillStyle = '#22d3ee'; g.fillText('KOMMANDO SPEZIALKRÄFTE', w / 2, h * 0.88); g.textAlign = 'start'
    }
    g.fillStyle = 'rgba(34,211,238,0.08)'; g.fillRect(0, (t * 60 + s.seed * 9) % h, w, 6)
    s.tex.needsUpdate = true
  }
  const update: BunkerView['update'] = (o) => {
    hall.visible = o.showHall
    const hk = hatchK(o.hatch)
    slabs[0].position.x = ex - hs / 2 - hk * (hs + 0.2); slabs[1].position.x = ex + hs / 2 + hk * (hs + 0.2)
    hazard.visible = hk < 0.98
    beacon.visible = o.moving || (o.hatch > 0.02 && o.hatch < 0.98); beacon.rotation.y = o.t * 8
    ;(shaftGlow.material as T.MeshBasicMaterial).opacity = hk * 0.5
    cage.position.y = liftY(o.lift)
    if (!o.showHall && !(o.hatch > 0.02)) return
    for (const f of dyn) f(o)
    if (o.t - lastDraw > 0.12) { lastDraw = o.t; for (const s of screens) drawScreen(s, o.t) }
  }
  return { hall, surface, update, setQuad, dispose: () => { scene.remove(hall); scene.remove(surface); for (const grp of [hall, surface]) grp.traverse((x) => { const m = x as T.Mesh; if (m.geometry) m.geometry.dispose() }); for (const d of disposables) d.dispose() } }
}
