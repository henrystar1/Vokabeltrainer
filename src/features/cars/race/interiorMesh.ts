import type * as T from 'three'
import type { Bld } from './city'
import { FLOOR_H, layoutOf, type Rect } from './interior'

type THREE = typeof T

/** Sichtbarer Innenraum eines Hauses: wird nur für das Haus gebaut, in dem die Figur steht; die Außenhaut des Hauses wird dann ausgeblendet. */
export function makeInteriorViewer(THREE: THREE, scene: T.Scene, ext: { geo: T.BufferGeometry; ranges: Map<Bld, [number, number]> }, night: boolean) {
  let cur: Bld | null = null
  let group: T.Group | null = null
  let saved: { b: Bld; arr: Float32Array } | null = null
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
    return g
  }
  return (b: Bld | null, wallMat: T.Material) => {
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
}
