/** Was jemand gerade in der App macht – aus der Seite abgeleitet (wird mit dem Online-Signal gesendet). */
const RULES: Array<[RegExp, string]> = [
  [/^\/lernen/, 'learn'],
  [/^\/test/, 'test'],
  [/^\/(ueben|konjugieren|genus|abschreiben)/, 'practice'],
  [/^\/spiele/, 'games'],
  [/^\/gambling/, 'gambling'],
  [/^\/sprint/, 'sprint'],
  [/^\/duell/, 'duel'],
  [/^\/chat/, 'chat'],
  [/^\/druckshop/, 'print'],
  [/^\/shop/, 'shop'],
  [/^\/(buecher|suche)/, 'books'],
  [/^\/verwaltung/, 'admin'],
]

export function activityFor(pathname: string): string {
  return RULES.find(([re]) => re.test(pathname))?.[1] ?? 'app'
}

const LABELS: Record<string, string> = {
  learn: 'lernt Vokabeln',
  test: 'schreibt einen Test',
  practice: 'übt',
  games: 'spielt',
  gambling: 'gambelt',
  sprint: 'macht einen Sprint',
  duel: 'ist im Duell',
  chat: 'ist im Chat',
  print: 'schaut im 3D-Druck-Shop',
  shop: 'ist im Shop',
  books: 'stöbert in den Büchern',
  admin: 'ist in der Verwaltung',
  app: 'ist in der App',
}

export function activityLabel(id: string | null | undefined): string {
  return LABELS[id ?? ''] ?? LABELS.app
}
