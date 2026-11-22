import type * as T from 'three'
import type { Bld } from './city'
import { FLOOR_H, layoutOf, type Rect } from './interior'
import { poiOf } from './poi'

type THREE = typeof T

/** Sichtbarer Innenraum eines Hauses: wird nur für das Haus gebaut, in dem die Figur steht; die Außenhaut des Hauses wird dann ausgeblendet. */
export function makeInteriorViewer(THREE: THREE, scene: T.Scene, ext: { geo: T.BufferGeometry; ranges: Map<Bld, [number, number]> }, night: boolean) {
  let cur: Bld | null = null
  let group: T.Group | null = null
  let saved: { b: Bld; arr: Float32Array } | null = null
  let vaultDoor: { pivot: T.Group; ang: number } | null = null
  let vaultOpen = false
  const dim = night ? 0.6 : 1
  const mat = (c: number, o = 1, side: T.Side = THREE.DoubleSide) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(dim), emissive: new THREE.Color(c).multiplyScalar(0.35 * dim), roughness: 0.9, side, transparent: o < 1, opacity: o })
  const mats = { floor: mat(0xb08968), roof: mat(0xe5e7eb), part: mat(0xf1efe8, 0.5), step: mat(0xcbd5e1) }

  const restore = () => {
    if (!saved) return
    const [a] = ext.ranges.get(saved.b)!
    const p = ext.geo.getAttribute('position') as T.BufferAttribute
    ;(p.array as Float32Array).set(saved.arr, a * 3); p.needsUpdate = true
    saved = null
  }
  const clear = () => {
    if (group) { scene.remove(group); group.traverse((o) => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose() }); group = null }
  }
  const box = (g: T.Group, r: Rect, y0: number, y1: number, m: T.Material) => {
    if (r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01 || y1 - y0 < 0.01) return
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, y1 - y0, r.z1 - r.z0), m)
    mesh.position.set((r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2); g.add(mesh)
  }
  const build = (b: Bld, wallMat: T.Material) => {
    const L = layoutOf(b)
    const g = new THREE.Group()
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2
    const top = L.floors * FLOOR_H
    for (let k = 0; k <= L.floors; k++) {
      // Platte k, über dem Lauf k−1 mit Loch (oberer Teil)
      const f = k >= 1 ? L.flights[k - 1] : undefined
      const ya = k * FLOOR_H - 0.2, yb = k * FLOOR_H
      const m = k === L.floors ? mats.roof : mats.floor
      if (!f) { box(g, { x0, x1, z0, z1 }, ya, yb, m); continue }
      const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
      const a = f.lo + (f.dir === 1 ? 0.38 : 0) * (f.hi - f.lo), c = f.lo + (f.dir === 1 ? 1 : 0.62) * (f.hi - f.lo)
      const hole: Rect = axisX ? { x0: a, x1: c, z0: f.lane.z0, z1: f.lane.z1 } : { x0: f.lane.x0, x1: f.lane.x1, z0: a, z1: c }
      box(g, { x0, x1, z0, z1: hole.z0 }, ya, yb, m); box(g, { x0, x1, z0: hole.z1, z1 }, ya, yb, m)
      box(g, { x0, x1: hole.x0, z0: hole.z0, z1: hole.z1 }, ya, yb, m); box(g, { x0: hole.x1, x1, z0: hole.z0, z1: hole.z1 }, ya, yb, m)
    }
    // Außenwände: Erdgeschoss mit Türöffnung, darüber geschlossen
    for (const r of L.outerG) box(g, r, 0, FLOOR_H, wallMat)
    for (const r of L.outerUp) box(g, r, FLOOR_H, top, wallMat)
    // Zwischenwände je Geschoss
    for (let k = 0; k < L.floors; k++) for (const r of L.inner) box(g, r, k * FLOOR_H, (k + 1) * FLOOR_H - 0.2, mats.part)
    // Treppenstufen
    for (const f of L.flights) {
      const axisX = f.lane.x1 - f.lane.x0 > f.lane.z1 - f.lane.z0
      const n = 16, len = f.hi - f.lo
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n
        const p0 = f.lo + (f.dir === 1 ? t0 : 1 - t1) * len, p1 = p0 + len / n
        const y1 = f.k * FLOOR_H + ((i + 1) / n) * FLOOR_H
        box(g, axisX ? { x0: p0, x1: p1, z0: f.lane.z0, z1: f.lane.z1 } : { x0: f.lane.x0, x1: f.lane.x1, z0: p0, z1: p1 }, y1 - 0.2, y1, mats.step)
      }
    }
    // Einrichtung
    for (const s of L.solids) {
      const y0 = s.y0 ?? 0
      if (s.h < 0.01) continue
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, s.h, s.z1 - s.z0), new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color).multiplyScalar(dim), roughness: 0.7 }))
      m.position.set((s.x0 + s.x1) / 2, y0 + s.h / 2, (s.z0 + s.z1) / 2); g.add(m)
    }
    // Tresortür: Drehpunkt am Rand, öffnet sich beim Banküberfall
    vaultDoor = null
    const pv = poiOf(b)?.vault
    if (pv) {
      const pivot = new THREE.Group()
      const ang = Math.atan2(pv.nx, pv.nz)
      pivot.position.set(pv.x + pv.nx * 0.16 - Math.cos(ang) * pv.w / 2, 1.4, pv.z + pv.nz * 0.16 + Math.sin(ang) * pv.w / 2)
      pivot.rotation.y = ang
      const steel = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.75, roughness: 0.3 })
      const gold = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.25 })
      const door = new THREE.Mesh(new THREE.BoxGeometry(pv.w, 2.8, 0.42), steel)
      door.position.set(pv.w / 2, 0, 0); pivot.add(door)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(pv.w + 0.3, 3.0, 0.1), new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.7, roughness: 0.4 }))
      frame.position.set(pv.w / 2, 0, -0.2); pivot.add(frame)
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 10, 28), gold)
      wheel.position.set(pv.w / 2, 0, 0.26); pivot.add(wheel)
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, 0.07), gold); sp.rotation.z = (i * Math.PI) / 3; sp.position.set(pv.w / 2, 0, 0.26); pivot.add(sp) }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 14), gold); hub.rotation.x = Math.PI / 2; hub.position.set(pv.w / 2, 0, 0.3); pivot.add(hub)
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const rv = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), gold); rv.position.set(pv.w / 2 + Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0.22); pivot.add(rv) }
      for (const by of [-1, 0, 1]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), steel); bolt.rotation.z = Math.PI / 2; bolt.position.set(pv.w - 0.1, by * 0.9, 0.05); pivot.add(bolt) }
      // Beute hinter der Tür: Goldbarren-Stapel und Geldbündel
      const loot = new THREE.Group()
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5 - r; c++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.28), gold); bar.position.set(-1.2 + c * 0.55 + r * 0.27, 0.12 + r * 0.21, 0.1); loot.add(bar) }
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) { const cash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.25), new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.8 })); cash.position.set(0.9 + c * 0.42, 0.1 + r * 0.19, 0.1); loot.add(cash) }
      loot.position.set(pv.x + pv.nx * 0.1, 0, pv.z + pv.nz * 0.1)
      loot.rotation.y = ang
      g.add(loot)
      pivot.rotation.y = ang + (vaultOpen ? -1.9 : 0)
      vaultDoor = { pivot, ang }
      g.add(pivot)
    }
    return g
  }
  const setVault = (open: boolean) => { vaultOpen = open; if (vaultDoor) vaultDoor.pivot.rotation.y = vaultDoor.ang + (open ? -1.9 : 0) }
  const show = (b: Bld | null, wallMat: T.Material) => {
    if (b === cur) return
    restore(); clear(); cur = b
    if (!b) return
    const r = ext.ranges.get(b)
    if (r) {
      const p = ext.geo.getAttribute('position') as T.BufferAttribute
      const arr = p.array as Float32Array
      saved = { b, arr: arr.slice(r[0] * 3, r[1] * 3) }
      arr.fill(0, r[0] * 3, r[1] * 3); p.needsUpdate = true
    }
    group = build(b, wallMat); scene.add(group)
  }
  return { show, setVault }
}
