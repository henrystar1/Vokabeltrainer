import type { ReactNode } from 'react'

/** Karteikarte: Vorderseite, Klick dreht sie mit 3D-Animation um. */
export default function FlipCard({ front, back, flipped, onFlip }: { front: ReactNode; back: ReactNode; flipped: boolean; onFlip: () => void }) {
  return (
    <button type="button" onClick={onFlip} aria-label={flipped ? 'Karte zurückdrehen' : 'Karte umdrehen'} className="flip-scene block min-h-[220px] w-full text-left">
      <span className={`flip-card block ${flipped ? 'is-flipped' : ''}`}>
        <span className="flip-face glass flex items-center justify-center rounded-2xl p-6 text-center text-2xl font-semibold">{front}</span>
        <span className="flip-face flip-back glass flex items-center justify-center rounded-2xl border border-accent-cyan/40 p-6 text-center text-2xl font-semibold text-accent-cyan">{back}</span>
      </span>
    </button>
  )
}
