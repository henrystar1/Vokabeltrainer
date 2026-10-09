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
    title: 'Gambling',
    text: 'Chancen in Promille (1000 = immer). Erwartung pro Einsatz = Gewinnchance × Faktor + Jackpot × Jackpot-Faktor; unter 1000 ‰ Summe bleibt es ein Verlustgeschäft.',
    rules: [
      { key: 'gambling_win_permille', label: 'Gewinnchance (‰)', hint: 'Drei gleiche Symbole' },
      { key: 'gambling_jackpot_permille', label: 'Jackpot-Chance (‰)', hint: 'Dreimal die 7' },
      { key: 'gambling_mult_win', label: 'Gewinn-Faktor', hint: 'Einsatz × Faktor' },
      { key: 'gambling_mult_jackpot', label: 'Jackpot-Faktor' },
      { key: 'gambling_max_bet', label: 'Höchster Einsatz (Coins)' },
    ],
  },
  {
    title: 'Coins & Belohnungen',
    text: 'Was es für Aktionen an Coins gibt.',
    rules: [
      { key: 'book_price_default', label: 'Standardpreis für neu veröffentlichte Bücher' },
      { key: 'copy_reward', label: 'Coins fürs Abschreiben einer Lektion' },
      { key: 'copy_daily_max', label: 'Abschreib-Belohnungen pro Tag höchstens' },
      { key: 'learn_reward', label: 'Coins pro neu gelernter Vokabel (Online-Bücher)' },
      { key: 'learn_daily_cap', label: 'Lern-Coins pro Tag höchstens' },
      { key: 'review_reward', label: 'Coins für eine sinnvolle Fehlermeldung' },
      { key: 'code_default_amount', label: 'Coins pro Code (Standard)' },
      { key: 'daily_bonus_mod', label: 'Tagesbonus Mods' },
      { key: 'daily_bonus_admin', label: 'Tagesbonus Admin' },
      { key: 'quest_reward_answers', label: 'Quest „Fleißig“: Coins' },
      { key: 'quest_reward_perfect', label: 'Quest „Fehlerfrei“: Coins' },
      { key: 'quest_reward_sprint', label: 'Quest „Sprinter“: Coins' },
      { key: 'quest_reward_duel', label: 'Quest „Herausforderer“: Coins' },
      { key: 'league_reward_1', label: 'Liga: Coins für Platz 1' },
      { key: 'league_reward_2', label: 'Liga: Coins für Platz 2' },
      { key: 'league_reward_3', label: 'Liga: Coins für Platz 3' },
      { key: 'league_min_points', label: 'Liga: Mindestpunkte pro Woche (sonst Abstieg)' },
      { key: 'duel_reward', label: 'Duell-Sieg: Coins' },
      { key: 'sprint_coin_every', label: 'Sprint: 1 Coin je so viele richtige Antworten' },
      { key: 'sprint_coin_cap', label: 'Sprint: Coins pro Tag höchstens' },
      { key: 'pay_max', label: '!pay: Höchstbetrag pro Überweisung (Coins)' },
      { key: 'pay_daily_cap', label: '!pay: Coins pro Tag und Person höchstens' },
      { key: 'duel_daily_cap', label: 'Duell-Siege mit Coins pro Tag' },
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
    title: 'Chat',
    rules: [
      { key: 'chat_per_minute', label: 'Nachrichten pro Minute und Person', hint: 'Gegen Spam' },
      { key: 'timeout_max', label: 'Stummschalten: längste Dauer für Alphamods (Min.)', hint: 'Die Dauer für Mods stellst du unter „Mod-Rechte“ ein' },
    ],
  },
]

