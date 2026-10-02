import { Coins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useWallet } from '../../features/koins/WalletProvider'

/** Kleines Guthaben-Etikett mit Link zum Profil. */
export default function KoinBadge({ compact = false }: { compact?: boolean }) {
  const { balance } = useWallet()
  return (
    <Link
      to="/profil"
      title="Dein Koin-Guthaben"
      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 font-mono text-sm text-amber-200 transition hover:bg-amber-300/20"
    >
      <Coins size={15} />
      {balance.toLocaleString('de-DE')}
      {!compact && <span className="text-[11px] uppercase tracking-wider text-amber-200/70">Koins</span>}
    </Link>
  )
}
