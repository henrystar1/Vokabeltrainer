import { useEffect, useRef, useState } from 'react'
import { Box, RotateCw } from 'lucide-react'
import type { StlMesh } from '../../lib/stl'

interface Props {
  mesh: StlMesh | null
  /** Farbe des Modells, z. B. „#e11d48“. */
  color?: string
  className?: string
  autoRotate?: boolean
}

/**
 * 3D-Vorschau einer STL-Datei (three.js wird erst beim Öffnen geladen). Ziehen = drehen, Mausrad/Zwei Finger = zoomen.
 * Das Modell liegt auf einer Druckplatte; STL ist Z-oben, three.js Y-oben.
 */
export default function StlViewer({ mesh, color = '#22d3ee', className = '', autoRotate = true }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const colorRef = useRef(color)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const apply = useRef<((c: string) => void) | null>(null)
  colorRef.current = color

  useEffect(() => {
    const el = host.current
    if (!el || !mesh) return
    let disposed = false
    let cleanup: (() => void) | null = null
    setState('loading')

    ;(async () => {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js')])
      if (disposed) return
      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      } catch {
        setState('error')
        return
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      el.appendChild(renderer.domElement)
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.touchAction = 'none'

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000)

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
      // Mitte in X/Y, Unterseite auf Z = 0
      geom.translate(-(mesh.min.x + mesh.size.x / 2), -(mesh.min.y + mesh.size.y / 2), -mesh.min.z)
      geom.computeVertexNormals()
      const material = new THREE.MeshStandardMaterial({ color: colorRef.current, roughness: 0.55, metalness: 0.08 })
      const model = new THREE.Mesh(geom, material)
      model.rotation.x = -Math.PI / 2
      scene.add(model)

      const size = Math.max(mesh.size.x, mesh.size.y, mesh.size.z, 1)

      // Druckplatte mit feinem Raster
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.95, size * 0.95, size * 0.02, 64),
        new THREE.MeshStandardMaterial({ color: '#1b2236', roughness: 0.9, metalness: 0.1, transparent: true, opacity: 0.85 }),
      )
      plate.position.y = -size * 0.011
      scene.add(plate)
      const grid = new THREE.GridHelper(size * 1.9, 14, 0x3b4a6b, 0x28324d)
      grid.position.y = 0.001
      ;(grid.material as import('three').Material).transparent = true
      ;(grid.material as import('three').Material).opacity = 0.55
      scene.add(grid)

      scene.add(new THREE.HemisphereLight(0xdbe7ff, 0x1a2036, 1.15))
      const key = new THREE.DirectionalLight(0xffffff, 1.6)
      key.position.set(size, size * 1.6, size * 0.8)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0x7dd3fc, 0.8)
      rim.position.set(-size, size * 0.6, -size)
      scene.add(rim)

      const target = new THREE.Vector3(0, mesh.size.z / 2, 0)
      camera.position.set(size * 1.5, size * 1.15, size * 1.7)
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.copy(target)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.autoRotate = autoRotate
      controls.autoRotateSpeed = 1.6
      controls.minDistance = size * 0.8
      controls.maxDistance = size * 6
      controls.maxPolarAngle = Math.PI * 0.52
      controls.update()
      renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false })

      const resize = () => {
        const w = Math.max(el.clientWidth, 1)
        const h = Math.max(el.clientHeight, 1)
        renderer.setSize(w, h, false)
        renderer.domElement.style.width = '100%'
        renderer.domElement.style.height = '100%'
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(el)

      let raf = 0
      let visible = true
      const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true })
      io.observe(el)
      const loop = () => {
        raf = requestAnimationFrame(loop)
        if (!visible) return
        controls.update()
        renderer.render(scene, camera)
      }
      loop()
      apply.current = (c: string) => material.color.set(c)
      setState('ready')

      cleanup = () => {
        cancelAnimationFrame(raf)
        ro.disconnect()
        io.disconnect()
        controls.dispose()
        geom.dispose()
        material.dispose()
        plate.geometry.dispose()
        ;(plate.material as import('three').Material).dispose()
        grid.geometry.dispose()
        ;(grid.material as import('three').Material).dispose()
        renderer.dispose()
        renderer.domElement.remove()
        apply.current = null
      }
    })().catch(() => !disposed && setState('error'))

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [mesh, autoRotate])

  useEffect(() => { apply.current?.(color) }, [color])

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-space-800 to-space-950 ${className}`}>
      <div ref={host} className="absolute inset-0" />
      {state === 'loading' && mesh && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-400" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" /> 3D-Ansicht lädt …
        </div>
      )}
      {state === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-400">
          <Box size={28} className="text-slate-500" />
          Die 3D-Vorschau geht auf diesem Gerät leider nicht.
        </div>
      )}
      {state === 'ready' && (
        <span className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-1 text-[11px] text-slate-500">
          <RotateCw size={12} /> ziehen zum Drehen
        </span>
      )}
    </div>
  )
}
