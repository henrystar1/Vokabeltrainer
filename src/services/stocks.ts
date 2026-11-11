import { rpc } from './rpc'

export interface StockConfig { key: string; symbols: string[]; rate: number; fee_permille: number }
export interface StockRow {
  symbol: string; name: string; price_cents: number | null; prev_close_cents: number | null; updated_at: string | null
  fresh: boolean; unit_koins: number | null; shares: number; cost: number
}
export interface StockTrade { symbol: string; side: 'buy' | 'sell'; shares: number; unit_koins: number; fee: number; total: number; at: string }

export const stockConfig = () => rpc<StockConfig>('stock_config')
export const stockList = () => rpc<StockRow[]>('stock_list')
export const stockHistory = () => rpc<StockTrade[]>('stock_history')
export const stockReport = (symbol: string, price: number, prev: number) => rpc<void>('stock_report', { p_symbol: symbol, p_price: price, p_prev: prev })
export const stockTrade = (symbol: string, side: 'buy' | 'sell', shares: number) => rpc<number>('stock_trade', { p_symbol: symbol, p_side: side, p_shares: shares })
export const adminStockGetKey = () => rpc<string>('admin_stock_get_key')
export const adminStockSetKey = (key: string) => rpc<void>('admin_stock_set_key', { p_key: key })
export const adminStockSave = (symbol: string, name: string) => rpc<void>('admin_stock_save', { p_symbol: symbol, p_name: name })
export const adminStockRemove = (symbol: string) => rpc<number>('admin_stock_remove', { p_symbol: symbol })

export interface Quote { c: number; pc: number }
/** Holt einen Kurs direkt von Finnhub (läuft im Browser). Gibt null zurück, wenn nichts Brauchbares kommt. */
export async function fetchQuote(symbol: string, key: string): Promise<Quote | null> {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`)
    if (!r.ok) return null
    const j = (await r.json()) as { c?: number; pc?: number }
    if (typeof j.c !== 'number' || !(j.c > 0)) return null
    return { c: j.c, pc: typeof j.pc === 'number' && j.pc > 0 ? j.pc : j.c }
  } catch { return null }
}
