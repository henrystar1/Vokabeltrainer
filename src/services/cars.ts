import { rpc } from './rpc'
import { registerCustomRows } from '../features/cars/customCar'

export interface CarRow { id: string; name: string; kind: string; color: string; price: number; active: boolean; owned: boolean; top_kmh: number | null; /** Bauplan (nur eigene Autos vom Admin) */ spec?: unknown }
/** Autoliste; eigene Autos (Bauplan) werden dabei im Spiel bekannt gemacht. */
export const carList = async (): Promise<CarRow[]> => { const l = await rpc<CarRow[]>('car_list'); registerCustomRows(l); return l }
export const adminCarCustomSave = (id: string, name: string, price: number, top: number, color: string, spec: unknown) => rpc<void>('admin_car_custom_save', { p_id: id, p_name: name, p_price: price, p_top: top, p_color: color, p_spec: spec })
export const carBuy = (id: string) => rpc<number>('car_buy', { p_id: id })
export const carSell = (id: string) => rpc<number>('car_sell', { p_id: id })
export const adminCarSet = (id: string, price: number, active: boolean) => rpc<void>('admin_car_set', { p_id: id, p_price: price, p_active: active })
export const raceSubmit = (track: string, car: string, lapMs: number) => rpc<void>('race_submit', { p_track: track, p_car: car, p_lap_ms: lapMs })

export interface RaceTrackRow { id: string; name: string; pts: Array<[number, number]>; width: number; public: boolean; mine: boolean; owner: string; /** ausgefüllte Übungsfläche */ fill?: boolean }
export const raceTrackList = () => rpc<RaceTrackRow[]>('race_track_list')
export const raceTrackSave = (name: string, pts: Array<[number, number]>, width: number, isPublic: boolean, fill = false) => rpc<string>('race_track_save', { p_name: name, p_pts: pts, p_width: width, p_public: isPublic, p_fill: fill })
export const raceTrackDelete = (id: string) => rpc<void>('race_track_delete', { p_id: id })
export interface BoardRow { name: string; car: string; kind: string; color: string; ms: number; me: boolean }
export interface CarBoardRow { name: string; kind: string; color: string; top: number | null; ms: number; driver: string }
export const raceBoard = (track: string) => rpc<BoardRow[]>('race_board', { p_track: track })
export const raceCarBoard = (track: string) => rpc<CarBoardRow[]>('race_car_board', { p_track: track })
export const raceSuperOk = () => rpc<boolean>('race_super_ok')
export interface SuperRow { id: string; name: string; role: string; granted: boolean; /** wirksames Tempo (km/h) */ kmh: number; /** eigenes Tempo gesetzt (sonst Standard) */ custom: boolean; /** hat den Fahrassistenten */ assist?: boolean }
export const adminSuperList = () => rpc<SuperRow[]>('admin_super_list')
export const adminSuperSet = (user: string, on: boolean) => rpc<void>('admin_super_set', { p_user: user, p_on: on })
export const adminSuperSpeed = (kmh: number) => rpc<void>('admin_super_speed', { p_kmh: kmh })
/** Fahrassistent für eine Person mit Supercar-Zugang an/aus. */
export const adminSuperAssist = (user: string, on: boolean) => rpc<void>('admin_super_assist', { p_user: user, p_on: on })
/** Tempo des Supercars für einen Nutzer (null = Standard). */
export const adminSuperUserSpeed = (user: string, kmh: number | null) => rpc<void>('admin_super_user_speed', { p_user: user, p_kmh: kmh })
export interface SuperInfo { ok: boolean; kmh: number; /** Fahrassistent (nur Admins) */ assist: boolean; /** Flug-Einstellungen des Admins (Sekunden; Rolle an/aus) */ fly?: { sec: number; cool: number; roll: boolean }; /** Sitzplätze je Auto (Admin, Standard 4) */ seats?: number; /** Lauf- und Sprinttempo zu Fuß (m/s) */ walk?: number; run?: number }
export const adminFlySet = (sec: number, cool: number, roll: boolean) => rpc<void>('admin_fly_set', { p_sec: sec, p_cool: cool, p_roll: roll })
export const adminFootSet = (walk: number, run: number) => rpc<void>('admin_foot_set', { p_walk: walk, p_run: run })
export const adminSeatsSet = (n: number) => rpc<void>('admin_seats_set', { p_n: n })
export const raceSuperInfo = () => rpc<SuperInfo>('race_super_info')
export interface CarUpRow { car_id: string; motor: number; reifen: number; bremse: number }
export const carUpgrades = () => rpc<CarUpRow[]>('car_upgrades')
export const carUpgrade = (car: string, part: string) => rpc<{ koins: number } & CarUpRow>('car_upgrade', { p_car: car, p_part: part })
/** Coins fürs Rennen (Platz, Starterfeld inkl. dir, Zeit); der Server rechnet und deckelt pro Tag. */
export interface RaceRewardResult { coins: number; koins: number | null; capped: boolean }
/** Coins für die Polizeijagd: mit Menschen mehr als nur mit Bots, Sieger mehr als Verlierer (Server rechnet und deckelt). */
export const raceChaseReward = (humans: number, bots: number, win: boolean, secs: number) => rpc<RaceRewardResult>('race_chase_reward', { p_humans: humans, p_bots: bots, p_win: win, p_secs: secs })
export const raceReward = (place: number, field: number, ms: number, online: boolean) => rpc<RaceRewardResult>('race_reward', { p_place: place, p_field: field, p_ms: ms, p_online: online })
