import type { HoleAnim, Look } from './lookTypes'
import { BH_APPEAR, BH_IN, BH_OUT, drawAdminBack, drawAdminBody, drawAdminName, drawBlackholeAnim } from './adminFx'
import { HAMMER_APPEAR, HAMMER_IN, HAMMER_OUT, drawHammerAnim, drawModBack, drawModBody, drawModName } from './modFx'
import { GUITAR_APPEAR, GUITAR_IN, GUITAR_OUT, drawGuitarAnim, drawGuitarBack, drawGuitarBody, drawGuitarName } from './guitarFx'
import { PIANO_APPEAR, PIANO_IN, PIANO_OUT, drawPianoAnim, drawPianoBack, drawPianoBody, drawPianoName } from './pianoFx'

type Ctx = CanvasRenderingContext2D
export interface LookDef {
  id: Look
  name: string
  blurb: string
  inDur: number
  outDur: number
  appear: number
  anim: (c: Ctx, h: HoleAnim, t: number) => void
  back: (c: Ctx, x: number, y: number, t: number, alpha?: number) => void
  body: (c: Ctx, x: number, y: number, face: 1 | -1, t: number, alpha?: number, scale?: number, rot?: number) => void
  label: (c: Ctx, cx: number, y: number, name: string, t: number) => void
}

export const LOOKS: Record<Look, LookDef> = {
  blackhole: { id: 'blackhole', name: 'Schwarzes Loch', blurb: 'Rakete schlägt ein, beim Gehen wirst du eingesaugt.', inDur: BH_IN, outDur: BH_OUT, appear: BH_APPEAR, anim: drawBlackholeAnim, back: drawAdminBack, body: drawAdminBody, label: drawAdminName },
  hammer: { id: 'hammer', name: 'Hammer & Blitz', blurb: 'Ein Hammer fällt, ein Blitz schlägt ein.', inDur: HAMMER_IN, outDur: HAMMER_OUT, appear: HAMMER_APPEAR, anim: drawHammerAnim, back: drawModBack, body: drawModBody, label: drawModName },
  guitar: { id: 'guitar', name: 'Gitarre', blurb: 'Ein Scheinwerfer geht an, eine Gitarre stürzt herab und bleibt stecken. Beim Gehen rockst du im Scheinwerfer davon.', inDur: GUITAR_IN, outDur: GUITAR_OUT, appear: GUITAR_APPEAR, anim: drawGuitarAnim, back: drawGuitarBack, body: drawGuitarBody, label: drawGuitarName },
  piano: { id: 'piano', name: 'Klavier', blurb: 'Ein Klavier kracht herunter, beim Gehen fliegst du als Klavier davon.', inDur: PIANO_IN, outDur: PIANO_OUT, appear: PIANO_APPEAR, anim: drawPianoAnim, back: drawPianoBack, body: drawPianoBody, label: drawPianoName },
}
