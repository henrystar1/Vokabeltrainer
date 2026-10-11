import { rpc } from './rpc'

export interface NotifyChat { id: number; from: string; body: string; whisper: boolean; mention: boolean }
export interface NotifyPoll {
  now: string
  chat_max: number
  chat: NotifyChat[]
  ready: { id: string; title: string }[]
  online: { id: string; name: string }[]
}

/** Neue Ereignisse seit dem letzten Abruf. Ohne `chatAfter` kommen nur Startwerte (kein Nachrichten-Schwall). */
export const notifyPoll = (chatAfter: number | null, since: string | null) =>
  rpc<NotifyPoll>('notify_poll', { p_chat_after: chatAfter, p_since: since })
