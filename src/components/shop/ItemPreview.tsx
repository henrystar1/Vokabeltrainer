import { Avatar, StyledName, Tags } from '../profile/PlayerTag'
import { TAGS, resolveTheme } from '../../features/shop/catalog'
import type { ShopKind } from '../../types'

export interface PreviewItem { id: string; kind: ShopKind; name?: string; price?: number }

/** Vorschau eines Shop-Artikels (Verkleidung, Farbe, Effekt, Titel, Design). */
export default function ItemPreview({ item, name, cosmetics }: { item: PreviewItem; name: string; cosmetics?: { color_id: string | null; effect_id: string | null } }) {
  if (item.kind === 'avatar') return <Avatar name={name} avatarId={item.id} size={(item.price ?? 0) >= 700 ? 76 : 56} />
  if (item.kind === 'tag') return TAGS[item.id] ? <span className={`tag ${TAGS[item.id].className} !text-xs`}>{TAGS[item.id].label}</span> : <Tags tagId={item.id} />
  if (item.kind === 'color') return <StyledName name={name} colorId={item.id} className="text-xl font-semibold" />
  if (item.kind === 'effect') return <StyledName name={name} colorId={cosmetics?.color_id ?? null} effectId={item.id} className="text-xl font-semibold" />
  const t = resolveTheme(item.id)
  return <div className="h-14 w-full rounded-xl border border-white/10" style={{ background: t?.preview ?? '#222' }} />
}
