import type { ReactNode } from 'react'

/**
 * Sticker für den Chat: selbst gezeichnete Figuren (SVG), keine Bilddateien.
 * Im Chat wird ein Sticker als Text `:sticker:<id>:` verschickt und beim Anzeigen wieder als Bild gezeichnet.
 */
export interface StickerDef {
  id: string
  label: string
  bg: [string, string]
  eyes: 'dots' | 'happy' | 'wide' | 'hearts' | 'closed' | 'angry' | 'glasses' | 'stars' | 'tired'
  mouth: 'smile' | 'grin' | 'o' | 'flat' | 'frown' | 'tongue' | 'wavy'
  extra?: 'zzz' | 'tear' | 'flame' | 'hat' | 'sweat' | 'sparkle' | 'bulb' | 'heart' | 'thumb'
  caption?: string
}

export const STICKERS: StickerDef[] = [
  { id: 'gg', label: 'GG', bg: ['#34d399', '#059669'], eyes: 'happy', mouth: 'grin', caption: 'GG!' },
  { id: 'lol', label: 'LOL', bg: ['#fbbf24', '#f59e0b'], eyes: 'closed', mouth: 'grin', extra: 'tear', caption: 'LOL' },
  { id: 'ok', label: 'Okay', bg: ['#60a5fa', '#2563eb'], eyes: 'dots', mouth: 'smile', extra: 'thumb', caption: 'OK' },
  { id: 'wow', label: 'Wow', bg: ['#f472b6', '#db2777'], eyes: 'wide', mouth: 'o', extra: 'sparkle', caption: 'WOW' },
  { id: 'love', label: 'Liebe', bg: ['#fb7185', '#e11d48'], eyes: 'hearts', mouth: 'smile', extra: 'heart' },
  { id: 'cool', label: 'Cool', bg: ['#22d3ee', '#0891b2'], eyes: 'glasses', mouth: 'smile', caption: 'COOL' },
  { id: 'fire', label: 'Feuer', bg: ['#fb923c', '#dc2626'], eyes: 'angry', mouth: 'grin', extra: 'flame', caption: 'HEISS' },
  { id: 'danke', label: 'Danke', bg: ['#a78bfa', '#7c3aed'], eyes: 'happy', mouth: 'smile', extra: 'heart', caption: 'DANKE' },
  { id: 'hilfe', label: 'Hilfe', bg: ['#fde047', '#eab308'], eyes: 'wide', mouth: 'wavy', extra: 'sweat', caption: 'HILFE' },
  { id: 'idee', label: 'Idee', bg: ['#fde68a', '#f59e0b'], eyes: 'dots', mouth: 'smile', extra: 'bulb', caption: 'IDEE!' },
  { id: 'schlaf', label: 'Müde', bg: ['#818cf8', '#4338ca'], eyes: 'tired', mouth: 'flat', extra: 'zzz', caption: 'MÜDE' },
  { id: 'party', label: 'Party', bg: ['#e879f9', '#a21caf'], eyes: 'stars', mouth: 'grin', extra: 'hat', caption: 'PARTY' },
  { id: 'traurig', label: 'Traurig', bg: ['#94a3b8', '#475569'], eyes: 'dots', mouth: 'frown', extra: 'tear', caption: 'MENNO' },
  { id: 'wuetend', label: 'Wütend', bg: ['#f87171', '#b91c1c'], eyes: 'angry', mouth: 'frown', caption: 'GRRR' },
  { id: 'hm', label: 'Hmm', bg: ['#a3e635', '#65a30d'], eyes: 'dots', mouth: 'flat', caption: 'HMM' },
  { id: 'blub', label: 'Blub', bg: ['#2dd4bf', '#0d9488'], eyes: 'happy', mouth: 'tongue', caption: 'BLÖD' },
]

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]))
const RE = /^:sticker:([a-z0-9_]{1,20}):$/

/** Chat-Text für einen Sticker. */
export const stickerBody = (id: string): string => `:sticker:${id}:`

/** Sticker-Definition, wenn der Chat-Text ein Sticker ist. */
export function parseSticker(body: string): StickerDef | null {
  const m = RE.exec(body.trim())
  return m ? (BY_ID.get(m[1]) ?? null) : null
}

function Eyes({ kind }: { kind: StickerDef['eyes'] }): ReactNode {
  const ink = '#0f172a'
  switch (kind) {
    case 'happy':
      return <g fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M34 52 q8 -10 16 0" /><path d="M70 52 q8 -10 16 0" /></g>
    case 'wide':
      return <g><circle cx="42" cy="50" r="9" fill="#fff" stroke={ink} strokeWidth="3" /><circle cx="78" cy="50" r="9" fill="#fff" stroke={ink} strokeWidth="3" /><circle cx="42" cy="50" r="3.5" fill={ink} /><circle cx="78" cy="50" r="3.5" fill={ink} /></g>
    case 'hearts':
      return <g fill="#be123c"><path d="M42 58 l-9 -9 a5 5 0 0 1 9 -6 a5 5 0 0 1 9 6z" /><path d="M78 58 l-9 -9 a5 5 0 0 1 9 -6 a5 5 0 0 1 9 6z" /></g>
    case 'closed':
      return <g fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M33 50 l14 4" /><path d="M87 50 l-14 4" /></g>
    case 'angry':
      return <g><circle cx="42" cy="52" r="5" fill={ink} /><circle cx="78" cy="52" r="5" fill={ink} /><g stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M32 40 l18 7" /><path d="M88 40 l-18 7" /></g></g>
    case 'glasses':
      return <g><rect x="28" y="42" width="30" height="18" rx="6" fill={ink} /><rect x="62" y="42" width="30" height="18" rx="6" fill={ink} /><path d="M58 50 h4" stroke={ink} strokeWidth="3" /><path d="M33 46 l8 0" stroke="#fff" strokeWidth="2" opacity=".5" /></g>
    case 'stars':
      return <g fill="#fde047" stroke={ink} strokeWidth="1.5"><path d="M42 41 l3 7 8 1 -6 5 2 8 -7 -4 -7 4 2 -8 -6 -5 8 -1z" /><path d="M78 41 l3 7 8 1 -6 5 2 8 -7 -4 -7 4 2 -8 -6 -5 8 -1z" /></g>
    case 'tired':
      return <g fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round"><path d="M33 53 h16" /><path d="M71 53 h16" /></g>
    default:
      return <g fill={ink}><circle cx="42" cy="52" r="5.5" /><circle cx="78" cy="52" r="5.5" /></g>
  }
}

function Mouth({ kind }: { kind: StickerDef['mouth'] }): ReactNode {
  const ink = '#0f172a'
  switch (kind) {
    case 'grin':
      return <g><path d="M36 72 q24 26 48 0z" fill={ink} /><path d="M44 77 q16 8 32 0" fill="#fb7185" /></g>
    case 'o':
      return <ellipse cx="60" cy="80" rx="8" ry="10" fill={ink} />
    case 'flat':
      return <path d="M46 80 h28" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    case 'frown':
      return <path d="M42 86 q18 -16 36 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    case 'tongue':
      return <g><path d="M40 74 q20 14 40 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" /><path d="M52 80 v8 a8 8 0 0 0 16 0 v-8z" fill="#fb7185" stroke={ink} strokeWidth="2" /></g>
    case 'wavy':
      return <path d="M40 80 q5 -8 10 0 t10 0 t10 0 t10 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    default:
      return <path d="M40 74 q20 16 40 0" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
  }
}

function Extra({ kind }: { kind?: StickerDef['extra'] }): ReactNode {
  switch (kind) {
    case 'zzz':
      return <g fill="#e0e7ff" fontFamily="system-ui, sans-serif" fontWeight="800"><text x="88" y="30" fontSize="18">Z</text><text x="100" y="18" fontSize="13">z</text></g>
    case 'tear':
      return <path d="M30 62 q-6 12 0 16 q6 -4 0 -16z" fill="#7dd3fc" stroke="#0369a1" strokeWidth="1.5" />
    case 'flame':
      return <path d="M60 -2 q-18 16 -6 26 q-14 -2 -10 -16 q-16 14 -2 28 h36 q16 -14 0 -30 q-2 10 -8 14 q8 -14 -10 -22z" transform="translate(0 4) scale(.7) translate(26 -4)" fill="#fde047" stroke="#ea580c" strokeWidth="3" />
    case 'hat':
      return <g><path d="M60 -4 l-20 30 h40z" fill="#fde047" stroke="#a16207" strokeWidth="3" /><circle cx="60" cy="-6" r="5" fill="#f472b6" /><path d="M46 14 h28" stroke="#f472b6" strokeWidth="3" /></g>
    case 'sweat':
      return <path d="M96 30 q-7 12 0 16 q7 -4 0 -16z" fill="#7dd3fc" stroke="#0369a1" strokeWidth="1.5" />
    case 'sparkle':
      return <g fill="#fff"><path d="M98 22 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" /><path d="M22 28 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" /></g>
    case 'bulb':
      return <g><circle cx="60" cy="6" r="11" fill="#fef08a" stroke="#a16207" strokeWidth="2.5" /><rect x="55" y="16" width="10" height="6" rx="2" fill="#a16207" /><path d="M60 -14 v-6 M44 -6 l-5 -4 M76 -6 l5 -4" stroke="#fde047" strokeWidth="3" strokeLinecap="round" /></g>
    case 'heart':
      return <path d="M100 30 l-10 -10 a6 6 0 0 1 10 -7 a6 6 0 0 1 10 7z" fill="#fb7185" stroke="#9f1239" strokeWidth="2" />
    case 'thumb':
      return <g transform="translate(78 78)"><rect x="0" y="12" width="12" height="22" rx="3" fill="#fde68a" stroke="#92400e" strokeWidth="2" /><path d="M14 16 l8 -18 a5 5 0 0 1 8 6 l-3 10 h12 a5 5 0 0 1 4 7 l-4 14 a5 5 0 0 1 -5 3 h-20z" fill="#fde68a" stroke="#92400e" strokeWidth="2" /></g>
    default:
      return null
  }
}

/** Ein Sticker als SVG. `size` ist die Breite in Pixeln. */
export function Sticker({ def, size = 112 }: { def: StickerDef; size?: number }) {
  const gid = `stk-${def.id}`
  return (
    <svg
      viewBox="-12 -26 144 168"
      width={size}
      height={(size * 168) / 144}
      role="img"
      aria-label={`Sticker: ${def.label}`}
      className="select-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={def.bg[0]} />
          <stop offset="1" stopColor={def.bg[1]} />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="#fff" />
      <circle cx="60" cy="60" r="51" fill={`url(#${gid})`} />
      <ellipse cx="42" cy="32" rx="18" ry="9" fill="#fff" opacity=".22" transform="rotate(-25 42 32)" />
      <Eyes kind={def.eyes} />
      <Mouth kind={def.mouth} />
      <Extra kind={def.extra} />
      {def.caption && (
        <g>
          <rect x="6" y="116" width="108" height="26" rx="13" fill="#fff" stroke="#0f172a" strokeWidth="3" />
          <text x="60" y="135" textAnchor="middle" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="16" fill="#0f172a">{def.caption}</text>
        </g>
      )}
    </svg>
  )
}

/** Auswahl-Raster für den Chat. */
export function StickerPicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="group" aria-label="Sticker auswählen">
      {STICKERS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          aria-label={`Sticker ${s.label} senden`}
          className="flex min-h-[64px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-1 transition hover:border-accent-cyan/40 hover:bg-white/10 active:scale-95"
        >
          <Sticker def={s} size={56} />
        </button>
      ))}
    </div>
  )
}
