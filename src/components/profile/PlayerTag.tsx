import { AVATARS, EFFECT_CLASSES, ROLE_TAGS, TAGS, nameColorStyle, themeFrameColor } from '../../features/shop/catalog'
import BikeSvg from '../../features/shop/Bike'
import { FrogMini } from '../../features/shop/Frog'
import AnimatedAvatar, { isAnimatedAvatar } from '../../features/shop/AnimatedAvatar'
import type { Flair, Role } from '../../types'

/** Profilbild: animiertes Bild oder Emoji aus dem Shop, sonst Anfangsbuchstabe. */
export function Avatar({ name, avatarId, colorId, size = 32 }: { name: string; avatarId?: string | null; colorId?: string | null; size?: number }) {
  if (avatarId && isAnimatedAvatar(avatarId)) return <AnimatedAvatar id={avatarId} size={size} />
  const emoji = avatarId ? AVATARS[avatarId] : undefined
  const ring = nameColorStyle(colorId).style
  const ringColor = ring.color ?? (ring.backgroundImage ? 'rgb(var(--c-violet))' : undefined)
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-space-600 font-semibold text-slate-200"
      style={{ width: size, height: size, fontSize: size * 0.55, boxShadow: ringColor ? `0 0 0 2px ${ringColor}` : undefined }}
    >
      {emoji ?? (name.trim().charAt(0).toUpperCase() || '?')}
    </span>
  )
}

/** Klaviertasten-Effekt: Buchstaben als weiße und schwarze Tasten (Muster einer Oktave). */
const KEY_PATTERN = [false, true, false, true, false, false, true, false, true, false, true, false]

function PianoName({ name, className }: { name: string; className: string }) {
  let k = 0
  return (
    <span className={`pk-name ${className}`} aria-label={name}>
      {Array.from(name).map((ch, i) => {
        if (ch === ' ') return <span key={i} className="pk-gap" aria-hidden />
        const black = KEY_PATTERN[k % KEY_PATTERN.length]
        const idx = k++
        return (
          <span key={i} aria-hidden className={`pk ${black ? 'pk-b' : 'pk-w'}`} style={{ '--i': idx } as React.CSSProperties}>
            {ch}
          </span>
        )
      })}
    </span>
  )
}

/** Name mit gekaufter Farbe und gekauftem Effekt. */
export function StyledName({ name, colorId, effectId, className = '' }: { name: string; colorId?: string | null; effectId?: string | null; className?: string }) {
  if (effectId === 'effect_piano') return <PianoName name={name} className={className} />
  const { className: c, style } = nameColorStyle(colorId)
  if (effectId === 'effect_bike' || effectId === 'effect_frog') {
    // Das Fahrzeug/Tier ist ein eigenes Element neben dem Text, damit `truncate` es nicht abschneidet.
    const frog = effectId === 'effect_frog'
    return (
      <span className="relative inline-flex min-w-0 max-w-full items-center">
        <span className={`${frog ? 'fx-frog' : c} ${className}`} style={frog ? undefined : style}>
          {name}
        </span>
        {frog ? (
          <span aria-hidden className="fg-hopper"><span className="fg-hop"><FrogMini /></span></span>
        ) : (
          <span aria-hidden className="bk-name-rider"><BikeSvg /></span>
        )}
      </span>
    )
  }
  const fx = effectId ? EFFECT_CLASSES[effectId] ?? '' : ''
  if (effectId === 'effect_vortex') {
    // Der Strudel ist ein eigenes Element neben dem Text, damit ihn `truncate` nicht abschneidet.
    return (
      <span className="relative isolate inline-flex min-w-0 max-w-full items-center">
        <i aria-hidden className="vx-glow" />
        <span className={`relative z-[1] ${c} ${fx} ${className}`} style={style}>
          {name}
        </span>
      </span>
    )
  }
  return (
    <span className={`${c} ${fx} ${className}`} style={style}>
      {name}
    </span>
  )
}

/** Rollen-Tag (Mod/Admin) und gekaufter Spender-Tag. */
export function Tags({ role, tagId }: { role?: Role; tagId?: string | null }) {
  const r = role ? ROLE_TAGS[role] : undefined
  const t = tagId ? TAGS[tagId] : undefined
  if (!r && !t) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {r && <span className={`tag ${r.className}`}>{r.label}</span>}
      {t && <span className={`tag ${t.className}`}>{t.label}</span>}
    </span>
  )
}

/**
 * Profilbild + Name + Tags (Rangliste, Seitenleiste, Profil).
 * `framed`: farbiger Rahmen in der Hauptfarbe des gewählten Website-Designs (z. B. Gold).
 */
export default function PlayerTag({
  name,
  cosmetics,
  size = 32,
  className = '',
  framed = false,
}: {
  name: string
  cosmetics: Flair
  size?: number
  className?: string
  framed?: boolean
}) {
  const frame = framed ? themeFrameColor(cosmetics.theme_id) : null
  return (
    <span
      className={`flex min-w-0 items-center gap-2.5 ${frame ? 'w-fit max-w-full rounded-full py-1 pl-1 pr-3' : ''} ${className}`}
      style={frame ? { boxShadow: `0 0 0 1.5px ${frame}, 0 0 14px -2px ${frame}`, background: `linear-gradient(90deg, ${frame}22, transparent 70%)` } : undefined}
    >
      <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
      <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
      <Tags role={cosmetics.role} tagId={cosmetics.tag_id} />
    </span>
  )
}
