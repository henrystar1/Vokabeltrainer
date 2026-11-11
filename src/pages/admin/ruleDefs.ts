export interface Rule { key: string; label: string; hint?: string }

/** Alle einstellbaren Zahlen, nach Themen gruppiert (Zahlen-Tab und Mod-Rechte nutzen dieselbe Liste). */
export const SECTIONS: Array<{ title: string; text?: string; rules: Rule[] }> = [
  {
    title: 'Rangliste & Punkte',
    rules: [
      { key: 'points_per_answer', label: 'Punkte pro richtiger Antwort', hint: 'Rangliste und Liga' },
      { key: 'points_daily_cap', label: 'Richtige Antworten pro Tag, die zählen', hint: 'Mehr Antworten bringen dann keine Punkte' },
      { key: 'points_active_day', label: 'Bonus für jeden aktiven Tag' },
      { key: 'points_accuracy_bonus', label: 'Maximaler Trefferquoten-Bonus pro Tag', hint: 'Bei 100 % richtig der volle Bonus' },
      { key: 'points_accuracy_min', label: 'Trefferquoten-Bonus ab so vielen Antworten' },
    ],
  },
  {
    title: 'Börse',
    text: 'Aktien werden mit Coins gehandelt. Kurse kommen von Finnhub (Schlüssel unter „Börse“).',
    rules: [
      { key: 'stock_koin_per_usd', label: 'Coins pro US-Dollar', hint: 'Eine Aktie zu 200 $ kostet bei 10 dann 2000 Coins' },
      { key: 'stock_fee_permille', label: 'Gebühr in ‰ (10 = 1 %)', hint: 'Bei Kauf und Verkauf' },
      { key: 'stock_max_age_min', label: 'Kurs gilt so viele Minuten', hint: 'Danach ist der Handel gesperrt, bis ein neuer Kurs bestätigt ist' },
      { key: 'stock_min_reporters', label: 'Personen, die einen Kurs bestätigen müssen', hint: 'Schützt vor gefälschten Kursen' },
    ],
  },
  {
    title: '3D-Shooter',
    rules: [
      { key: 'shooter_fee', label: 'Kosten pro Spiel für die Lobby-Erstellung (Coins)' },
      { key: 'shooter_to_win', label: 'Treffer bis zum Sieg' },
      { key: 'shooter_minutes', label: 'Maximale Spieldauer (Minuten)' },
    ],
  },
  {
    title: 'Tages-Quests',
    text: 'Wie viel man für die Quests schaffen muss. Die Coins-Belohnungen stehen unter „Coins & Belohnungen“.',
    rules: [
      { key: 'quest_goal_answers', label: 'Fleißig: richtige Antworten' },
      { key: 'quest_goal_perfect', label: 'Fehlerfrei: Mindestfragen der Runde' },
      { key: 'quest_goal_sprint', label: 'Sprinter: richtige Antworten im Sprint' },
      { key: 'quest_goal_duel', label: 'Herausforderer: Duelle' },
    ],
  },
  {
    title: 'Lernen: Wartezeit zwischen den Phasen',
    text: 'Nach einer Antwort kommt eine Vokabel erst nach dieser Zeit wieder dran (in Minuten, 0 = sofort). 60 = 1 Stunde, 1440 = 1 Tag.',
    rules: [
      { key: 'learn_gap_l1', label: 'Stufe 1 → wieder nach (Min.)' },
      { key: 'learn_gap_l2', label: 'Stufe 2 → wieder nach (Min.)' },
      { key: 'learn_gap_l3', label: 'Stufe 3 → wieder nach (Min.)' },
      { key: 'learn_gap_l4', label: 'Stufe 4 → wieder nach (Min.)' },
    ],
  },
  {
    title: 'Multiple Choice (Übung)',
    text: 'Bringt bewusst weniger als normales Lernen und ändert den Lernstand nicht.',
    rules: [
      { key: 'mc_points_per_answer', label: 'Ranglistenpunkte pro richtiger Antwort' },
      { key: 'mc_daily_cap', label: 'Richtige Antworten pro Tag, die zählen' },
      { key: 'mc_coin_every', label: '1 Coin je so viele richtige Antworten' },
      { key: 'mc_coin_cap', label: 'Coins pro Tag höchstens' },
    ],
  },
  {
    title: 'Mathe',
    text: 'Kopfrechnen mit + − × ÷. Die Ergebnisse werden vom Browser gemeldet; die Mindestzeit pro Aufgabe schützt vor Schummeln.',
    rules: [
      { key: 'math_points_per_answer', label: 'Ranglistenpunkte pro richtiger Antwort' },
      { key: 'math_daily_cap', label: 'Richtige Antworten pro Tag, die zählen' },
      { key: 'math_coin_every', label: '1 Coin je so viele richtige Antworten' },
      { key: 'math_coin_cap', label: 'Coins pro Tag höchstens', hint: '0 = keine Coins' },
      { key: 'math_min_seconds', label: 'Mindestzeit pro Aufgabe (Sekunden)', hint: 'Schneller gemeldete Runden zählen nicht' },
    ],
  },
  {
    title: 'Gambling',
    text: 'Chancen in Promille (1000 = immer). Erwartung pro Einsatz = Gewinnchance × Faktor + Jackpot × Jackpot-Faktor; unter 1000 ‰ Summe bleibt es ein Verlustgeschäft.',
    rules: [
      { key: 'gambling_win_permille', label: 'Gewinnchance (‰)', hint: 'Drei gleiche Symbole' },
      { key: 'gambling_jackpot_permille', label: 'Jackpot-Chance (‰)', hint: 'Dreimal die 7' },
      { key: 'gambling_mult_win', label: 'Gewinn-Faktor', hint: 'Einsatz × Faktor' },
      { key: 'gambling_mult_jackpot', label: 'Jackpot-Faktor' },
      { key: 'gambling_max_bet', label: 'Höchster Einsatz (Coins)', hint: 'Gilt nur, wenn „Ganzes Guthaben setzen“ aus ist. Roulette: insgesamt das Fünffache pro Runde' },
      { key: 'gambling_all_in', label: 'Ganzes Guthaben setzen erlaubt', hint: '1 = jeder darf bis zu seinem ganzen Guthaben setzen (Gewinne können riesig werden), 0 = nur bis zum Höchsteinsatz' },
    ],
  },
  {
    title: 'Gambling: Würfeln & Roulette',
    text: 'Gewinnquote in Promille: 850 = im Schnitt 85 % des Einsatzes kommen zurück (über 1000 wäre ein Gewinn für die Spieler).',
    rules: [
      { key: 'gambling_rtp_dice', label: 'Würfeln: Gewinnquote (‰)', hint: 'Die Auszahlung richtet sich nach der Chance, die der Spieler wählt' },
      { key: 'gambling_dice_max_chance', label: 'Würfeln: höchste wählbare Gewinnchance (%)', hint: '5 bis 95' },
      { key: 'gambling_rtp_roulette', label: 'Roulette: Gewinnquote (‰)' },
    ],
  },
  {
    title: 'Gambling: Glücksrad',
    text: 'Gewichte: Wie oft kommt welcher Faktor im Verhältnis zu den anderen? Die Summe muss nicht 1000 sein, es zählt das Verhältnis. Es wird genau der Faktor ausgezahlt, der auf dem Feld steht.',
    rules: [
      { key: 'gambling_wheel_w0', label: 'Gewicht ×0 (Verlust)' },
      { key: 'gambling_wheel_w05', label: 'Gewicht ×0,5' },
      { key: 'gambling_wheel_w1', label: 'Gewicht ×1' },
      { key: 'gambling_wheel_w2', label: 'Gewicht ×2' },
      { key: 'gambling_wheel_w3', label: 'Gewicht ×3' },
      { key: 'gambling_wheel_w4', label: 'Gewicht ×4' },
    ],
  },
  {
    title: 'Gambling: Black Jack',
    text: 'Der Geber zieht bis 17. Verdoppeln nur mit den ersten zwei Karten, kein Teilen.',
    rules: [
      { key: 'gambling_bj_blackjack_x10', label: 'Black Jack zahlt (Zehntel des Einsatzes zusätzlich)', hint: '12 = 6:5, 15 = 3:2, 10 = 1:1' },
      { key: 'gambling_bj_dealer_hits_soft17', label: 'Geber zieht bei weichem 17', hint: '1 = ja (besser fürs Haus), 0 = nein' },
    ],
  },
  {
    title: 'Gambling: Hausschutz',
    text: 'Schaut auf Einsätze und Auszahlungen der letzten 3 Tage über alle Spiele. Liegt der Gewinn des Hauses unter dem Ziel, wird ein Gewinn mit einer gewissen Wahrscheinlichkeit nicht ausgespielt, ohne dass die Spieler es sehen. Je weiter unter dem Ziel, desto öfter, höchstens mit der unten gesetzten Chance. 0 bei der höchsten Chance schaltet den Schutz aus.',
    rules: [
      { key: 'gambling_guard_target_permille', label: 'Ziel: Hausgewinn (‰ der Einsätze)', hint: '50 = das Haus soll mindestens 5 % behalten' },
      { key: 'gambling_guard_max_permille', label: 'Höchste Chance, einen Gewinn zu streichen (‰)', hint: '0 = Schutz aus, 600 = höchstens 60 %' },
      { key: 'gambling_guard_min_wagered', label: 'Schutz greift erst ab so vielen eingesetzten Coins (3 Tage)' },
    ],
  },
  {
    title: 'Belohnungen: Lernen, Abschreiben, Fehler melden',
    rules: [
      { key: 'book_price_default', label: 'Standardpreis für neu veröffentlichte Bücher' },
      { key: 'copy_reward', label: 'Coins fürs Abschreiben einer Lektion' },
      { key: 'copy_daily_max', label: 'Abschreib-Belohnungen pro Tag höchstens' },
      { key: 'learn_reward', label: 'Coins pro neu gelernter Vokabel (Online-Bücher)' },
      { key: 'learn_daily_cap', label: 'Lern-Coins pro Tag höchstens' },
      { key: 'learn_coin_every', label: 'Lernen: 1 Coin je so viele richtige Antworten', hint: 'Zählt in Online-Büchern, nicht im Test und nicht in der Wiederholung' },
      { key: 'learn_coin_cap', label: 'Lernen: solche Coins pro Tag höchstens', hint: '0 = aus' },
      { key: 'review_reward', label: 'Coins für eine sinnvolle Fehlermeldung' },
      { key: 'irregular_coin_every', label: 'Unregelmäßige Verben: 1 Coin je so viele richtige Antworten' },
      { key: 'irregular_coin_cap', label: 'Unregelmäßige Verben: Coins pro Tag höchstens' },
    ],
  },
  {
    title: 'Belohnungen: Quests und Liga',
    rules: [
      { key: 'quest_reward_answers', label: 'Quest „Fleißig“: Coins' },
      { key: 'quest_reward_perfect', label: 'Quest „Fehlerfrei“: Coins' },
      { key: 'quest_reward_sprint', label: 'Quest „Sprinter“: Coins' },
      { key: 'quest_reward_duel', label: 'Quest „Herausforderer“: Coins' },
      { key: 'league_reward_1', label: 'Liga: Coins für Platz 1' },
      { key: 'league_reward_2', label: 'Liga: Coins für Platz 2' },
      { key: 'league_reward_3', label: 'Liga: Coins für Platz 3' },
      { key: 'league_min_points', label: 'Liga: Mindestpunkte pro Woche (sonst Abstieg)' },
      { key: 'league_promote', label: 'Liga: Wie viele steigen pro Woche auf' },
      { key: 'league_relegate', label: 'Liga: Wie viele steigen pro Woche ab (0 = keine Abstiege nach Rang)' },
      { key: 'league_relegate_min_group', label: 'Liga: Abstieg nach Rang erst ab so vielen Aktiven in der Stufe' },
      { key: 'league_rows_max', label: 'Liga: Zeilen in der Liste (Platzierte)' },
    ],
  },
  {
    title: 'Belohnungen: Sprint und Duelle',
    rules: [
      { key: 'sprint_coin_every', label: 'Sprint: 1 Coin je so viele richtige Antworten' },
      { key: 'sprint_coin_cap', label: 'Sprint: Coins pro Tag höchstens' },
      { key: 'sprint_extra_cost', label: 'Sprint: Coins je zusätzlicher Sekunde' },
      { key: 'sprint_extra_max', label: 'Sprint: höchstens so viele Zusatzsekunden insgesamt (dauerhaft)' },
      { key: 'duel_reward', label: 'Duell-Sieg: Coins', hint: 'Unentschieden: jeder die Hälfte' },
      { key: 'duel_daily_cap', label: 'Duell-Siege mit Coins pro Tag', hint: 'Gilt auch für die Live-Duell- und Klassen-Prämien' },
      { key: 'live_duel_reward', label: 'Live-Duell (bis 4): Siegprämie', hint: 'Nur Platz 1' },
      { key: 'live_class_reward_1', label: 'Klassen-Battle: Prämie Platz 1' },
      { key: 'live_class_reward_2', label: 'Klassen-Battle: Prämie Platz 2' },
      { key: 'live_class_reward_3', label: 'Klassen-Battle: Prämie Platz 3' },
    ],
  },
  {
    title: 'Team-Parkour und Parcours',
    rules: [
      { key: 'team_reward', label: 'Vokabel-Parcours (Team): Coins für jeden bei Erfolg' },
      { key: 'team_daily_cap', label: 'Team-Spiele: Erfolge mit Coins pro Tag' },
      { key: 'team_lives', label: 'Team-Spiele (Parkour und Parcours): gemeinsame Grund-Herzen', hint: '1 bis 9, gilt für neue Läufe' },
      { key: 'parkour_coins_level', label: 'Team-Parkour: Coins je geschafftem Level (für jeden)' },
      { key: 'parkour_coins_cp', label: 'Team-Parkour: Coins je erreichtem Checkpoint (für jeden)' },
      { key: 'parkour_coins_bonus', label: 'Team-Parkour: Bonus für Level 8 (für jeden)' },
      { key: 'parkour_coins_endless', label: 'Team-Parkour: Extra-Coins je Level ab Level 9 (für jeden)' },
    ],
  },
  {
    title: 'Parkour-Shop und Datenbank-Budget',
    rules: [
      { key: 'parkour_heart_price', label: 'Parkour-Shop: Preis für das erste Extra-Herz', hint: 'Jedes weitere kostet ein Vielfaches (2×, 3× …)' },
      { key: 'parkour_heart_max', label: 'Parkour-Shop: Extra-Herzen pro Person (höchstens)' },
      { key: 'parkour_color_price', label: 'Parkour-Shop: Preis einer Körperfarbe', hint: 'Gold, Neon und Regenbogen kosten das Dreifache' },
      { key: 'parkour_hat_price', label: 'Parkour-Shop: Preis eines Huts', hint: 'Krone und Flamme kosten das Dreifache' },
      { key: 'parkour_msg_month_k', label: 'Parkour: Monatsbudget je Spiel-Datenbank (in Tausend Nachrichten)', hint: 'Das Spiel läuft über zwei fremde Supabase-Projekte (Free: je 2,2 Mio. im Monat). Ist das Budget der ersten voll, wechselt alles zur zweiten. An einem Tag dürfen bis zu 4× der Tagesschnitt der übrigen Tage verbraucht werden. Ist das erreicht, ist Parkour bis Mitternacht bzw. Monatsende gesperrt. 0 = kein Limit' },
    ],
  },
  {
    title: 'Coins: Überweisungen, Bonus, Codes und Konten',
    text: '!pay, Tagesbonus, Codes und Anmeldung.',
    rules: [
      { key: 'pay_max', label: '!pay: Höchstbetrag pro Überweisung (Coins)' },
      { key: 'pay_daily_cap', label: '!pay: Coins pro Tag und Person höchstens' },
      { key: 'daily_bonus_mod', label: 'Tagesbonus Mods' },
      { key: 'daily_bonus_admin', label: 'Tagesbonus Admin' },
      { key: 'code_default_amount', label: 'Coins pro Code (Standard)' },
      { key: 'signup_approval', label: 'Neue Konten müssen freigeschaltet werden (1 = ja, 0 = nein)', hint: 'Wer sich selbst registriert, wartet dann auf „Aktivieren“ unter Verwaltung → Benutzer. Konten, die ein Admin anlegt, sind sofort frei' },
    ],
  },
  {
    title: 'Spiele',
    rules: [
      { key: 'game_fee', label: 'Eintritt pro Runde (Coins)' },
      { key: 'game_record_reward', label: 'Coins für einen neuen Rekord', hint: 'Wer die Bestenliste des Spiels übertrifft' },
    ],
  },
  {
    title: 'Auswendig (Pi, Flaggen)',
    text: 'Belohnung gibt es nur, wenn der eigene Bestwert steigt.',
    rules: [
      { key: 'memo_pi_coins_per_10', label: 'Pi lernen: Coins je 10 neue Stellen', hint: '10 = 1 Coin je Stelle, 0 = keine Coins.' },
      { key: 'memo_pi_min_ms', label: 'Pi Schummelschutz: Mindestzeit pro Stelle (Millisekunden)', hint: 'Wer schneller tippt, dessen Rekord wird abgelehnt. 450 = ca. 2 Stellen pro Sekunde.' },
      { key: 'memo_pi_max_minutes', label: 'Pi Schummelschutz: längster Versuch (Minuten)' },
      { key: 'memo_pi_points_per_10', label: 'Pi lernen: Punkte je 10 neue Stellen', hint: '0 = keine Punkte' },
      { key: 'memo_flags_coins_per_10', label: 'Flaggen lernen: Coins je 10 Lernpunkte', hint: 'Lernpunkte = Summe der Fächer aller Länder (bis 5 je Land). 2 = 1 Coin je 5 Lernpunkte, 0 = keine Coins.' },
      { key: 'memo_flags_points_per_100', label: 'Flaggen lernen: Punkte je 100 Lernpunkte', hint: '0 = keine Punkte' },
    ],
  },
  {
    title: 'Adventskalender',
    text: 'Jede Person bekommt beim Öffnen ihre eigene, zufällige Belohnung. Die vier Gewichte bestimmen, wie oft was kommt (nur das Verhältnis zählt, 0 = nie). Türchen 24 ist immer groß.',
    rules: [
      { key: 'advent_force_day', label: 'Testen: so tun, als wäre heute Türchen …', hint: '0 = echtes Datum (nur 1. bis 24. Dezember). 1 bis 24 = dieser Tag ist heute offen. Danach wieder auf 0.' },
      { key: 'advent_w_coins', label: 'Gewicht: Coins' },
      { key: 'advent_w_points', label: 'Gewicht: Punkte' },
      { key: 'advent_w_plus', label: 'Gewicht: Plus-Tage' },
      { key: 'advent_w_item', label: 'Gewicht: Verkleidung / Design', hint: 'Ab Türchen 2' },
      { key: 'advent_limited_chance', label: 'Chance auf einen limitierten Artikel (zusätzlich)', hint: 'In Prozent pro Türchen. Nur solange noch welche übrig sind (je 4 Stück).' },
      { key: 'advent_coins_min', label: 'Coins: mindestens' },
      { key: 'advent_coins_spread', label: 'Coins: Schwankung (zufällig dazu)' },
      { key: 'advent_coins_per_day', label: 'Coins: zusätzliche Schwankung je Türchen-Nummer', hint: 'Spätere Türchen können mehr bringen' },
      { key: 'advent_points_min', label: 'Punkte: mindestens' },
      { key: 'advent_points_spread', label: 'Punkte: Schwankung' },
      { key: 'advent_points_per_day', label: 'Punkte: zusätzliche Schwankung je Türchen-Nummer' },
      { key: 'advent_plus_days_min', label: 'Plus-Tage: mindestens' },
      { key: 'advent_plus_days_per_6', label: 'Plus-Tage: so viele Extra-Tage je 6 Türchen möglich' },
      { key: 'advent_item_price_base', label: 'Artikel: Preisgrenze am Anfang (Coins)' },
      { key: 'advent_item_price_per_day', label: 'Artikel: Preisgrenze wächst je Türchen um (Coins)' },
      { key: 'advent_final_coins', label: 'Türchen 24: Coins mindestens' },
      { key: 'advent_final_coins_spread', label: 'Türchen 24: Coins Schwankung' },
      { key: 'advent_final_plus_days', label: 'Türchen 24: Plus-Tage' },
      { key: 'advent_final_item_price', label: 'Türchen 24: Preisgrenze des Artikels (Coins)' },
    ],
  },
  {
    title: 'Loot Drop',
    text: 'Jeden Tag ein Paket für alle (nur die schnellste Person) und ein persönliches Paket für jeden. Gewichte: nur das Verhältnis zählt, 0 = nie. Pro-Mitglieder bekommen Beträge und Artikelwert mal „Pro: Adventskalender-Gewinne“ (Verwaltung → Plus & Pro).',
    rules: [
      { key: 'loot_p_w_coins', label: 'Persönlich – Gewicht: Coins' },
      { key: 'loot_p_w_points', label: 'Persönlich – Gewicht: Punkte' },
      { key: 'loot_p_w_item', label: 'Persönlich – Gewicht: Verkleidung / Design' },
      { key: 'loot_p_coins_min', label: 'Persönlich – Coins: mindestens' },
      { key: 'loot_p_coins_spread', label: 'Persönlich – Coins: Schwankung (zufällig dazu)' },
      { key: 'loot_p_points_min', label: 'Persönlich – Punkte: mindestens' },
      { key: 'loot_p_points_spread', label: 'Persönlich – Punkte: Schwankung' },
      { key: 'loot_p_item_price', label: 'Persönlich – Artikel: Preisgrenze (Coins)' },
      { key: 'loot_g_w_coins', label: 'Für alle – Gewicht: Coins' },
      { key: 'loot_g_w_points', label: 'Für alle – Gewicht: Punkte' },
      { key: 'loot_g_w_item', label: 'Für alle – Gewicht: Verkleidung / Design' },
      { key: 'loot_g_coins_min', label: 'Für alle – Coins: mindestens' },
      { key: 'loot_g_coins_spread', label: 'Für alle – Coins: Schwankung' },
      { key: 'loot_g_points_min', label: 'Für alle – Punkte: mindestens' },
      { key: 'loot_g_points_spread', label: 'Für alle – Punkte: Schwankung' },
      { key: 'loot_g_item_price', label: 'Für alle – Artikel: Preisgrenze (Coins)' },
    ],
  },
  {
    title: 'Chat',
    rules: [
      { key: 'chat_per_minute', label: 'Nachrichten pro Minute und Person', hint: 'Gegen Spam' },
      { key: 'timeout_max', label: 'Stummschalten: längste Dauer für Alphamods (Min.)', hint: 'Die Dauer für Mods stellst du unter „Mod-Rechte“ ein' },
    ],
  },
]


/** Hauptbereiche des Zahlen-Tabs: Welche Abschnitte gehören wohin. */
export const CATEGORIES: Array<{ id: string; label: string; titles: Array<string | RegExp> }> = [
  { id: 'learn', label: 'Lernen & Punkte', titles: ['Rangliste & Punkte', 'Tages-Quests', /^Lernen/, 'Multiple Choice (Übung)', 'Mathe', /^Auswendig/] },
  { id: 'rewards', label: 'Belohnungen', titles: [/^Belohnungen/, /^Coins:/] },
  { id: 'games', label: 'Spiele & Parkour', titles: ['Spiele', 'Adventskalender', 'Loot Drop', /^Team-Parkour/, /^Parkour/] },
  { id: 'gambling', label: 'Gambling', titles: [/^Gambling/] },
  { id: 'chat', label: 'Chat', titles: ['Chat'] },
]
export function categoryOf(title: string): string {
  return CATEGORIES.find((c) => c.titles.some((t) => (typeof t === 'string' ? t === title : t.test(title))))?.id ?? 'learn'
}
