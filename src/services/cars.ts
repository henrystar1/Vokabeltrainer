import { rpc } from './rpc'

export interface CarRow { id: string; name: string; kind: string; color: string; price: number; active: boolean; owned: boolean; top_kmh: number | null }
export const carList = () => rpc<CarRow[]>('car_list')
export const carBuy = (id: string) => rpc<number>('car_buy', { p_id: id })
export const adminCarSet = (id: string, price: number, active: boolean) => rpc<void>('admin_car_set', { p_id: id, p_price: price, p_active: active })
export const raceSubmit = (track: string, car: string, lapMs: number) => rpc<void>('race_submit', { p_track: track, p_car: car, p_lap_ms: lapMs })

export interface RaceTrackRow { id: string; name: string; pts: Array<[number, number]>; width: number; public: boolean; mine: boolean; owner: string }
export const raceTrackList = () => rpc<RaceTrackRow[]>('race_track_list')
export const raceTrackSave = (name: string, pts: Array<[number, number]>, width: number, isPublic: boolean) => rpc<string>('race_track_save', { p_name: name, p_pts: pts, p_width: width, p_public: isPublic })
export const raceTrackDelete = (id: string) => rpc<void>('race_track_delete', { p_id: id })
export interface BoardRow { name: string; car: string; kind: string; color: string; ms: number; me: boolean }
export interface CarBoardRow { name: string; kind: string; color: string; top: number | null; ms: number; driver: string }
export const raceBoard = (track: string) => rpc<BoardRow[]>('race_board', { p_track: track })
export const raceCarBoard = (track: string) => rpc<CarBoardRow[]>('race_car_board', { p_track: track })
export const raceSuperOk = () => rpc<boolean>('race_super_ok')
export interface SuperRow { id: string; name: string; role: string; granted: boolean }
export const adminSuperList = () => rpc<SuperRow[]>('admin_super_list')
export const adminSuperSet = (user: string, on: boolean) => rpc<void>('admin_super_set', { p_user: user, p_on: on })
