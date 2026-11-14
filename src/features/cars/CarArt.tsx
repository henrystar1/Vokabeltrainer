import type { ReactNode } from 'react'

/** Selbst gezeichnete Auto-Bilder (SVG, eigene Entwürfe ohne Marken). */
export const CAR_KINDS = ['kleinwagen', 'limousine', 'kombi', 'suv', 'pickup', 'cabrio', 'sportwagen', 'bus', 'oldtimer', 'buggy', 'monstertruck', 'muscle', 'rallye', 'gt', 'hypercar', 'rennwagen', 'roadster', 'supercar', 'chopper', 'crossbike', 'sportbike'] as const
export type CarKind = (typeof CAR_KINDS)[number]

interface Shape {
  body: string
  glass: string[]
  wheels: [number, number]
  r: number
  /** y-Mitte der Räder */
  wy?: number
  extra?: (c: string) => ReactNode
  /** Kein Felgenschutz-Bogen (offene Räder) */
  open?: boolean
  head?: [number, number]
  tail?: [number, number]
  hideBody?: boolean
}

const SHAPES: Record<Exclude<CarKind, 'chopper' | 'crossbike' | 'sportbike'>, Shape> = {
  kleinwagen: { body: 'M26 76 L26 58 Q28 50 44 48 L62 31 Q66 27 76 27 L116 27 Q125 27 131 34 L147 49 Q168 51 173 62 L173 76 Z', glass: ['M68 33 L79 33 L79 47 L57 47 Z', 'M85 33 L114 33 L128 47 L85 47 Z'], wheels: [56, 146], r: 15 },
  limousine: { body: 'M12 76 L12 60 Q14 54 34 52 L60 36 Q66 31 78 31 L122 31 Q131 31 138 38 L156 52 Q186 54 190 63 L190 76 Z', glass: ['M71 37 L83 37 L83 51 L58 51 Z', 'M89 37 L122 37 L137 51 L89 51 Z'], wheels: [48, 154], r: 14 },
  kombi: { body: 'M14 76 L14 56 Q16 50 34 48 L56 33 Q62 29 72 29 L152 29 Q160 29 162 38 L170 52 Q186 54 188 63 L188 76 Z', glass: ['M64 35 L76 35 L76 50 L52 50 Z', 'M82 35 L116 35 L116 50 L82 50 Z', 'M122 35 L152 35 L158 50 L122 50 Z'], wheels: [50, 150], r: 14 },
  suv: { body: 'M12 80 L12 56 Q14 48 32 46 L52 30 Q58 26 68 26 L142 26 Q150 26 154 34 L164 48 Q186 50 188 60 L188 80 Z', glass: ['M60 32 L72 32 L72 46 L48 46 Z', 'M78 32 L108 32 L108 46 L78 46 Z', 'M114 32 L142 32 L152 46 L114 46 Z'], wheels: [52, 148], r: 18, wy: 78, extra: () => <><rect x="60" y="19" width="80" height="3" rx="1.5" fill="#94a3b8" /><rect x="64" y="21" width="2" height="5" fill="#64748b" /><rect x="134" y="21" width="2" height="5" fill="#64748b" /><rect x="176" y="68" width="12" height="5" rx="2" fill="#1e293b" /></> },
  pickup: { body: 'M10 78 L10 56 Q12 50 30 48 L50 32 Q56 28 66 28 L104 28 Q110 28 114 34 L122 48 L190 48 L190 78 Z', glass: ['M58 34 L68 34 L68 48 L44 48 Z', 'M74 34 L104 34 L112 48 L74 48 Z'], wheels: [48, 150], r: 17, wy: 78, extra: () => <><rect x="124" y="48" width="66" height="6" fill="#0f172a" opacity=".5" /><rect x="190" y="50" width="4" height="24" fill="#1e293b" /></> },
  cabrio: { body: 'M12 76 L12 60 Q14 54 34 52 L62 44 Q68 42 76 44 L108 44 Q114 44 120 50 Q176 52 190 63 L190 76 Z', glass: ['M76 39 L94 39 L102 46 L76 46 Z'], wheels: [50, 152], r: 14, extra: () => <><rect x="76" y="46" width="24" height="9" rx="4" fill="#0f172a" opacity=".65" /><circle cx="84" cy="43" r="4" fill="#e2e8f0" opacity=".9" /></> },
  sportwagen: { body: 'M8 76 L8 62 Q12 56 38 54 L72 40 Q80 36 92 36 L112 36 Q124 36 134 44 L158 54 Q190 56 193 65 L193 76 Z', glass: ['M82 41 L110 41 Q120 41 128 48 L82 48 Z'], wheels: [48, 156], r: 14, extra: () => <><rect x="10" y="48" width="22" height="3" rx="1" fill="#0f172a" /><rect x="14" y="50" width="3" height="8" fill="#0f172a" /><path d="M40 66 L150 66" stroke="#fff" strokeOpacity=".5" strokeWidth="2.4" /></> },
  bus: { body: 'M8 80 L8 40 Q8 26 24 26 L178 26 Q192 26 192 40 L192 80 Z', glass: ['M18 34 L52 34 L52 54 L18 54 Z', 'M58 34 L90 34 L90 54 L58 54 Z', 'M96 34 L128 34 L128 54 L96 54 Z', 'M134 34 L170 34 L170 54 L134 54 Z'], wheels: [48, 150], r: 15, wy: 80, extra: () => <><rect x="8" y="58" width="184" height="4" fill="#fff" opacity=".4" /><rect x="14" y="20" width="20" height="5" rx="2" fill="#475569" /></> },
  oldtimer: { body: 'M16 76 L16 62 Q16 56 28 55 Q34 40 52 38 L66 28 Q72 24 84 24 L108 24 Q118 24 122 32 L132 40 Q150 40 162 52 Q184 54 186 64 L186 76 Z', glass: ['M72 29 L84 29 L84 40 L64 40 Z', 'M90 29 L110 29 L116 40 L90 40 Z'], wheels: [54, 148], r: 16, wy: 78, extra: () => <><rect x="164" y="48" width="14" height="14" rx="2" fill="#cbd5e1" /><path d="M167 50 v10 M171 50 v10 M175 50 v10" stroke="#475569" strokeWidth="1.2" /><circle cx="160" cy="54" r="5" fill="#fde68a" stroke="#cbd5e1" strokeWidth="2" /><rect x="64" y="70" width="70" height="4" rx="2" fill="#0f172a" /><circle cx="20" cy="56" r="3" fill="#cbd5e1" /></> },
  buggy: { body: 'M30 74 L30 64 Q34 58 52 58 L100 58 L130 60 Q146 60 150 68 L150 74 Z', glass: [], wheels: [50, 146], r: 19, wy: 74, extra: (c) => <><path d="M58 58 L66 32 L108 32 L124 58 M66 32 L58 58 M86 32 L86 58" fill="none" stroke="#e2e8f0" strokeWidth="3.2" strokeLinejoin="round" /><rect x="76" y="46" width="20" height="12" rx="3" fill="#0f172a" /><rect x="26" y="52" width="26" height="6" rx="2" fill={c} /><rect x="146" y="44" width="30" height="4" rx="2" fill="#0f172a" /></> },
  monstertruck: { body: 'M26 62 L26 46 Q28 42 42 40 L58 26 Q64 22 74 22 L110 22 Q116 22 120 28 L128 40 L170 40 L174 62 Z', glass: ['M64 28 L74 28 L74 40 L50 40 Z', 'M80 28 L110 28 L118 40 L80 40 Z'], wheels: [58, 142], r: 27, wy: 70, extra: () => <><rect x="46" y="62" width="104" height="5" rx="2" fill="#1e293b" /><rect x="150" y="46" width="22" height="3" fill="#fde047" opacity=".9" /></> },
  muscle: { body: 'M8 76 L8 58 Q12 52 32 52 L74 38 Q84 34 98 34 L116 34 Q126 34 134 42 L148 52 Q192 52 194 64 L194 76 Z', glass: ['M82 40 L112 40 Q120 40 126 46 L82 46 Z'], wheels: [48, 156], r: 15, extra: () => <><path d="M138 50 L186 52" stroke="#0f172a" strokeWidth="3" /><rect x="150" y="45" width="22" height="6" rx="2" fill="#0f172a" /><path d="M60 46 L132 47" stroke="#fff" strokeOpacity=".7" strokeWidth="3" /><rect x="6" y="62" width="9" height="3" fill="#94a3b8" /></> },
  rallye: { body: 'M14 76 L14 56 Q16 50 36 48 L62 32 Q68 28 80 28 L124 28 Q132 28 138 34 L152 48 Q184 50 188 62 L188 76 Z', glass: ['M70 34 L82 34 L82 47 L56 47 Z', 'M88 34 L122 34 L134 47 L88 47 Z'], wheels: [52, 150], r: 16, wy: 77, extra: (c) => <><rect x="8" y="34" width="30" height="4" rx="1" fill="#0f172a" /><rect x="12" y="36" width="4" height="14" fill="#0f172a" /><rect x="30" y="36" width="4" height="14" fill="#0f172a" /><rect x="88" y="24" width="26" height="4" rx="2" fill="#0f172a" /><circle cx="108" cy="57" r="8" fill="#fff" opacity=".9" /><text x="108" y="61" textAnchor="middle" fontSize="11" fontWeight="800" fill="#0f172a">7</text><path d="M160 54 L186 58 L186 66 L160 64 Z" fill="#0f172a" opacity=".55" /><rect x="14" y="68" width="150" height="3" fill={c} opacity=".0" /></> },
  gt: { body: 'M6 76 L6 63 Q10 57 34 55 L78 42 Q88 38 100 38 L118 38 Q130 38 140 46 L162 55 Q192 57 195 66 L195 76 Z', glass: ['M86 43 L116 43 Q126 43 134 50 L86 50 Z'], wheels: [46, 158], r: 14.5, extra: () => <><rect x="6" y="50" width="24" height="3" rx="1" fill="#0f172a" /><rect x="11" y="52" width="3" height="9" fill="#0f172a" /><path d="M96 38 L96 55 M100 38 L100 55" stroke="#fff" strokeOpacity=".7" strokeWidth="3" /><path d="M60 66 L146 66" stroke="#0f172a" strokeOpacity=".5" strokeWidth="2" /><rect x="176" y="62" width="14" height="3" fill="#fde68a" /></> },
  hypercar: { body: 'M4 76 L4 66 Q8 61 36 58 L88 41 Q100 37 112 38 L124 40 Q136 42 146 50 L170 58 Q197 60 197 68 L197 76 Z', glass: ['M92 43 L120 42 Q130 43 138 51 L96 51 Z'], wheels: [44, 160], r: 15, extra: () => <><rect x="2" y="52" width="26" height="3" rx="1.5" fill="#0f172a" /><rect x="8" y="54" width="3" height="8" fill="#0f172a" /><rect x="22" y="54" width="3" height="8" fill="#0f172a" /><path d="M70 62 Q84 56 100 60 L100 64 Q84 62 70 66 Z" fill="#0f172a" opacity=".85" /><path d="M150 56 L194 64" stroke="#38bdf8" strokeWidth="2.5" /><rect x="2" y="68" width="14" height="4" rx="2" fill="#f97316" /></> },
  rennwagen: { hideBody: true, body: '', glass: [], wheels: [48, 152], r: 18, wy: 75, open: true, head: [196, 70], tail: [8, 52], extra: (c) => <>
    <path d="M30 70 L56 62 L88 56 L100 44 L112 44 L124 56 L160 64 L196 70 L196 74 L30 74 Z" fill={c} />
    <path d="M30 70 L56 62 L88 56 L100 44 L112 44 L124 56 L160 64 L196 70 L196 74 L30 74 Z" fill="url(#shine)" />
    <path d="M88 56 L98 44 L106 36 Q110 34 114 36 L122 52 Z" fill="#0f172a" opacity=".92" /><circle cx="106" cy="42" r="6" fill="#fde047" /><path d="M98 36 Q108 26 120 36" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
    <rect x="178" y="68" width="24" height="5" rx="2" fill={c} /><rect x="174" y="72" width="28" height="3" fill="#0f172a" />
    <rect x="6" y="40" width="30" height="5" rx="1.5" fill="#0f172a" /><rect x="12" y="44" width="4" height="22" fill="#0f172a" /><rect x="26" y="44" width="4" height="22" fill="#0f172a" /><rect x="10" y="38" width="22" height="3" fill={c} />
    <circle cx="64" cy="66" r="4" fill="#fff" opacity=".9" /><text x="64" y="69" textAnchor="middle" fontSize="6" fontWeight="800" fill="#0f172a">1</text>
  </> },
  roadster: { body: 'M6 76 L6 64 Q10 58 34 56 L70 48 Q78 45 90 46 L112 46 Q122 46 130 52 L160 57 Q192 59 195 67 L195 76 Z', glass: ['M92 41 L108 41 L114 47 L92 47 Z'], wheels: [46, 156], r: 14, extra: () => <><path d="M104 40 Q112 34 122 38" fill="none" stroke="#e2e8f0" strokeWidth="2.5" /><rect x="6" y="52" width="22" height="3" rx="1.5" fill="#0f172a" /><path d="M20 70 L10 80 L28 76 Z" fill="#60e6ff" opacity=".9" /><path d="M60 66 L150 66" stroke="#0f172a" strokeOpacity=".4" strokeWidth="2" /></> },
  supercar: { body: 'M5 76 L5 62 Q8 56 26 54 L50 44 Q60 36 76 33 L104 33 Q122 33 134 44 L150 52 Q178 55 190 60 Q196 64 196 76 Z', glass: ['M70 40 Q78 36 92 36 L106 36 Q118 36 126 44 L72 46 Z'], wheels: [46, 154], r: 15, extra: () => <><rect x="4" y="50" width="26" height="4" rx="2" fill="#7f1d1d" /><circle cx="176" cy="58" r="6" fill="#fff7c2" stroke="#e2e8f0" strokeWidth="2" /><rect x="4" y="60" width="9" height="3" fill="#ff1a1a" /><path d="M120 52 L186 58" stroke="#fff" strokeOpacity=".6" strokeWidth="2.4" /><rect x="60" y="68" width="76" height="3" rx="1.5" fill="#0f172a" opacity=".6" /></> },
}

/** Motorräder haben eigene Zeichnung (zwei Räder, Fahrer). */
const BIKE_ART: Record<string, { r: number; wb: number; bars: number; chopper?: boolean; cross?: boolean }> = {
  sportbike: { r: 17, wb: 78, bars: 52 },
  chopper: { r: 18, wb: 108, bars: 36, chopper: true },
  crossbike: { r: 19, wb: 70, bars: 44, cross: true },
}
function BikeArt({ kind, color, className, label }: { kind: string; color: string; className: string; label?: string }) {
  const b = BIKE_ART[kind]
  const cx = 100, rw = cx - b.wb / 2, fw = cx + b.wb / 2, wy = 76
  const rider = '#1f2937'
  return (
    <svg viewBox="0 0 200 100" className={className} role="img" aria-label={label ?? 'Motorrad'}>
      <ellipse cx="100" cy="92" rx="70" ry="4" fill="#000" opacity=".3" />
      {[rw, fw].map((x) => <g key={x}><circle cx={x} cy={wy} r={b.r} fill="#0b1220" /><circle cx={x} cy={wy} r={b.r * 0.62} fill="#e2e8f0" /><circle cx={x} cy={wy} r={b.r * 0.16} fill="#334155" /></g>)}
      {/* Gabel und Rahmen */}
      <path d={`M${fw} ${wy} L${fw - (b.chopper ? 26 : 10)} ${b.bars}`} stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
      <path d={`M${rw} ${wy} L${cx - 6} ${wy - 14} L${cx + 14} ${wy - 12} L${fw - 8} ${wy - 6}`} fill="none" stroke="#0f172a" strokeWidth="6" strokeLinejoin="round" />
      <rect x={cx - 14} y={wy - 24} width="30" height="14" rx="7" fill={color} />
      <rect x={cx - 14} y={wy - 24} width="30" height="14" rx="7" fill="#fff" opacity=".15" />
      <rect x={cx - 8} y={wy - 12} width="22" height="14" rx="4" fill="#111827" />
      <path d={`M${rw + 4} ${wy - 22} L${cx - 14} ${wy - 22} L${cx - 14} ${wy - 14} L${rw + 4} ${wy - 12} Z`} fill={b.cross ? '#0f172a' : color} />
      {kind === 'sportbike' && <path d={`M${fw - 12} ${wy - 28} L${fw + 6} ${wy - 16} L${fw - 4} ${wy - 8} L${fw - 22} ${wy - 12} Z`} fill={color} />}
      <path d={`M${fw - (b.chopper ? 30 : 12)} ${b.bars} L${fw - (b.chopper ? 38 : 20)} ${b.bars - (b.chopper ? 14 : 2)}`} stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
      <circle cx={fw + 2} cy={b.bars + 8} r="4.5" fill="#fde68a" />
      <rect x={rw - 4} y={wy - 22} width="6" height="4" rx="2" fill="#ef4444" />
      {/* Fahrer */}
      <path d={`M${cx - 10} ${wy - 26} L${cx + (b.chopper ? -6 : 8)} ${wy - 52} L${cx + (b.chopper ? 0 : 16)} ${wy - 50} L${cx + 6} ${wy - 24} Z`} fill={rider} />
      <circle cx={cx + (b.chopper ? 2 : 18)} cy={wy - 58} r="7" fill={b.cross ? '#f8fafc' : '#facc15'} />
      <path d={`M${cx + (b.chopper ? 0 : 14)} ${wy - 46} L${fw - (b.chopper ? 38 : 20)} ${b.bars - 2}`} stroke={rider} strokeWidth="5" strokeLinecap="round" />
      <path d={`M${cx - 4} ${wy - 24} L${cx + 12} ${wy - 6} L${cx + 4} ${wy + 2}`} stroke={rider} strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d={`M${rw + 6} ${wy - 6} L${cx + 26} ${wy - 4}`} stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

/** Stabile Hell/Dunkel-Version einer Farbe für die Akzente. */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

export default function CarArt({ kind, color, className = '', label }: { kind: string; color: string; className?: string; label?: string }) {
  if (BIKE_ART[kind]) return <BikeArt kind={kind} color={color} className={className} label={label} />
  const k = ((CAR_KINDS as readonly string[]).includes(kind) ? kind : 'kleinwagen') as keyof typeof SHAPES
  const sh = SHAPES[k]
  const wy = sh.wy ?? 76
  const id = `${k}-${color.replace('#', '')}`
  const head = sh.head ?? [188, 62], tail = sh.tail ?? [12, 62]
  return (
    <svg viewBox="0 0 200 100" className={className} role="img" aria-label={label ?? 'Auto'}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".35" stopColor="#fff" stopOpacity=".05" /><stop offset=".75" stopColor="#000" stopOpacity=".08" /><stop offset="1" stopColor="#000" stopOpacity=".42" /></linearGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".5" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".35" /></linearGradient>
        <linearGradient id={`gl-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e0f2fe" /><stop offset=".5" stopColor="#7dd3fc" /><stop offset="1" stopColor="#0c4a6e" /></linearGradient>
        <radialGradient id={`hl-${id}`}><stop offset="0" stopColor="#fef08a" stopOpacity=".9" /><stop offset="1" stopColor="#fef08a" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="92" rx="90" ry="5" fill="#000" opacity=".3" />
      {sh.extra && k === 'rennwagen' ? sh.extra(color) : null}
      {!sh.hideBody && (
        <>
          <path d={sh.body} fill={color} />
          <path d={sh.body} fill={shade(color, 0.55)} opacity=".35" transform="translate(0 0)" clipPath={undefined} />
          <path d={sh.body} fill={`url(#g-${id})`} />
          {/* Türlinie, Schweller */}
          <path d={sh.body} fill="none" stroke="#000" strokeOpacity=".28" strokeWidth="1.2" />
          <rect x="30" y={wy - 4} width={sh.wheels[1] - sh.wheels[0] + 20} height="3.5" rx="1.5" fill="#0f172a" opacity=".55" transform={`translate(${sh.wheels[0] - 30 - 10} 0)`} />
          {sh.glass.map((d, i) => <g key={i}><path d={d} fill={`url(#gl-${id})`} stroke="#0f172a" strokeOpacity=".5" strokeWidth="1" /><path d={d} fill="#fff" opacity=".18" transform="translate(2 -1) scale(.96 .9)" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} /></g>)}
          {sh.extra && k !== 'rennwagen' ? sh.extra(color) : null}
          <circle cx={head[0] - 6} cy={head[1] + 3} r="10" fill={`url(#hl-${id})`} />
          <rect x={head[0] - 10} y={head[1]} width="10" height="5.5" rx="2.2" fill="#fde68a" /><rect x={tail[0]} y={tail[1]} width="7" height="5.5" rx="2" fill="#ef4444" />
        </>
      )}
      {sh.hideBody && <><rect x={head[0] - 14} y={head[1] - 1} width="10" height="4" rx="2" fill="#fde68a" /></>}
      {sh.wheels.map((x) => (
        <g key={x}>
          {!sh.open && <path d={`M${x - sh.r - 3} ${wy} A${sh.r + 3} ${sh.r + 3} 0 0 1 ${x + sh.r + 3} ${wy}`} fill="#0b1220" />}
          <circle cx={x} cy={wy} r={sh.r} fill="#0b1220" />
          <circle cx={x} cy={wy} r={sh.r * 0.62} fill="#e2e8f0" />
          <circle cx={x} cy={wy} r={sh.r * 0.62} fill="none" stroke="#64748b" strokeWidth="1" />
          {[0, 1, 2, 3, 4].map((i) => <line key={i} x1={x} y1={wy} x2={x + Math.cos((i * 2 * Math.PI) / 5) * sh.r * 0.6} y2={wy + Math.sin((i * 2 * Math.PI) / 5) * sh.r * 0.6} stroke="#475569" strokeWidth="2" />)}
          <circle cx={x} cy={wy} r={sh.r * 0.16} fill="#334155" />
        </g>
      ))}
    </svg>
  )
}
