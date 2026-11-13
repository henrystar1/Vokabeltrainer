import { rpc } from './rpc'

export type OgKind = 'rps' | 'ludo' | 'ships' | 'shooter' | 'chess' | 'checkers' | 'race'
export const OG_NAMES: Record<OgKind, string> = { rps: 'Schnick Schnack Schnuck', ludo: 'Mensch ärgere dich nicht', ships: 'Schiffe versenken', shooter: '3D-Shooter', chess: 'Schach', checkers: 'Dame', race: '3D-Rennen' }

export interface OgListItem {
  id: string
  kind: OgKind
  status: 'lobby' | 'running' | 'finished' | 'cancelled'
  my_state: 'invited' | 'joined'
  host: string
  host_id: string
  my_turn: boolean
  winner_me: boolean
  names: string[]
  updated_at: string
}
export interface OgPlayer { user_id: string; name: string; seat: number | null; join_state: 'invited' | 'joined' | 'declined' | 'left'; avatar_id: string | null; color_id: string | null }

export interface RpsState { to_win: number; score: Record<string, number>; rounds: Array<{ a: string; b: string; w: number | null }> }
export interface ShipsShot { r: number; c: number; res: 'miss' | 'hit' | 'sunk'; sunk?: Ship }
export interface Ship { len: number; r: number; c: number; h: boolean }
export interface ShipsState { phase: 'placing' | 'running'; shots: Record<string, ShipsShot[]> }
export interface LudoLast { seat: number; dice: number; piece?: number; from?: number; to?: number; caps?: Array<{ seat: number; piece: number }>; rolled?: boolean; nomove?: boolean; again?: boolean }
export interface LudoState { seats: number[]; pieces: Record<string, number[]>; turn: number; dice?: number; tries: number; out: number[]; last?: LudoLast; winner?: number }

export interface RaceCarState { id?: string; name?: string; kind: string; color: string; top?: number | null }
export interface RaceCustomState { id: string; name: string; pts: Array<[number, number]>; width: number }
export interface RaceState { cars?: Record<string, RaceCarState>; custom?: RaceCustomState | null; track?: number; laps?: number; t0?: number; first_at?: number; results?: Record<string, number> }

export interface OgView {
  id: string
  kind: OgKind
  status: 'lobby' | 'running' | 'finished' | 'cancelled'
  version: number
  host_id: string
  me: { user_id: string; seat: number | null; join_state: string }
  turn_seat: number | null
  winner_seat: number | null
  state: RpsState & ShipsState & LudoState & RaceState
  players: OgPlayer[]
  mine: { pick?: string; opp_picked?: boolean; ships?: Ship[]; placed?: boolean; opp_placed?: boolean; opp_ships?: Ship[]; legal?: number[] }
}

export const ogCreate = (kind: OgKind, opponents: string[]) => rpc<string>('og_create', { p_kind: kind, p_opponents: opponents })
export const ogList = () => rpc<OgListItem[]>('og_list')
export const ogGet = (id: string) => rpc<OgView>('og_get', { p_id: id })
/** Bei Ablehnung gibt der Server nichts zurück (null). */
export const ogRespond = (id: string, accept: boolean) => rpc<OgView | null>('og_respond', { p_id: id, p_accept: accept })
export const ogStart = (id: string) => rpc<OgView>('og_start', { p_id: id })
export const ogLeave = (id: string) => rpc<OgView>('og_leave', { p_id: id })
export const ogRpsPick = (id: string, pick: string) => rpc<OgView>('og_rps_pick', { p_id: id, p_pick: pick })
export const ogLudoRoll = (id: string) => rpc<OgView>('og_ludo_roll', { p_id: id })
export const ogLudoMove = (id: string, piece: number) => rpc<OgView>('og_ludo_move', { p_id: id, p_piece: piece })
export const ogShipsPlace = (id: string, ships: Ship[]) => rpc<OgView>('og_ships_place', { p_id: id, p_ships: ships })
export const ogShipsShoot = (id: string, r: number, c: number) => rpc<OgView>('og_ships_shoot', { p_id: id, p_r: r, p_c: c })

export interface SpectateGame { id: string; kind: OgKind; status: string; updated_at: string; players: string[] | null }
export interface SpectateView {
  id: string; kind: OgKind; status: string; version: number; host_id: string; turn_seat: number | null; winner_seat: number | null
  state: RpsState & ShipsState & LudoState
  players: { user_id: string; name: string; seat: number | null; join_state: string; secret: { ships?: Ship[]; pick?: string } }[]
}
export const ogSpectateList = () => rpc<SpectateGame[]>('og_spectate_list')
export const ogSpectateView = (id: string) => rpc<SpectateView>('og_spectate_view', { p_id: id })

export const ogShooterReport = (id: string, scores: Record<string, number>, final: boolean) => rpc<OgView>('og_shooter_report', { p_id: id, p_scores: scores, p_final: final })
export const ogShooterLeave = (id: string) => rpc<OgView>('og_shooter_leave', { p_id: id })

export const ogBoardMove = (id: string, state: Record<string, unknown>, result: 'ongoing' | 'win' | 'draw') => rpc<OgView>('og_board_move', { p_id: id, p_state: state, p_result: result })
export const ogBoardResign = (id: string) => rpc<OgView>('og_board_resign', { p_id: id })
export const ogBoardDraw = (id: string, action: 'offer' | 'accept' | 'decline' | 'withdraw') => rpc<OgView>('og_board_draw', { p_id: id, p_action: action })

export const ogRaceSet = (id: string, track: number, laps: number, custom: string | null = null) => rpc<OgView>('og_race_set', { p_id: id, p_track: track, p_laps: laps, p_custom: custom })
export const ogRacePick = (id: string, car: string) => rpc<OgView>('og_race_pick', { p_id: id, p_car: car })
export const ogRaceReport = (id: string, ms: number | null) => rpc<OgView>('og_race_report', { p_id: id, p_ms: ms })
export const ogRaceLeave = (id: string) => rpc<OgView>('og_race_leave', { p_id: id })
