/** Selbst gezeichnete Auto-Bilder (SVG, eigene Entwürfe ohne Marken). */
export const CAR_KINDS = ['kleinwagen', 'limousine', 'kombi', 'suv', 'pickup', 'cabrio', 'sportwagen', 'bus'] as const
export type CarKind = (typeof CAR_KINDS)[number]

interface Shape { body: string; glass: string[]; wheels: [number, number]; r: number; roofRack?: boolean; open?: boolean }

const SHAPES: Record<CarKind, Shape> = {
  kleinwagen: { body: 'M30 74 L30 58 Q32 50 46 48 L62 32 Q66 28 74 28 L116 28 Q124 28 130 34 L146 50 Q166 52 170 62 L170 74 Z', glass: ['M68 34 L78 34 L78 48 L58 48 Z', 'M84 34 L114 34 L128 48 L84 48 Z'], wheels: [58, 146], r: 15 },
  limousine: { body: 'M14 74 L14 60 Q16 54 34 52 L60 36 Q66 32 76 32 L122 32 Q130 32 136 38 L154 52 Q184 54 188 62 L188 74 Z', glass: ['M70 38 L82 38 L82 52 L58 52 Z', 'M88 38 L122 38 L136 52 L88 52 Z'], wheels: [50, 154], r: 14 },
  kombi: { body: 'M16 74 L16 56 Q18 50 34 48 L56 34 Q62 30 72 30 L150 30 Q158 30 160 38 L168 52 Q184 54 186 62 L186 74 Z', glass: ['M64 36 L76 36 L76 50 L52 50 Z', 'M82 36 L116 36 L116 50 L82 50 Z', 'M122 36 L150 36 L156 50 L122 50 Z'], wheels: [52, 150], r: 14 },
  suv: { body: 'M14 78 L14 56 Q16 48 32 46 L52 30 Q58 26 68 26 L142 26 Q150 26 154 34 L164 48 Q184 50 186 60 L186 78 Z', glass: ['M60 32 L72 32 L72 46 L48 46 Z', 'M78 32 L108 32 L108 46 L78 46 Z', 'M114 32 L142 32 L152 46 L114 46 Z'], wheels: [52, 148], r: 18, roofRack: true },
  pickup: { body: 'M12 76 L12 56 Q14 50 30 48 L50 32 Q56 28 66 28 L104 28 Q110 28 114 34 L122 48 L188 48 L188 76 Z', glass: ['M58 34 L68 34 L68 48 L44 48 Z', 'M74 34 L104 34 L112 48 L74 48 Z'], wheels: [48, 150], r: 17 },
  cabrio: { body: 'M14 74 L14 60 Q16 54 34 52 L62 44 Q68 42 76 44 L108 44 Q114 44 120 50 Q176 52 188 62 L188 74 Z', glass: ['M76 40 L96 40 L102 46 L76 46 Z'], wheels: [50, 152], r: 14, open: true },
  sportwagen: { body: 'M10 74 L10 62 Q14 56 38 54 L72 40 Q80 36 92 36 L112 36 Q124 36 134 44 L158 54 Q190 56 192 64 L192 74 Z', glass: ['M82 41 L110 41 Q120 41 128 48 L82 48 Z'], wheels: [48, 156], r: 14 },
  bus: { body: 'M10 78 L10 40 Q10 28 24 28 L176 28 Q190 28 190 40 L190 78 Z', glass: ['M20 36 L52 36 L52 54 L20 54 Z', 'M58 36 L90 36 L90 54 L58 54 Z', 'M96 36 L128 36 L128 54 L96 54 Z', 'M134 36 L166 36 L166 54 L134 54 Z'], wheels: [48, 150], r: 15 },
}

export default function CarArt({ kind, color, className = '', label }: { kind: string; color: string; className?: string; label?: string }) {
  const sh = SHAPES[(CAR_KINDS as readonly string[]).includes(kind) ? (kind as CarKind) : 'kleinwagen']
  const wy = 76
  return (
    <svg viewBox="0 0 200 100" className={className} role="img" aria-label={label ?? 'Auto'}>
      <defs>
        <linearGradient id={`g-${kind}-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="92" rx="86" ry="5" fill="#000" opacity=".25" />
      {sh.roofRack && <rect x="62" y="20" width="76" height="3" rx="1.5" fill="#94a3b8" />}
      <path d={sh.body} fill={color} />
      <path d={sh.body} fill={`url(#g-${kind}-${color.replace('#', '')})`} />
      {sh.glass.map((d, i) => <path key={i} d={d} fill="#bae6fd" opacity=".85" stroke="#0f172a" strokeOpacity=".35" strokeWidth="1" />)}
      {sh.open && <rect x="78" y="44" width="22" height="9" rx="4" fill="#0f172a" opacity=".6" />}
      <rect x="176" y="58" width="10" height="6" rx="2" fill="#fde68a" /><rect x="12" y="60" width="7" height="6" rx="2" fill="#ef4444" />
      {sh.wheels.map((x) => (
        <g key={x}><circle cx={x} cy={wy} r={sh.r} fill="#0f172a" /><circle cx={x} cy={wy} r={sh.r * 0.55} fill="#cbd5e1" /><circle cx={x} cy={wy} r={sh.r * 0.2} fill="#475569" /></g>
      ))}
    </svg>
  )
}
