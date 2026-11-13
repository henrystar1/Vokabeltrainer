/** Chip-Symbol für das Gambling (Spielmarke statt Geldschein). */
export const CHIP_EMOJI = '🪙'

export default function ChipIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-block shrink-0 leading-none ${className}`} style={{ fontSize: size }}>
      {CHIP_EMOJI}
    </span>
  )
}
