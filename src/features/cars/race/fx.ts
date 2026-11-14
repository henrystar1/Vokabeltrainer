import type * as T from 'three'
type THREE = typeof import('three')

/** Partikel (Wolken, Feuer, Rauch) und Reifenspuren; ein gemeinsamer Vorrat, damit auch bei vielen Autos nichts ruckelt. */
export type FxKind = 'cloud' | 'fire' | 'smoke'
interface P { s: T.Sprite; life: number; max: number; vx: number; vy: number; vz: number; s0: number; s1: number; kind: FxKind; on: boolean }

export interface Fx {
  emit: (kind: FxKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number) => void
  /** Reifenspur: ein Stück Spur an (x,z) in Richtung h, Länge len, Breite w */
  skid: (x: number, z: number, h: number, len: number, w?: number) => void
  update: (dt: number) => void
  dispose: () => void
}

function blob(THREE: THREE, stops: Array<[number, string]>): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  for (const [o, col] of stops) gr.addColorStop(o, col)
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64)
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace
  return tx
}

export function createFx(THREE: THREE, scene: T.Scene): Fx {
  const texCloud = blob(THREE, [[0, 'rgba(255,255,255,0.95)'], [0.55, 'rgba(235,242,250,0.55)'], [1, 'rgba(235,242,250,0)']])
  const texFire = blob(THREE, [[0, 'rgba(255,255,230,1)'], [0.3, 'rgba(255,196,60,0.95)'], [0.7, 'rgba(255,80,10,0.55)'], [1, 'rgba(255,40,0,0)']])
  const texSmoke = blob(THREE, [[0, 'rgba(70,70,76,0.8)'], [0.6, 'rgba(60,60,66,0.4)'], [1, 'rgba(60,60,66,0)']])
  const pool: P[] = Array.from({ length: 300 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texCloud, transparent: true, depthWrite: false, opacity: 0 }))
    s.visible = false; s.renderOrder = 5; scene.add(s)
    return { s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, kind: 'cloud', on: false }
  })
  let next = 0
  const emit: Fx['emit'] = (kind, x, y, z, vx, vy, vz, size) => {
    const p = pool[next]; next = (next + 1) % pool.length
    const m = p.s.material as T.SpriteMaterial
    p.kind = kind; p.on = true; p.vx = vx; p.vy = vy; p.vz = vz
    p.max = p.life = kind === 'cloud' ? 1.5 + Math.random() * 0.6 : kind === 'fire' ? 0.16 + Math.random() * 0.1 : 0.6 + Math.random() * 0.4
    p.s0 = size * (kind === 'cloud' ? 0.6 : 1); p.s1 = size * (kind === 'cloud' ? 3.2 : kind === 'fire' ? 0.3 : 2.4)
    m.map = kind === 'cloud' ? texCloud : kind === 'fire' ? texFire : texSmoke
    m.blending = kind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending
    m.rotation = Math.random() * 6.28; m.needsUpdate = true
    p.s.position.set(x, y, z); p.s.visible = true
  }
  // Reifenspuren: flache dunkle Streifen als Instanzen (Ringpuffer)
  const MAX = 1200
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2)
  const skidMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX)
  skidMesh.frustumCulled = false; skidMesh.count = 0; skidMesh.renderOrder = 2
  scene.add(skidMesh)
  const d = new THREE.Object3D()
  let sk = 0, filled = 0
  const skid: Fx['skid'] = (x, z, h, len, w = 0.3) => {
    d.position.set(x, 0.075, z); d.rotation.set(0, h, 0); d.scale.set(w, 1, len); d.updateMatrix()
    skidMesh.setMatrixAt(sk, d.matrix); sk = (sk + 1) % MAX; filled = Math.min(MAX, filled + 1)
    skidMesh.count = filled; skidMesh.instanceMatrix.needsUpdate = true
  }
  const update = (dt: number) => {
    for (const p of pool) {
      if (!p.on) continue
      p.life -= dt
      if (p.life <= 0) { p.on = false; p.s.visible = false; continue }
      const k = 1 - p.life / p.max
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt
      if (p.kind === 'cloud') {
        // Strahl trifft den Boden: die Wolke bremst und breitet sich seitlich aus
        if (p.s.position.y < 0.5) { p.s.position.y = 0.5; p.vy = 0; p.vx *= 1.04; p.vz *= 1.04 } else p.vy *= 0.985
        p.vx *= 0.97; p.vz *= 0.97
      } else if (p.kind === 'smoke') p.vy += dt * 1.2
      const sz = p.s0 + (p.s1 - p.s0) * k
      p.s.scale.set(sz, sz, 1)
      ;(p.s.material as T.SpriteMaterial).opacity = p.kind === 'fire' ? 1 - k * k : p.kind === 'cloud' ? 0.9 * (1 - k) * Math.min(1, k * 8) : 0.6 * (1 - k)
    }
  }
  const dispose = () => {
    for (const p of pool) { scene.remove(p.s); (p.s.material as T.SpriteMaterial).dispose() }
    scene.remove(skidMesh); geo.dispose(); (skidMesh.material as T.Material).dispose()
    texCloud.dispose(); texFire.dispose(); texSmoke.dispose()
  }
  return { emit, skid, update, dispose }
}
