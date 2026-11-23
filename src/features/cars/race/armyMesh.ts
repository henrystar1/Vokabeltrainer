import type * as T from 'three'

type THREE = typeof T

const mat = (THREE: THREE, color: number, o: { rough?: number; metal?: number } = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0.2 })

/** Armee-Fahrzeuge: Panzer, Kampfhubschrauber, Waffenauto. Vorne ist +z, wie bei allen Fahrzeugen. */
export function makeArmyModel(THREE: THREE, kind: string, color?: string): T.Group {
  const g = new THREE.Group()
  const olive = mat(THREE, kind === 'heli' && color ? new THREE.Color(color).getHex() : 0x4d5d3a), dark = mat(THREE, 0x1f2a1a), steel = mat(THREE, 0x3b4252, { metal: 0.6, rough: 0.4 }), glass = mat(THREE, 0x1e3a5f, { rough: 0.1, metal: 0.8 })
  const box = (w: number, h: number, d: number, m: T.Material, x: number, y: number, z: number, parent: T.Object3D = g) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); parent.add(b); return b }
  const cyl = (r: number, len: number, m: T.Material, x: number, y: number, z: number, parent: T.Object3D = g) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); parent.add(c); return c }
  const shadow = () => { const sh = new THREE.Mesh(new THREE.PlaneGeometry(4, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.07; g.add(sh) }
  if (kind === 'tank') {
    box(2.6, 0.9, 6.6, olive, 0, 1.0, 0)
    box(2.2, 0.5, 1.4, olive, 0, 1.0, 3.5).rotation.x = -0.35
    for (const sx of [-1, 1]) {
      box(0.95, 1.1, 7.2, dark, sx * 1.35, 0.65, 0)
      for (let i = 0; i < 6; i++) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10), steel); w.rotation.z = Math.PI / 2; w.position.set(sx * 1.35, 0.45, -3 + i * 1.2); g.add(w) }
      box(1.0, 0.12, 7.0, olive, sx * 1.35, 1.25, 0)
    }
    const turret = new THREE.Group(); turret.position.set(0, 1.6, -0.3); g.add(turret)
    box(2.2, 0.8, 2.8, olive, 0, 0.4, 0, turret)
    box(1.6, 0.4, 1.0, olive, 0, 0.9, -0.3, turret)
    cyl(0.17, 4.2, steel, 0, 0.5, 3.3, turret)
    cyl(0.25, 0.7, steel, 0, 0.5, 1.5, turret)
    box(0.5, 0.3, 0.5, dark, 0.6, 1.2, -0.6, turret)
    const mg = cyl(0.05, 1.2, steel, 0.6, 1.45, 0.1, turret); void mg
    const star = box(0.9, 0.02, 0.9, mat(THREE, 0xf8fafc), 0, 1.42, 0.4); star.rotation.y = Math.PI / 4
    g.userData.turret = turret
    shadow()
  } else if (kind === 'heli') {
    box(2.0, 1.9, 4.6, olive, 0, 2.1, 0)
    box(1.7, 1.2, 1.8, glass, 0, 2.2, 2.6)
    box(0.7, 0.8, 5.2, olive, 0, 2.5, -4.6)
    box(0.14, 1.6, 1.2, olive, 0, 3.2, -7.0)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.18), dark); tail.position.set(0.2, 3.1, -7.1); g.add(tail); g.userData.tailRotor = tail
    for (const sx of [-1, 1]) {
      cyl(0.06, 4.6, steel, sx * 1.1, 0.7, 0.2); box(0.08, 1.0, 0.08, steel, sx * 1.1, 1.2, 1.2); box(0.08, 1.0, 0.08, steel, sx * 1.1, 1.2, -1.0)
      box(0.5, 0.5, 1.6, dark, sx * 1.55, 1.8, 0.6); cyl(0.04, 1.4, steel, sx * 1.55, 1.8, 1.8)
    }
    box(0.3, 0.5, 0.3, steel, 0, 3.3, 0)
    if (color && color.toLowerCase() === '#f8fafc') for (const sx of [-1, 1]) { const red = mat(THREE, 0xdc2626); box(0.06, 0.8, 0.26, red, sx * 1.02, 2.1, 0.2); box(0.06, 0.26, 0.8, red, sx * 1.02, 2.1, 0.2); box(2.04, 0.12, 4.0, red, 0, 1.3, 0) }
    const rotor = new THREE.Group(); rotor.position.set(0, 3.6, 0)
    box(11, 0.07, 0.34, dark, 0, 0, 0, rotor); box(0.34, 0.07, 11, dark, 0, 0, 0, rotor)
    g.add(rotor); g.userData.rotor = rotor
    cyl(0.03, 1.6, steel, 0, 1.0, 3.2)
  } else {
    box(2.0, 0.6, 4.4, olive, 0, 0.8, 0)
    box(1.5, 0.5, 1.4, olive, 0, 0.95, 2.4)
    box(1.7, 0.8, 1.4, glass, 0, 1.4, 0.6)
    for (const sx of [-1, 1]) for (const z of [-0.2, 1.8]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), steel); p.position.set(sx * 0.9, 1.65, z); g.add(p) }
    box(1.9, 0.05, 2.2, dark, 0, 2.3, 0.8)
    const mount = new THREE.Group(); mount.position.set(0, 1.5, -1.3); g.add(mount)
    box(0.5, 0.6, 0.5, steel, 0, 0.3, 0, mount); box(0.45, 0.3, 0.8, dark, 0, 0.7, 0.2, mount); cyl(0.045, 1.4, steel, 0, 0.72, 1.1, mount)
    const wheels: T.Group[] = []
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const w = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 14), mat(THREE, 0x14161b, { rough: 0.9 })); t.rotation.z = Math.PI / 2
      w.add(t); w.position.set(sx * 1.1, 0.55, sz * 1.5); w.name = sz > 0 ? 'front' : 'rear'; g.add(w); wheels.push(w)
    }
    g.userData.wheels = wheels
    shadow()
  }
  g.userData.len = kind === 'tank' ? 7.4 : kind === 'heli' ? 8.5 : 4.8
  g.userData.wid = kind === 'tank' ? 3.6 : kind === 'heli' ? 3.0 : 2.2
  return g
}
