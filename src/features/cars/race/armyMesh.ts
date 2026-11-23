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
  const tan = mat(THREE, 0x8a7a52), brown = mat(THREE, 0x3b2f1e), dkolive = mat(THREE, 0x39452b)
  const sph = (rx: number, ry: number, rz: number, m: T.Material, x: number, y: number, z: number, parent: T.Object3D = g) => { const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), m); s.scale.set(rx, ry, rz); s.position.set(x, y, z); parent.add(s); return s }
  const cylA = (r0: number, r1: number, len: number, m: T.Material, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: T.Object3D = g) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 12), m)
    if (axis === 'z') c.rotation.x = Math.PI / 2; else if (axis === 'x') c.rotation.z = Math.PI / 2
    c.position.set(x, y, z); parent.add(c); return c
  }
  if (kind === 'tank') {
    // Wanne mit schräger Bugplatte, Seitenschürzen, Ketten mit Laufrollen
    box(2.5, 0.8, 6.0, olive, 0, 1.0, -0.2)
    const glacis = box(2.4, 0.14, 2.0, olive, 0, 1.28, 3.0); glacis.rotation.x = -0.42
    box(2.4, 0.5, 1.3, dkolive, 0, 1.45, 2.4)
    box(2.3, 0.5, 1.2, dkolive, 0, 1.5, -3.0)
    for (const sx of [-1, 1]) {
      box(0.9, 0.95, 6.6, dark, sx * 1.55, 0.62, 0)
      cylA(0.48, 0.48, 0.9, dark, sx * 1.55, 0.62, 3.3, 'x'); cylA(0.48, 0.48, 0.9, dark, sx * 1.55, 0.62, -3.3, 'x')
      for (let i = 0; i < 7; i++) cylA(0.4, 0.4, 0.34, steel, sx * 1.9, 0.5, -2.7 + i * 0.9, 'x')
      cylA(0.52, 0.52, 0.34, steel, sx * 1.9, 0.62, 3.3, 'x'); cylA(0.46, 0.46, 0.34, steel, sx * 1.9, 0.62, -3.3, 'x')
      box(0.14, 0.62, 5.7, dkolive, sx * 1.98, 1.1, 0)
      box(1.05, 0.1, 6.9, olive, sx * 1.55, 1.15, 0)
      for (let i = 0; i < 9; i++) box(0.95, 0.04, 0.34, mat(THREE, 0x0d130b), sx * 1.55, 1.12, -3.0 + i * 0.75)
    }
    for (const [x, z, sx, sz, m] of [[-0.6, 0.9, 0.8, 0.5, tan], [0.5, -0.7, 0.9, 0.6, brown], [-0.3, -1.8, 0.7, 0.45, tan], [0.7, 1.9, 0.6, 0.5, brown]] as const) box(sx, 0.02, sz, m, x, 1.43, z)
    const turret = new THREE.Group(); turret.position.set(0, 1.55, -0.3); g.add(turret)
    box(2.1, 0.75, 2.7, olive, 0, 0.38, 0, turret)
    const slope = box(2.1, 0.6, 0.9, olive, 0, 0.36, 1.5, turret); slope.rotation.x = -0.5
    box(1.7, 0.18, 2.2, dkolive, 0, 0.78, -0.1, turret)
    box(1.2, 0.62, 0.55, steel, 0, 0.38, 1.85, turret)
    cylA(0.19, 0.19, 1.5, steel, 0, 0.4, 2.7, 'z', turret)
    cylA(0.14, 0.14, 3.6, steel, 0, 0.4, 4.4, 'z', turret)
    cylA(0.24, 0.24, 0.5, dark, 0, 0.4, 6.4, 'z', turret)
    cylA(0.42, 0.42, 0.25, dark, 0.6, 0.9, -0.5, 'y', turret); cylA(0.3, 0.3, 0.08, steel, 0.6, 1.04, -0.5, 'y', turret)
    box(0.35, 0.28, 0.45, dark, -0.6, 0.95, 0.4, turret); cylA(0.04, 0.04, 0.9, steel, -0.6, 1.0, 0.9, 'z', turret)
    box(1.7, 0.45, 0.8, dkolive, 0, 0.5, -1.65, turret)
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) cylA(0.06, 0.06, 0.28, dark, sx * 1.12, 0.6, 0.4 + i * 0.2, 'x', turret)
    cylA(0.025, 0.025, 2.4, steel, -0.9, 1.7, -1.3, 'y', turret)
    const star = box(0.9, 0.02, 0.9, mat(THREE, 0xf8fafc), 1.06, 0.4, 0.3, turret); star.rotation.set(0, 0, Math.PI / 2); star.rotation.y = 0
    g.userData.turret = turret
    shadow()
  } else if (kind === 'heli') {
    // Kampfhubschrauber: Tandem-Kanzel, Stummelflügel mit Raketenbehältern, Bugkanone, Heckausleger
    sph(0.95, 1.0, 2.6, olive, 0, 2.0, 0.2)
    sph(0.8, 0.55, 1.5, mat(THREE, 0x1e3a5f, { rough: 0.08, metal: 0.8 }), 0, 2.45, 1.7)
    sph(0.75, 0.5, 1.1, mat(THREE, 0x1e3a5f, { rough: 0.08, metal: 0.8 }), 0, 2.75, 0.2)
    box(1.5, 0.5, 3.2, dkolive, 0, 1.4, 0.2)
    cylA(0.32, 0.18, 6.6, olive, 0, 2.55, -4.2, 'z')
    box(0.12, 1.5, 1.0, olive, 0, 3.3, -7.2)
    box(2.2, 0.08, 0.6, olive, 0, 2.6, -6.6)
    const tail = new THREE.Group(); tail.position.set(0.18, 3.3, -7.2); g.add(tail)
    box(0.04, 1.5, 0.16, dark, 0, 0, 0, tail); box(0.04, 0.16, 1.5, dark, 0, 0, 0, tail); g.userData.tailRotor = tail
    for (const sx of [-1, 1]) {
      cylA(0.45, 0.45, 2.4, dkolive, sx * 0.85, 3.05, -0.4, 'z')
      box(2.6, 0.12, 0.9, olive, sx * 2.0, 1.85, 0.3)
      for (const px of [1.5, 2.6]) { cylA(0.22, 0.22, 1.7, dkolive, sx * px, 1.6, 0.5, 'z'); cylA(0.0, 0.22, 0.35, dark, sx * px, 1.6, 1.5, 'z'); for (let i = 0; i < 3; i++) cylA(0.03, 0.03, 0.5, steel, sx * px, 1.75, -0.3 + i * 0.01, 'z') }
      cylA(0.04, 0.04, 2.0, steel, sx * 0.9, 0.55, 0.6, 'z')
    }
    sph(0.36, 0.3, 0.4, dark, 0, 1.2, 2.9); cylA(0.05, 0.05, 1.1, steel, 0, 1.15, 3.7, 'z')
    for (const sz of [1.6, -0.6]) { box(2.0, 0.06, 0.06, steel, 0, 0.62, sz); box(0.06, 0.7, 0.06, steel, 0.9, 0.95, sz); box(0.06, 0.7, 0.06, steel, -0.9, 0.95, sz) }
    cylA(0.08, 0.08, 0.7, steel, 0, 3.6, 0, 'y')
    cylA(0.34, 0.34, 0.2, dark, 0, 4.0, 0, 'y')
    const rotor = new THREE.Group(); rotor.position.set(0, 4.05, 0)
    box(11.2, 0.06, 0.38, dark, 0, 0, 0, rotor); box(0.38, 0.06, 11.2, dark, 0, 0, 0, rotor)
    g.add(rotor); g.userData.rotor = rotor
    if (color && color.toLowerCase() === '#f8fafc') for (const sx of [-1, 1]) { const red = mat(THREE, 0xdc2626); box(0.06, 0.8, 0.26, red, sx * 0.98, 2.1, 0.3); box(0.06, 0.26, 0.8, red, sx * 0.98, 2.1, 0.3) }
    else for (const sx of [-1, 1]) { const st = box(0.04, 0.4, 0.4, mat(THREE, 0xf8fafc), sx * 0.97, 2.2, 0.3); st.rotation.x = 0.8 }
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
