import { rpc } from './rpc'

export interface StockRow {
  base_koins: number
  symbol: string; name: string; price_cents: number | null; prev_close_cents: number | null; updated_at: string | null
  fresh: boolean; unit_koins: number | null; shares: number; cost: number
}
export interface StockTrade { symbol: string; side: 'buy' | 'sell'; shares: number; unit_koins: number; fee: number; total: number; at: string }

export const stockList = () => rpc<StockRow[]>('stock_list')
export const stockChart = (symbol: string, days: number) => rpc<{ t: number; p: number }[]>('stock_chart', { p_symbol: symbol, p_days: days })
export const stockHistory = () => rpc<StockTrade[]>('stock_history')
export const stockTrade = (symbol: string, side: 'buy' | 'sell', shares: number) => rpc<number>('stock_trade', { p_symbol: symbol, p_side: side, p_shares: shares })
export const adminStockSave = (symbol: string, name: string, price: number) => rpc<void>('admin_stock_save', { p_symbol: symbol, p_name: name, p_price: price })
export const adminStockRemove = (symbol: string) => rpc<number>('admin_stock_remove', { p_symbol: symbol })
