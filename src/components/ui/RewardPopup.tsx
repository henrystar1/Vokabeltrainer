import { useState } from 'react'
import RewardReveal, { type Reward } from './RewardReveal'

/** Zeigt nach einer Runde einmal „+X Coins, +Y Punkte“ mit der Belohnungs-Animation. Wird nur eingebunden, wenn es etwas gibt. */
export default function RewardPopup({ coins = 0, points = 0, title = 'Geschafft!' }: { coins?: number; points?: number; title?: string }) {
  const [open, setOpen] = useState(true)
  const rewards: Reward[] = [
    ...(coins > 0 ? [{ type: 'coins' as const, amount: coins }] : []),
    ...(points > 0 ? [{ type: 'points' as const, amount: points }] : []),
  ]
  if (!open || rewards.length === 0) return null
  return <RewardReveal gift={false} title={title} rewards={rewards} onClose={() => setOpen(false)} />
}
