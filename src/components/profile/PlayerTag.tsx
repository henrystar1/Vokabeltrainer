import { AVATARS, EFFECT_CLASSES, nameColorStyle } from '../../features/shop/catalog'
import type { Cosmetics } from '../../types'

/** Profilbild: Emoji aus dem Shop oder Anfangsbuchstabe. */
export function Avatar({ name, avatarId, colorId, size = 32 }: { name: string; avatarId?: string | null; colorId?: string | null; size?: number }) {
  const emoji = avatarId ? AVATARS[avatarId] : undefined
  const { style } = nameColorStyle(colorId)
  const ring = style.color
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-space-600 font-semibold text-slate-200"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        boxShadow: ring ? `0 0 0 2px ${ring}` : style.backgroundImage ? '0 0 0 2px rgb(var(--c-violet))' : undefined,
      }}
    >
      {emoji ?? (name.trim().charAt(0).toUpperCase() || '?')}
    </span>
  )
}

/** Name mit gekaufter Farbe und gekauftem Effekt. */
export function StyledName({ name, colorId, effectId, className = '' }: { name: string; colorId?: string | null; effectId?: string | null; className?: string }) {
  const { className: c, style } = nameColorStyle(colorId)
  const fx = effectId ? EFFECT_CLASSES[effectId] ?? '' : ''
  return (
    <span className={`${c} ${fx} ${className}`} style={style}>
      {name}
    </span>
  )
}

/** Profilbild + Name zusammen (Rangliste, Seitenleiste, Profil). */
export default function PlayerTag({
  name,
  cosmetics,
  size = 32,
  className = '',
}: {
  name: string
  cosmetics: Cosmetics
  size?: number
  className?: string
}) {
  return (
    <span className={`flex min-w-0 items-center gap-2.5 ${className}`}>
      <Avatar name={name} avatarId={cosmetics.avatar_id} colorId={cosmetics.color_id} size={size} />
      <StyledName name={name} colorId={cosmetics.color_id} effectId={cosmetics.effect_id} className="truncate font-medium" />
    </span>
  )
}
