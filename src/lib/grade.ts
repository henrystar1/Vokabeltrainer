/** Deutsche Schulnote (1–6) aus Prozent; Grenzen wie an vielen Schulen üblich (92/81/67/50/30). */
export function gradeFromPercent(percent: number): number {
  const p = Number.isFinite(percent) ? percent : 0
  if (p >= 92) return 1
  if (p >= 81) return 2
  if (p >= 67) return 3
  if (p >= 50) return 4
  if (p >= 30) return 5
  return 6
}

export function gradeFromScore(score: number, total: number): number {
  return total <= 0 ? 6 : gradeFromPercent((score / total) * 100)
}

export const GRADE_WORD: Record<number, string> = { 1: 'sehr gut', 2: 'gut', 3: 'befriedigend', 4: 'ausreichend', 5: 'mangelhaft', 6: 'ungenügend' }

export function percentOf(score: number, total: number): number {
  return total <= 0 ? 0 : Math.round((score / total) * 100)
}
