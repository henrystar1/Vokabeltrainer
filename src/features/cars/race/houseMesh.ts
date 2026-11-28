import type * as T from 'three'
import { FURNITURE, furnDef, garageDoor, houseById, type Furn, type GarageDoor, type HouseData } from './house'

type THREE = typeof T

/** Garagentore (Rolltor, animiert) und Möbel der gekauften Häuser. */
export interface HouseWorld {
  setHouses: (list: HouseData[]) => void
  /** Möbel eines Hauses sofort neu zeichnen (Editor) */
  setFurn: (bld: number, f: Furn[]) => void
  setDoor: (bld: number, open: boolean) => void
  /** Wandfarbe eines Hauses (null = Original) */
  setWall: (bld: number, color: string | null) => void
  /** Haus, in dem man gerade steht (-1 = keins): Außenfarbhülle ausblenden */
  setInside: (bld: number) => void
  tick: (px: number, pz: number, dt: number) => void
  doorK: (bld: number) => number
  dispose: () => void
}

export function makeHouseWorld(THREE: THREE, scene: T.Scene): HouseWorld {
  const root = new THREE.Group(); scene.add(root)
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mats = new Map<number, T.MeshStandardMaterial>()
  const mat = (c: number) => { let m = mats.get(c); if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); mats.set(c, m) } return m }
  interface Entry { bld: number; door: GarageDoor; panel: T.Group; k: number; want: number; furn: T.Group; cx: number; cz: number; shell: T.Mesh | null }
  let inside = -1
  const entries = new Map<number, Entry>()
  const buildFurn = (g: T.Group, f: Furn[]) => {
    g.clear()
    for (const it of f) {
      const d = furnDef(it.k) ?? FURNITURE[0], w = it.r ? d.d : d.w, dd = it.r ? d.w : d.d
      const m = new THREE.Mesh(geo, mat(d.color)); m.scale.set(w, d.h, dd); m.position.set(it.x, 0.06 + d.h / 2, it.z); g.add(m)
      if (it.k === 'bed') { const p = new THREE.Mesh(geo, mat(0xf8fafc)); p.scale.set(it.r ? 1.4 : 0.5, 0.15, it.r ? 0.5 : 1.4); p.position.set(it.x + (it.r ? 0 : -0.6), 0.06 + d.h + 0.07, it.z + (it.r ? -0.6 : 0)); g.add(p) }
      if (it.k === 'tv') { const s = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x38bdf8 })); s.scale.set(it.r ? 0.04 : 1.0, 0.6, it.r ? 1.0 : 0.04); s.position.set(it.x + (it.r ? 0.19 : 0), 0.06 + d.h / 2 + 0.1, it.z + (it.r ? 0 : 0.19)); g.add(s) }
    }
  }
  const makeDoor = (d: GarageDoor): { frame: T.Group; panel: T.Group } => {
    const frame = new THREE.Group()
    const rot = Math.atan2(d.nx, d.nz)
    frame.position.set(d.x + d.nx * 0.12, 0, d.z + d.nz * 0.12); frame.rotation.y = rot
    const post = (x: number) => { const m = new THREE.Mesh(geo, mat(0xd1d5db)); m.scale.set(0.3, d.h + 0.3, 0.3); m.position.set(x, (d.h + 0.3) / 2, 0); frame.add(m) }
    post(-d.w / 2 - 0.15); post(d.w / 2 + 0.15)
    const lintel = new THREE.Mesh(geo, mat(0xd1d5db)); lintel.scale.set(d.w + 0.6, 0.3, 0.3); lintel.position.set(0, d.h + 0.15, 0); frame.add(lintel)
    const dark = new THREE.Mesh(geo, mat(0x0b0f17)); dark.scale.set(d.w, d.h, 0.06); dark.position.set(0, d.h / 2, -0.05); frame.add(dark)
    const panel = new THREE.Group(); panel.position.set(0, d.h, 0.05)
    const n = 8
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(geo, mat(i % 2 ? 0x9ca3af : 0xb6bcc6)); s.scale.set(d.w, d.h / n - 0.02, 0.1); s.position.set(0, -(i + 0.5) * (d.h / n), 0); panel.add(s)
    }
    frame.add(panel)
    return { frame, panel }
  }
  const shellMat = new THREE.MeshStandardMaterial({ roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const paintShell = (e: Entry, color: string | null) => {
    const b = houseById(e.bld); if (!b) return
    if (!color) { if (e.shell) { root.remove(e.shell); e.shell.material instanceof THREE.Material && e.shell.material.dispose(); e.shell = null } return }
    if (!e.shell) { const m = new THREE.Mesh(geo, shellMat.clone()); m.scale.set(b.w + 0.04, b.h - 0.06, b.d + 0.04); m.position.set(b.x, (b.h - 0.06) / 2, b.z); root.add(m); e.shell = m }
    ;(e.shell.material as T.MeshStandardMaterial).color.set(color)
  }
  const clear = () => { for (const e of entries.values()) { root.remove(e.panel.parent!, e.furn); if (e.shell) { root.remove(e.shell); (e.shell.material as T.Material).dispose() } } entries.clear() }
  return {
    setHouses(list) {
      clear()
      for (const h of list) {
        const b = houseById(h.bld); if (!b) continue
        const d = garageDoor(b), { frame, panel } = makeDoor(d)
        const furn = new THREE.Group(); furn.position.set(b.x, 0, b.z); buildFurn(furn, h.furn)
        root.add(frame, furn)
        const en: Entry = { bld: h.bld, door: d, panel, k: 0, want: 0, furn, cx: b.x, cz: b.z, shell: null }
        entries.set(h.bld, en); paintShell(en, h.wall)
      }
    },
    setFurn(bld, f) { const e = entries.get(bld); if (e) buildFurn(e.furn, f) },
    setWall(bld, color) { const e = entries.get(bld); if (e) paintShell(e, color) },
    setInside(bld) { inside = bld },
    setDoor(bld, open) { const e = entries.get(bld); if (e) e.want = open ? 1 : 0 },
    tick(px, pz, dt) {
      for (const e of entries.values()) {
        e.k += Math.sign(e.want - e.k) * Math.min(Math.abs(e.want - e.k), dt / 1.4)
        e.panel.scale.y = Math.max(0.06, 1 - e.k)
        e.furn.visible = Math.hypot(px - e.cx, pz - e.cz) < 80
        if (e.shell) e.shell.visible = e.bld !== inside
      }
    },
    doorK: (bld) => entries.get(bld)?.k ?? 0,
    dispose() { clear(); scene.remove(root); geo.dispose(); shellMat.dispose(); for (const m of mats.values()) m.dispose() },
  }
}

/** Alle Wandkameras als drei InstancedMeshes (Halterung, Gehäuse, Linse) */
export function makeWallCamMeshes(THREE: THREE, scene: T.Scene, cams: ReadonlyArray<{ x: number; y: number; z: number; yaw: number }>): () => void {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mk = (color: number, emissive = 0) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, emissive, emissiveIntensity: emissive ? 1 : 0 })
  const mats = [mk(0x6b7280), mk(0xd1d5db), mk(0x0b1226, 0x2563eb)]
  const meshes = mats.map((m) => { const im = new THREE.InstancedMesh(geo, m, cams.length); im.frustumCulled = false; scene.add(im); return im })
  const o = new THREE.Object3D()
  cams.forEach((c, i) => {
    const place = (k: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
      o.position.set(c.x, c.y, c.z); o.rotation.set(0.28, c.yaw, 0, 'YXZ'); o.updateMatrix()
      const m = o.matrix.clone(); o.position.set(lx, ly, lz); o.rotation.set(0, 0, 0); o.scale.set(sx, sy, sz); o.updateMatrix()
      meshes[k].setMatrixAt(i, m.multiply(o.matrix)); o.scale.set(1, 1, 1)
    }
    place(0, 0, 0.1, -0.35, 0.14, 0.5, 0.14)
    place(1, 0, 0, 0.1, 0.4, 0.34, 0.95)
    place(2, 0, 0, 0.6, 0.26, 0.26, 0.08)
  })
  meshes.forEach((m) => { m.instanceMatrix.needsUpdate = true })
  return () => { for (const m of meshes) { scene.remove(m); m.dispose() } geo.dispose(); mats.forEach((m) => m.dispose()) }
}
