import { rpc } from './rpc'

export interface ChipStatus {
  chips: number
  /** Heute neu geschenkte Chips (nur beim ersten Aufruf des Tages > 0). */
  gift: number
  bought_today: number
  buy_left: number
  limit: number
  /** Coins pro Chip. */
  rate: number
  daily: number
  /** Restliche Sperre in Millisekunden (Portemonnaie leer geschüttelt). */
  lock_ms: number
}
export type ChipTrade = ChipStatus & { koins: number }

export const getChipStatus = () => rpc<ChipStatus>('chip_status')
export const buyChips = (chips: number) => rpc<ChipTrade>('chip_buy', { p_chips: chips })
export const sellChips = (chips: number) => rpc<ChipTrade>('chip_sell', { p_chips: chips })
