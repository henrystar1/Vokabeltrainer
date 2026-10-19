import { AVATARS, EFFECT_CLASSES, ROLE_TAGS, TAGS, nameColorStyle, themeFrameColor } from '../../features/shop/catalog'
import { getAvatarBg, shade, useAvatarBgVersion } from '../../features/shop/avatarBg'
import BikeSvg from '../../features/shop/Bike'
import { FrogMini } from '../../features/shop/Frog'
import AnimatedAvatar, { isAnimatedAvatar } from '../../features/shop/AnimatedAvatar'
import { customEffect, customTag, getCustom, svgDataUrl, useCustomVersion } from '../../features/shop/custom'
import type { Flair, Role } from '../../types'

/** Profilbild: animiertes Bild oder Emoji aus dem Shop, sonst Anfangsbuchstabe. */
export function Avatar({ name, avatarId, colorId, size = 32 }: { name: string; avatarId?: string | null; colorId?: string | null; size?: number }) {
  useCustomVersion()
  useAvatarBgVersion()
  if (avatarId && isAnimatedAvatar(avatarId)) return <AnimatedAvatar id={avatarId} size={size} />
  const own = avatarId ? getCustom(avatarId) : undefined
  if (own?.svg) {
    return (
      <img
        src={svgDataUrl(own.svg)}
        alt=""
        aria-hidden
        draggable={false}
        className="shrink-0 rounded-full bg-space-600 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  const emoji = avatarId ? AVATARS[avatarId] : undefined
  const ring = nameColorStyle(colorId).style
  const ringColor = ring.color ?? (ring.backgroundImage ? 'rgb(var(--c-violet))' : undefined)
  // Emoji auf einer Scheibe mit Verlauf und Glanz (statt nackt auf grauem Grund): Farbton je Avatar stabil aus der ID.
  const hue = emoji ? hueOf(avatarId ?? '') : 0
  const myBg = emoji ? getAvatarBg(name) : undefined // selbst gewählte Hintergrundfarbe
  const disc = emoji
    ? myBg
      ? `radial-gradient(circle at 30% 22%, rgb(255 255 255 / 0.35), transparent 55%), linear-gradient(145deg, ${shade(myBg, 0.1)}, ${shade(myBg, -0.35)})`
      : `radial-gradient(circle at 30% 22%, hsl(${hue} 90% 78% / 0.55), transparent 55%), linear-gradient(145deg, hsl(${hue} 70% 38%), hsl(${(hue + 50) % 360} 65% 20%))`
    : undefined
  const shadows = [
    ringColor ? `0 0 0 2px ${ringColor}` : '',
    emoji ? `inset 0 1px 1px ${myBg ? 'rgb(255 255 255 / 0.5)' : `hsl(${hue} 100% 88% / 0.55)`}, inset 0 -3px 6px rgb(0 0 0 / 0.3), 0 0 ${Math.round(size / 3)}px -2px ${myBg ?? `hsl(${hue} 90% 60% / 0.55)`}` : '',
  ].filter(Boolean).join(', ')
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-slate-200 ${emoji ? '' : 'bg-space-600'}`}
      style={{ width: size, height: size, fontSize: size * (emoji ? 0.54 : 0.55), background: disc, boxShadow: shadows || undefined }}
    >
      {emoji ? <span style={{ filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.45))', lineHeight: 1 }}>{emoji}</span> : name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function hueOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
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
  useCustomVersion()
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
  const ownFx = effectId && !EFFECT_CLASSES[effectId] ? getCustom(effectId) : undefined
  if (ownFx && ownFx.kind === 'effect') {
    const e = customEffect(ownFx)
    return (
      <span className={`${c} ${e.className} ${className}`} style={{ ...style, ...e.style }}>
        {name}
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
  useCustomVersion()
  const t = tagId ? TAGS[tagId] : undefined
  const own = tagId && !t ? getCustom(tagId) : undefined
  const ownTag = own && own.kind === 'tag' ? customTag(own) : undefined
  if (!r && !t && !ownTag) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {r && <span className={`tag ${r.className}`}>{r.label}</span>}
      {t && <span className={`tag ${t.className}`}>{t.label}</span>}
      {ownTag && <span className={`tag ${ownTag.className}`} style={ownTag.style}>{ownTag.label}</span>}
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
  if (framed && cosmetics.theme_id === 'theme_blackhole') {
    // Schwarzes Loch: doppelter Rahmen (blau auf weiß), der sich dreht.
    return (
      <span className={`bh-ring flex w-fit min-w-0 max-w-full ${className}`}>
        <span className="bh-ring-in">
          <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
          <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
          <Tags role={cosmetics.role} tagId={cosmetics.tag_id} />
        </span>
      </span>
    )
  }
  if (framed && cosmetics.theme_id === 'theme_mountain') {
    return (
      <span className={`mt-ring flex w-fit min-w-0 max-w-full ${className}`}>
        <span className="mt-ring-in">
          <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
          <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
          <Tags role={cosmetics.role} tagId={cosmetics.tag_id} />
        </span>
      </span>
    )
  }
  if (framed && cosmetics.theme_id === 'theme_football') {
    return (
      <span className={`fb-ring flex w-fit min-w-0 max-w-full ${className}`}>
        <span className="fb-ring-in">
          <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
          <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
          <Tags role={cosmetics.role} tagId={cosmetics.tag_id} />
        </span>
      </span>
    )
  }
  if (framed && cosmetics.theme_id === 'theme_food') {
    return (
      <span className={`fd-ring flex w-fit min-w-0 max-w-full ${className}`}>
        <span className="fd-ring-in">
          <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
          <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
          <Tags role={cosmetics.role} tagId={cosmetics.tag_id} />
        </span>
      </span>
    )
  }
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
