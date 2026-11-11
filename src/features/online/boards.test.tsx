import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OgView } from '../../services/online'
import LudoBoard from './LudoBoard'
import RpsBoard from './RpsBoard'
import ShipsBoard from './ShipsBoard'
import { CheckersBoard, ChessBoard } from './board/BoardGames'

const players = [
  { user_id: 'a', name: 'Anna', seat: 0, join_state: 'joined' as const, avatar_id: null, color_id: null },
  { user_id: 'b', name: 'Ben', seat: 2, join_state: 'joined' as const, avatar_id: null, color_id: null },
]
const base = { id: 'g', version: 3, host_id: 'a', me: { user_id: 'a', seat: 0, join_state: 'joined' }, winner_seat: null, players }

describe('Online-Spiel-Oberflächen', () => {
  it('Mensch ärgere dich nicht zeichnet Brett, Figuren und Hinweise', () => {
    const v = {
      ...base, kind: 'ludo', status: 'running', turn_seat: 0, mine: { legal: [1] },
      state: { seats: [0, 2], pieces: { '0': [-1, 5, 41, -1], '2': [-1, -1, -1, 12] }, turn: 0, dice: 3, tries: 1, out: [], last: { seat: 2, dice: 6, piece: 3, from: -1, to: 0, caps: [{ seat: 0, piece: 0 }] } },
    } as unknown as OgView
    const html = renderToString(<LudoBoard view={v} busy={false} onRoll={() => undefined} onMove={() => undefined} />)
    expect(html).toContain('Spielbrett')
    expect(html).toContain('Tippe auf eine leuchtende Figur')
    expect(html).toContain('wirft Anna raus')
  })
  it('Schnick Schnack Schnuck zeigt Stand und Auswahl', () => {
    const v = { ...base, kind: 'rps', status: 'running', turn_seat: null, mine: {}, state: { to_win: 2, score: { '0': 1, '1': 0 }, rounds: [{ a: 'rock', b: 'scissors', w: 0 }] } } as unknown as OgView
    const html = renderToString(<RpsBoard view={v} busy={false} onPick={() => undefined} />).replace(/<!-- -->/g, '')
    expect(html).toContain('1 : 0')
    expect(html).toContain('Punkt für dich')
  })
  it('Schiffe versenken: Aufstellen und Kampf', () => {
    const place = { ...base, kind: 'ships', status: 'running', turn_seat: null, mine: { placed: false }, state: { phase: 'placing', shots: { '0': [], '1': [] } } } as unknown as OgView
    expect(renderToString(<ShipsBoard view={place} busy={false} onPlace={() => undefined} onShoot={() => undefined} />)).toContain('Setze das Schiff')
    const fight = {
      ...base, kind: 'ships', status: 'running', turn_seat: 0,
      mine: { ships: [{ len: 2, r: 0, c: 0, h: true }], placed: true },
      state: { phase: 'running', shots: { '0': [{ r: 1, c: 1, res: 'hit' }], '1': [{ r: 0, c: 0, res: 'hit' }] } },
    } as unknown as OgView
    const html = renderToString(<ShipsBoard view={fight} busy={false} onPlace={() => undefined} onShoot={() => undefined} />)
    expect(html).toContain('Du bist dran')
    expect(html).toContain('Deine Flotte')
  })
  it('Schach zeigt Brett, Zugtext und Remis-Angebot', () => {
    const v = { ...base, kind: 'chess', status: 'running', turn_seat: 0, mine: {}, me: { user_id: 'a', seat: 0, join_state: 'joined' }, state: { moves: 0, draw_offer: 1 } } as unknown as OgView
    const html = renderToString(<ChessBoard view={v} busy={false} onMove={() => undefined} onDraw={() => undefined} />).replace(/<!-- -->/g, '')
    expect(html).toContain('Schachbrett')
    expect(html).toContain('Anna (Weiß) ist am Zug')
    expect(html).toContain('Remis-Angebot vom Gegner')
  })
  it('Dame zeigt Brett und Schlagzwang-Hinweis nur bei Zwang', () => {
    const v = { ...base, kind: 'checkers', status: 'running', turn_seat: 0, mine: {}, state: { moves: 0, draw_offer: null } } as unknown as OgView
    const html = renderToString(<CheckersBoard view={v} busy={false} onMove={() => undefined} onDraw={() => undefined} />).replace(/<!-- -->/g, '')
    expect(html).toContain('Damebrett')
    expect(html).toContain('Remis anbieten')
    expect(html).not.toContain('Schlagzwang!')
  })
})
