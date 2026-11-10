import { fachColor } from './cardBox'

/** Mini-Kasten für ein Buch: Fortschrittsring (Anteil in Fach 5) und fünf farbige Fächer mit Anzahl. */
export default function BookBoxMini({ fach }: { fach: number[] }) {
  const total = fach.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const done = fach[4] ?? 0
  const pct = Math.round((done / total) * 100)
  const R = 20
  const C = 2 * Math.PI * R
  return (
    <div className="mt-4 flex items-center gap-3" aria-label={`Kasten: ${pct} % in Fach 5`}>
      <svg width="52" height="52" viewBox="0 0 52 52" className="shrink-0">
        <circle cx="26" cy="26" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
        <circle cx="26" cy="26" r={R} fill="none" stroke={fachColor(5)} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(C * done) / total} ${C}`} transform="rotate(-90 26 26)" />
        <text x="26" y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">{pct}%</text>
      </svg>
      <div className="min-w-0 flex-1">
        <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
          {fach.map((n, i) => n > 0 && <span key={i} style={{ width: `${(n / total) * 100}%`, background: fachColor(i + 1) }} />)}
        </div>
        <div className="mt-1.5 grid grid-cols-5 gap-1 text-center text-[10px] text-slate-400">
          {fach.map((n, i) => <span key={i}><b style={{ color: fachColor(i + 1) }}>{n}</b><br />Fach {i + 1}</span>)}
        </div>
      </div>
    </div>
  )
}
