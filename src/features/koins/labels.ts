import type { FeedbackKind, FeedbackStatus } from '../../types'

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  idea: 'Idee',
  improvement: 'Verbesserung',
  bug: 'Fehler',
  other: 'Sonstiges',
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'Neu',
  seen: 'Gesehen',
  done: 'Umgesetzt',
  declined: 'Abgelehnt',
}
