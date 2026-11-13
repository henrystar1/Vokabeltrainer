import { rpc } from './rpc'

export interface CarRow { id: string; name: string; kind: string; color: string; price: number; active: boolean; owned: boolean; top_kmh: number | null }
export const carList = () => rpc<CarRow[]>('car_list')
export const carBuy = (id: string) => rpc<number>('car_buy', { p_id: id })
export const adminCarSet = (id: string, price: number, active: boolean) => rpc<void>('admin_car_set', { p_id: id, p_price: price, p_active: active })
