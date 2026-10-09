import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PANIC_PATHS, setPanic, usePanic } from './panic'

/**
 * Roter Knopf (oder Esc) auf den Spiele-Seiten: blendet Spiele, Gambling, Chat und Shop aus und springt zur Startseite.
 * Danach ist der Knopf selbst auch weg. Rückgängig unter Einstellungen.
 */
export default function PanicButton() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const panic = usePanic()
  const visible = !panic && PANIC_PATHS.some((r) => r.test(pathname))

  function trigger() {
    setPanic(true)
    navigate('/', { replace: true })
  }

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) trigger()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible) return null
  return (
    <button
      type="button"
      onClick={trigger}
      aria-label="Panik: Spiele sofort ausblenden"
      title="Panik (Esc)"
      className="fixed bottom-24 right-4 z-[70] flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/70 bg-red-600 text-xl font-bold text-white shadow-[0_0_18px_rgb(220_38_38/0.8)] active:scale-95 md:bottom-6"
    >
      !
    </button>
  )
}
