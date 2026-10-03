/** Münz-Symbol: Geld-Emoji (Dollarschein) statt eines Icons. */
export const COIN_EMOJI = '💵'

export default function CoinIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={`inline-block shrink-0 leading-none ${className}`} style={{ fontSize: size }}>
      {COIN_EMOJI}
    </span>
  )
}
