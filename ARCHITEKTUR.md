# Vokabeltrainer – Architektur

## Tech-Stack
- Frontend: React 19 + TypeScript (strict), Vite, Tailwind CSS 3, React Router (BrowserRouter mit `basename`), lucide-react
- Backend: Supabase (Auth, PostgreSQL, Row Level Security, RPC-Funktionen)
- Tests: Vitest (gesamte Lernlogik als reine, testbare Funktionen)
- Hosting: GitHub Pages über GitHub Actions (`.github/workflows/deploy.yml`); `404.html` = Kopie von `index.html` als SPA-Fallback
- Im Frontend nur `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` (öffentlich); niemals ein Secret-/service_role-Key.

## Projektstruktur
```
vokabeltrainer/
├─ ARCHITEKTUR.md
├─ .github/workflows/deploy.yml
├─ supabase/migrations/
│  ├─ 0001_schema.sql      Tabellen, RLS, Trigger, Views, Rangliste/Community-Funktionen
│  └─ 0002_functions.sql   RPC-Funktionen (Eingabe, Suche, Lernen, Statistik, Import/Export)
└─ src/
   ├─ main.tsx, App.tsx (Routen), index.css
   ├─ types/               Domain-Typen (Antworten der RPC-Funktionen)
   ├─ lib/                 supabaseClient, errors (deutsche Fehlertexte), useAsync, navigation
   ├─ services/            dünne Wrapper um Supabase/RPC (books, entry, search, learning, stats, exchange, settings)
   ├─ features/
   │  ├─ auth/             AuthProvider (Session, Anzeigename, Passwort-Reset)
   │  ├─ settings/         SettingsProvider + rules (Richtungen, Anzahl gerade bei 2 Richtungen)
   │  ├─ learning/         algorithm, answer, selection, questions, session (+ Tests)
   │  ├─ entry/            rows (Zeilenmodell der Eingabetabelle)
   │  ├─ books/            exportFormat (Validierung/Vorschau der Import-Datei)
   │  ├─ test/             range (Bereich nach Vokabel/Seite/Unit)
   │  └─ ocr/              nur Typen + Anbieter-Schnittstelle (nicht umgesetzt)
   ├─ components/          layout (Sidebar, MobileNav, AppShell, RequireAuth), ui, charts (SVG), quiz
   └─ pages/               Dashboard, Books, BookDetail, BookEntry, Search, Learn, Test, Stats, Leaderboard, Settings, ImportBook, auth/*
```

## Datenbanktabellen
| Tabelle | Zweck |
|---|---|
| languages | Erweiterbare Sprachliste (`en`, `fr`); neue Sprache = neue Zeile |
| profiles | 1:1 zu auth.users; eindeutiger Anzeigename (Trigger bei Registrierung) |
| user_settings | Lernrichtungen, Abfragen pro Runde (1–200), Groß-/Kleinschreibung, Lernsprache |
| books | Name, Sprache, Beschreibung, owner_id |
| units | Buch, Nummer, Name |
| pages | Buch, Seitenzahl, **unit_id** (Unit kann über mehrere Seiten gehen; eine Seite gehört zu genau einer Unit) |
| vocabulary | Deutsche Grundform je Buch (`german_key` normalisiert → Duplikate werden zusammengeführt) |
| vocabulary_placements | Vokabel → Seite + Position (dieselbe Vokabel kann auf mehreren Seiten stehen) |
| translations | Mehrere richtige Übersetzungen je Vokabel |
| user_vocabulary_progress | user + vocabulary + learning_level (1–5 in 0,5er-Schritten, CHECK) |
| learning_sessions / learning_answers | Runden und Einzelantworten (`is_repeat` = Wiederholungsrunde) |
| daily_stats | Tageswerte je Nutzer (Trigger-gepflegt; Basis für Statistik, Rangliste, Durchschnitte) |

## RPC-Funktionen (0002)
Alle laufen als *security invoker* – die RLS-Regeln bleiben aktiv. Große Ergebnisse kommen als `jsonb`, damit das PostgREST-Zeilenlimit nicht greift.
`save_vocab_entry` (Anlegen/Ändern/Zusammenführen), `delete_vocab_entry`, `move_page_to_unit`, `delete_page`, `delete_unit`, `get_book_summaries`, `get_book_outline`, `get_book_entries`, `get_page_entries`, `get_learning_pool`, `search_vocabulary`, `submit_session` (atomar: Sitzung + Antworten + Lernstände), `add_repeat_answers`, `get_my_stats`, `export_book`, `import_book`.
Rangliste und Community-Durchschnitt: `get_leaderboard`, `get_community_averages` (*security definer*, nur Anzeigename/Punkte bzw. aggregierte Werte, Durchschnitt erst ab 3 Lernenden).

## Sicherheit (RLS)
- Alle Tabellen mit RLS. Bücher/Units/Seiten/Vokabeln/Übersetzungen nur für den Besitzer.
- Fortschritt, Sessions, Antworten, Statistik: nur `user_id = auth.uid()`.
- Fremde Daten sind nur über die beiden aggregierenden Funktionen sichtbar.
- Export enthält ausschließlich Buchinhalte – keinen Fortschritt, keine Konten.

## Lernlogik
- Start Stufe 1, Bereich 1–5 in 0,5er-Schritten. Paarbewertung: beide richtig +1 · eine richtig +0,5 · beide falsch −1 (min. 1, max. 5).
- Nur eine aktive Richtung: richtig zählt wie „beide richtig“, falsch wie „beide falsch“.
- Auswahl gewichtet (Gewicht 2^(5−Stufe)), Stufe 5 ist nie fällig; gezogen ohne Zurücklegen (Efraimidis–Spirakis).
- Einstellung „Abfragen pro Runde“ (1–200); bei zwei Richtungen ist die Zahl gerade (N/2 Vokabeln, beide Richtungen, mit Mindestabstand).
- Rückrichtung: eine zufällige Übersetzung wird gezeigt; alle deutschen Wörter mit dieser Übersetzung gelten als richtig. Falsche Antworten zeigen alle akzeptierten Lösungen.
- Antwortvergleich: Unicode-Normalisierung, typografische Anführungszeichen, Leerzeichen, optional Groß-/Kleinschreibung – keine Tippfehlerkorrektur.
- „Fehler wiederholen“ ändert den Lernstand nicht (Antworten mit `is_repeat = true`, zählen nicht für Statistik).
- Test: Bereich nach Vokabelnummer/Seite/Unit, Reihenfolge wie im Buch, erst alle Vorwärts-, dann alle Rückwärtsfragen; Lernstand nur bei ausdrücklicher Option.

## Definitionen
- „Gelernt“ = Stufe ≥ 2 · Fortschritt % = Mittel von (Stufe−1)/4 · „Zu wiederholen“ = Stufe 1 mit bereits gemachten Fehlern.
- Rangliste: Punkte je Tag = 2 × richtige Antworten (max. 200) + 25 Aktivitätsbonus + bis 20 Genauigkeitsbonus (ab 20 Antworten). Tage nach Europe/Berlin.

## Austauschformat (Import/Export, Version 1)
```json
{ "format": "vokabeltrainer-book", "version": 1,
  "book": { "name": "…", "language": "en", "description": null },
  "units": [ { "number": 1, "name": null,
    "pages": [ { "number": 10, "vocabulary": [ { "german": "Haus", "translations": ["house"] } ] } ] } ] }
```
Der Import zeigt zuerst eine Vorschau (Zählwerte, Beispiele, Fehler) und legt ein neues Buch an; dieselben Regeln prüft die Datenbank erneut.

## OCR (vorbereitet, nicht umgesetzt)
`src/features/ocr`: `OcrProvider`-Schnittstelle (Bild → erkannte Zeilen mit optionaler Sicherheit) und ein Platzhalter-Anbieter. Geplanter Ablauf: Foto → Erkennung → Prüfansicht → Speichern über `save_vocab_entry`. Es gibt keine Oberfläche dafür.

## Phasenplan
1 Gerüst + UI · 2 Supabase/Auth · 3 Bücher/Units/Seiten · 4 Vokabeleingabe · 5 Suche · 6 Lernmodus · 7 Algorithmus · 8 Test · 9 Statistik · 10 Rangliste · 11 Import/Export · 12 OCR-Vorbereitung – alle bis auf die OCR-Umsetzung selbst sind implementiert.

## Erweiterung: Französisch zuerst, mehrere Lösungen, Foto-Einlesung

- **Migration `0003_german_alts.sql`** (nach 0002 ausführen): `vocabulary.german_alts text[]`. Deutsch hat damit ein Hauptwort plus beliebig viele Alternativen; Fremdsprache hatte schon mehrere Übersetzungen. Eindeutigkeit bleibt über das deutsche Hauptwort.
- **Reihenfolge**: Eingabetabelle Fremdsprache links, Deutsch rechts. Abfrage: zuerst Fremdsprache → Deutsch, danach Deutsch → Fremdsprache. Jede Lösung beider Seiten wird akzeptiert.
- **Akzent-Leiste** (`components/ui/AccentBar.tsx`): é è ç à … für Französisch-Bücher, in Eingabe, Foto-Prüfung und Abfrage (Deutsch → Französisch).
- **Foto-Einlesung** (`features/ocr`, `components/ocr/ScanModal.tsx`): läuft komplett im Browser mit tesseract.js (kostenlos, kein API-Schlüssel). Sprachdaten liegen in `public/tessdata`. Bild wird nur im Speicher verarbeitet, nie hochgeladen. Ablauf: Beleuchtung glätten → OCR → Spalten/Zeilen (`layout.ts`) → Unité/Seite erkennen, blaue Kästen und Beispielsätze auslassen → Prüfansicht → Speichern.

## Erweiterung: Rollen, öffentliche Bücher, Prüfanfragen (Migration 0004)

**Rollen** (`profiles.role`): `user`, `mod`, `admin`. Admin wird nur per SQL gesetzt (Supabase SQL Editor):

```sql
update public.profiles set role = 'admin'
 where id = (select id from auth.users where email = 'deine@mail.de');
```

Rolle und Sperre lassen sich vom Client nicht ändern (Spaltenrechte + Trigger). Admins ernennen Mods in *Verwaltung → Benutzer*.

| | Nutzer | Mod | Admin |
|---|---|---|---|
| Eigene Bücher anlegen/bearbeiten | ✓ | ✓ | ✓ |
| Online-Bücher lesen, verwenden, lernen | ✓ | ✓ | ✓ |
| Vokabeln melden („Prüfung anfordern“) | ✓ | ✓ | ✓ |
| Eigene Bücher veröffentlichen | – | ✓ | ✓ |
| Vokabeln öffentlicher Bücher ändern, Prüfanfragen bearbeiten | – | ✓ | ✓ |
| Öffentliches Buch zurücknehmen | – | nur eigene | alle |
| Öffentliches Buch löschen, Nutzer sperren/zurücksetzen/löschen, Speicher einsehen, Mods ernennen | – | – | ✓ |

**Öffentliche Bücher**: `books.is_public`. Gelesen werden dürfen eigene und öffentliche Bücher (`can_read_book`), geändert werden dürfen eigene private Bücher oder – bei öffentlichen – nur Mods/Admins (`can_edit_book`; `owns_book` zeigt darauf, damit alle bisherigen Funktionen mitziehen). „Verwenden“ legt einen Eintrag in `book_library` an; Lernpool, Suche, Statistik und „Meine Bücher“ beziehen sich auf die Bibliothek (eigene Bücher + verwendete Online-Bücher). Der Lernfortschritt bleibt pro Nutzer (`user_vocabulary_progress`).

**Prüfanfragen**: `review_requests` (Momentaufnahme der Vokabel + Nachricht, Status offen/erledigt/abgelehnt). Gestellt über `request_review`, gelesen/bearbeitet nur von Mods/Admins (`list_review_requests`, `resolve_review_request`). Eine offene Anfrage je Nutzer und Vokabel, höchstens 50 offene je Nutzer.

**Sperren**: `profiles.blocked` + `auth.users.banned_until`. Eine restriktive RLS-Policy (`blocked_guard`) sperrt gesperrte Nutzer sofort bei allen Tabellen aus; die App zeigt „Konto gesperrt“.

**Speicheranzeige** (`admin_list_users`): Schätzung aus Textlängen + Zeilenaufwand; Inhalte fremder Nutzer sind nicht einsehbar.

**Buchsprache** ändern: Bearbeiten-Dialog im Buch (Spalte `books.language`).

**Foto-Einlesung für Englisch**: `public/tessdata/eng.traineddata`; `createTesseractEngine(language)` lädt Fremdsprache + Deutsch. Der Layout-Parser ist am französischen Buch geeicht, für englische Bücher noch ungetestet.

## Erweiterung: Koins, Shop, Themes, Feedback, Aktivierung (Migration 0005)

**Einspielen:** `supabase/migrations/0005_koins_shop.sql` nach 0001–0004 im Supabase-SQL-Editor ausführen (wiederholbar).

### Koin-Wirtschaft
- Alle Zahlen stehen in `app_settings` und sind im Admin-Tab „Koins & Shop“ änderbar (Standardpreis Buch 200, Lernen 1 Koin je neu gelernter Vokabel aus einem **Online-Buch**, höchstens 30 pro Tag, Fehlermeldung 10, Code 500, Tagesbonus Mod 1 / Admin 10).
- Koins bewegen sich nur über `_grant_koins` (Wallet + Ledger in einer Transaktion, Guthaben nie negativ). Die Tabellen sind für Clients nur lesbar (RLS: nur eigene Zeilen).
- Quellen: Codes (`admin_create_codes` → `redeem_code`, Code wird beim Einlösen gelöscht, Rate-Limit 5 Fehlversuche / 10 Min.), Lernen (Trigger auf `user_vocabulary_progress`, nur einmal pro Vokabel und nur Online-Bücher → kein Farmen durch Wiederholen oder eigene Bücher), bestätigte Prüfanfragen (`resolve_review_request`, Häkchen „Belohnen“), Feedback (bis 50), Tagesbonus (`claim_daily_bonus`, beim Laden der App für Mods/Admins), Admin-Geschenke.
- Ausgaben: Online-Bücher (`add_to_library` = Kauf, einmalig; Staff/Besitzer/Preis 0 kostenlos), Shop-Artikel (`buy_item`).

### Aktive Vokabeln
- `user_active_vocab`: pro Nutzer, welche Vokabeln lernbar sind. Eigene Bücher: automatisch (Trigger). Online-Bücher: nur über `set_vocab_active` (ganzes Buch, Unit oder Seite) → neue Vokabeln eines Online-Buchs erscheinen erst nach Aktivierung. Lernpool und Statistik filtern auf aktive Vokabeln. Der Test über einen Seiten-/Unit-Bereich nutzt weiterhin alle Einträge im gewählten Bereich.

### Shop und Designs
- DB kennt nur `shop_items` (ID, Art, Name, Preis, aktiv) und `user_items`; gewählte Artikel stehen in `profiles.avatar_id/color_id/effect_id/theme_id` (nur über `equip_item`/`unequip_item` setzbar, nur gekaufte).
- Das Aussehen steht im Client-Katalog `src/features/shop/catalog.ts` (Schlüssel = Artikel-ID); `catalog.test.ts` prüft, dass jeder Artikel der Migration im Katalog vorkommt.
- Designs: Tailwind-Farben `space-*` und `accent-*` sind CSS-Variablen (`--s950…--s600`, `--c-cyan/violet/blue`, Triplets). `ThemeApplier` setzt sie aus `profile.theme_id`; `StarField` zeigt die passende Dekoration (Sterne, Blasen, Blüten, Konfetti, Glühwürmchen, Code-Regen, Funken). Effekte für Namen sind CSS-Klassen `fx-*` in `index.css`.
- `PlayerTag`/`Avatar`/`StyledName` zeigen Profilbild, Namensfarbe und Effekt in Rangliste, Seitenleiste und Profil. `get_leaderboard` liefert die Kosmetik-IDs mit.

### Oberfläche
- Neue Seiten: `/shop`, `/profil` (Guthaben, Code einlösen, Verlauf), `/feedback`. Admin-Tabs: Feedback (Mods+Admin), Koins & Shop (nur Admin: Codes, Geschenke, Zahlen, Shop-Preise).
- Lern-/Testrunde: `QuizRunner` schaltet über `useFocusMode` Seitenleiste und Navigation aus; Abbruch nur über das „X“ (mit Rückfrage), `beforeunload` schützt vor versehentlichem Schließen/Neuladen. Abgebrochene Runden werden nicht gewertet.

## Erweiterung: Online-Anzeige, Nachrichten, Tags, animierte Profilbilder (Migration 0006)

**Einspielen:** `supabase/migrations/0006_presence_messages_tags.sql` nach 0001–0005 im SQL-Editor ausführen (wiederholbar).

- **Online-Anzeige:** `profiles.last_seen_at`; `PresenceProvider` ruft jede Minute `heartbeat()` auf (nur bei sichtbarem Tab). `admin_list_online()` (nur Admin) liefert, wer in den letzten 3 Minuten aktiv war → Admin-Tab „Online & Nachrichten“.
- **Nachrichten:** `user_messages` (nur eigene lesbar), `admin_send_message(p_user | null = alle)`, `get_unread_messages`, `mark_messages_read`. Der Client zeigt ungelesene Nachrichten als Fenster, bis sie bestätigt werden. Gesperrte Nutzer bekommen keine Rundnachricht.
- **Tags:** `shop_items.kind = 'tag'` (Unterstützer … Koin-König, 1.500–50.000 Koins), `profiles.tag_id`. Mod/Admin-Tag wird automatisch aus der Rolle angezeigt (`ROLE_TAGS`). Die Rangliste liefert `role`, `tag_id`, `theme_id`; ein farbiger Rahmen um den Namen nutzt die Hauptfarbe des gewählten Designs (`themeFrameColor`).
- **Staff-Effekte:** `shop_items.required_role` (`mod`/`admin`), Preis 0, nicht kaufbar; `get_shop` zeigt sie nur berechtigten Rollen, `equip_item` prüft die Rolle, ein Trigger entfernt den Effekt bei Degradierung.
- **Animierte Profilbilder:** reine CSS-Animationen (`features/shop/avatars.css`, `AnimatedAvatar.tsx`): Plasma, Inferno, Frostkern, Sturm, Galaxie, Portal, Supernova, Schwarzes Loch (10.000 Koins). Neue Bilder = neue ID in der Migration + Eintrag in `ANIMATED_AVATARS` + CSS; `catalog.test.ts` prüft, dass jede Artikel-ID der Migrationen im Katalog vorkommt.
- **Live-Koins:** `koin_wallets` ist (falls vorhanden) in der Publication `supabase_realtime`; `WalletProvider` hört per Realtime auf das eigene Guthaben, pollt zusätzlich alle 45 s und beim Zurückkehren zum Tab und zeigt bei einem Plus „+N Koins“.
- **Aktivieren:** `activate_next_page` (nächste Seite mit inaktiven Vokabeln), `activate_up_to` (alles bis Unit/Seite). `ActivationPanel` im Buch (Fortschrittsbalken, „Nächste Seite“, „Bis hierhin“, Seiten farbig nach Zustand) und Schnellbutton auf der Lernen-Seite.

## Migration 0007 – Liga, Quests, Sprint, Fehler-Training, Duelle

Nach 0006 im Supabase-SQL-Editor ausführen (wiederholbar).

- **Fehler-Training**: `get_mistake_pool(book)` liefert Vokabeln, die in den letzten 30 Tagen falsch waren (Stufe < 5, meiste Fehler zuerst). Client: Umschalter auf der Lernen-Seite, `buildMistakeQuestions`.
- **Sprint** (`/sprint`): 60 s, `QuizRunner` mit `timeLimitSeconds`. `submit_sprint` speichert das Wochenbestergebnis (max. 30/Tag), `get_sprint_board` die Bestenliste.
- **Quests & Streak** (`/quests`): `get_quests`, `claim_quest` (Koins, Grund `quest`, einmal pro Tag und Quest), `get_streak`. Belohnungen in `app_settings` (`quest_reward_*`).
- **Wochenliga** (Tab „Liga“ in der Rangliste): 5 Stufen (Bronze–Diamant), eine Gruppe je Stufe. `_league_rollover()` läuft lazy beim ersten Aufruf nach Wochenwechsel (Advisory Lock): Top 3 steigen auf, Inaktive bzw. die letzten 3 (ab 8 Teilnehmern) steigen ab, Koins für Top 3 (`league_reward_*`), Nachricht an jeden.
- **Duelle / Zusammenlernen** (`/duell`): `search_players`, `create_duel` (beide brauchen ≥ 5 gemeinsame aktive Online-Vokabeln), `list_duels`, `get_duel`, `submit_duel` (Gewinner: mehr richtig, sonst schneller; Koins `duel_reward`, begrenzt durch `duel_daily_cap`), `cancel_duel`. Asynchron, nicht live. Der Client meldet sein Ergebnis selbst – Manipulation ist nicht ausgeschlossen.
- **iOS-Icon**: `apple-touch-icon.png`, `icon-192/512.png`, `manifest.webmanifest`, Links in `index.html` mit `%BASE_URL%`.

## Migration 0008 – Gesamt-Chat

`chat_messages` ohne direkten Tabellenzugriff; `get_chat(limit)`, `post_chat(body)` (1–500 Zeichen, mind. 1 s Abstand, max. 20/Minute, keine identische Nachricht innerhalb 30 s), `delete_chat_message(id)` nur Mods/Admins; Gesperrte können weder lesen noch schreiben. Client: Seite `/chat`, Polling alle 4 s nur bei sichtbarem Tab (kein Realtime nötig).

## Migration 0009 – Coins verschicken, Regeln, Schwarzes-Loch-Set

- **!pay** (im Chat): `post_chat` erkennt `!pay @Anzeigename 100` (Groß-/Kleinschreibung egal, @ optional). Prüft Empfänger (nicht gesperrt, nicht man selbst), Betrag (1 bis `pay_max`), Tageslimit `pay_daily_cap` und Guthaben; bucht über `_grant_koins` (`pay_out`/`pay_in`), schreibt eine Chat-Zeile der Art `pay` und eine Nachricht an den Empfänger.
- **Einstellbare Regeln**: `app_settings.mod_editable`; `staff_set_setting` (Mods nur für markierte Zahlen, Admins für alle). Die Ranglistenpunkte kommen aus `_day_points()` mit `points_per_answer`, `points_daily_cap`, `points_active_day`, `points_accuracy_bonus`, `points_accuracy_min`; `get_leaderboard` und `_week_points` (Liga) nutzen sie. Admin-Seite: Tab „Regeln“.
- **Coins statt Koins**: nur der sichtbare Text (UI, Migrationstexte); Tabellen/Funktionen heißen weiter `koin_*`. Symbol: 💵 (`CoinIcon`).
- **Shop**: Avatare Lavalampe, Matrix, Aurora, Sonnenfinsternis; Namensfarbe „Ereignishorizont“ und Effekt „Wirbel“ (`fx-vortex`) passend zum Schwarzen Loch. Das Schwarze Loch ist neu animiert (12 s: Lichtstreifen am Rand → Wirbelarme → Loch mit Akkretionsscheibe → Zusammenfall), reine CSS/SVG-Animation.
- **Sprint**: Buchauswahl; ohne Auswahl zählen alle aktiven Vokabeln aller Sprachen (vorher nur die Lernsprache).

## Migration 0010 – Sprint-Coins, Bot-Spiele, Klavier

- **Sprint**: `submit_sprint` liefert jetzt `{best, earned}` und zahlt 1 Coin je `sprint_coin_every` richtige Antworten, höchstens `sprint_coin_cap` pro Tag (Grund `sprint`).
- **Bot-Spiele** (`/spiele`: Snake, Tetris, Block Blast): `start_game` bucht den Eintritt (`game_fee`) und würfelt das Ziel des Bots (25–100 % von `bot_snake`/`bot_tetris`/`bot_blast`, von Mods einstellbar). `finish_game` wertet: Punkte werden auf das zeitlich Mögliche gekappt (Snake 2/s, Tetris 50/s, Blast 60/s), Sieg nur bei mehr Punkten als der Bot, Gewinn `game_reward`, begrenzt durch `game_daily_cap`. Der Client meldet die Punkte selbst – der Schutz ist eine Obergrenze, kein Beweis. Logik rein in `src/features/games/*.ts` (getestet), Oberflächen als Komponenten.
- **Chat**: „schreibt …“ und sofortiges Nachladen laufen über Supabase Broadcast (Kanal `vokabeltrainer-chat`), ohne Datenbank; Polling alle 4 s bleibt als Rückfall.
- **Optik**: Schwarzes Loch (16 s: zwei gegenläufige Randstreifen, Wirbel, Loch mit geradem Ring und Lichtbögen, lange Haltephase), Klavier-Profilbild (`avatar_piano`), Namens-Effekte „Wirbel“ (eigenes Glühelement, wird nicht abgeschnitten) und „Klaviertasten“ (`effect_piano`, Buchstaben als Tasten).

## 0011 – Alphamod, Gambling, Highscores, Chat-Erweiterungen

- **Rollen:** neue Rolle `alphamod` (Rang 2, goldener „MOD“-Tag). Nur Alphamods und Admins ändern Werte (`staff_set_setting`, Tab „Regeln“); normale Mods verwalten nur Bücher/Prüfanfragen. Ernennung per `admin_set_role`.
- **Ranglistenpunkte ±:** Tabelle `points_adjustments`, `admin_adjust_points`; fließen in `get_leaderboard` und `_week_points` (Liga) ein.
- **Chat:** `!whisper @Name Text` (Spalte `recipient_id`, serverseitig gefiltert), roter Punkt über `chat_reads`/`chat_unread_count` (`ChatProvider`), endgültiges Löschen (eigene, erhaltene Flüsternachrichten, DMs über `delete_my_messages`), Stummschalten `staff_timeout_message` (Mods 1 Min., Alphamod/Admin bis `timeout_max`). Chat-Performance: Gruppierung, `content-visibility`, ältere Beiträge mit pausierten Animationen.
- **Gambling:** `gambling_play`, Chancen/Faktoren/Höchsteinsatz als Einstellungen.
- **Spiele:** kein Bot mehr; Highscores aller Nutzer (`get_game_board`), +`game_record_reward` Coins für neuen Rekord. Neu: Crossy Road, Flappy Bird. Touch-Steuerung auf allen Geräten.
- **Lernen:** Quest-Ziele (`quest_goal_*`) und Wartezeiten (`learn_gap_l1..l4`, Minuten; `get_learning_pool` liefert `last_at`) einstellbar; Multiple Choice, Konjugieren (FR) und le/la-Quiz über `submit_choice` (`daily_stats.choice_correct`, eigene Punkte-/Coin-Grenzen).
- **Shop:** gekaufte, aber entfernte Artikel bleiben sichtbar/auswählbar (`get_shop.active`). Neue Artikel: Radfahrer, Frosch (Avatar + Namen-Effekt).
- **UI:** Modal per Portal (Bestätigungen erscheinen im Sichtfeld), gruppiertes Menü, Einstellungen mit Reitern + Passwort ändern.

## 0012 – Mod-Rechte, Artikel schenken, Tags ausblendbar

- **Mod-Rechte** (nur Admin stellt sie ein, Tab „Mod-Rechte“): Einstellungen `mod_books_all` (alle Online-Bücher ja/nein), `mod_set_all` (alle Zahlen), `mod_shop_prices`, `mod_timeout_max` (Minuten, mind. 1) sowie Tabelle `mod_book_access` (ausgewählte Bücher) und `app_settings.mod_editable` (ausgewählte Zahlen). Alphamods und Admins dürfen immer alles.
- Server: `_staff_can(perm)`, `get_my_permissions()`, neu definiert `can_edit_book`, `staff_set_setting` (Schlüssel `mod_*` nur Admin), `admin_set_item` (Mods nur mit Recht), `staff_timeout_message` (Mods höchstens `mod_timeout_max`); neu `admin_list_public_books`, `admin_set_mod_book`, `admin_set_mod_editable`.
- **Artikel schenken**: `admin_grant_item(user, item, equip)` – kostenlos, optional gleich angezogen, Nachricht an den Nutzer.
- **Tags ausblenden**: `profiles.tags_hidden`, `set_tags_hidden()`. Die Ausgabefunktionen (`get_leaderboard`, `get_chat`, `get_game_board`, `get_sprint_board`, `get_league`, `search_players`, `list_duels`) werden in der Migration per `pg_get_functiondef` umgeschrieben: `role`/`tag_id` werden bei `tags_hidden` zu `user`/`null`.
- Verwaltung: zweistufige Navigation (Moderation · Nutzer · Regeln & Wirtschaft); alle Zahlen stehen in `pages/admin/ruleDefs.ts` (Zahlen-Tab und Mod-Rechte nutzen dieselbe Liste).
- Client: le/la-Quiz nutzt nur Wörter aus den eigenen Französisch-Büchern (`features/french/gender.ts`), Chat-@-Vorschläge, Block Blast mit Portal und einrastendem Teil, Flappy Bird per Tipp auf den ganzen Bildschirm, „Crossy Road“, Melden aus der Suche (`components/books/ReportModal.tsx`), Wartezeit je Lernstufe in der Statistik.

## 0013 – Rechte je Mod/Alphamod

- Tabellen `staff_rights` (Modus für Bücher/Zahlen: `none`/`selected`/`all`, `shop`, `timeout_max`; `null` = Standard aus 0012), `staff_book_access`, `staff_setting_access`.
- `can_edit_book`, `staff_set_setting`, `admin_set_item`, `staff_timeout_message` und `get_my_permissions` prüfen zuerst die eigene Einstellung der Person, sonst den Standard. Ein Alphamod hat nur noch den Tag; Admins dürfen immer alles. Stummschaltung aufheben dürfen alle Mods.
- Admin-Funktionen: `admin_list_staff`, `admin_get_staff_rights`, `admin_set_staff_rights`, `admin_set_staff_book`, `admin_set_staff_setting`, `admin_reset_staff_rights`. UI: Tab „Einzelne Mods“ (`pages/admin/StaffRightsTab.tsx`), der Standard liegt unter „Standard-Rechte“.

## 0014 – Shop-Editor, Schwarzes Brett, Wer ist da, Coin-Rangliste

- **Eigene Shop-Artikel**: `shop_items.custom/style/svg`. Anlegen/Ändern `admin_save_item`, Löschen `admin_delete_item` (nur eigene), alle Nutzer laden sie mit `get_custom_items()` (Store `features/shop/custom.ts`, `useCustomVersion()`). Profilbild = SVG (als `<img>`, serverseitig und im Editor geprüft: keine Skripte, Ereignisse, Links, fremden Bilder, ≤ 30 000 Zeichen; `_svg_is_safe`). Farben, Effekte, Tags, Designs sind strukturierte Angaben (`style` jsonb), nur gültige Hex-Werte kommen ins CSS (`safeHex`). Designs: Hintergrund + 3 Akzente → Palette (`customTheme`), Knopf-Effekt `fx` = `shine`/`rainbow` über `html[data-fx]` und die Klasse `btn-fx`.
- **KI-Prompt** für Profilbilder liegt in `components/shop/ItemEditor.tsx` (`AI_PROMPT`).
- **Artikel entziehen**: `admin_list_user_items`, `admin_revoke_item` (legt auch ab). Das Profil wird beim Zurückkehren zur Seite und alle 60 s neu geladen, damit Geschenke sofort sichtbar sind.
- Neue eingebaute Designs (Lava, Eis, Cyber, Königlich, Minze, Vaporwave, Glanz und Regenbogen je 100 000 Coins) und kurze Tags (GG, HOT, VIP, OG, ★, PRO, MVP, ELITE).
- **Gambling**: `gambling_feed` + `get_gambling_feed()` (Gewinne und Jackpots, 7 Tage); im Admin-Tab „Zahlen“ steht der Rückfluss je 1000 Coins live (`GamblingValue` in `RulesTab.tsx`).
- **Schwarzes Brett**: `board_posts`, `get_board`, `admin_save_board_post`, `admin_delete_board_post`, Seite `/brett`.
- **Wer ist da?**: `get_presence()` (online = letzte 3 Min.), `profiles.hide_presence` + `set_hide_presence`, Seite `/online`.
- **Coin-Rangliste**: `get_coin_leaderboard()`, `get_my_coin_rank()`, Reiter „Coins“ in der Rangliste.

## 0015 – Sperren, Gambling-Bilanz, höhere Limits

- `feature_locks` (Schlüssel games, gambling, sprint, duels, chat, shop, quests): `off_until` plus Regeln `[{days:[1..7], from, to}]` (Berliner Zeit, from=to = ganzer Tag, from>to über Mitternacht). `_feature_locked_raw/_feature_locked` (Admins nie gesperrt), `_feature_guard(key)` wird per Funktions-Umschreibung in `start_game`, `create_duel`, `submit_sprint`, `post_chat`, `buy_item`, `claim_quest` eingehängt (und direkt in `gambling_play`). `get_locked_features()` für alle, `admin_get_feature_locks`, `admin_set_feature_lock`.
- Client: `features/locks/LocksProvider` (Abfrage jede Minute), Menüeinträge mit `lock`-Feld verschwinden (`navGroupsFor(isStaff, locked)`), `Gate` in `App.tsx` für direkte Aufrufe, Admin-Tab „Sperren“ (`pages/admin/LocksTab.tsx`).
- `gambling_stats` (Spiele, gesetzt, gewonnen, bester Gewinn; aus dem Ledger vorbefüllt), `gambling_feed` enthält jetzt auch Verluste (3 Tage), `get_gambling_board()`; Seiten: Rangliste → „Gambling“, Gambling-Seite (Bilanz Top 10, Verluste grau).
- Limits: Shop-Preise ≤ 1 Mrd., `admin_grant_koins` ≤ 1 Mrd. pro Buchung (Guthaben max. 2 Mrd.).
- `components/admin/ManageUser.tsx` („Verwalten“-Schraubenschlüssel in Coin-/Gambling-Rangliste und Wer-ist-da): Coins ±, Artikel schenken/entziehen, Punkte ±. Preis ändern direkt auf den Shop-Karten (Admin / Mods mit Shop-Recht).
- Schnell-Tag im `ItemEditor` (Text + Farbe → Verlauf und Schriftfarbe automatisch). Chat: `!`-Befehlsvorschläge (Tab/Tippen).
- `PresenceProvider`: Nachrichten alle 7 s abgeholt, Anzeige zurückgestellt auf Sprint/Spiele/Gambling/Duell/Lernseiten.
- Testversion: siehe `TESTVERSION.md`.

## 0016 – Konten anlegen, Abschreiben, Panik-Modus, neue Artikel

- `admin_create_user`, `admin_create_users` (bis 60 Zeilen), `admin_set_password`: schreiben direkt in `auth.users`/`auth.identities` (bestätigt, Kennwort per `extensions.crypt`), Profil entsteht über den bestehenden Trigger. Nur gegen PGlite-Attrappen getestet – in echtem Supabase zuerst in der Testversion ausprobieren. UI: Verwaltung → Nutzer → „Konten anlegen“, Kennwort setzen im „Verwalten“-Fenster (`ManageUser`).
- `claim_copy_reward(book, unit, count)`: `copy_rewards`, Einstellungen `copy_reward` (5) und `copy_daily_max` (5); je Buch/Unit und Tag einmal, mindestens 5 Wörter. Seite `/abschreiben` (`pages/Copy.tsx`): „Alles sichtbar“ oder „Erst Deutsch, dann aufdecken“ (Gekonnt/Nochmal), mischen, umgekehrt.
- Panik-Modus (`features/panic`): nur lokal (`localStorage vt_panic`), roter Knopf/Esc auf `/spiele` und `/gambling`; blendet Spiele, Gambling, Chat, Shop aus (Menü über `LocksProvider`, Seiten leiten per `Gate` auf `/` um); Rückgängig in den Einstellungen.
- Neue Artikel: `effect_zocker` („Reicher Zocker“, Dollar-Regen, `.fx-zocker`; Vorlage `dollar` auch im Editor) und `theme_chroma` („Farbwechsel“, `fx: 'hue'`, Palette wandert per `ThemeApplier` durch den Farbkreis).

## 0017 – Riesige Guthaben, Admin-!pay, Wave

- `koin_wallets.balance` und `koin_ledger.amount` sind `bigint`; `_grant_koins(uuid, bigint, …)` liefert bigint, Obergrenze 9 · 10¹⁵. Funktionen mit Guthaben-Rückgabe (`get_wallet`, `buy_item`, `claim_quest`, `redeem_code`, `gambling_play`, `start_game`, `finish_game`, `get_coin_leaderboard`, `admin_list_users`) werden per Umschreiben (pg_get_functiondef + replace) auf bigint gebracht. Shop-Preise bleiben `integer` (≤ 1 Mrd.).
- `admin_grant_koins(uuid, bigint, text)`: bis 1 Billiarde je Buchung (auch Minus). `_parse_coins` (k, m/mio, mrd, b/bio = 10¹², nur für Admins), `_fmt_coins` (Punkte-Schreibweise). `post_chat`: Admin-`!pay` erzeugt die Coins neu (kein Abzug, keine Tages-/Höchstgrenze, höchstens 1 Billiarde); normale Nutzer unverändert (nur Ziffern, `pay_max`/`pay_daily_cap`).
- Client: `lib/coins.ts` (`parseCoins`, `shortCoins`, `MAX_GRANT`), Kurzanzeige im `KoinBadge` ab 1 Mrd., Eingabefelder in „Verwalten“ und „Coins schenken“ verstehen k/m/mrd/b.
- Spiel „Wave“ (`features/games/wave.ts`, `WaveGame.tsx`): Spitze fliegt im 45°-Winkel, Halten = hoch, Loslassen = runter; Stacheln (Dreiecke) von Decke und Boden, Öffnung wird enger, Tempo steigt; Punkte = passierte Stachel-Paare. Server: `game_runs`-Check, `start_game`/`get_game_board`/`finish_game` (Rate 2/s) kennen `wave`.

## 0018 – 3D-Druck-Shop
- Tabellen `print_settings` (alle Preiswerte, vom Admin änderbar), `print_colors`, `print_products`, `print_bans`, `print_orders`. Alle nur über RPC erreichbar (RLS an, keine Grants).
- Preis wird nur serverseitig berechnet (`_print_calc`): STL-Volumen × Filament + Strom + Maschine + Grundgebühr + Marge, Mindestpreis, Beschleunigt-Aufschlag, einmaliger Coin-Rabatt je Bestellung (`discount_coins` → `discount_percent`).
- Status: angefragt → preis_vorgeschlagen → in_bearbeitung → druckt → lieferbereit → geliefert (plus abgelehnt/storniert). Fortschritt wird aus Druckminuten und Serverzeit berechnet (`orderProgress`, 10–90 % beim Druck). Erweiterungspunkt für Klipper/Timelapse: `progress_override`.
- Storage-Bucket `print-files` (privat) mit Policies; Dateien nur Besitzer/Admin.
- Spam-Schutz: Sperren, max. offene Anfragen, Bestellungen pro Tag, max. Menge/Volumen.
- Verdienst-Ziel („Pro-Abo“) zählt Umsatz übergebener Bestellungen, bleibt beim Löschen erhalten (`goal_offset_eur`).
- Client: `/druckshop` (lazy, three.js in eigenem Chunk), Admin-Gruppe „3D-Druck“.

## 0019 – Brett für Mods, Fehler-Wiederholung, Lern-Coins
- Schwarzes Brett: `is_staff()` statt Admin.
- `user_settings.repeat_until_correct`: Learn.tsx wiederholt falsche Fragen in Runden, bis alle stimmen; Lernstand bleibt unverändert, Wiederholungsantworten werden nur einmal gespeichert.
- Trigger `award_answer_koins`: 1 Coin je `learn_coin_every` richtige Antworten (nur Lernen, Online-Bücher, keine Wiederholung), Tageslimit `learn_coin_cap`.

## 0020 – Kleine Hinweise (Benachrichtigungen)
- `user_settings`: `notify_mentions` (an), `notify_chat` (aus), `notify_print` (an), `notify_online` (`off|staff|all`, Standard aus).
- `notify_poll(chat_after, since)` liefert neue Ereignisse als JSON: Chat-Nachrichten (nach Einstellung gefiltert: @-Erwähnung oder Flüstern an mich, bzw. alle), fertige Druckaufträge (`print_orders.ready_at`, per Trigger gesetzt) und wer online kommt (`profiles.online_since`, von `heartbeat` gesetzt; `hide_presence` wird respektiert). Ohne `chat_after` nur Startwerte, damit beim Öffnen kein Nachrichten-Schwall kommt.
- `_print_notify` unterdrückt die „Fertig“-Meldung als großes Fenster, wenn der kleine Hinweis aktiv ist.
- Client: `NotifyProvider` (in `AppShell`) fragt alle 8 s ab und zeigt Hinweise oben rechts (ohne Fokus, auch beim Lernen/Spielen); im Chat selbst keine Hinweise für normale Nachrichten. `lib/mentions.ts` markiert `@Name`-Nachrichten im Chat gelb (gleiche Wortgrenzen-Regel wie die Datenbank).
- Ergänzung 0020: `profiles.activity/activity_at` (von `heartbeat(p_activity)` gesetzt; Kennung wird auf a–z/_ bereinigt, max. 20 Zeichen), `admin_user_status()` (nur Admin: online + Tätigkeit), `admin_list_messages_to(user)`, `user_settings.notify_dm` (`window|edge`). Client: `lib/activity.ts` leitet die Tätigkeit aus der Seite ab; `PresenceProvider` meldet sie beim Seitenwechsel; bei `edge` zeigt `NotifyProvider` Team-Nachrichten als Hinweis, der bis zum Wegklicken bleibt (dann `mark_messages_read`).
- Verwaltung „Nutzer → Benutzer“: Personenliste (Suche, Filter Online/Team/Gesperrt, Online-Punkt, Tätigkeit); Antippen öffnet `PersonSheet` (Status, Nachricht, Zahlen, Coins/Punkte/Artikel/Bücher, Rolle, Konto). Die Online-Liste öffnet dasselbe Fenster.

## 0021 – Vokabeltrainer + und KI
- Tabellen (alle nur per RPC, RLS an): `plus_settings` (Preis, Laufzeit, Coin-Tag, KI-Grenzen, Modellpreise), `plus_requests`, `plus_sales` (paid/gift/coins, Cent), `goal_entries` (manuelle ± Buchungen), `ai_status` (no_key/ok/empty/error), `ai_usage` (Tokens, Kosten in Mikro-Euro), `ai_grammar_sets`, `ai_vocab_sentences` (Cache je Vokabel/Stufe), `ai_results` (gespeicherte Blätter/Tests, je Art höchstens 100). Spalten: `profiles.plus_until/plus_trial_used`, `shop_items.plus_only`.
- Plus: `_plus_active` (Admins immer), `_plus_sync` (legt Plus-Artikel ab, wenn Plus endet), `_plus_apply_perks` (setzt das „+“-Tag, wenn noch keins gewählt ist). `buy_item` bleibt unverändert (Plus-Artikel haben Preis 0 und sind über `get_shop`/`equip_item` nur mit Plus nutzbar).
- Verdienst-Balken: `_goal_total_cents()` = übergebener Druck + Plus-Verkäufe + manuelle Buchungen − KI-Kosten; `goal_offset_eur` gilt weiter. Admin kann Vergaben rückgängig machen (`admin_plus_undo_sale`, bei Coin-Tagen mit Rückerstattung) und manuell ± buchen.
- KI: Edge Function `supabase/functions/ai` (Deno). Schlüssel nur als Secret `OPENAI_API_KEY`. Aktionen `grammar`, `sentences`, `check` (nur Admin). Die Datenbankfunktionen `ai_begin`, `ai_set_status`, `ai_record_usage`, `ai_save_*` sind nur für `service_role` freigegeben. Grenzen: pro Person und Tag/Monat, insgesamt pro Monat. Antworten von OpenAI werden streng geprüft (`lib.ts`, getestet); Themen werden bereinigt und gelten nur als Stichwort.
- Client: `PlusProvider` (`usePlus`), Menüpunkt „Grammatik“ (farbig mit Schloss ohne Plus), `PlusDialog`, `pages/Grammar.tsx`, `components/sheet/*` (Papier-Blatt mit Lücken, Bewertung mit `lib/gaps.ts`, Noten in `lib/grade.ts`), Test-Blatt in `pages/Test.tsx`, Admin-Gruppe „Plus“, `PlusSection` im Personen-Fenster.

## 0022 – Höchstguthaben und automatische Belohnungen
- `_grant_koins` kürzt positive Belohnungen (Liga, Quests, Lernen, Duelle, Sprint …) auf den freien Platz unter 9 Billiarden oder lässt sie entfallen, statt einen Fehler zu werfen. Vorher brach `_league_rollover` ab, sobald ein Top-3-Platz fast am Limit war, und die ganze Liga lud nicht mehr. Strikt (mit Fehler) bleiben Reasons `admin`, `pay_in`, `print_refund`, `plus_refund`.

## 0023 – 3D-Druck ausschaltbar, Coin-Sperre pro Person
- `feature_locks` kennt jetzt den Schlüssel `print` (Verwaltung → Regeln & Wirtschaft → Sperren). `print_get_info`, `print_quote`, `print_create_order` haben `_feature_guard('print')`; Menüpunkt und Seite verschwinden über `NavItem.lock` und `Gate`. Bestehende Aufträge bleiben für Admin und Kunden einsehbar.
- Coin-Sperre: `profiles.coins_locked_at/coins_lock_note`. `_grant_koins` verweigert Abbuchungen gesperrter Personen außer `gambling_bet`, `game_fee`, `admin` (Shop, Bücher, Überweisung/!pay, 3D-Druck-Rabatt, Plus gesperrt); Gutschriften laufen weiter. RPCs `admin_set_coin_lock` (Admins nicht sperrbar, Nachricht an die Person), `admin_coin_locks`, `coin_lock_status`. UI: `CoinLockSection` im Personen-Fenster, Hinweis im Shop.

## 0024 – Plus nur mit Coins, Vorteile
- Stufen (`_plus_tiers`): 1 Tag 100, 1 Woche 600, 1 Monat 3000, 3 Monate 8000, für immer 100000 Coins. Preise stehen in `plus_settings` (Verwaltung → Plus → Preise & Verdienst). `plus_buy(stufe)` bucht über `_grant_koins(…,'plus_buy',…)`; der Verkauf steht mit `kind='coins'` in `plus_sales`. Rückgängig macht die Coins zurück (`plus_refund`).
- Plus-Vorteile: Coins ×1,5 und Ranglistenpunkte ×1,5 (zentral in `_grant_koins` und `_week_points`, Gambling-Gewinne ausgenommen), höhere Gambling-Gewinnchance (`plus_gamble_boost_percent`, in `gambling_play` eingefügt), `plus_make_due` (Stufe 5 → 4), `plus_revive(run)` (Wiederbeleben im Spiel, höchstens `plus_revive_max` pro Runde), zusätzliche Quests.
- Quests in Stufen (`get_quests`/`claim_quest`): pro Familie (answers, perfect, sprint, duel, plus_answers, plus_games) erscheint nach dem Einsammeln die nächste, größere Stufe. Quest-ID = `familie_stufe`.
- Neue Plus-Artikel: Profilbilder Supernova, Portal, Aurora-Kugel, Spiralgalaxie (animiert, `avatars.css`), Effekte Blitzschlag und Hologramm, Farben Lava, Galaxie, Hologramm, Designs Nebel und Cyber.
- Spiele: `Games.tsx` fragt bei Game over mit Plus nach dem Wiederbeleben; der Punktestand läuft mit Versatz weiter. Plus-Grafik: `features/games/plusfx.ts` (Schimmer, Funkeln, Vignette) und `.plus-game` in `index.css`.

## 0025 – Push-Nachrichten (Web Push)
- Tabellen `push_subscriptions` (Geräte), `push_config` (url, public_key, secret), `push_log` (Protokoll). Kein direkter Zugriff, nur über Funktionen.
- `_push_send` ruft per `pg_net` die Edge Function `push` auf (Header `x-push-secret`). Fehler werden protokolliert und blockieren nie die auslösende Aktion. Fehlt pg_net, steht `kein pg_net` im Protokoll.
- Auslöser: `chat_messages` (Erwähnung/Flüstern/optional alles), `user_messages` (Team-Nachricht), `print_orders` (lieferbereit). Es gelten die Schalter aus 0020. Wer in den letzten 90 s aktiv war, bekommt keinen Push (der Rand-Hinweis übernimmt).
- Client: `public/sw.js` (Service Worker), `src/lib/serviceWorker.ts`, `src/services/push.ts`, `src/features/push/PushSettings.tsx` (Einstellungen → Hinweise). Einrichtung: `supabase/functions/push/README.md`.

## Mathe (nur Client, keine Migration)
- `src/features/math/problems.ts`: Aufgaben-Generator für + − × ÷ in 5 Stufen (Division immer ohne Rest, Minus erst ab Stufe 5 negativ), `parseAnswer` liest Eingaben tolerant. Tests in `problems.test.ts`.
- `src/pages/Math.tsx` (Route `/mathe`, Menü „Lernen“): Rechenarten und Stufe wählen, 10/20/30 Aufgaben, Auswertung mit Zeit und Fehlerliste. Die Auswahl merkt sich der Browser. Es gibt keine Coins.

## 0026 – Push auch bei offener App, Push bei „kommt online“
- `_push_idle` liefert immer true (früher: kein Push, wenn die Person in den letzten 90 s aktiv war).
- Trigger `profiles_push_online` (auf `online_since`): Push je nach `notify_online` (alle oder nur Mods/Admins), nicht an sich selbst, nicht bei versteckter Anwesenheit, höchstens alle 10 Minuten pro Person.

## 0027 – Mathe mit Coins/Punkten, Admin-Liga, Korrektur Wochenpunkte
- Mathe: `daily_stats.math_correct`, `submit_math(correct, total, seconds)` (Einstellungen `math_*`, Mindestzeit `math_min_seconds` gegen Schummeln, Coins mit Grund `math`). Punkte fließen in `_week_points` und `get_leaderboard`.
- Korrektur: `_week_points` (in 0024 versehentlich fest verdrahtet) rechnet wieder mit den Einstellungen, Multiple-Choice-, Mathe-Punkten und Admin-Anpassungen; Plus ×1,5 gilt nur für erspielte Punkte (`_plus_points_factor`), auch in der Rangliste.
- `admin_get_league(tier)`: Admins sehen jede Liga (auch fremde). UI: Stufen-Knöpfe in `LeagueView`.
- `components/admin/PageRules.tsx`: aufklappbarer Admin-Bereich unter Lernen, Test, Multiple Choice und Mathe, mit Erklärung und direkt änderbaren Werten.
- Antwortvergleich (`features/learning/answer.ts`): „to“ am Anfang und Bindestriche egal, Schrägstrich-Alternativen (`qc/qn`), Kürzel (qc, qn, sth, sb, etw., jdn. …) und Klammern optional.

## Crashkurs („Noch nichts gelernt“)
Seite `/crashkurs` (`pages/Cram.tsx`), Logik in `features/cram/cram.ts` (+Tests), Karteikarte `features/cram/FlipCard.tsx` (CSS-3D-Flip in `index.css`).
Ablauf: Merken → Karteikarten → Abfrage (falsche kommen nach 3 Wörtern wieder) → schwere Wörter als Karten → Test (10 Wörter, Note per `gradeFromScore`).
Der Stand liegt nach jedem Schritt in localStorage (`cram-session:<userId>`), kein Fokusmodus: Menü und Chat (Fenster per Knopf) bleiben erreichbar. Kein Server/Migration nötig.
Außerdem: eigene Seite `/karteikarten` (`pages/Flashcards.tsx`, nutzt `FlipCard`), Melden-Knopf (`features/cram/ReportBtn.tsx`, öffnet `ReportModal`) in Crashkurs und Karteikarten; „Hab ich gewusst“ (max. 3 pro Crashkurs) in `cram.ts`.

## 0028 – Latein & Spanisch
`languages` bekommt `la`/`es` (Bücher, Suche, Einstellungen lesen die Tabelle). Grammatik: `Lang` in `services/ai.ts` und `supabase/functions/ai/lib.ts`, Themen je Sprache in `TOPICS`, Check-Constraint von `ai_grammar_sets` erweitert. Sonderzeichenleiste je Sprache (`AccentBar lang=…`, `accentsFor()` in `AccentBar.tsx`). **Edge Function `ai` muss neu deployt werden.**

### 0028 Teil 2 (Update 28)
- **Sprint-Zeit kaufen:** `buy_sprint_time(n)` (Einstellungen `sprint_extra_cost` = 100 Coins/Sekunde, `sprint_extra_max` = 30), bezahlt erst beim Start (`pages/Sprint.tsx`).
- **Liga:** alle Nutzer sind Mitglied (Nachtrag + Trigger `profiles_league_member`); `get_league` zeigt alle Mitglieder der eigenen Stufe, auch mit 0 Punkten (Anzeige „–“).
- **Spiele:** `g2048`, `memory`, `bricks`, `mole` (`features/games/*`); `start_game`/`finish_game`/`get_game_board` werden per Text-Patch erweitert (wie bei Wave), Punkte-Obergrenzen je Sekunde im `case` von `finish_game`.
- **Sticker:** Chat-Text `:sticker:<id>:` (`features/chat/stickers.tsx`, selbst gezeichnete SVGs), keine DB-Änderung.
- **Antworten:** Leerzeichen dürfen fehlen (`answer.ts`). **Melden-Knopf** im `QuizRunner` (`reportable`, Lernen und Test). **Tastatur/Scroll:** `lib/keepFocusVisible.ts` (aus `AppShell`) + `preventScroll` beim Fokussieren.

## 0029 – Veröffentlichtes Buch aus „Meine Bücher“ entfernen
Tabelle `book_library_hidden`; `in_library` blendet ein veröffentlichtes Buch des Besitzers aus, wenn dort ein Eintrag steht. `remove_from_library` (Besitzer: verstecken, andere: Bibliothekseintrag löschen) und `add_to_library` (holt es zurück). Beim Zurücknehmen der Veröffentlichung werden die Einträge gelöscht. Das Buch bleibt online und im Reiter „Online“.

## 0030 – Dauerhafte Sprint-Zeit, Spiel „Hüpfer“
- `sprint_upgrades` + `get_sprint_bonus()`; `buy_sprint_time(n)` kauft dauerhaft (100 Coins/s, insgesamt höchstens `sprint_extra_max` = 30 s). Sprint dauert 60 s + Bonus.
- Bricks: feste Steine (2 Treffer, erst angeknackst; `isTough` in `features/games/bricks.ts`).
- Plattformer `jump` (`features/games/jump.ts`, `JumpGame.tsx`, Joystick `joystick.tsx`): Punkte = Strecke/50 + 5 je Münze, Obergrenze 14 Punkte/s im `finish_game`.

## Update 31 – Sprachmenü, irreguläre Verben, neues Hüpfer-Design (keine SQL-Änderung)
- Menü „Lernen“ ist nach Sprache sortiert: `LangPicker` (Englisch, Französisch oben; Spanisch, Latein darunter) setzt `learn_language`; darunter stehen die Einträge der gewählten Sprache (`NavItem.langs`, `navGroupsFor(isStaff, locked, language)`). Sprachunabhängig (unten): Bücher, Suche, Mathe.
- Seite `/unregelmaessig` (`pages/Irregular.tsx`, `features/irregular/irregular.ts`): Englisch Simple Past/Past Participle (~95 Verben, Varianten wie learnt/learned), Französisch Présent je/nous/ils, Participe passé, Futur (22 unregelmäßige Verben), mit Wortliste.
- `JumpGame.tsx`: nur Optik neu (Nachthimmel, Mond, Sterne, Wolken, 3 Parallax-Hügel, Gras-Plattformen, drehende Münzen, Figur mit Augen/Squash, Partikel, Anzeige). Physik in `jump.ts` unverändert.

## 0031 – Duell-Unentschieden, Coreball/Klicker/CPS, Design „Schwarzes Loch“
- `submit_duel` (gepatcht): gleich viele richtige Antworten = Unentschieden (Zeit entscheidet nicht mehr); beide bekommen `duel_reward / 2` (Tageslimit je Person).
- Neue Spiele (`game_runs`-Check, `start_game`/`get_game_board`/`finish_game` gepatcht; Punktegrenzen je Sekunde: coreball 6, clicker 2, cps 3):
  - `coreball` (`coreball.ts`, `CoreballGame.tsx`): Kugeln auf drehenden Kern schießen, `levelConfig(level)` = mehr Kugeln/schneller/Richtungswechsel ab 3/Pendeln ab 6. Score = gesetzte Kugeln.
  - `clicker` (`clicker.ts`, `ClickerGame.tsx`): 30 s, 0,1 Punkte je Klick, gewertet nur gerade ganze Zahlen (`2*floor(clicks/20)`).
  - `cps` (`cps.ts`, `CpsGame.tsx`): 10 s, Score = meiste Klicks in einer Sekunde.
- Design `theme_blackhole` (Shop 250 000 Coins, in 0031 eingetragen; Aussehen in `catalog.ts`, `fx: 'hole'`, `decor: 'blackhole'`): `components/ui/BlackHole.tsx` – `BlackHoleBackdrop` (Horizont, Photonenring, Scheibe, einfallende Sterne) hinter der Seite, `BlackHoleBeams` (Lichtfunken spiralen von zufälligen Menüpunkten ins Loch, über der Seite, `pointer-events:none`). CSS in `index.css`: Verlaufs-Knöpfe `[data-fx='hole']`, `.bh-ring` (Rangliste/Profil, `PlayerTag framed`) und `.bh-bubble` (Chat-Blase): rotierender doppelter Rahmen blau auf weiß. `prefers-reduced-motion` schaltet Animationen aus.

## 0032 – Faire Spiele, Gambling-Erweiterung, Schwarzes Brett mit Autor, Design „Berge“
- **Fairness:** `finish_game` zählt Läufe mit Wiederbelebung (`game_runs.revives > 0`) nicht mehr für Rekord/Belohnung. Memory (`memory.ts`): nur vermeidbare Fehlversuche kosten Herzen, fehlerfreie Runde heilt. Maulwurf (`mole.ts`): Plateau-Tempo, 3 Leben, Bomben, goldene Maulwürfe, 12er-Serie heilt – ohne Zeitlimit. Klicker und CPS-Test sind entfernt (Clients; die Spiel-IDs bleiben in der DB harmlos).
- **Gambling:** `gambling_roulette(jsonb)`, `gambling_dice`, `gambling_wheel` (alle mit `_feature_guard('gambling')`, Einsatzgrenzen, `_gamble_settle`). Oberfläche in `features/gambling/` (Roulette, Dice, Wheel, Slots) mit Tab-Leiste in `pages/Gambling.tsx`.
- **Schwarzes Brett:** `board_posts.created_by/updated_by`; `get_board()` liefert Autor- und Bearbeitername, `admin_save_board_post` setzt sie. `Board.tsx` zeigt „von … · bearbeitet von …“.
- **Wer ist da:** `get_presence()` liefert `hidden`; Admins sehen auch Versteckte (Badge „versteckt“).
- **Design `theme_mountain`** (Shop 250 000 Coins; `fx: 'alps'`, `decor: 'mountains'`): `components/ui/Mountains.tsx` (Canvas: Himmel, Sonnenstrahlen, 5 Bergketten mit Schneekappen, Nebel). CSS `[data-fx='alps']`, `.mt-bubble` (Gipfel über der Chat-Blase; Zeile mit `.mt-row` wegen `content-visibility`), `.mt-ring`.
- **Verläufe:** Wechselnde Verläufe (`fx-rainbow`, `tag-gold`, `bh-flow`, `mt-flow`) laufen hin und her in einem 200 %-Bild – so wandert keine Kachelkante („Strich“) mehr durch.
- Avatar-Emojis liegen auf einer Farbscheibe mit Glanz (`PlayerTag.tsx`), Plus-Vorteile nutzen Lucide-Icons.

## 0033 – Design „Fußball“
- `theme_football` (Shop 250 000 Coins, in 0033 eingetragen; `fx: 'pitch'`, `decor: 'football'`): `components/ui/Football.tsx` – Canvas mit Nachthimmel, Tribüne mit Kamerablitzen, Rasen mit Mähstreifen (einmal vorgerendert), flackernden Flutlichtkegeln und einem hüpfenden, rollenden Ball. CSS `[data-fx='pitch']` (Rasen-Verlaufsknöpfe), `.fb-bubble` (Nachricht als Tor: Pfosten, Latte, Netz; ein Ball fliegt per `::before` im Bogen hinein, Netz wackelt; Zeile mit `.fb-row` wegen `content-visibility`) und `.fb-ring` (Grasstreifen-Rahmen, Ball umkreist per `offset-path`).

## 0034 – Hausvorteil bei Würfeln, Roulette, Glücksrad
- Einstellung `gambling_rtp_permille` (Standard 900 = 90 % Rückzahlung, begrenzt auf 500–950; Admin unter Regeln › Gambling). Würfeln: Auszahlung = Einsatz × rtp / (10 × Chance), Chance höchstens 75 % (vorher 90 %, sah wie sicherer Gewinn aus). Roulette: Auszahlung je Feld × rtp / 973. Glücksrad: × rtp / 975. Der Client (`Dice.tsx`) liest die Quote aus `app_settings`.

## 0035 – Lernpool nur aus eigener Bibliothek
- `get_learning_pool` filtert wieder auf `in_library(book)` (wenn kein Buch gewählt ist) und `is_active_vocab`. Die Version aus 0011 hatte beides verloren, dadurch kamen in Multiple Choice, Lernen, Test, Sprint und Fehler-Training auch Vokabeln aus öffentlichen Büchern, die man nicht verwendet.

## 0036 – Design „Gasthaus“ und blaue Berge
- `theme_food` (Shop 250 000 Coins, in 0036 eingetragen; `fx: 'tavern'`, `decor: 'food'`): `components/ui/Food.tsx` – Canvas mit Karo-Tischdecke und fallenden, selbst gezeichneten Speisen (Schnitzel, Pommes in Tüte, Spätzle in Schüssel, Brezel, Bratwurst, Zitrone; keine Emojis). CSS `[data-fx='tavern']` (goldene Krusten-Verläufe), `.fd-bubble` (Karo-Rand, oben ragen Pommes heraus; Zeile `.fd-row`), `.fd-ring` (Karo-Ring). Die Karomuster sind exakt periodisch, die Animation läuft nahtlos.
- `theme_mountain` ist jetzt komplett blau (Himmel, Strahlen, Berge, Akzente in `[data-fx='alps']`).

## 0037 – Hintergrundfarbe der Emoji-Profilbilder
- `profiles.avatar_bg` (#rrggbb oder null), gesetzt über `set_avatar_bg(text)`, gelesen über `get_avatar_bgs()` (Anzeigename → Farbe). Anzeigenamen sind eindeutig, deshalb lädt der Client die Liste einmal (`features/shop/avatarBg.ts`, wie die eigenen Shop-Artikel, Auffrischung alle 60 s) und `Avatar` schlägt per Name nach – die vielen Chat-/Ranglisten-Funktionen blieben unverändert. Auswahl in Einstellungen › Profil (Vorgaben, eigene Farbe, Zurücksetzen), nur wenn ein Emoji-Profilbild getragen wird. Ohne eigene Farbe gilt die Standard-Scheibe (Farbton aus der Avatar-ID).

- Schwarzes Loch: Die Lichtstrahlen (`BlackHoleBeams`) liegen jetzt hinter dem Seiteninhalt (`-z-[9]` statt `z-[35]`) und pausieren, solange ein Eingabefeld den Fokus hat – vorher flogen sie quer über Chat-Eingabe und Texte.
- Einblend-Animation `animate-rise` nutzt `backwards` statt `both`: Vorher blieb am Seiteninhalt dauerhaft `transform: translateY(0)` hängen; auf Apple-Geräten kann das den blinkenden Textcursor („Strich hinter dem letzten Buchstaben“) in Eingabefeldern springen lassen. Jetzt gibt es nach der Animation keinen Transform mehr.

### 0038/0039 – Gambling verschärft, Black Jack
- 0038: Würfeln höchstens 50 % Chance, Standard-Gewinnquote 85 %. Glücksrad zahlt exakt den Faktor des Felds (Layout bringt ~87,5 % zurück).
- 0039: Black Jack. Tabelle `blackjack_hands` (eine offene Runde pro Nutzer, für Clients gesperrt) hält Deck und Karten. RPCs `blackjack_start`, `blackjack_action('hit'|'stand'|'double')`, `blackjack_current`. Einsatz wird beim Start abgebucht, Auszahlung (inkl. Einsatz) am Ende; die verdeckte Geberkarte wird erst bei Rundenende gesendet. Regeln: 1 Deck pro Runde, Geber zieht bis 17 inkl. weichem 17, Black Jack 6:5, Verdoppeln nur mit 2 Karten, kein Teilen. Neustart mit offener Runde = Verlust der alten Runde. Frontend: `features/gambling/Blackjack.tsx`, `cards.ts`.

### 0040 – Gambling-Einstellungen, Hausschutz, höhere Einsätze
- Höchsteinsatz Standard 10.000 (nur wenn noch 200 gesetzt war). Einsatzfeld mit Schnellwahl bis 100.000, Roulette-Chips bis 5.000.
- Jede Wahrscheinlichkeit einzeln im Admin-Bereich: `gambling_rtp_dice`, `gambling_dice_max_chance`, `gambling_rtp_roulette`, `gambling_wheel_w0/w05/w1/w2/w3/w4` (Gewichte je Faktor, Rad zahlt exakt den Feld-Faktor), `gambling_bj_blackjack_x10` (12 = 6:5), `gambling_bj_dealer_hits_soft17`, dazu Automat wie bisher. `gambling_rtp_permille` wird nicht mehr benutzt.
- Hausschutz `_house_squeeze()`: summiert Einsatz/Auszahlung der letzten 3 Tage aus `gambling_feed`. Liegt der Hausgewinn unter `gambling_guard_target_permille` (Standard 50 ‰) und wurden mindestens `gambling_guard_min_wagered` Coins eingesetzt, wird ein Gewinn mit Wahrscheinlichkeit min(`gambling_guard_max_permille`, Abstand zum Ziel) durch eine Niete ersetzt (Würfeln: Wurf, Rad: Feld, Roulette: neue Zahl, Automat: Walzen, Black Jack: Deck wird neu gemischt). Für Spieler unsichtbar. `gambling_guard_max_permille` = 0 schaltet ihn aus.
- Frontend: `WalletProvider.hold()/release(n)` hält Guthaben-Änderungen und die „+N Coins“-Meldung zurück, bis die Animation fertig ist (vorher sprang die Meldung per Realtime schon beim Drehen auf). Haken „Animationen überspringen“ (`features/gambling/skipAnim.ts`, im Browser gemerkt) gilt für alle Spiele.
- Black Jack neu gestaltet (Sechseck-Tisch, Kartenrücken, Austeilen/Aufdecken animiert).

### 0041 – Riesige Einsätze und Gewinne
- Einsätze/Auszahlungen/Feed/Bilanz rechnen mit bigint (vorher integer, ~2,1 Mrd. Grenze). Zwischenrechnungen mit numeric. Regel `gambling_all_in` (Standard 1): jeder darf bis zum ganzen Guthaben setzen, sonst gilt `gambling_max_bet`.
- Das Höchstguthaben bleibt 9 Billiarden (9·10^15), weil JavaScript darüber Zahlen nicht mehr exakt darstellt; Gewinne über dem Limit werden gekürzt gutgeschrieben (`_grant_koins`).
- Frontend: `lib/compact.ts` (Kurzschreibweise für Chips/Schnellwahl bis 1 Brd.), Einsatz-Obergrenze = max(Höchsteinsatz, Guthaben).

### 0042 – Live-Duell, Online-Anzeige, Namen ändern
- Live-Duell (bis 4 Spieler): Tabellen `live_duels`, `live_duel_players` (für Clients gesperrt), RPCs `live_create/live_my_invites/live_respond/live_leave/live_start/live_get/live_progress/live_finish`. Host lädt 1–3 Personen ein (bekommen zusätzlich eine Nachricht, damit Push ankommt), Fragen aus Vokabeln, die ALLE Beigetretenen aktiv haben, Start nach 4 s Countdown (Serverzeit aus `live_get.now`), Fortschritt jede Sekunde per Polling, Rangfolge (richtig, dann Zeit), Sieger bekommt `live_duel_reward` (zählt zum `duel_daily_cap`). Hängende Runden werden nach q_count·60+120 s abgeschlossen.
- Frontend: `pages/LiveDuel.tsx` (Einladen), `pages/LiveDuelRoom.tsx` (Lobby → Countdown → Rennen mit `features/duel/RaceTrack.tsx` → Podium), `features/duel/LiveInviteWatcher.tsx` (Einladungskarte, fragt alle 5 s). Routen `/live-duell`, `/live-duell/:id`.
- Online-Fenster 75 s statt 3 min (SQL ersetzt `interval '3 minutes'` in allen Funktionen mit `last_seen_at` automatisch); die App meldet sich alle 30 s. „Zuletzt gesehen“ zählt minutengenau. Admins sehen in „Wer ist da?“ zusätzlich die Tätigkeit (`admin_user_status`).
- `admin_rename_user` (Admin ändert Anzeigenamen, Name eindeutig); UI im Personen-Fenster.
- Mitteilungen: `features/push/PushPrompt.tsx` meldet das Gerät still an, wenn die Erlaubnis schon vorliegt, sonst kommt alle 3 Tage ein Hinweis zum Einschalten (iPad: Hinweis zum Home-Bildschirm). Die Schalter für @, Team-Nachrichten und Hinweise sind schon standardmäßig an.

### 0043 – Klassen-Battle (bis 20 Spieler)
- Erweitert das Live-Duell: `live_duels.book_id/max_players/code`. `live_create(p_invitees, p_count, p_book)` mit Buch = Klassen-Battle (bis 20 Spieler, 4-stelliger Code, Fragen aus allen Vokabeln des Buchs, egal ob aktiv); `live_join_code(code)` zum Beitreten, `live_respond` prüft die Platzzahl. Frontend: Reiter „Live-Duell · bis 4“ / „Klassen-Battle · bis 20“ in `pages/LiveDuel.tsx`, Code-Karte und kleinere Plätze in `LiveDuelRoom`.
- `RaceTrack`: ab 5 Spielern kompakt (die Besten + du, mit Platz). Das Profilbild-Element hat bewusst keinen `key`: sonst startet animierte Profilbilder (Schwarzes Loch) bei jeder Antwort ihre 16-s-Animation neu und wirken leer.

### 0044 – Siegprämien, offene Klassen-Battles, Team-Parkour
- Einstellungen (Admin → Zahlen, Bereich Coins): `live_duel_reward`, `live_class_reward_1/2/3`, `team_reward`, `team_parkour_reward`, `team_lives`, `team_daily_cap`. `_live_finalize` zahlt über `_live_pay` (Tageslimit `duel_daily_cap`); `live_get` liefert `rewards` für die Lobby-Anzeige.
- Offene Klassen-Battles: `live_open_classes()` und `live_join_open(id)`; Liste in `pages/LiveDuel.tsx` (Reiter Klassen-Battle), Aktualisierung alle 4 s.
- Team-Spiele für 2 Personen: Tabelle `team_runs` mit `kind` = `parkour` oder `quiz`; RPCs `team_create/_my_invites/_respond/_start/_get/_leave`, für Quiz `team_report`, für Parkour `team_parkour_finish` (frühestens 60 s nach Start, zahlt `team_parkour_reward` an beide, Limit `team_daily_cap`, Grund `team`).
- **Team-Parkour** (`features/parkour/`): `levels.ts` (Kachelkarten per Builder: Block, Stacheln, Checkpoint, Ausgang, Druckplatten a/b/c, Türen A/B/C, Brücken x/y/z), `engine.ts` (reine Physik: Laufen, Sprung mit Koyote-Zeit und Puffer, Doppelsprung (ein Luftsprung; Stachelgruben und Brücken sind deshalb 12 Kacheln breit, die Reichweite liegt unter 11), Räuberleiter = auf dem Kopf des Partners landen, Leine max. 17 Kacheln, Tod durch Stacheln/Abgrund/Einklemmen), `ParkourGame.tsx` (Canvas, Joystick + Sprungknopf, Tastatur). Jeder simuliert nur sich selbst; Positionen gehen alle 50 ms über einen Supabase-Realtime-Broadcast-Kanal `parkour-<id>`. Platten, Türen und Brücken berechnet jeder Client aus beiden Positionen. Level wechselt, wenn beide im Ausgang stehen; nach Level 3 meldet jeder `team_parkour_finish` (idempotent). Realtime muss im Supabase-Projekt aktiv sein (Broadcast braucht keine Tabelle).
- Quiz-Variante (`pages/TeamRunRoom.tsx`, `features/team/TeamTrack.tsx`): pro Hindernis eine Frage je Person, weiter nur wenn beide richtig, falsche Antwort kostet ein gemeinsames Leben.
- Lobby/Countdown/Ergebnis für beide Arten in `pages/TeamRunRoom.tsx`, Route `/team/:id`, Einladungen über `LiveInviteWatcher`.
- Animierte Profilbilder (`.av`) sind jetzt `inline-block`: in Block-Containern (Lobby, Rennstrecke) hatten sie sonst keine Größe (unsichtbar oder riesig).
- Spanisch: `isAnswerCorrect` ignoriert Akzente, ñ, ü sowie ¿ ¡ ? !, wenn die Lernsprache Spanisch ist (`setAnswerLanguage` aus `SettingsProvider`).

### 0045 – Team-Parkour: 8 Level, Herzen, Coins nach Fortschritt, Duo-Bestenliste
- 8 Level in `features/parkour/levels.ts` (Builder-Makros `chain`, `bridgeGap`, `tower`): 1–3 Einstieg, 4 schmale Plattformen, 5 Türme mit Platten oben, 6 Doppelbrücke, 7 Stachelfelder, 8 Finale mit allem.
- Gemeinsame Herzen (`team_lives`, Standard 3): jeder Sturz eines der beiden kostet eins (jeder zählt die Tode des Partners aus dem Broadcast mit), ein geschafftes Level bringt eins zurück, bei 0 ist der Lauf verloren. Das Frontend meldet dann `team_parkour_finish(p_id, p_millis, p_deaths, p_levels, p_cps)`.
- Neustart-Knopf (Taste R, ohne Herzverlust, 1,5 s Pause): Respawn an einem erreichten Checkpoint, der im Bild ist (der nächste); sonst beim Partner (wenn dieser am Boden steht), sonst beim letzten Checkpoint. Gilt auch nach einem Sturz.
- Coins: `parkour_coins_level` je Level, `parkour_coins_cp` je erreichtem Checkpoint, `parkour_coins_bonus` für alle 8 Level, jeweils für beide; Mindestdauer 12 s je gemeldetem Level; Tageslimit `team_daily_cap`.
- `team_parkour_board()`: bester Lauf je Duo (Level, Checkpoints, Zeit), Top 20; Anzeige im Reiter „Team-Parkour“ in `pages/LiveDuel.tsx`.

### 0046 – Team-Parkour endlos
- `features/parkour/generator.ts`: nach den 8 handgebauten Leveln erzeugt `generateLevel(seed, n)` zufällige Level. Seed = Lauf-ID + Levelnummer (`rng` = mulberry32), daher haben beide Spieler dasselbe Level, ohne dass etwas übertragen wird. `levelFor(seed, n)` wählt handgebaut oder zufällig.
- Schwierigkeit d = n − 7: mehr Abschnitte (5 + d, höchstens 18), breitere Stachelfelder (bis 6), mehr und schmalere Plattformen mit größeren Lücken, ab d 2 Türme, ab d 3 Doppelbrücken. Alles bleibt in Sprungreichweite (Doppelsprung ≈ 7 Kacheln weit, 5 hoch); Tests in `generator.test.ts` prüfen Gültigkeit (Ausgang, Platten-Paare, Spawn frei) für viele Seeds.
- Der Lauf endet nur durch aufgebrauchte Herzen. `team_parkour_finish` erlaubt bis zu 500 Level; ab Level 9 gibt es `parkour_coins_endless` Extra-Coins je Level. Status `won` ab Level 8.

### Parkour-Fix: Herzen nur durch Stacheln
- `parse()` setzt in jeder Schlucht (Zeile 10 und 11 leer) unten Stacheln. `stepBody` liefert `dead` nur bei Stacheln (kostet ein Herz, auch für den Partner); Einklemmen in Türen und Herausfallen aus der Welt liefern `lost` = Neustart ohne Herzverlust. Respawn prüft per `spotIsSafe`, dass man nicht in Block/Stacheln startet. Keine SQL-Änderung.
- Fix: Partner-Position (Leine, Platten, Räuberleiter, Respawn, Kamera) zählt nur, wenn er im selben Level ist (`remote.lv === lv`). Vorher wurde, wer zuerst ins nächste Level kam, an die alte Partner-Position gebunden, in die Wand geschoben und verlor beim Start ein Herz.
- Admins springen im Parkour vierfach (`Input.airJumps` = 3, sonst 1; `useAuth().isAdmin`). Level 4 hat zusätzlich einen Checkpoint vor der Säule (Spalte 80). `reach.test.ts` sucht per Zustandssuche allein (alle Platten gedrückt) einen Weg zum Ausgang und prüft so die Sprung-Geometrie aller 8 Level.
- Leinen-Fix: Platte und Tür müssen zusammenpassen (Leine 17 Kacheln). Level 5 und 8 sowie das Zufalls-Stück „Turm“ hatten die Tür 18+ Kacheln von der Platte entfernt, so dass man nie durchkam. Jetzt: Turm-Platte, Tür, danach niedrige Säule mit Platte (höchstens 16 Kacheln zwischen den Platten). `reach.test.ts` prüft das für alle Level und mehrere Zufallslevel.

### 0047 – Parkour-Shop
- `parkour_profiles` (nur über RPC): gekaufte Extra-Herzen, besessene Farben/Hüte, ausgerüstete Farbe/Hut. RPCs `parkour_shop_get`, `parkour_shop_buy(item)` (`heart`, `color:<id>`, `hat:<id>`; Zahlung über `_grant_koins`, Grund `shop`), `parkour_equip(color, hat)`. Preise aus `app_settings` (`parkour_heart_price` × Anzahl, `parkour_heart_max`, `parkour_color_price`, `parkour_hat_price`, Premium ×3). `team_get` liefert je Person `pk_hearts/pk_color/pk_hat`; der Herzvorrat im Spiel ist `team_lives` + Extra-Herzen beider Personen. Katalog-IDs: `features/parkour/cosmetics.ts` (Test gleicht sie mit dem SQL ab). Seite `/parkour` (Menü „Parkour“ neben „Spiele“).
- Zusätzlich im Spiel: Schonfrist von 1,5 s nach Start/Neustart (Stacheln kosten dann kein Herz), Versions-Hash der Level in jeder Nachricht – bei Abweichung zeigt das Spiel „unterschiedliche Spiel-Versionen, Seite neu laden“. Admins: Vierfachsprung und Flugmodus (Taste F, W/S/A/D).

### 0048 – Parkour mit bis zu 5 Personen
- `team_run_extras` (run_id, user_id, state invited/joined/declined/left, paid): bis zu 3 weitere Mitspielende neben Host und Partner (nur Parkour). `team_create(..., p_extra uuid[])`, `team_my_invites/_respond/_leave/_start/_get/_parkour_finish` kennen sie. `team_get.people` enthält je Person `state`; im Spiel zählen nur Host und `joined`. Auszahlung an alle Beigetretenen. `team_parkour_board` liefert `group_size`.
- Spiel: keine Leine mehr (unendlich weit auseinander), Kamera folgt nur der eigenen Figur, Randpfeile zeigen Mitspielende außerhalb des Bildes, Ausgang öffnet, wenn alle aktiven (Nachricht jünger als 2,5 s) im Ausgang stehen. Herzvorrat: Grundherzen + 1 ab der dritten Person + Extra-Herzen aller (höchstens 20). Sendetakt 50/70/90 ms je nach Anzahl. Admin: Geistmodus (Taste G) fliegt durch Wände und Türen.

### 0049 – Deathrun
- `team_runs.kind` = `deathrun`; Tabelle `deathrun_results` (je Person Level, Checkpoints, Zeit, Stürze, Coins). `team_deathrun_finish` (Coins wie Parkour, Tageslimit `team_daily_cap`) meldet die Person; `_deathrun_close` beendet den Lauf, sobald jede beigetretene Person ein Ergebnis hat. `deathrun_board()` = beste Läufe einzelner Personen. `team_get` liefert `results`.
- Spiel (`ParkourGame`, `kind === deathrun`): eigene Herzen (`team_lives` + eigene Shop-Herzen), eigenes Level (Ziel erreicht = sofort nächstes Level), kein Folgen fremder Level, keine geteilten Checkpoints/Tode; Platten, Türen, Brücken und Räuberleiter wirken nur zwischen Personen im selben Level; wer allein im Level ist, für den sind alle Tore offen; ausgeschiedene Personen senden `el` und werden ausgeblendet. Beim Verlassen der Seite wird der Stand gemeldet.
- Bestenlisten (Team-Parkour und Deathrun) stehen jetzt auf der Seite Rangliste (Reiter „Parkour“, `pages/ParkourBoard.tsx`), nicht mehr unter Duell.

### 0050 – Offene Deathrun-Lobby, Bots, Wiedereinstieg, Zuschauer, Effekte
- `team_runs.is_open` (offene Lobby, nur Deathrun; Host = Partner = erste Person, `partner_state = 'left'`), `bots` (0–8) und `bot_skill` (1–3). `deathrun_open_join()` tritt der ältesten freien offenen Lobby bei, legt sonst eine an, und bringt Personen zurück in einen laufenden offenen Lauf. Bei 5 Personen startet der Lauf automatisch; `team_start` für offene Lobbys: Mods/Admins immer, sonst jede beigetretene Person, solange kein Mod/Admin beigetreten ist (`_run_staff_present`). Verlässt der Host eine offene Lobby, wird die nächste Person Host (`_team_promote`).
- `team_set_bots` (Mods/Admins, bei privaten Lobbys auch der Host). Bots läuft auf dem Rechner der Person mit der kleinsten Nutzer-ID im Lauf (`bots.ts`: vorausrechnende Läufer, alle Tore für sie offen, kein Coin-Lohn); die Stände gehen als Event `b` über denselben Kanal, ein Wechsel des Steuerrechners übernimmt den letzten Stand.
- `team_rejoin`: wer ausgestiegen oder rausgeflogen ist, kommt in einen laufenden Parkour/Deathrun zurück; Host-Wechsel statt Abbruch (`team_leave`); `team_get` hält laufende Läufe am Leben (`updated_at`). Der Spielstand (Level, Herzen, Zeit) liegt 15 Minuten in `localStorage` (`pkr:<lauf>:<nutzer>`).
- Netz im Spiel: Kanal wird bei Fehlern (CHANNEL_ERROR/TIMED_OUT/CLOSED), bei 6 s Funkstille, nach `online`/Sichtbarwerden neu aufgebaut; Nachrichten mit Laufnummer `n` je Sitzung `sid` (Veraltetes wird verworfen), Werte werden begrenzt, große Positionssprünge werden nicht weich nachgezogen, Stillstand sendet nur alle 350 ms.
- `admin_open_runs()` und `team_spectate()` (nur Admins): Übersicht aller offenen/laufenden Parkour- und Deathrun-Läufe (`/laeufe`) und unsichtbares Zuschauen (`/team/<id>?zuschauen=1`): Geist ohne Senden, ohne Herzen, folgt einer Person oder fliegt frei.
- Boden-Upgrades (`pickups.ts`, nur im Client, aus Lauf-ID und Level deterministisch): 3er-Sprung (20 s) und Jetpack (25 s, 5 s Schub, Sprungknopf in der Luft halten); Aura/Flamme sehen auch die anderen (`bf`).
- Kosmetik: Effekte (`fx.ts`: Notenstrahl, Schwarzes Loch, Blitze …), weitere Farben und Hüte; `parkour_profiles.fx`, `parkour_equip(color, hat, fx)`, `_pk_price` (Preise: `parkour_fx_price`, Premium ×3), `team_get.people[].pk_fx`.
- Joystick: setzt sich bei pointerup/cancel, verlorenem Pointer, Fensterfokus-Verlust, Tab-Wechsel und wenn kein Finger mehr auf dem Bildschirm ist zurück; Textmarkieren (`selectstart`), Kontextmenü und Lupe sind im Spiel gesperrt.

## Update 57: Bots als echte Mitspieler, Jetpack-Flugmodus, Loch unter dem Spieler
- Bots (`bots.ts`) bekommen einen `BotCtx` (Menschen/andere im Level): sie stehen auf Platten, bis Menschen durch sind, haben selbst feste Türen/Brücken und warten auf Menschen. Nach 14 s ohne Hilfe werden sie hinter das Tor gesetzt.
- In `ParkourGame.tsx` zählen Bots im selben Level für Platten (`pressedMap`) und als Kopf-Landefläche. Notausgang: steht ein Mensch 12 s vor einem Tor, das nur Bots hätten öffnen können, sind alle Tore 40 s offen.
- Jetpack = Flugmodus wie beim Admin für 20 s (Sprung = hoch, „Runter“-Knopf/S = runter, keine Stacheln, Wände bleiben fest). Kein Treibstoff mehr (`JET_FUEL` entfernt).
- `fx.ts`: Schwarzes Loch liegt flach unter den Füßen (Anker `cx`/`foot`).

## Update 58/59: Bots kommen zurück, Meister-Bot, gemischte Bots, weniger Upgrades
- Bots bleiben auf der Platte, bis jeder Mensch ganz hinter dem Tor ist (nicht nur an der Tür). Steht ein Mensch noch 0,8 s vor einem Tor, das der Bot schon passiert hat, läuft der Bot zur nächsten Platte dieses Kanals zurück (`forgottenGate`, danach 30 s Pause gegen Hin-und-Her).
- Bots sprechen sich ab (`BotCtx.bots`, vom Steuerrechner in `ParkourGame` gefüllt): Hält schon ein Bot die Platte eines Tors oder ist unterwegs dorthin, stellt sich kein zweiter dazu, sondern geht weiter. Zusätzlich halten Bots Abstand: steht ein laufender Bot mit kleinerer Nummer auf derselben Stelle, wartet der andere kurz (mit Pause danach).
- Pläne enden bei der Landung (der Bot plant danach neu, statt blind weiterzuspringen). Checkpoints merkt sich ein Bot auch im Sprung.
- Können 4 = Meister: Bremsen in der Luft für schmale Inseln (`candidates` Modus 2/3). Können 3 und 4 benutzen außerdem **einprogrammierte Wege** (`routes.generated.ts`): bildgenau per Strahlsuche berechnet für alle Stachelabschnitte der handgebauten Level 7 und 8 (je Checkpoint und Startplatz 0–4). Am Checkpoint wird der Bot auf die Startstelle des Wegs gesetzt (wenige Pixel) und spielt den Weg ab. Wege durch Abschnitte mit Türen/Brücken gelten nur, wenn kein Mensch im Level ist (alle Tore offen).
- Gemischte Bots (`botmix.ts`): `team_runs.bot_skill` = 1–4 (alle gleich, alte Lobbys) oder ab 10 `10 + n1 + 9·n2 + 81·n3 + 729·n4`. Lobby: je Stärke ein Plus/Minus, zusammen höchstens 8.
- `0051_master_bot.sql`: Prüfregel `bot_skill` 1–7000 und `team_set_bots` ohne die alte Obergrenze 3.
- Boden-Upgrades deutlich seltener (erstes ab Spalte ~36, danach etwa alle 70–100 Spalten).
- Testlauf (`bots.test.ts`, Level 1–14): Profi und Meister schaffen 13–14 von 14, in Level 7 und 8 mit allen Herzen.

## Update 60: Bots achten aufeinander, Meister klettert wieder
- Der haltende Bot wartet auf der Platte auch auf andere Bots, die noch vor dem Tor sind (bis 30 Kacheln dahinter, höchstens 40 s). Sind Menschen oder andere Bots im Level, gelten die Tore für die Bots; alle Tore offen nur, wenn der Bot allein ist (`allOpen`). Der letzte Haltende kommt nach der Wartezeit hinter das Tor.
- Meister: Bremsplanung nur noch, wenn gar kein normaler Sprung geht (vorher wartete er an der Säule von Level 7 auf einen „besseren“ Plan, lief gegen die Wand, ging zurück und sprang in die Stacheln).

## Update 61: Bots auf beiden Seiten, Effizient-Bot, Zuschauen mitten im Lauf, Tore für Zuschauer
- Stehen zwei Bots auf Platten desselben Kanals auf verschiedenen Seiten eines Tors, bleibt der vordere stehen und wartet, bis der hintere durch das offene Tor ist (`holdWanted`: ein Halter weiter vorn hat Vorrang).
- Neues Können 5 „Effizient“ (zwischen Profi und Meister): Profi-Planung, einprogrammierte Wege (`routes.generated.ts`) und einfache Bremspläne, Bremspläne nur jedes 2. Bild, keine feine Suche. Testlauf Level 1–14 in ca. 2 s (Meister rechnet ein Mehrfaches). `botmix.ts`: Mischung als laufende Nummer (`10 + Index` in `MIXES`, alle Aufstellungen mit höchstens 8 Bots), passt in die vorhandene Spalte, **kein neues SQL**. Alte Codes aus Update 59 (Basis-9-Zahl) sind ungültig, Lobbys halten aber nur Minuten.
- Admins können mitten im Lauf „👻 Zuschauen“ drücken (`watchApi` in `ParkourGame`): Geist ohne Senden (die anderen sehen sie als ausgeschieden und ausgeblendet), Flug durch Wände und Tore; „Zurück ins Spiel“ setzt am Anfang des aktuellen Levels neu an.
- Zuschauer (auch der Seiten-Zuschauer `?zuschauen=1`) kommen jetzt durch das Ziel in das nächste Level, durch den linken Rand in das vorige und haben Knöpfe „◀ Level“ / „Level ▶“.

## Update 62: Wettlauf im Team-Parkour (Bots oder anderes Team), Bots im Deathrun beim Erstellen
- SQL `0052_versus.sql` (wiederholbar): Spalten `versus` (0 normal, 1 gegen Bots, 2 Team gegen Team), `team_map` (Person → 0 rot / 1 blau), `team_results`; `team_set_bots` gilt auch für Team-Parkour, `team_set_versus`, `team_parkour_finish` meldet bei Versus 2 je Team; Bestenliste nur für `versus = 0`.
- Lobby (`TeamRunRoom`): „Gegner“ Keiner / Bots / Anderes Team; bei Team gegen Team Rot/Blau pro Person (Standard abwechselnd). Bot-Mix wie im Deathrun, bei Versus 1 als „Bot-Team“.
- `ParkourGame`: Gegner liegen in `rivals` (Team gegen Team) bzw. als Bot-Team (alle Bots im selben Level, gemeinsame Herzen `bgh`, im Ausgang „geparkt“ bis alle durch sind). Gegner sind sichtbar (roter/blauer Ring), aber ohne Wirkung auf Platten, Tore und Herzen. Wer keine Herzen mehr hat, scheidet aus; Urteil in `checkVerdict`: das weiter gekommene Team gewinnt (bleibt ein Team übrig, muss es die Ebene des anderen übertreffen). Ergebnis lokal in `pkrvs:<id>:<me>` und (Versus 2) serverseitig in `team_results`.
- Wer allein im Team ist, geht allein durch Ziel und Tore (`soloTeam`).
- Bots: tote/wartende Bots und tote Menschen zählen für die Bots weiter (sie „vergessen“ niemanden mehr); Checkpoints werden auch ±1 Spalte neben dem Fahnenmast im Sprung registriert.
- `LiveDuel`: beim Anlegen eines Deathruns können Bots (Mix) gleich gewählt werden (`teamSetBots` direkt nach `teamCreate`).

## Update 63: Doppelbrücken-Bots, Bot-Texturen, Bots in der Deathrun-Rangliste, Admin springt aus dem Zuschauen ins Spiel
- `bots.ts`: Laufende Bots zählen in der Vorausberechnung nicht mehr als „hält die Platte“ (`simOthers`: nur Menschen und stehende Bots); das war der Grund, warum Bots immer wieder in eine Brücke sprangen, die gleich wieder weg war.
- Gibt es keinen sicheren Sprung, wohl aber bei offenen Toren, wartet der Bot vor dem Tor (`gateWait`) statt hineinzuspringen; vor einer Tür/Brücke läuft er zur Platte.
- Staffel an Brücken und Türen: der hintere Bot wartet auf der Platte; der vordere stellt sich danach auf die Platte hinter dem Tor (`takeoverGate`, Modus `goto` mit `take`), bis der hintere durch ist. Der hintere hält so lange, bis der vordere dort steht (Zeitfenster 10 Kacheln, max. 8 s). `BotInfo.take` meldet das den anderen Bots. Wer in `goto` ist, geht weiter, wenn schon jemand anderes die Platte hält.
- Tests: `duoSim.ts` + `duo.test.ts` lassen mehrere Bots zusammen Level laufen (Doppelbrücke mit 2 und 3 Bots, Level 1–14).
- `ParkourGame`: Jede Bot-Stärke hat Farbe und Muster (Punkte, Streifen, Schrägstreifen, Gitter, Pfeile). Der Stand der Bots wird in `pkbots:<id>` gemerkt und in der Ergebnisliste des Deathruns mit einsortiert (`TeamRunRoom` → `Results`).
- Admin „Hier mitspielen“: aus dem Zuschauen geht es genau an der Stelle des Geists ins Spiel (liegt sie in einer Wand oder in Stacheln, an der nächsten freien Stelle), mit 1,5 s Schonfrist.

## Update 64: Zuschauer steigt ins Spiel ein, Decke, Turm ohne Falle, Bots klettern auf Türme
- Admin im reinen Zuschauer-Modus (`?zuschauen=1`) bekommt „Hier mitspielen“ wie beim Zuschauen mitten im Lauf: Einstieg an der Stelle des Geists, als Gast (seine Stürze kosten dem Team keine Herzen, `dc` wird mit 0 gesendet).
- `engine.ts`: oben im Level ist eine Decke (`solidAt` für `ty < 0`, Flug klemmt bei y ≥ 0): man kommt weder durch Sprung noch Jetpack noch Flug über den Bildrand (vorher ließ sich so über Türen hinweg fliegen). Gilt auch für die Bots.
- `levels.ts` `tower`: Lücken zwischen den Stufen sind bis zur niedrigeren Stufe gefüllt; wer oben herunterfällt, landet auf einer Stufe und steckt nicht mehr in einer zu hohen Grube fest (betrifft Level 5, 8 und alle erzeugten Türme).
- `bots.ts`: Ein Bot, der zu einer Platte oben auf einem Turm zurück will (`goto`), läuft erst zum Fuß der Treppe (`viaDone`) und klettert dann hinauf, statt von der falschen Seite vergeblich an der Wand zu springen; das Tor öffnet sich so für den Menschen, ohne dass der Bot „weitergesetzt“ werden muss.

## Update 65: Turm-Nische, Admin-Auftritt mit Schwarzem Loch
- `levels.ts` `tower`: die Lücken zwischen den Stufen sind wieder offen, unten liegen Stacheln (wer hineinfällt, startet am Checkpoint neu). Level 5: der Checkpoint hinter Turm b stand in der Nische zwischen Turm und Tür und sperrte zwei Spielende ein; er steht jetzt hinter der Tür (Spalte 63).
- `bots.ts`: Ein Bot in einer solchen Nische (Weg zur Turm-Platte, nach 8 s ohne Fortschritt) startet am Checkpoint neu (kein Herz), statt ewig an der Wand zu springen.
- `adminFx.ts` (neu): Admin-Figur als kleines Schwarzes Loch (Leuchten, Linsenbögen, Akkretionsscheibe hinten/vorn, Galaxie im Körper, Funkeln, leuchtender Name mit Sternen) und die Loch-Animationen `in`/`out`.
- `ParkourGame`: Admins werden so gezeichnet (auch von den anderen: Rolle `admin` in der Mitspielerliste bzw. `ad` im Zustand). Beim Einsteigen (zu Beginn, aus dem Zuschauen) öffnet sich ein Loch, der Admin fällt heraus (Nachricht `ev: 'in'`, alle sehen es). Beim Zuschauen öffnet sich ein Loch unter ihm, er fällt hinein und verschwindet mit ihm (`ev: 'out'`, 1,5 s gesperrt, dann Geist). Ein Gast-Admin (vorher nur Zuschauer) lädt Farbe, Hut, Effekt und Extra-Herzen aus dem Shop (`parkourShopGet`), sendet Name und Aussehen (`lk`) mit und erscheint mit seinem Namen statt „Du“.

## Update 66: Lernen im Parkour, weniger Coins
- Speedups (3er-Sprung, Jetpack) liegen nicht mehr auf dem Boden: Alle ca. 38 s erscheint am rechten Bildrand ein Angebot mit ablaufendem Balken (14 s). Tippen öffnet `LearnOverlay`: 1 Vokabel richtig beantworten, dann gilt der Speedup 20 s. Falsch oder abgelaufen = weg. Admins bekommen keine Angebote (sie fliegen/springen sowieso). `pickups.ts` bleibt nur noch für `PICKUP_INFO`.
- Zwischen den Leveln (Ausgang erreicht) müssen 2 Vokabeln richtig sein (falsche Antworten zeigen die Lösung, dann kommt eine neue Frage). Während einer offenen Frage steht die Figur still (`learnBusy`, Schritt wird übersprungen), die Verbindung läuft weiter.
- `parkourLearn.ts`: Pool = aktive Vokabeln (`getLearningPool(null, null)`); gibt es keine, Einträge von bis zu 3 öffentlichen Büchern (`listPublicBooks` + `getBookEntries`). Ist gar nichts erreichbar, wird nicht gefragt (blockiert nie). Fragen über `makeQuestion`, Antwortprüfung `isAnswerCorrect`.
- Admin-Schalter: Tabelle `parkour_learn_off`, RPCs `parkour_learn_off_list(uuid[])` (alle angemeldeten Personen) und `parkour_learn_set(user, off)` (nur Admin). In der Lobby (Parkour und Deathrun) zeigt `LearnToggles` Admins An/Aus je Person, auch für sich selbst. Das Spiel liest beim Start das eigene Flag.
- SQL `0053_parkour_learn.sql` (wiederholbar): Tabelle und RPCs wie oben; Coins gesenkt (Level 5, Checkpoint 1, Bonus 20, Endlos 3, nur wenn die Werte aktuell höher sind).

## Update 67: Bots – Turm-Lücke, Fahnen, Warten auf Menschen
- `bots.ts` Turm-Lücke: Ein Bot oben auf einem Turm springt nicht mehr in die Lücke zwischen Turm und Tür, solange niemand sonst die Platte hält (`ledgeT`, wartet bis zu 45 s; steht er auf der Platte, hält er sie offen). Dort kam man mit geschlossener Tür nicht mehr heraus. Außerdem zielte `goto` hinter der Tür fälschlich auf den Fuß der Turmtreppe (`via`), obwohl die nächste Platte der Pfeiler war; `via` gilt jetzt nur, wenn die nächste infrage kommende Platte selbst oben auf dem Turm liegt.
- Fahnen: `finishStep` zählt jede Fahne, die seit dem letzten Schritt überquert wurde (`px`), auch bei hohen Sprüngen darüber.
- `ParkourGame`: Bots bleiben am Start des nächsten Levels stehen, bis der erste Mensch (er lernt zwischen den Leveln noch) dort angekommen ist (`humanMax`); der Bot-Team-Wechsel (Versus mit Bots) wartet ebenso.
- Tests in `duo.test.ts`: Turm-Lücke (kein Bot im Loch bei weit entferntem Menschen) und Fahnen (nach dem Level ist die letzte Fahne gemerkt).

## Update 68: Mods mit Zuschauer-Recht und Hammer, nur aktive Läufe, Herzen-Bug, Jetpack, Verben-Coins
- SQL `0054_mod_spectate_irregular.sql` (wiederholbar): `staff_rights.spectate` (Mod darf Läufe ansehen und als Gast einsteigen) und `staff_rights.look` (`none`/`hammer`); `can_spectate()` (Admin oder Mod mit Recht), `_staff_look(uid)` (`blackhole` für Admins, `hammer` für Mods mit Hammer), `my_run_perks()`; `admin_get/set_staff_rights` kennen die neuen Felder (Verwaltung → Mod-Einzelrechte: „Parkour: Zuschauen und Auftritt“); `team_spectate`/`admin_open_runs` prüfen `can_spectate()`; `team_get.people[].pk_look`.
- Nur wirklich aktive Läufe in der Übersicht: `_team_get` schreibt den Herzschlag (`updated_at`) für Mitspielende alle 20 s (auch in der Lobby), nie für Zuschauer; `admin_open_runs` zeigt nur Läufe mit Herzschlag der letzten 3 Minuten (vorher 30/40 Minuten, und Zuschauer hielten leere Läufe am Leben).
- `features/parkour/perks.ts` (`useRunPerks`): Zuschauer-Recht und Auftritt für die Seiten (`Parkour` Link, `AdminRuns`) und das Spiel (`ParkourGame` wartet auf die Antwort, dann `ParkourGameInner`). Admin-Kräfte (Flug, Geist, 4 Sprünge, keine Angebote) bleiben nur für Admins; Mods mit Recht bekommen nur „Zuschauen“ und „Hier mitspielen“.
- `modFx.ts`: Hammer-Auftritt der Mods (Hammer fällt, großer Blitz mit Flackern, Druckwelle, Funken, dann erscheint die Figur; beim Verlassen trifft der Hammer die Figur). Figur: Stahl mit goldenem Rand, Blitz-Zeichen, kleinem Hammer, ⚡-Name. Andere sehen es über `hm` im Zustand bzw. `pk_look`; `appearT`/`appearAt` verstecken die Figur bis zum Einschlag. Admins behalten das Schwarze Loch (`adminFx.ts`).
- Herzen-Bug: Shop-Herzen eines Gasts (Zuschauer, der einsteigt) gibt es nur beim ersten Einstieg (`guestHeartsGiven`); Hin- und Herwechseln füllt weder die Herzen auf noch erhöht es den Vorrat.
- Jetpack wieder wie am Anfang: 12 s Dauer, Sprungknopf in der Luft halten = Schub (`engine` `jet`), insgesamt 3,5 s Treibstoff (`JET_FUEL`); kein Flugmodus und kein „Runter“-Knopf mehr.
- Unregelmäßige Verben: `submit_irregular(correct, total)` zahlt 1 Coin je `irregular_coin_every` (5) richtige Antworten, höchstens `irregular_coin_cap` (15) pro Tag (Grund `irregular`); `ChoiceResult` (`irregular`) ruft es zusätzlich zu `submit_choice` auf; Werte in Verwaltung → Zahlen und unter der Seite (nur Admins).

## Update 69: Auftritte (Schwarzes Loch, Hammer, Klavier) und Zuschauer-Geister

- Migration `0055_entrances.sql`: `staff_rights.looks text[]` (vom Admin freigegebene Auftritte `hammer`/`piano`), `parkour_profiles.entrance` (`blackhole|hammer|piano|none`), `_allowed_looks`, `_staff_look`, `my_run_perks()` liefert `{spectate, look, allowed, entrance}`, `parkour_set_entrance(p_look)`. Admins dürfen alle drei, Mods nur freigegebene (Admin-Tab „Mod-Rechte“: Checkboxen Hammer/Klavier, `p_looks`).
- `lookTypes.ts` (`Look`, `HoleAnim`), `lookFx.ts` (`LOOKS`-Tabelle: Dauer, Erscheinzeitpunkt, `anim/back/body/label` je Look), `adminFx.ts` (Schwarzes Loch weit oben, Rakete rast herab und explodiert; Abgang mit Sog, Spaghettisierung und Kollaps), `modFx.ts` (Hammer), `pianoFx.ts` (Klavier fällt und zerbricht in Trümmer; beim Gehen wird die Figur zum Klavier mit Flügeln und fliegt davon).
- `ParkourGame`: alles über `LOOKS[look]`; Nutzdaten tragen `kd: Look` statt `ad/hm`; `appearT` gilt für alle Looks.
- Zuschauer sehen sich: eigener Broadcast-Event `g` (Position, Level, Name; 110 ms bewegt, 450 ms still). Nur Zuschauende zeichnen die Geister (halbtransparent, „👻 Name“); Spielende ignorieren das Event, Spielzustand wird nie berührt.
- Shop (`Parkour.tsx`): Abschnitt „Auftritt“ mit Live-Vorschau (`EntrancePreview`) für alle erlaubten Looks, Auswahl über `parkourSetEntrance`.

## Update 70: Bots für alle, Bots in Teams, Parkour-Shop im Shop, Seilbahn

- Migration `0056_bot_teams.sql`: `_can_set_bots` (Mods/Admins, Host einer privaten Lobby, im offenen Deathrun jede Person der Lobby, solange kein Mod/Admin drin ist; `_team_get.can_manage` nutzt das), `team_set_bots(p_id, p_bots, p_skill, p_map)` (Bots und Teamkarte in einem Schritt), `team_set_versus` behält Bots bei „Team gegen Team“. Bots stehen in `team_map` unter `b0`…`b7` (0 rot, 1 blau).
- Team-Lobby (`TeamRunRoom`): bei „Anderes Team“ zwei Spalten, Blau links, Rot rechts, Pfeil je Person und Bot, Bots einzeln („Name · Können · Bot“), „+ Bot“ je Team (`BotAdder`). `botmix.ts`: `lobbyBots`, `rebuildBots` (Bots werden nach Können sortiert, Teams bleiben erhalten).
- `ParkourGame`: `botTeam(i)`, je Team steuert ein Rechner die Bots (`isMasterFor`, `syncBots`); Bots halten nur Platten für ihr eigenes Team (`botPts`), Bots des anderen Teams zählen im Wettlauf-Urteil und in der Anzeige (`checkVerdict`). Zuschauer-Geister können Bots (`bot<i>`) und eingestiegene Ex-Zuschauer verfolgen (`targets`).
- Parkour-Shop: `features/parkour/ParkourShopPanel.tsx`, erreichbar als Reiter „Parkour“ im Shop (`/shop?tab=parkour`); die Parkour-Seite verlinkt dorthin.
- Design „Berge“ (`components/ui/Mountains.tsx`): Seilbahn mit Stationen, Stützen, zwei Seilen und je drei Gondeln auf dem Weg hinauf und hinunter (`drawCableCar`).

## Update 71
- Lobby (`TeamRunRoom.tsx`): `versus` und `team_map` gehören in den Vergleichsschlüssel des Pollings, damit Teamwechsel (Pfeile) ohne Neuladen erscheinen.
- Sprungpad: Zeichen `J` (`Builder.pad`), `engine.ts` (`PAD_V`, `onPad`, `Body.pad`), Zeichnung in `ParkourGame.tsx`. Generator: Stücke `pad` (Mauer) und `padchain` (Plattform mit Platte); jedes zufällige Level hat mindestens ein Pad. Handgebaute Level 1–8 unverändert. Test: `pad.test.ts`. Keine SQL.
- Update 72 (Pads schwerer): `Builder.sky` (Höhen-Jump&Run: Plattformreihe ab dem Pad, `pit` = Stacheln darunter). Level 1–6 haben jetzt Pads mit steigender Schwierigkeit (Mauer, Stachelmauer, Plattformreihe ohne/mit Stacheln, zwei Stachelmauern hintereinander; die Pad-Plattform mit Tür gibt es nur im Zufallsgenerator, weil zwei Bots daran in Level 5 hängen blieben); Level 7/8 unverändert (feste Bot-Wege). Generator: Stücke `sky`, mehr/breitere Stachelfelder, mehr/weiter auseinanderliegende Plattformen, bis zu 30 Abschnitte, keine Deckelung der Schwierigkeit bei den „Einser-Blöcken“. Welt bleibt 12 Kacheln hoch (Pad reicht bis knapp unter die Decke).

## Update 74
- Versionsanzeige: `src/version.ts` (`APP_UPDATE`, bei jedem Update-Zip um 1 erhöhen), `components/ui/VersionTag.tsx`; steht unten in `AppShell` und fest unten auf den Anmelde-Seiten.
- Welt nach oben: `Level.up` (Zeilen über Zeile 0, `tileAt(lv, x, y)`), Level mit `up` haben keine Decke mehr. Kamera: `camY` in `ParkourGame` folgt in solchen Leveln senkrecht (Spieler in der Mitte, unten am Boden angeschlagen). Netzwerk-y-Grenze von −800 auf −100000.
- Pad-Turm: `Builder.padTower(x, n, w, gap, pit)`: Pad → Etappe 1 nach rechts (Zeile 3) → Pad → Etappe 2 nach links (5 Zeilen höher) → Pad → Etappe 3 nach rechts → hohe Mauer. Ohne Pads unüberwindbar (Test `tower.test.ts`). Level 3, 4, 6 haben je einen (n = 1, 2, 3), Generator-Stück `sky` (wächst mit der Schwierigkeit).
- Doppelfahne `Builder.cp2` vor jedem Turm. Bots: `Level.skips` (Bots warten vor dem Turm und stehen danach hinter der Mauer, `botStep`).
- Generator: Plattformen steigen höchstens eine Zeile je Schritt (sonst nicht mehr machbar), Lücken wachsen bis 5 ab Schwierigkeit 12. `reach.test.ts` verfolgt zusätzlich die höchsten Zustände.
- Update 76: Pads über dem Bildrand wurden nicht erkannt (`onPad` nutzt jetzt `tileAt`); Etappen des Pad-Turms 6 Zeilen auseinander (Pads sind Pflicht, Test „jedes Pad ist nötig“). Tests schneller: `reachable` liegt in `reach.ts` (vorher lief `reach.test.ts` durch den Import in drei Dateien mehrfach), weniger und kleinere Suchläufe, Plattformlücken höchstens 4.
- Update 77: Bots springen den Pad-Turm hinauf (`Level.skips[].path`: Wegpunkte, Bogen je Stück, `botStep`) statt davor zu warten. Generator: keine dritte Fahne vor einem Turm (vorige Fahne weicht der Doppelfahne).
- Update 77 (Auftritte): neuer Auftritt „Gitarre“ (`guitarFx.ts`, Look `guitar`; Scheinwerfer, Gitarre stürzt und bleibt stecken, Klangwellen; Gehen: Gitarren-Windmühle und nach oben davonrocken). SQL: Migration `0057_look_guitar.sql` (Constraint, `_allowed_looks`, `admin_set_staff_rights`). Schwarzes Loch: `HoleAnim.top` (Oberkante des Bildes, wird in `ParkourGame` je Frame gesetzt), das Loch hängt in hohen Ebenen über der Figur; Explosion mit echtem Rauch (`explosionSmoke`, `BH_IN` 3,8 s), dichtere Rauchspur der Rakete. Test `lookFx.test.ts` zeichnet alle Auftritte in/out auch bei y = −900.

- Update 77 (Ergänzung): Vokabelfragen im Parkour pro Person ausschaltbar: Verwaltung → Benutzer → Person → Verwalten → Tab „Parkour“ (`parkourLearnSet`). `ParkourGame` liest den Schalter alle 15 s und beim Tab-Wechsel neu (Fehler behalten den letzten Stand).

- Update 78: Realtime-Nachrichten gesenkt (Supabase-Free-Kontingent 2,2 Mio./Monat war überschritten): Sendeabstand Position 90–130 ms (vorher 50–100), Ruhe-Heartbeat 600 ms, Zuschauer 200 ms, Bots 170 ms; Nachzieh-Glättung der Figuren etwas weicher. Ein Umbau auf PeerJS (WebRTC) wurde erwogen, aber wegen Schulnetzen/TURN nicht gemacht.

- Update 79: (1) Mehr Sprünge pro Person: Tabelle `parkour_jumps`, RPCs `parkour_jumps_list/set` (Migration 0058), Verwaltung → Person → Verwalten → Parkour; `ParkourGame` nimmt `max(Standard, Sprünge-1)` Luftsprünge und liest den Wert alle 15 s. (2) Tageslimit für Realtime-Nachrichten: Spielende zählen gesendete + empfangene Broadcasts (so zählt Supabase) und melden sie alle 15 s per `parkour_usage_add` (Tabelle `parkour_usage`, Tag nach Berliner Zeit). Einstellung `parkour_msg_limit_k` (Tausend/Tag, Standard 60, 0 = aus) unter Verwaltung → Regeln. Ist es erreicht, trennt `ParkourGame` den Kanal und zeigt eine Sperre bis Mitternacht. Fehler beim Melden sperren nicht (fail-open). Grenze: Sperre nur clientseitig, Starten in der Lobby ist nicht serverseitig blockiert.

- Update 80: Parkour-Echtzeit läuft über ein zweites Supabase-Projekt (`src/lib/gameRealtime.ts`, nur Broadcast, keine Anmeldung/Tabellen; URL/Key per `VITE_GAME_SUPABASE_URL` / `VITE_GAME_SUPABASE_PUBLISHABLE_KEY` überschreibbar). Zählung und Sperre bleiben in der Haupt-DB: Migration 0059 macht aus dem Tageslimit ein Monatsbudget (`parkour_msg_month_k`, Standard 1800) mit Tagesrahmen = 4 × Schnitt der verbleibenden Tage. Free-Plan-Grenzen des Zweitprojekts: 200 gleichzeitige Verbindungen, ca. 100 Nachrichten/s.

- Update 81: (1) Seite „Auswendig“ (`/auswendig`, `pages/Memorize.tsx`, Logik in `features/memorize/`): Pi (500 Stellen, Lernen + Abfrage mit Tipp, Bestwert im Browser), Hochzahlen (4 Stufen, auch „Welche Hochzahl?“), Flaggen (Bilder von flagcdn.com, 5 Weltgegenden, beide Richtungen). Keine Server-Belohnung. (2) Hausaufgaben (`/hausaufgaben`): Tabellen `homework`, `homework_done`, RPCs `homework_*` (Migration 0060); Mods/Admins tragen ein, jede Person hakt für sich ab. (3) Websites (`/websites`): Tabelle `site_links`, RPCs `site_link*` (nur Admins pflegen), Vorschau = optionales Bild oder verkleinerter iframe (sandbox). Service: `services/tasks.ts`.

- Update 82: Zuschauer → ins Spiel wechseln: `safeLanding` (engine.ts) setzt die Figur senkrecht auf sicheren festen Boden unter dem Geist (ohne Stacheln auf dem Weg, sonst Nachbarspalten, sonst Checkpoint); Schonfrist danach 2,5 s statt 1,5 s. Vorher erschien die Figur dort, wo der Geist schwebte, und fiel in Stacheln/Löcher.

- Update 83: (1) Freischaltung: `profiles.approved` (Migration 0061), Einstellung `signup_approval` (Standard 1), neue Selbst-Registrierungen warten, `is_blocked()` zählt „nicht freigeschaltet“ mit; `RequireAuth` zeigt Warte-Bildschirm (prüft alle 15 s neu); Verwaltung → Benutzer: Filter „Wartet“, Zeichen, Knopf „Aktivieren“ (`admin_set_approved`). Von Admins angelegte Konten sind sofort frei. Die Bestätigungs-E-Mail wird im Supabase-Dashboard abgeschaltet (Auth → Email → Confirm email). (2) Parkour nach Limit: Schleife und Tasten stehen still. (3) Mods/Admins: Knopf „♥ Heilen“ im Spiel füllt die Herzen des Teams (Zähler `hl` im Zustands-Paket). (4) Ranglisten Pi (Stellen ohne Tipp) und Flaggen (gemeisterte Länder), Tabelle `memo_scores` (0062). (5) Flaggen-Karteikasten (`flagLearn.ts`): Fächer 0–5, Auswahl bis Fach 1, ab Fach 2 Eintippen mit Toleranz (Umlaute, Alternativnamen, kleine Tippfehler), Stand im Browser. (6) Chat (0063): `@everyone` markiert alle, `!pay @everyone N` und `!pay @random N`; Admins erzeugen die Coins, andere zahlen vom Guthaben; `#Menüpunkt` und `#Websites/Name` sind Links (`lib/chatLinks.ts`).

- Update 84: Fix `admin_list_users` in 0061 (`koins bigint`, sonst „structure of query does not match function result type“, weil 0017 die Spalte auf bigint gestellt hat; 0061 neu ausführen). Ranglisten Pi und Flaggen stehen unter Rangliste (Reiter „Pi“, „Flaggen“, `pages/MemoBoard.tsx`), nicht mehr in „Auswendig“.


## Update 85
- **Pad-Türme (Parkour)**: `padTower(..., floors)` baut 1–9 Etagen (gerade Zahlen beginnen nach links, die letzte Etappe geht immer nach rechts). Der Generator zieht die Höhe gewichtet mit `towerFloors(u)` (3: 26 %, 4: 22 %, 5: 17 %, 6: 13 %, 7: 10 %, 8: 7 %, 9: 5 %). Tests in `tower.test.ts`, `generator.test.ts`.
- **Pi/Flaggen-Belohnungen (0064)**: `memo_score_submit` liefert jsonb `{best, coins, points}`. Nur bei neuem Bestwert: Pi 3 Coins je Stelle + 1 Punkt je 5 Stellen, Flaggen 10 Coins je gemeistertem Land + 1 Punkt je 2 (Punkte über `points_adjustments`). Anzeige per `RewardReveal`.
- **RewardReveal** (`components/ui/RewardReveal.tsx`): Vollbild-Animation (Geschenk oder sofort offen) für Coins, Punkte, Plus-Tage und Artikel (Vorschau über `components/shop/ItemPreview.tsx`). Genutzt im Shop nach dem Kauf, bei Pi/Flaggen und im Adventskalender.
- **Chat `#`-Vorschläge**: `tagSuggestions()` in `lib/chatLinks.ts`; nach `Websites/` kommen die Seitennamen (`siteLinksList`). Tab übernimmt den ersten Vorschlag.
- **Adventskalender (0065)**: Tabelle `advent_opened`, Plan in `_advent_plan(day)`, RPCs `advent_status`, `advent_open(day)`. Nur das Türchen des Tages (Berlin-Datum, 1.–24. Dezember) lässt sich öffnen; Test über Einstellung `advent_force_day` (Verwaltung → Zahlen). Doppelte Artikel geben den halben Preis als Coins. Türchen-Reihenfolge pro Jahr gemischt (`features/advent/doors.ts`). Seite `/advent`.
- **Wiederbeleben (Parkour)**: Mods mit Zuschauer-Recht sehen nach „Keine Herzen mehr“ den Knopf „Wiederbeleben“ (nur Team-Parkour, nicht Deathrun/Versus). Sendet `rv`-Zähler, alle im Team bekommen volle Herzen und sind wieder im Spiel (`reviveSelf`).


## Update 86
- **`#Menü/Unterpunkt` für alle Reiter-Seiten**: `lib/subTabs.ts` (`SUB_TABS`, `matchSubTab`) listet die Reiter von Rangliste, Auswendig, Gambling, Shop, Einstellungen, Verwaltung. Der Chat-Link wird `/<seite>?t=<id>`, die Seiten lesen `?t=` beim Start. `tagSuggestions` schlägt die Reiter nach `Rangliste/` vor.
- **Gambling-Bank (0066)**: `gambling_bank()` (Summe aus `gambling_stats`: Bank = gesetzt − gewonnen, Schnitt pro Spiel, Auszahlungsquote), `admin_gambling_reset(p_user)` (null = alle). Anzeige und Zurücksetzen in `GamblingBoard.tsx` (Reset nur Admin).
- **Flaggen-Rangliste**: Wert sind jetzt Lernpunkte (`lernpunkte(cards)` = Summe der Fächer, Höchstwert 1500 im Server), damit man sofort auf die Rangliste kommt; Belohnung 2 Coins je Lernpunkt, 1 Punkt je 10 (in 0064). Karteikasten-Ansicht vereinfacht (ein Startknopf, Kennzahlen, „Beenden“-Knopf sendet den Stand).


## Update 87
- **Adventskalender zufällig pro Person**: `_advent_plan(day)` ist jetzt volatil und würfelt bei jedem Öffnen (Coins 38 %, Punkte 20 %, Plus 15 %, sonst Artikel bis Preisgrenze 100 + 60·Tag, nicht schon besessen; Tür 24 immer Artikel + 7 Tage Plus + ~1000 Coins). 0065 ist wiederholbar und muss neu ausgeführt werden.
- **Belohnungs-Popup überall**: `components/ui/RewardPopup.tsx` (nutzt `RewardReveal`) nach Lernen, Test/Üben (`ChoiceResult`), Mathe, Sprint, Spiele-Rekord und Team-Lauf.
- **Impressum und Datenschutz**: öffentliche Seiten `/impressum`, `/datenschutz` (`pages/legal/`), Links in der Anmeldeseite (`AuthLayout`) und in der Seitenleiste. Die Angaben stehen in `public/rechtliches.txt` (`lib/legalInfo.ts` liest sie, leere Felder werden rot markiert). Texte sind Entwürfe.
- **Schriften lokal**: Inter und JetBrains Mono liegen als woff2 in `src/fonts/` (`fonts.css`, in `main.tsx` importiert). Kein Google-Fonts-Aufruf mehr (Datenschutz). Keine neue npm-Abhängigkeit.
- **Pi/Flaggen-Belohnung einstellbar (0064)**: Settings `memo_pi_coins_per_10` (10), `memo_pi_points_per_10` (2), `memo_flags_coins_per_10` (2), `memo_flags_points_per_100` (5), in Verwaltung → Zahlen. Ersetzt die festen Werte aus Update 85/86. Flaggen: Standard jetzt 1 Coin je 5 Lernpunkte.
- **Zwei Spiel-Datenbanken (0067)**: `lib/gameRealtime.ts` hält zwei Supabase-Clients (nur Realtime). `_parkour_usage_state` liefert `slot` (0 solange der Monatsverbrauch unter `parkour_msg_month_k`·1000 liegt, danach 1) und rechnet Budget und Tageslimit mit `parkour_projects` (Standard 2) Datenbanken. Der Client wechselt bei jeder Meldung (alle 15 s) über `setGameSlot` und baut den Kanal neu auf (`netApi.reconnect`). Beide voll: Parkour bis Monatsende gesperrt. Env-Variablen `VITE_GAME2_SUPABASE_URL` / `_PUBLISHABLE_KEY`.

## Update 89
- **Weniger Anfragen (Supabase „Log Ingestion“, Free 1 GB/Monat; im November nach 5 Tagen schon 35 %)**: Abfrage-Abstände vergrößert: Hinweise 8→30 s, Team-Nachrichten 7→20 s, Online-Meldung 30→45 s und Nachrichten 7→20 s, Chat-Zähler 20→45 s, Chat-Seite 4→10 s (neue Beiträge kommen zusätzlich sofort per Realtime), Wallet 45→90 s (Realtime liefert Änderungen sofort), Einladungen 5→15 s. Alle Abfragen laufen nur bei sichtbarem Tab. Ungefähr 35 → 12 Anfragen pro aktiver Person und Minute.
- **Spiel-Datenbanken in der Verwaltung (0068)**: Tabelle `game_dbs` (Name, URL, Publishable Key, Reihenfolge, aktiv; RLS an, nur über RPCs). `parkour_game_dbs()` liefert die aktive Liste ans Spiel (`whenGameDbsReady` in `lib/gameRealtime.ts`, alle 5 min neu, eingebaute Werte als Fallback), `admin_game_db_*` zum Pflegen (Verwaltung → Regeln & Wirtschaft → Spiel-Datenbanken, `GameDbsTab`). Geheime Schlüssel werden abgelehnt. `_parkour_usage_state` nimmt die Zahl der aktiven Einträge statt `parkour_projects`.

## Update 91
- **Alle Menüpunkte sperrbar (0069)**: `_lock_keys()` ist die eine Liste der Sperr-Schlüssel (32). Neue Schlüssel stehen in `LockKey` (services/koins.ts), `navigation.ts` (`lock:`), `App.tsx` (`<Gate k=…>`) und `LocksTab.tsx` (Beschriftung). Duelle gesperrt ⇒ Parkour mit gesperrt (`LocksProvider`). Lern-Seiten werden nur in Menü und Seite gesperrt (kein Server-Guard).
- **Heilen/Wiederbeleben nur mit Recht `heal` (0069)**: `staff_rights.heal`, `can_heal()`, `my_run_perks().heal`, `admin_set_staff_heal`. Im Spiel `perks.heal`. Admins dürfen immer.
- **Panik im Parkour**: `PANIC_PATHS` enthält /parkour, /deathrun, /team/. Esc löst dort keine Panik aus (nur der Knopf). `parkour` ist in `PANIC_KEYS`.
- **Verwaltung**: „Einzelne Mods“ ist in die Personen-Ansicht (Benutzer → Person → Reiter „Mod-Rechte“) gewandert (`StaffEditor` aus `StaffRightsTab.tsx`). Die Personen-Ansicht hat Reiter Überblick / Coins & Plus / Mod-Rechte / Rolle & Konto. Zahlen-Tab hat Hauptbereiche (`CATEGORIES` in `ruleDefs.ts`) und Suche; „Coins & Belohnungen“ ist in sechs Abschnitte geteilt.
- **Adventskalender komplett einstellbar (0070)**: Gewichte, Mengen, Preisgrenzen und Türchen 24 sind Einstellungen `advent_*`.


## Update 92
- Liga (0071): Auf-/Abstieg einstellbar (`league_promote`, `league_relegate`, `league_relegate_min_group`, `league_rows_max`), `_league_rollover`/`get_league` neu, Wochenpunkte nur einmal je Person berechnet, Liste begrenzt; `get_league` liefert `my_rank`, `promote_points`, `relegate_points` → Hinweis „Noch X Punkte“ in `LeagueView`.
- Pi-Schummelschutz (0072): `memo_pi_start()` startet Versuch serverseitig, `memo_score_submit` prüft Zeit (`memo_pi_min_ms` je Stelle, `memo_pi_max_minutes`), sonst `rejected`; Client bricht Versuch bei Fenster-/Tab-Wechsel ab. `admin_memo_delete(game,user)` + Löschen-Buttons in `MemoBoard`.

## Update 93
- Aufräumen: ungenutzte Funktionen entfernt (`loadDisplayName`, `adminPushOverview`/`PushOverview`, `countOpenReviews`, `plusRequest`, `plusCancelRequest`, `plusBuyDay`, `resetLearnPool`, `getSkipAnim`, `tesseractEngine`, `gapCount`, `gameSlots`). Kein SQL nötig.
- Foto-Scan (alles lokal im Browser, nichts wird hochgeladen): neuer Leser für Camden Town (`features/ocr/layoutEn.ts`: Lautschrift /…/, Zahlenkästchen, Fließtext/Kästen werden über Spaltenabstand, Einrückung und Ausrichtung der deutschen Spalte ausgelassen, Spaltenränder als schräge Geraden angepasst). `parse.ts`: Neigungsausgleich (`estimateSlope`), Erkennung von Doppelseiten (`splitSpread`), wählt Leser je Sprache (Französisch bleibt `parsePage`, jetzt mit Ausrichtungsprüfung gegen Kasten-Fließtext). Jede Zeile trägt `boxes` (Wörter auf dem Foto); `ScanOverlay.tsx` zeigt das Foto mit Markierung (rot = Wort, blau = Übersetzung, Zeilennummern, Tippen springt zur Zeile, Zoom). Test-Fixture `fixtures/camden-town-204.json`.

## Update 94
- **Pro-Stufe** (Migration `0073_pro.sql`): über Plus, 800 Koins/Tag (längere Laufzeit günstiger pro Tag), alle Plus-Funktionen, Foto-Scan, bessere Wahrscheinlichkeiten, Parkour-Zuschauen, mehr Koins (auch Glücksspiel), begrenztes Heilen, mehr/höhere Quests, bessere Advent-Ziehungen, höhere Parkour-Limits, Skins, +3 Herzen, 3 feste Sprünge (4 mit Dreiersprung), kein Vokabellernen im Parkour. Werte in Verwaltung → Plus (`plus_settings`). Client: `services/plus.ts`, `features/plus/*`, `PlusProvider` (`pro`, `ocrAllowed`).
- **Pi-Anti-Cheat**: Mindestzeit pro Zahl Standard 200 ms (war 450); zusätzliche Abbruch-Auslöser (Größenänderung, Fokusverlust, pagehide). Teilweises Hochwischen am iPad ist nur bestmöglich erkennbar.
- **Foto-Scan**: Seitenzahl per Ziffern-OCR im Streifen unter dem Text (`recognizeNumber`); **Genau-Modus** (höhere Auflösung + zweiter SPARSE-Durchgang, `mergeWords`); **Bereich nochmal prüfen** (`rescanRegion`, Rechteck im Overlay aufziehen, Zeilen im Bereich werden ersetzt). Nur für Pro.

## Update 95
- **Verwaltung**: Menüpunkt „Plus & Pro"; Pro-Preise und alle Pro-Werte unter Preise & Verdienst (Gruppen „Pro: …").
- **Loot Drop** (`0074_lootdrop.sql`, `pages/Loot.tsx`, Sperr-Schlüssel `loot`): tägliches Paket für alle (`loot_global`, Primärschlüssel `day` → nur die schnellste Person, `on conflict do nothing`) und persönliches Paket (`loot_personal`). Inhalt über `_loot_roll` (Coins/Punkte/Artikel, Gewichte `loot_p_*`/`loot_g_*` in Verwaltung → Zahlen → Loot Drop; Pro × `pro_advent_mult`). Animation `RewardReveal`. Tag = Berliner Datum.
- **Admin auf der Loot-Seite**: Coins an N zufällige Personen (`admin_loot_gift`, Tabelle `loot_gifts`, Empfänger sehen beim nächsten Besuch eine Auspack-Meldung), Adventskalender neu starten (`admin_advent_reset`, nur eigener oder alle; erhaltene Belohnungen bleiben), Loot Drop heute zurücksetzen (`admin_loot_reset`).
- **Foto-Scan pro Person** (`0075_ocr_grant.sql`): `profiles.ocr_granted`, in `_ocr_allowed` berücksichtigt; Admin schaltet im Personen-Fenster (PlusSection) frei oder entzieht (`admin_set_ocr`/`admin_get_ocr`). Admins haben den Scan ohnehin.

## Update 97
- **Fix Adventskalender** (`0076_advent_fix.sql`): In 0073 hat `replace(pg_get_functiondef(..), 'function public._advent_plan(' …)` wegen Großschreibung (`FUNCTION`) nichts ersetzt → `_advent_plan_base` fehlte → Fehler 42883 („Datenbankfunktion fehlt") beim Öffnen. 0073 nutzt jetzt `regexp_replace(..., 'i')`; 0076 legt die Basisfunktion (Logik 0070) direkt an. Lehre: bei `pg_get_functiondef` immer case-insensitiv ersetzen.
- **Aktivität** (`0077_activity_feed.sql`): `plus_recent_buys` → „Zuletzt gekauft" auf der Plus-&-Pro-Seite (`BuyTicker`, Sprüche in `buyJokes.ts`, deterministisch je Kauf-ID); `admin_league_move`/`admin_league_tier` → `LeagueSection` im Personen-Fenster; `watch_progress` (ein Aufruf: abholbare Quests + Wochenrang mit Nachbarn) → `features/progress/ProgressWatcher` im AppShell (alle 75 s bei sichtbarem Tab, bei Seitenwechsel, min. 20 s Abstand): Quest-Banner mit „Abholen" und Überhol-Animation (`overtakes.ts`, getestet).
- **Loot Drop**: `components/ui/LootBox.tsx` (SVG-Paket, Schweben → Schütteln → Deckel fliegt weg → Strahlen), Server-Antwort wird parallel zur 2-s-Animation geholt.

## Update 98
- **Punkte-Multiplikator beim Verdienen** (`0078_points_snapshot.sql`): Bisher wurde `_plus_points_factor` beim Anzeigen auf alle Punkte angewendet (Kauf verdoppelte rückwirkend, Ablauf nahm Punkte weg). Jetzt Trigger `daily_bonus` auf `daily_stats`: Bonus = Zuwachs der Basispunkte × (Faktor − 1) wird in `bonus_pts` festgehalten; `_week_points` und `get_leaderboard` summieren Basis + `bonus_pts`. Alte Tage: Bonus 0.

## Update 99
- **Admin: Parkour-Rekorde löschen** (`admin_parkour_delete`): in `ParkourBoard` je Eintrag „löschen" und „alle löschen" (Deathrun: `deathrun_results`; Team: `team_runs.levels = null`, so verschwinden sie aus der Liste).
- **Online-Spiele** (`0079_online_games.sql`, Menüpunkt „Online-Spiele" zwischen Spiele und Parkour, Route `/mehrspieler`, Sperr-Schlüssel `online`): Schnick Schnack Schnuck, Mensch ärgere dich nicht (2–4), Schiffe versenken. Tabellen `og_games` (Zustand `state` jsonb, `version`, `turn_seat`) und `og_players` (Platz, `secret` = geheime Auswahl/Schiffe). **Alle Regeln auf dem Server**: Würfel (`og_ludo_roll`), Zugregeln (`_ludo_legal/_ludo_move`), Treffer/Versenkt (`og_ships_shoot`), Gewinner. Geheimes sieht nur die Person selbst (`_og_view`). Die SQL-Regeln wurden lokal gegen PostgreSQL 16 getestet (90 Zufalls-Partien Ludo mit 2–4 Personen, Schiffe, Schnick, Aufgeben).
- **Echtzeit über die Spiel-Datenbanken** (`features/online/useGameSync.ts`): nach jedem Zug sendet der Client einen Broadcast-Zuruf `og-<id>` über `gameRealtime()` (fremde Projekte, kein Kontingent der Haupt-Datenbank); der andere holt dann `og_get`. Zusätzlich Abfrage alle 8 s (20 s wenn man selbst dran ist) als Netz. Einladungen kommen über `watch_progress` (`invites`) als Banner. Kein Gewinn-/Coin-System.
- UI: `LudoBoard` (SVG, Brett in `ludoBoard.ts`), `ShipsBoard` (`ships.ts`), `RpsBoard`; Tests `online.test.ts`, `boards.test.tsx`.
- **Quest-Banner-Fix** (`0080_quest_banner_fix.sql`): `watch_progress` meldete auch Plus-/Pro-Quests, die man ohne Plus/Pro nicht abholen darf → Banner kam immer wieder (Abholen scheiterte, nächste Abfrage meldete sie erneut). Jetzt nur abholbare Quests; Client merkt sich zusätzlich Quests, deren Abholen scheitert (`dismissed`).
- **Standard pro Sprache** (`0081_language_defaults.sql`): `user_settings.language_defaults` (jsonb, Code → Anzahl + Richtungen). `SettingsProvider.update` merkt Änderungen für die aktuelle Sprache und stellt sie beim Sprachwechsel wieder ein (`withLanguageDefaults`/`rememberLanguageDefaults` in `rules.ts`). `services/settings.ts` fällt ohne die Spalte automatisch auf die alte Abfrage zurück. Anzeige im Einstellungen → Lernen unter der Lernsprache.

## Update 100
- **Jubiläums-Artikel** (`0082_update100.sql`): `shop_items.limited`; `tag_u100` (animierter Gold-Tag, `.tag-u100`) und `theme_u100_gold` (goldenes Feuerwerk, `FireworksBackdrop`) nur für die ersten 10 (`u100_claim` mit Advisory-Lock, Rückgabe `ok`/`owned`/`gone`), `theme_u100` (Luftballons mit „100", `BalloonBackdrop`) gratis für alle. `u100_status()` liefert Restplätze. Shop zeigt oben den Bereich „Update 100"; die Artikel sind aus den normalen Tabs ausgeblendet. Backdrops in `components/ui/Update100.tsx`, Decor-Typen `balloons`/`fireworks`.
- **Live-Sicht für Mods** (`staff_extra.see_online`, Standard `app_settings.mod_see_online`, `_can_see_online()`): `admin_list_online`, `admin_user_status` und `get_presence` (inkl. versteckte Personen) prüfen darauf statt nur Admin. Verwaltung: Standard unter „Standard-Rechte", pro Person im Mod-Rechte-Editor („Live-Sicht"). Mods sehen im Tab „Live-Sicht" nur die Liste (keine Nachrichten/Personenfenster).
- **Private Sticker**: Sticker-Leiste im Chat hat „Privat senden an"; sendet `!whisper @Name :sticker:id:`, Flüster-Nachrichten rendern Sticker.
- **Kasten pro Buch**: `get_book_boxes` + `BookBoxMini` (Fortschrittsring = Anteil in Fach 5, Fächer-Leiste) auf jeder Buchkarte der Bücher-Seite.
- **Lernen**: `get_card_box` (nur lesend, Lernstand unverändert) + `features/learning/CardBoxPanel.tsx` (5 anklickbare Fächer = Stufen, Kärtchen mit Trefferquote rot→grün, „Nur Fach N lernen" filtert den Pool clientseitig) + Belohnungsvorschau (`previewReward`, mit Plus-/Pro-Multiplikator aus `plus.status`) + neuer Start-Button. Tests `cardBox.test.ts`.
- **Limit-Absicherung** (`0083_u100_limit_guard.sql`): Trigger `_limited_guard` auf `user_items` verhindert mehr als `shop_items.limited` Einträge je Artikel auf jedem Weg; `u100_claim` meldet dann `gone`.

## Update 101
- **Fix Update-100-Limit** (`0084_limited_trade.sql`): Die Artikel hatten Preis 0 → `get_shop` meldete sie für alle als besessen und `equip_item` ließ sie ohne `user_items`-Eintrag zu (Limit wirkte nie). Jetzt Preis 1 + `shop_items.claim_only`; `buy_item` verweigert `claim_only`/`source='advent'`. Die Migration vergibt die Artikel an Personen, die sie schon ausgewählt hatten (älteste Konten zuerst, bis zum Limit), allen anderen wird die Auswahl entfernt.
- **Limitierte Artikel** (`shop_items.limited`, `source` shop|advent|both): je 4 Stück `tag_ltd_phoenix`, `theme_ltd_polar` (Shop) und `tag_ltd_glitch`, `theme_ltd_void` (nur Adventskalender). Das Limit sichert der Trigger `_limited_guard` (0083). `get_shop` liefert `limited/taken/claim_only/source`; Shop zeigt „Limitiert – nur 4 Stück" mit Restmenge. Advent: `_advent_plan` hängt mit Chance `advent_limited_chance` (%, einstellbar unter Adventskalender) ein `limited`-Türchen an, `advent_open` vergibt zufällig einen freien Artikel mit `source in (advent, both)`; Zufalls-Designs ziehen nie limitierte/claim_only-Artikel.
- **Handel** (`item_offers`, `item_bids`, `trade_*`, `features/shop/TradePanel.tsx`, Shop-Tab „Handel"): nur limitierte Artikel. Verkäufer setzt Preis, Käufer kauft zum Preis oder bietet; Verkäufer nimmt Gebote an/lehnt ab. `_trade_execute` überweist Coins (Käufer `trade_buy`, Verkäufer `pay_in` = ohne Plus-Bonus), verschiebt die `user_items`-Zeile, entfernt die Auswahl beim Verkäufer. „Zuletzt verkauft" zeigt Preise.
- **Admin „Limitierte Artikel"** (`admin_limited_overview`, `LimitedTab`): Inhaber je Artikel mit Zeitpunkt und „im Handel".
- **Mods: Spiele ansehen** (`staff_extra.see_games`, Standard `mod_see_games`, `_can_see_games`, `og_spectate_list/view`, `SpectateTab`): zeigt laufende Spiele inkl. beider Flotten, Auswahlen, Ludo-Figuren. `admin_set_staff_extra(user, key, value)` ersetzt die alte Signatur (Keys `see_online`, `see_games`).
- **3D-Shooter** (`0085_shooter.sql`, `features/online/shooter/*`): Spielart `shooter` (2–4 Personen). Host zahlt beim Start `shooter_fee` (50, `game_fee`); Sieg bei `shooter_to_win` Treffern oder meisten nach `shooter_minutes`. Echtzeit nur per Broadcast `sh-<id>` über die Spiel-Datenbanken (Positionen `p`, Treffer `h`, Abschüsse `k`, Schusslinie `s`); der getroffene Client zieht sich selbst Leben ab. `og_shooter_report` speichert Zwischenstand/Ende (jede sitzende Person, Ende gilt einmal), `og_shooter_leave`. three.js wird erst im Spiel nachgeladen. **Panik-Knopf** (Taste P oder Button): Spiel pausiert, Pointer-Lock weg, Vollbild-Fake-„Vokabeln üben"-Seite, Tab-Titel „Vokabeltrainer", Spieler unverwundbar und unsichtbar.
- **Fix Update 99**: Eine Einladung zu einem Online-Spiel ablehnen schlug fehl („Spiel nicht gefunden", Rollback). `og_respond` gibt bei Ablehnung `null` zurück (`_patch_fn` in 0085), Client navigiert zurück.

## Update 102
- **Melden**: `ReportModal` zeigt die Lösung der gemeldeten Vokabel erst nach Klick („Lösung trotzdem zeigen“).
- **Tastatur im Mensch-ärgere-dich-nicht** (`LudoBoard`): Leertaste/Enter/W/R würfeln, Ziffern 1–4 ziehen die Figur (nur wenn legal).
- **Mehr limitierte Artikel** (`0086_more_limited.sql`): 3 Tags (`tag_ltd_frost/royal/neon`) und 3 Designs (`theme_ltd_sakura/lava/matrix`), je 4 Stück, Quelle Shop/beides/Advent. CSS in `index.css`, Katalog in `shop/catalog.ts`.
- **Schach & Dame online** (`0087_boardgames.sql`): neue `og_games.kind` `chess`/`checkers`; Regeln laufen im Client (`features/online/board/chess.ts` perft-geprüft, `checkers.ts` deutsche Regeln mit Schlagzwang, fliegender Dame). Der Server prüft nur Zugrecht (`turn_seat`), speichert den Zustand (`fen` bzw. `board`) und das Ergebnis. RPCs `og_board_move`, `og_board_resign`, `og_board_draw` (Remis anbieten/annehmen/ablehnen/zurückziehen). Mods/Admins sehen laufende Partien über `og_spectate_*` (`SpectateTab` zeichnet das Brett). Keine Uhr, nur Siege (Gewinner bekommt Sieg-Punkte wie in den anderen Online-Spielen).
- **Börse** (`0088_stocks.sql`, `pages/Stocks.tsx`, `pages/admin/StocksTab.tsx`, `services/stocks.ts`): Sperr-Schlüssel `stocks`, Route `/boerse`. Der Admin trägt einen Finnhub-Schlüssel ein (Tabelle `stock_config`, über `stock_config()` für eingeloggte Nutzer lesbar) und die Aktien. Der Browser holt Kurse und meldet sie mit `stock_report`. Ein Kurs gilt erst, wenn `stock_min_reporters` (2) verschiedene Personen innerhalb ±1 % melden (Meldung des Admins gilt allein); ein Kurs ist `stock_max_age_min` Minuten gültig, sonst ist der Handel gesperrt. `stock_trade` kauft/verkauft ganze Aktien zum Serverkurs (Coins = Dollar × `stock_koin_per_usd`, Gebühr `stock_fee_permille`). Verkaufserlös läuft mit dem strikten Grund `pay_in` (kein Plus-Bonus). Zahlen stehen in Verwaltung → Zahlen → Börse.

## Update 103
- **Shooter auf dem iPad/Tablet** (`ShooterGame.tsx`): bei `(pointer: coarse)` gibt es statt Maus/Tastatur eine Touch-Steuerung (`TouchControls`): links Joystick (Pointer Events, Teilausschlag = langsamer), rechts Wischfläche zum Zielen, großer FEUER-Knopf (hält = Dauerfeuer, Abklingzeit gilt weiter). Der Panik-Knopf ist per Tippen erreichbar. Bewegung/Netzwerk unverändert, kein SQL.

## Update 103 – Börse vereinfacht (`0089_stocks_sim.sql`)
- Echte Kurse/Finnhub entfallen. Der Server simuliert die Preise selbst: `_stock_tick()` rechnet beim Aufruf von `stock_list`/`stock_trade` die Kurse im Minutentakt weiter (zufälliger Schritt um den Grundpreis `stock_symbols.base_cents`, leichter Zug zum Grundpreis, Grenzen 0,2× bis 5×, höchstens 120 Schritte am Stück). Preise sind direkt in Coins (`price_cents`/100). `prev_close_cents` = Kurs vom Vortag (Berlin).
- Admin: `admin_stock_save(symbol, name, preis_in_coins)`; Zahlen: `stock_volatility_permille`, `stock_fee_permille`. Entfernt: `stock_report`, `stock_config`, Finnhub-Schlüssel-RPCs. Bestehende 0088-Kurse werden einmalig mit `stock_koin_per_usd` in Coins umgerechnet.
- **Schnelllesen** (`/schnelllesen`, `pages/SpeedRead.tsx`, `features/speedread/engine.ts`): Text einfügen, Zeichen-/Wort-/Satzzahl und Lesezeit live; Wörter blitzen (1–3 pro Blitz) mit rotem Fixpunkt in der Mitte; Tempo 100–1200 Wörter/min, optional variable Geschwindigkeit (lange Wörter/Satzenden länger). Einstellungen in localStorage, kein SQL.
- **Parkour-Zuschauer**: Wer zuschaut oder übers Zuschauen ins Spiel kommt (`tainted` in `ParkourGame.report`), schickt kein Ergebnis an den Server: keine Münzen, kein Rekord. Reine Client-Regel, kein SQL.
- **Autohaus** (`0090_cars.sql`, `pages/Cars.tsx`, `pages/admin/CarsTab.tsx`, `features/cars/CarArt.tsx`): Sperr-Schlüssel `cars`, Route `/autohaus`. Tabellen `cars` (Preis/Angebot, in Verwaltung → Autos einstellbar) und `car_owned`; RPCs `car_list`, `car_buy` (Grund `shop`), `admin_car_set`. Die Bilder sind selbst gezeichnete SVGs (8 Bauarten, Farbe pro Auto), keine Marken.

## Update 104
- **Gambling-Überlauf** (`0091_gambling_overflow_fix.sql`): Ursache von „bigint out of range“: `_house_squeeze` rechnete (Einsätze − Gewinne) × 1000 in bigint; nach sehr hohen Einsätzen der letzten 3 Tage lief das für ALLE Spiele über. Jetzt numeric, ein Feed-Eintrag zählt dort höchstens mit 10¹² Coins. Außerdem: Statistik-Summen (`_gamble_settle`, `_bj_finish`) und Bilanz in der Rangliste werden begrenzt statt überzulaufen, Auszahlungsvergleiche in Würfel/Roulette und der Slot-Gewinn rechnen mit numeric, und `admin_gambling_reset` löscht auch die Feed-Einträge des Spielers.
- **Börse** (`0092_stocks_trend.sql`): Kurse steigen im Schnitt um `stock_weekly_growth_percent` (50) pro Woche (logarithmischer Trend pro Minute, Zufall um den Trend, Schwankung `stock_volatility_permille` jetzt 2). Der Startpreis ist nur noch Untergrenze-Bezug (Kurs ≥ 20 %). Nachrechnen bis 4 Wochen (>120 Schritte werden zusammengefasst). Tabelle `stock_history` (stündlicher Punkt, 120 Tage), RPC `stock_chart(symbol, tage)`; Client: `features/stocks/StockChart.tsx` (SVG-Linie, 5/10/20/100 Tage, Hover-Wert).
- **Shooter**: Auf Touch-Geräten lief die Spielschleife nie (`touch ||` im Effekt) → Zeit stand still, schwarzes Bild; behoben. Höhe auf dem iPad `100dvh − 260px`, kein Seiten-Scrollen. Treffer: Radius 0,8 statt 0,5 (`HIT_R`), rotes ✕ beim Treffer, Lebensbalken über Gegnern.

## Update 105
- **Weniger Anfragen ans Backend** (Log-/Traffic-Kontingent): neues `lib/poll.ts` (`every` = Intervall nur bei sichtbarem Tab). Hintergrund-Intervalle verlängert: Benachrichtigungen 30→60 s, DMs 20→45 s, Präsenz 45→90 s, Präsenz-Nachrichten 20→45 s, Chat-Badge 45→90 s, Wallet 90→180 s, Fortschritt 75→150 s, Plus/Sperren 60→180 s, Live-Einladungen 15→45 s, Chat-Seite 10→15 s, Wer-ist-da-Seite und Gambling-Feed 15→30 s, Freischaltungs-Wartescreen 15→30 s. Dazu stoppt `0091` den Fehler-Dauerbeschuss durch den Überlauf (jeder Fehler landet im Postgres-Log).
- **Komplett-Backup** (`0093_backup.sql`, `features/backup/backup.ts`, `pages/admin/BackupTab.tsx`, Verwaltung → Backup): `admin_backup_tables` (alle Tabellen in public, Eltern vor Kindern), `admin_backup_read` (seitenweise), `admin_backup_write` (Upsert per Primärschlüssel; Zeilen mit ins Leere zeigenden Fremdschlüsseln werden übersprungen; User-Trigger während des Einspielens aus; Serial/Identity-Zähler werden nachgezogen), `admin_backup_clear` (für „komplett ersetzen“). Datei: JSON `{format:'vt-backup-1', created, app_update, tables:{name:[Zeilen]}}`. Nicht enthalten: `auth.users` (Passwörter bleiben bei Supabase). Eignet sich auch als Umzugsweg in ein neues Supabase-Projekt (Konten müssten dort mit gleicher ID existieren).

## Update 106 – Log-Ingestion senken
- Auslöser: Supabase-Usage (Free, Organisation): Log Ingestion 0,818 / 1 GB nach 13 Tagen des Zyklus (30.10.–30.11.), ca. 63 MB/Tag. Gnadenfrist bis 27.11. (wegen Realtime-Nachrichten im Vormonat); danach Fair-Use (HTTP 402), wenn das Kontingent überschritten ist. Bis 27.11. blieben nur ca. 12 MB/Tag.
- `lib/poll.ts` `every()` ist jetzt leerlaufbewusst: ohne Bedienung seit 90 s nur jeder 4. Takt, seit 5 min gar nicht (Funktion `shouldRun`, getestet). Alle Hintergrund-Poller nutzen es (Benachrichtigungen, DMs, Präsenz, Chat-Badge 120 s, Wallet, Fortschritt, Plus, Sperren, Live-Einladungen). Folge: Wer 5 min nichts tippt, gilt bei „Wer ist da?“ nach kurzer Zeit als offline; beim nächsten Tippen läuft alles spätestens im nächsten Takt wieder an.
- Quoten gelten pro Organisation (Dropdown „All projects“): ein zweites Projekt in derselben Organisation entlastet nichts.

## Update 107 – Shooter-Fixes, Autos fahren, Umzug
- Shooter: alle Spieler eines Spiels nutzen dasselbe Spiel-Realtime-Projekt (`slotForKey(game id)` in `gameRealtime.ts`), Senden erst nach SUBSCRIBED, 20 Positionen/s mit Dead-Reckoning beim Gegner. Waffen (Pistole, Gewehr, Schrot, Sniper; `WEAPONS` in `engine.ts`, Schaden beim Empfang auf `MAX_HIT_DMG` begrenzt), Pfeiltasten drehen, Leertaste schießt (halten = Dauerfeuer), 1–4/Q/E Waffenwechsel. Touch-Joystick wird relativ zur Zone positioniert (nicht `fixed`, wegen iPad-Transform).
- Autos: Tab „Fahren“ (`carRun.ts`, `CarRun.tsx`) mit gekauftem Auto.
- Umzug: `backendConfig.ts` wählt Projekt (Browser-Speicher > `public/backend.json` > Build-Variablen); Admin → Umzug trägt URL/Key ein oder erzeugt `backend.json`. Backup kann `_auth` (Konten + Passwort-Hashes + Admin-IDs) enthalten (`admin_accounts_export`). Öffentliche Seite `/umzug` ruft `migration_bootstrap` (nur in einem Projekt ohne Konten/Profile), danach Admin-Login und normale Backup-Wiederherstellung. SQL: 0094.

## Update 108 – 3D-Rennspiel
- Neuer Ordner `src/features/cars/race/`: `track.ts` (6 Strecken als geschlossene Catmull-Rom-Kurven, abgetastet; `project`, `pointAt`, `advance`, `curveAhead`), `physics.ts` (Arcade-Fahrmodell, Werte je Autoart, Leitplanken, Zusammenstöße, Bots), `scene.ts` (three.js-Szene: Straße, Randsteine, Leitplanken, Kurvenschilder, Landschaft je Thema, Auto-Modelle aus abgerundeten Teilen), `RaceView.tsx` (Schleife, Verfolgerkamera, HUD mit Streckenkarte, Kurvenwarnung, Ampel, Runden, Platz; Knöpfe links/rechts/Gas/Bremse per Pointer Events, Tastatur Pfeile/WASD/Leertaste, R = zurücksetzen), `RaceMenu.tsx` (Einzelspieler: Training oder gegen 3 Bots, Schwierigkeit, Runden), `RaceOnline.tsx` (Auto wählen, Strecke/Runden in der Lobby, laufendes Online-Rennen).
- Online: neue Art `race` (SQL 0095). Gastgeber lädt ein, wählt Strecke (0–5) und Runden (`og_race_set`); `_og_start` setzt Startzeit; jede Person meldet ihre Zielzeit (`og_race_report`, Plausibilitätsprüfung, einmalig); 60 s nach dem ersten Ziel kann jede beteiligte Person das Rennen beenden (null melden); Sieger = kleinste Zeit; `og_race_leave`. Positionen laufen als Broadcast `r` (ca. 18/s) über das Spiel-Projekt `slotForKey(game id)`, Kanal `rc-<id>`. Kein Münzeinsatz.
- Autohaus: Tabs Kaufen / Rennen / Autobahn (das frühere „Fahren“).

## Update 109 – Mehr Autos, Cockpit, Aktien mit Treibern
- Autos: 16 Arten (`CarArt.tsx`, `stats.ts`): neu Oldtimer, Buggy, Monstertruck, Muscle, Rallye, GT, Hypercar, Rennwagen (Formel). 29 Autos im Autohaus, geordnet nach Preis; `cars.top_kmh` (SQL 0096) ist die echte Höchstgeschwindigkeit im Rennen und steht im Shop (Zahl + Balken). `physics.statsFor(kind, kmh)` skaliert Tempo und Beschleunigung. 3D-Modelle für alle Arten in `race/scene.ts` (Formel mit Flügeln, Halo, Helm; Buggy mit Käfig; Hutzen, Streifen).
- Cockpit-Ansicht im Rennen (Taste C oder Knopf, wird gemerkt): Kamera im Fahrerplatz, eigenes Auto ausgeblendet, Armaturenbrett mit Lenkrad und Tempo als Überlagerung.
- Aktien: `stock_symbols.driver` ('gambling' | 'shop'); `_stock_tick` wertet das `koin_ledger` seit dem letzten Mal aus (`stock_driver.last_id`): BANK steigt, wenn Spieler beim Gambling verlieren (Einsätze minus Gewinne), SHOPX steigt bei Ausgaben (Gründe shop, plus_buy, pro_buy, trade_buy). Sprung = exp(Stärke · tanh(Summe / Skala)), Einstellungen `stock_driver_strength_permille` (60) und `stock_driver_scale` (20000).

## Update 110 – Gambling mit Chips
- Gespielt wird nur noch mit **Chips** (SQL `0097_chips.sql`): `chip_wallets` (chips, loss_streak, locked_until, bought/bought_day, bonus_day), `chip_ledger`. Einzige Bewegungsstelle `_chip_grant(user, betrag, grund)`; Einsätze (`gambling_bet`) sind während der Sperre unmöglich.
- 1 Chip = `chip_rate` (10) Coins. `chip_buy(n)` bucht Coins (Grund `chip_buy`) ab, höchstens `chip_daily_buy_limit` (1000) Chips pro Berliner Tag. `chip_sell(n)` zahlt Coins zurück (`pay_in`). `chip_status()` schreibt beim ersten Aufruf des Tages `chip_daily_bonus` (100) Chips gut. Folge: Geschenkte Chips lassen sich in Coins tauschen (bis 1000 Coins pro Tag) – gewollt.
- Verlustserie: `_chip_streak` (nach Auszahlung < Einsatz +1, sonst 0); bei `chip_lock_losses` (3) setzt es `locked_until = jetzt + chip_lock_seconds` (10 s). Der Server entscheidet.
- `_gamble_settle`/`_bj_finish` rechnen in Chips; die Spielfunktionen (play/roulette/dice/wheel/blackjack_*) werden im DO-Block per Textersatz auf `_chip_balance`/`_chip_grant` umgestellt (bricht ab, falls noch Coin-Zugriffe übrig sind; wiederholbar). Spielregeln, Chancen, Höchsteinsatz (jetzt in Chips) bleiben.
- `_stock_tick`: BANK-Treiber liest `chip_ledger` × `chip_rate` (Coin-Wert).
- Client: `features/gambling/ChipsProvider.tsx` (`useChips` hat dieselbe Form wie der Coin-Geldbeutel; ab der 3. Netto-Niederlage fragt er `chip_status`), `ChipsPanel` (Kaufen/Zurücktauschen), `ChipPurse` (Gag: Overlay mit geschütteltem Portemonnaie, Staub, Countdown; bleibt bis Sperrende), `chipLogic.ts` (getestet). Bisherige Coin-Gambling-Statistik bleibt als Verlauf; die Bilanz-Rangliste mischt alte (Coin) und neue (Chip) Zahlen.

## Update 111 – Rennspiel Teil 2
- **Hitboxen/Schaden** (`race/collide.ts`, `physics.ts`): Autos sind gedrehte Rechtecke (`KIND_DIMS` in `stats.ts`, gleiche Maße wie das 3D-Modell), Trennachsen-Test; Leitplanke prüft die vier Ecken. Schaden 0–100 aus der Aufprallgeschwindigkeit (`impactDamage`), senkt Tempo/Beschleunigung, zieht zur Seite, bei 100 Totalschaden. R = Werkstatt (repariert, 3 s Pause). Bots haben höchstens 85 Schaden. Sichtbar: dunkler Lack, schiefe Karosserie, Rauch/Feuer (`damageCar` in `scene.ts`).
- **Driften**: Bremse + Lenken ab ~50 km/h baut einen Driftwinkel `slip` auf (Fahrtrichtung = Blickrichtung − slip), Reifenqualm. Bots und Fahrassistent driften nicht.
- **Ideallinie** (`race/line.ts`): Gummiband-Verfahren legt die kürzeste Linie in die Fahrbahn, Geschwindigkeitsprofil aus Krümmung (seitliche Beschleunigung nach Auto/Fahrer) + Bremswegen; `botSteer` folgt ihr. Bots fahren je Stufe (Leicht…Profi) gute Autos (`top`), Profi mit Skill 1. `bots.test.ts` prüft alle Strecken.
- **Strecken**: 4 neue lange Strecken (Highspeed-Ring, Endlos-Highway mit 5-km-Geraden, Alpen-Marathon, Kontinent-Express ~15 km), Szenerie als Instanzen, Himmel/Boden/Berge folgen der Kamera (`follow`). **Gemalte Strecken** (`TrackEditor`, `trackDraw.ts`: schließen, gleichmäßig verteilen, glätten, skalieren, Kreuzungs- und Kurvenprüfung), gespeichert in `race_tracks` (max. 20 pro Nutzer, öffentlich oder privat), solo und online fahrbar (`og_race_set(..., p_custom)` kopiert die Strecke in den Spielstand).
- **Online-Autos**: `og_race_pick(game, car)` bestimmt das Auto serverseitig aus dem Besitz und legt es in `state.cars[user]`; die Lobby zeigt alle gewählten Autos, das Rennen nutzt dieses Auto (vorher wurde es beim Rennstart oft nicht geladen → Leihwagen). `_og_start` behält `cars` und `custom`.
- **Rangliste**: `race_records` (beste Runde je Nutzer/Strecke/Auto, `race_submit`), `race_board` (Fahrer) und `race_car_board` (Autos); Autohaus-Tab „Rangliste“ zeigt beides plus alle Autos nach Tempo. Fahrassistent-Fahrten und das Supercar zählen nicht.
- **Supercar „Admin-Hyperion“** (700 km/h, `SUPERCAR` in `stats.ts`): `_race_super` = Admin immer, Mods nur mit Eintrag in `race_super_access` (Admin-Tab Autos: `admin_super_set`). Fahrassistent (F / Knopf) = Ideallinie mit Handeingriff. 15 neue Autos (SQL 0098).

## Update 112/113 – Tuning, Roadster-Flug, Motorräder, Supercar, Drift
- **Roadster „Sky-Roadster“** (`kind 'roadster'`, `canFly`): Taste E / Knopf FLIEGEN, 2 s Flug (`FLY_SECONDS`), danach 20 s Laden (`FLY_COOLDOWN`), `flyHeight` (bis 6,5 m). Im Flug kein Wand-/Gras-Effekt und keine Autokollisionen (auch bei Online-Gegnern, Feld `fl`), Düsen am Modell. Zum Überholen über andere hinweg.
- **Motorräder** (`chopper`, `crossbike`, `sportbike`; `isBike`): eigenes 3D-Modell `buildBike` (Lean-Gruppe), legt sich in Kurven (Rollwinkel aus Lenkung × Tempo), Kamera rollt mit (Cockpit stärker). Eigene Zeichnung in `CarArt` (`BikeArt`).
- **Tuning**: `car_upgrades` (Motor/Reifen/Bremse je Auto, Stufe 0–5), `car_upgrade` (Preis `_car_up_price` = max(500, Preis/10) × (Stufe+1), Coins-Grund 'shop'). Formeln in `features/cars/tuning.ts` = SQL. `og_race_pick` legt `up {m,r,b}` in den Online-Spielstand. Autohaus-Tab „Tuning“ (`TuneTab`).
- **Supercar** (`kind 'supercar'`, rot, 911-Coupé-Optik): Tempo je Nutzer einstellbar (`race_super_access.kmh`, Standard `supercar_kmh`; `admin_super_user_speed`, `admin_super_speed`, `race_super_info` → {ok, kmh, assist}). **Fahrassistent nur Admin** (`_race_assist`); freigegebene Mods fahren es ohne Assistent.
- **Assistent mit Drift** (`line.ts` `assistSteer`, `physics.ts` Input `drift`/`turn`, `AUTO_LAT`): Pure-Pursuit auf der Ideallinie, Fahrtrichtung folgt direkt der Wunschdrehung (max. `AUTO_LAT/v`), das Heck steht quer (`slip` ∝ Drehrate), kaum Tempoverlust; Kurventempo-Profil mit `DRIFT_MUL`, gedeckelt bei 80 m/s². Auf allen 11 Strecken schadenfrei und 5–20 % schneller als die Linie ohne Drift (`fly.test.ts`).
- **Drift-Arena** (Strecke 10, `t10`): 48 m breit (Rest 14–28 m), weite Bögen, ~3,4 km, 3 Runden. SQL erlaubt `t10` (Check, `race_submit`, `og_race_set` bis 10).
- **Online-Autowahl-Fix**: `RaceLobbyOptions` zeigt die Wahl sofort (lokaler Zustand) und übernimmt die vom Server zurückgegebene Ansicht (`onView` → `apply` + `ping`); vorher kam sie erst beim nächsten Abruf.
- SQL: `0099_tuning_fly_bikes.sql` (nach 0098).

## Update 114 – Flug fürs Supercar, Effekte, Renn-Coins, Bot-Start, Szenerie
- **Fliegen**: `canFly` gilt jetzt für Sky-Roadster und Supercar. Düsen (`addJets`) zeigen nach unten; im Flug schießen Wolken-Partikel nach unten, treffen den Boden und breiten sich aus. Abzeichen „✈ kann fliegen“ im Autohaus/Garage.
- **Effekte** (`race/fx.ts`, `createFx`): gemeinsamer Partikel-Vorrat (Wolken, Feuer additiv, Rauch; 300 Sprites) + Reifenspuren als InstancedMesh-Ringpuffer (1200 Streifen). Supercar: Auspuff-Feuer und Rauch bei Gas. Reifenspuren an den Hinterrädern bei |slip| > 0,14 (alle Autos, auch Bots und Online-Gegner). `carFx` in `RaceView`.
- **Szenerie**: `roadProximity(track)` (Raster) prüft den Abstand zu *jedem* Streckenpunkt; vorher wurde nur nahe dem eigenen Index geprüft, daher standen Häuser/Bäume auf Straßenstücken, die an anderer Stelle vorbeilaufen. Stadt: Häuser mind. Straßenbreite/2 + 30 m weg.
- **Bot-Start**: Bots bleiben 60 m in ihrer Startspur (`lat0`, `total0`) und ziehen dann über 350 m weich zur Linie (`botInput`); `packLimit` bremst Bots vor einem Auto direkt davor in ihrer Spur. Start-Crash-Schaden von 250–490 auf ~0 (Test „Startpulk“).
- **Renn-Coins**: `race_reward(place, field, ms, online)` (0100): (Grundbetrag 25 + 12 × Gegner) × Platzfaktor (100/60/40/20 %), online × 1,5; Rennen < 15 s zählen nicht, 15 s Abstand, Tageslimit 2000 (24 h, Einstellungen `race_coin_base`, `race_coin_daily`). Ledger-Grund `race`. Kein Lohn für Supercar oder Fahrassistent. Anzeige im Zielfenster.
- **Strecken löschen**: Admins sehen „Löschen“ bei allen (sichtbaren) gemalten Strecken (`race_track_delete` erlaubte Staff schon).
- **Motorräder**: `hyperbike` (420 km/h; Hyper-Bike 420, Raketen-Bike 520 km/h). Höchsttempo-Grenze `cars_top_kmh_check` auf 600.
- SQL: `0100_race_coins_hyperbikes.sql` (nach 0099).

## Update 115 – Flug einstellbar, Rolle, Unterkamera, faire Kollisionen, Tempo bis 100.000 km/h
- **Flug-Einstellungen** (Admin, global): `fly_seconds` (1–60 s), `fly_cooldown` (0–300 s), `fly_roll` (0/1) in `app_settings`; `admin_fly_set`, `race_super_info().fly`. Client: `flyConfig`/`setFlyConfig` in `cars/stats.ts` (wird von `useRaceCars` aus `race_super_info` gesetzt), `physics.ts` und `flyHeight` lesen sie. Admin-Tab „Autos“ → „Fliegen“ (`FlySettings`).
- **Rolle im Flug**: `flyRoll(left)` = eine volle Drehung über die Flugdauer; Modell `rotation.z` und Kamera `rotateZ(-roll)` (alle drei Ansichten).
- **Unterkamera**: Kameraansicht (Taste C) hat jetzt drei Modi: Außen → Cockpit → „Von unten“ (tief hinter dem Auto, Blick nach oben auf Wagenboden und Düsenwolken). Außenkamera-Abstand/Höhe bei hohem Tempo gedeckelt.
- **Kollisionen**: Schaden aus dem Annäherungstempo entlang der Mittelpunktsverbindung (`crash`; vorher falsche Achse bei tiefem Eindringen → oft kaum Schaden), kein 0,7-Dämpfer mehr, beide Seiten aus demselben Vor-Zustand (Spieler↔Bot und Bot↔Bot symmetrisch), 250-ms-Sperre je Gegner gegen Mehrfachschaden, Online-Gegner mit leicht vergrößerter Hitbox und auf die letzte Position hochgerechnet. Frontal mit 700 km/h → 100 % Schaden (Test).
- **Teilschritte**: Der eigene Wagen wird bei hohem Tempo in Schritten von höchstens ~1,6 m simuliert (max. 240 pro Bild) und nach jedem Schritt auf Zusammenstöße geprüft: kein Durchrasen mehr.
- **Supercar-Tempo bis 100.000 km/h** (Standard und je Nutzer; Check/Funktionen in 0101 angepasst).
- SQL: `0101_fly_settings.sql` (nach 0100).

## Update 116 – Endlos-Asphalt und Drift-Kreis
- `TrackDef.mode`: `'free'` (Strecke 11 „Endlos-Asphalt“) und `'disc'` (Strecke 12 „Drift-Kreis“), `lineMax` begrenzt den Versatz der Ideallinie (sonst würde das elastische Band auf der 304 m breiten Kreisfläche zur Mitte hin schrumpfen).
- **Endlos-Asphalt** (`free`): `stepCar` überspringt `project`/Wände/Gras (`offroad` immer false, `total` bleibt) – man fährt beliebig weit. Szene: nur eine 9 km große Asphaltfläche mit Übungskreisen (Textur 120-m-Kachel), die der Kamera folgt; `RaceScene.focus(x, z)` schiebt die Texture-Offsets, damit die Markierungen an der Welt hängen. Alles andere (Straße, Szenerie) wird nach dem Bauen entfernt. Kein Countdown, keine Bots/Runden/Rangliste/Minikarte/Online; stattdessen **Drift-Punkte** (Serie ∝ Tempo × |Driftwinkel|, wird nach 0,9 s ohne Drift gutgeschrieben, beste Serie in `localStorage` `vt-race-driftbest`).
- **Drift-Kreis** (`disc`): Straßenband von der Mitte bis 304 m, **keine Leitplanken/Randsteine/Torbogen**, nur weiße Randlinie und gelbe Linie auf der Ideallinie; `stepCar` überspringt die Wand (Gras außerhalb). Normale Rennen mit Bots, Runden, Rangliste (`t12`) und Online.
- SQL `0102_drift_tracks.sql`: Schlüssel `t11`/`t12` in `race_records`-Check und `race_submit`, Online-Streckenwahl bis 12.
- Tests (`fly.test.ts`): Definitionen, endlose Fahrt ohne Schaden, Mitte und Rand des Kreises, Bots fahren eine Runde auf dem Kreis schadenfrei.

## Update 117 – Strecken-Limits, Ausfüllen, breite Kurven, Schotter, Bot-Anzahl
- `0103_track_limits.sql`: eigene Strecken je Tarif begrenzt (ohne Plus/Pro 1, Plus 2, Pro 3; `_plus_active`/`_pro_active`), Spalte `race_tracks.fill`, neue Prüfung `_race_track_valid` (keine Selbstkreuzung, Kurvenradius ≥ 1,2 × halbe Breite), bisher gespeicherte ungültige Strecken samt Bestzeiten gelöscht, `race_track_save(..., p_fill)`, `race_track_list` liefert `fill`, `og_race_set` lehnt Flächen ab (nur allein fahrbar).
- `track.ts`: `Track.hw` (halbe Breite je Punkt, in Kurven bis +30 %, innen durch 0,8/Krümmung begrenzt), `Track.gr/gs` (Schotterbreite außen und Seite; nur an jeder zweiten Kurve, nie an zwei hintereinander, nicht neben anderen Streckenteilen). `mode: 'fill'` = ausgefüllte Fläche (Vieleck, `inPolygon`, wie `free` ohne Ziel/Wände), `isOpen(def)` = free oder fill.
- `physics.ts`: Fahrbahngrenze und Wand folgen `hw`; im Schotter Höchsttempo ×0,36 plus Bremswirkung, kein Schaden (Wand erst hinter dem Schotter).
- `scene.ts`: `ribbon` skaliert Versätze mit `hw` und begrenzt sie auf der Kurveninnenseite (keine Überschlagung, kein grauer Rand auf der Bahn), Schotterband, Fläche als `ShapeGeometry`.
- `trackDraw.ts`: `fitDrawing(..., fill)`; zusätzlich Abstandsprüfung zwischen entfernten Streckenteilen. `TrackEditor`: Option „Fläche ausfüllen“. `RaceMenu`: Bot-Anzahl 0–7.
- Tests: `track117.test.ts`.

## Update 118 – Stadt, Brücke, offene Lobby
- `race/city.ts`: deterministische Stadt (8×8 Blöcke, Raster 120 m, Straßen 24 m): ein großes Haus, zwei oder vier Häuser mit 8-m-Gassen, Parks; Stadtmauer bei ±492 m; Raster `cityPush(x,z)` für Kollisionen; Brücke (`CITY`, `bridgeH`, `onDeck`): über der Straße z = 240, Fahrbahn 16 m, 5 m hoch, 60-m-Rampen.
- `TRACKS[13]` „Stadt“ (`mode: 'city'`, zählt als `isOpen`: kein Ziel, keine Bots, keine Rangliste). `physics.ts`: Häuser/Mauer wie Wände (Schaden aus Aufprallgeschwindigkeit), `Car.lvl` (1 = auf der Brücke): Auffahren über die Rampe (längs, > 3 m/s) oder Landen im Flug von der Seite; oben Geländer; Autos unter der Brücke bleiben unten.
- `scene.ts` `buildCity`: Straßen mit Mittelstrichen, Häuser als ein zusammengeführtes Mesh mit Fenster-Textur, Gehwege, Parks mit Bäumen, Brücke mit Pfeilern. `RaceView`: Höhe `carY` (Flug oder Brücke).
- Offene Lobby (ohne SQL): `RaceView` mit `online.open`; Kanal `rc-open-city` über den vorhandenen Spiel-Funkdienst; Mitspieler entstehen aus den Funkdaten (Name `n`, Brückenebene `lv`) und verschwinden nach 15 s ohne Signal. Start über „Offene Stadt-Lobby“ im Rennmenü. Autos auf verschiedenen Ebenen stoßen nicht zusammen.
- Tests: `city.test.ts`.

## Update 119 – Stunt-Park
- `race/stunt.ts`: Karte `TRACKS[14]` „Stunt-Park“ (`mode: 'stunt'`, zählt als `isOpen`): 600×600-m-Fläche mit Zaun (`arenaPush`), Rampen/Hügel (`RAMPS`, `groundH`) und einem Looping (`STUNT.loop`, Radius 12 m, `loopPoint` = Wendel mit 6 m seitlichem Versatz).
- `physics.ts`: neue optionale Car-Felder `y`, `vy`, `loop`, `lp`. Am Boden folgt das Auto der Rampenhöhe; hebt der Boden ab (Rampenende, Hügelkamm bei Tempo) fliegt es auf einer Wurfparabel (g = 9,8), Landung mit kleinem Schaden. Looping: Einfahrt ab 28 m/s (≈ 100 km/h) und gerader Ausrichtung am Einstieg, danach läuft `loopStep` die Wendel mit Energieerhaltung; oben zu langsam = Absturz mit Schaden.
- `scene.ts` `buildStunt`: Keile für Rampen, Wendel mit Seitenwänden, Stützen, Zaun. `RaceView`: `carY` berücksichtigt `y`, `pitchOf` neigt die Nase (im Looping volle Drehung), Funkdaten `y`/`pt`, Autos auf unterschiedlicher Höhe stoßen nicht zusammen.
- Tests: `stunt.test.ts`.

## Update 120 – Lernen übersichtlicher, Kurven, Melden
- Rennen: `buildTrack` entschärft zu enge Kurven (Radius ≥ halbe Breite + 9 m, Mittellinie wird geglättet), damit sich Randstein/Leitplanke nicht mehr überschlagen; die breiteren Kurven (`hw`) sind wieder gleich breit (Array bleibt für den Schotter-Code). Schotterfeld bleibt.
- Lernen (`pages/Learn.tsx`): Schritt 1 Buch wählen (Kacheln mit Fortschritt, Link zu Büchern/Eintragen), Schritt 2 Modus + sofort der Start-Knopf; Fach, Belohnung, Seiten freischalten, „wieder fällig“ liegen in „Weitere Optionen“ (`<details>`); darunter Kacheln aller Übungsarten (`hubItemsFor` in `lib/navigation.ts`).
- Menü: Gruppe „Lernen“ nur Lernen, Bücher, Karteikarten, Test, Hausaufgaben, Suche; Abschreiben, Crashkurs, Multiple Choice, Grammatik, Irreguläre Verben, Konjugieren, le/la sind `menu: false` (nur Kacheln); Mathe, Schnelllesen, Auswendig, Advent, Loot in neuer Gruppe „Extras“.
- Melden: `ReportBtn` hat `locked`, `QuizRunner` zeigt „Vokabel melden“ erst nach der Antwort (Melden zeigt den Eintrag samt Lösung); Karteikarten erst nach dem Umdrehen, im Crashkurs-Test nie.
- Buch eintragen (`pages/BookEntry.tsx`): große Unit/Seite-Schalter (− / +), Statusanzeige „Speichert … / n gespeichert / Fehler“, feste Spaltenköpfe, Knöpfe „Neue Zeile“ und „Nächste Seite“ unter der Liste, Foto/Gehe zu/Nächste Unit eingeklappt.
- Tests: `lib/navigation.test.ts`, `features/cram/ReportBtn.test.tsx`, Kurventest in `track117.test.ts`.

## Update 121 – Menü nach Themen, Karteikasten immer sichtbar
- `lib/navigation.ts`: Gruppen Start · Lernen · Mehr üben · Wettkampf · Spiele (Spiele, Online-Spiele, Deathrun, Parkour, Autohaus, Gambling) · Coins & Belohnungen (Advent, Loot, Börse, Shop, 3D-Druck, Plus & Pro) · Community (Chat, Wer ist da?, Websites) · Konto. Test in `navigation.test.ts`.
- `features/learning/CardBoxDock.tsx`: Karteikasten als feste Leiste rechts (ab 1280 px, einklappbar, Zustand in localStorage `vt-cardbox-dock`, `AppShell` schafft Platz mit `xl:pr-[236px]`); auf kleineren Bildschirmen ein Reiter am rechten Rand mit Schublade. Fach anklicken → `/lernen?fach=N` (Learn liest `fach`). Lädt höchstens einmal pro Minute neu; im Fokusmodus (Lernrunde) ausgeblendet.
- Spiele-Seiten gegliedert: Online-Spiele „Brettspiele“ / „Action in 3D“, Spiele „Knobeln & Denken“ / „Geschick & Reaktion“.


## Update 122
- Supercar: Regler für die Höchstgeschwindigkeit (log-Skala 20 bis Maximum, Tasten ÷2, ×2, Max) in `RaceView`; wirkt sofort über `setTopRef`.
- Ego-Shooter: Zielen (Rechtsklick/F, Touch-Knopf „ZIELEN“) mit Zoom (Scharfschütze FOV 16 mit Zielfernrohr-Overlay, sonst 55, Empfindlichkeit skaliert); prozedurale Canvas-Texturen für Boden, Wände, Kisten, Sternenhimmel.
- Admin: `admin_grant_chips` (Migration 0104, unbegrenzt, auch negativ), Chips-Kauf ohne Limit für Admins (`_chip_buy_max`), Tab „Chips vergeben“ in `ManageUser`.
- Menü: `Spiele` und `Shop` sind je ein Eintrag; Sammelseiten `/spielen` und `/laden` (`pages/HubPage.tsx`, `hubPageFor`, `NavItem.hubOf/hubGroup`). Schnelllesen steht in der Gruppe Lernen.


## Update 123
- Rangliste: neuer Reiter „Chips“ (`ChipBoard`, `get_chip_leaderboard`, `get_my_chip_rank`, Migration 0105).
- Gambling: Einstellung `gambling_payout_percent` (100 = normal, 0 = −100 %, 150 = +50 %); `_pay_adj` wird per Funktionstext-Patch vor jede Abrechnung gesetzt (Würfeln, Roulette, Rad, Slots, Black Jack), also stimmen Anzeige und Guthaben überein.
- Börse: je Aktie `trend_percent` (leer = global, negativ = sinkt) und `driver_mult_percent` (Stärke von BANK/SHOPX; SHOPX Standard jetzt 25 %). Admin: `admin_stock_tune`, `admin_stock_tune_list`, Bereich „Kurs-Trend je Aktie“ in `StocksTab`; globale Treiber-Werte stehen zusätzlich unter „Zahlen“.


## Update 124
- Admin-Aktienverwaltung (Migration 0106): `admin_stock_holdings(p_user)` zeigt alle Depots oder das einer Person, `admin_stock_adjust(p_user, p_symbol, p_delta)` vergibt oder zieht Aktien ab (Einstandswert sinkt anteilig, keine Coins zurück). UI: Reiter „Aktien“ in `ManageUser`, Liste „Wer hat welche Aktien?“ in `StocksTab`.


## Update 125
- Fahrassistent: Admin kann ihn Mods mit Supercar-Zugang geben (`race_super_access.assist`, `admin_super_assist`, Migration 0107; Haken „Fahrassistent“ in `CarsTab`).
- Supercar: Beschleunigung wählbar (×0,25 bis ×20) neben dem Tempo-Regler (`accRef`, `mkStats`).
- Offene Felder: Reparatur (R) auf der Stelle, 3 s Werkstatt, danach 12 s Wartezeit (`REPAIR_CD_MS`), beides im Knopf angezeigt; Rennstrecken setzen weiter zurück.
- Stadt (Strecke 13) größer: 12 × 12 Blöcke (`CITY.K`, half 720), fünf Brücken (`BRIDGES`, `bridgeAt(x,z)`, `bridgeH(x,z)`), Tunnel (zwei Häuser + Dach, `city().tunnels`), Wäldchen mit Bäumen und Büschen (`inPark`).
- Verstecken: Knopf/Taste H oder automatisch im Wäldchen; Broadcast-Feld `hd` – versteckte Fahrer sind für andere unsichtbar (kein Namensschild) und fehlen auf der neuen Stadtkarte (`cmini`).
- Die Stadt-Lobby steht jetzt oben im Rennen-Menü.


## Update 126
- Stadt: vier echte Untergrund-Tunnel (`TUNNELS`, `tunnelAt/tunnelRamp/tunnelD`, Ebene `lvl = -1`): Einfahrt über Rampen (Löcher im Boden `ShapeGeometry`), Röhre unter Häusern und Kreuzungen, oben fährt man normal drüber. Die alten überdachten Block-Tunnel entfallen.
- Brücken: kein Geländer mehr; seitlich herunterfahren = freier Fall (`y/vy` im City-Zweig von `stepCar`).
- Sichtbare Stadtgrenze (rot-weiße Sperre plus Zaun). Verstecken blendet nur noch Namensschild und Kartenpunkt aus, das Auto bleibt sichtbar.
- Polizeijagd (`race/chase.ts`, `ChasePanel.tsx`, in `RaceView`): Menüknopf in der offenen Stadt-Lobby, Einladung per Broadcast-Ereignis `ch` (`inv`/`ans`/`go`/`end`), Ersteller wählt Bandit und Polizei-Bots (0–6). Bandit: schnelles schwarzes fliegendes Auto (Roadster 255), immer auf der Karte; Polizei: weiße Autos mit Blaulicht, langsamer (215, Admin-Fahrer fliegender Roadster). Fangen = Berührung auf gleicher Ebene (`caught`, 4,6 m); nach 6 Minuten gewinnt der Bandit. Bots rechnet nur der Ersteller (`copDrive`, Straßen-Routing, Tunnel/Brücke-Ausfahrt, Stuck-Reset) und sendet sie als `pb-…`-Fahrer.

## Update 127
- Tunnel-Netz: `TUNNELS` sind Segmente `{dir:'x'|'z', c, a0, a1}` (4 Ost-West, 4 Nord-Süd, Kreuzungen unter der Stadt). `tunnelD` = tiefste Röhre am Punkt, `tunnelClamp` = Wandbegrenzung als Vereinigung aller Röhren (Abbiegen an Kreuzungen), Einfahrt über Rampen an den Enden (Winkel-Test je Achse). Szene: Boden/Wände in 1-m-Stücken, Wandöffnungen an Kreuzungen, Löcher im Boden für alle Rampen, Minimap zeichnet alle Segmente.
- Polizei-Bots (`copDrive`): Selbstreparatur (Schaden ≥ 55 → 2 s stehen, dann `repair` → dmg 0), Hänger-Erkennung auch über zu geringe Fortbewegung (< 6 m in 2 s), Tempo vor Kreuzungen/Tunnelausgang, folgen dem Bandit unter die Erde (`entranceFor`, `tunnelWaypoint`, Zwischenziel 28 m voraus auf der Mittellinie).
- Jagd-Robustheit: `end` und `go` werden mehrfach gesendet, `ce/cw` im Funkpaket als zusätzlicher Weg für das Ende; Bandit/Polizei werden nie automatisch versteckt, Bandit bleibt länger sichtbar/auf der Karte.
- Coins: `race_chase_reward` (0108): mit Menschen 80 + 25 × weitere Spieler + 6 × Bots, nur Bots 40 + 6 × Bots, Verlierer 50 %, mind. 20 s, 60 s Abstand, Tageslimit `chase_coin_daily` (3000). Anzeige im Ergebnisdialog.
- Kamera: im Tunnel (`lvl === -1`) automatisch Cockpit, danach wieder die gewählte Ansicht (`camEff`; gespeicherte Einstellung bleibt unverändert).
- Server-Fix: `slotForKey` gibt für offene Lobbys (`open-…`) immer Spiel-Datenbank 0 zurück (der Hash über die Listenlänge lief zwischen Geräten mit unterschiedlicher Liste auseinander → man sah sich nicht).
- Berge hinter der Stadt (`race/mountains.ts`): Tor (x ∈ ±14) in der Nordmauer, Außenbereich x ±900 / z 720–2150 mit eigener Grenze (`cityPush`, Mauerstück 4 m dick), drei Berge (`MOUNTAINS`, `hillH` glatte Kuppen), Hauptstraße und Serpentinen (`outRoads`, `spiral`, Steigung ≤ 14 %). Physik: am Boden folgt `y` dem Gelände, Fall bis dorthin sonst, Steigung bremst/beschleunigt; Szene: Wiese, Bergnetze mit Höhenfarben, Straßenbänder; Karte jetzt hochformatig (`WORLD`); Bots fahren durchs Tor (`gateTgt`) und frei im Außenbereich. Bergtunnel noch nicht gebaut.
- Mehrere Banditen: Nachrichten `inv`/`go` tragen `bandits[]` (altes `bandit` wird noch gelesen), jeder Bandit wird einzeln gefangen (`cau`-Meldung, mehrfach gesendet), Polizei gewinnt, wenn alle gefangen sind, Banditen nach 6 min. Bots jagen den nächsten freien Banditen. Anzeige „x/y gefangen“.
- Minimap (Stadt): rund, dreht sich mit (Fahrtrichtung oben, Nordmarke), Ausschnitt um das eigene Auto; Reichweite 120–2200 m und Größe klein/mittel/groß, ein/aus über den Knopf „⚙ Karte“ (localStorage `vt-race-map`); Leute außerhalb des Kreises als kleiner Punkt am Rand, Banditen immer rot (gefangene grau).

## Update 128
- Flug in der Stadt (`physics.ts`, nur `mode === 'city'`): stufenlos – Flug-Taste halten steigt (bis ~17 m/s, max. 320 m), loslassen = langsames Sinken (~5,5 m/s), kein Zeitlimit/Laden mehr (`fly`/`cool` bleiben 0, die Höhe steckt in `y`/`vy`). Andere Modi behalten den zeitlich begrenzten Flug. Untergrund = max(Gelände, Hausdach `roofH`): man landet und fährt auf Dächern, vom Dach herunter sinkt man langsam; Häuser blockieren nur, wenn man unterhalb des Dachs ist (`cityPush` liefert `top`). Brücke: im Sinkflug auf dem Deck landen (`vy ≤ 0,5`), mit Flug-Taste wieder abheben.
- `caught` vergleicht echte Höhen (`y`), Hinweis im HUD „Höhe x m“, Düsen/Flammen bei Höhe > 1 m.
- Kamera (Verfolger): hängt hinten oben über dem Auto und folgt Berg, Dach und Flughöhe (geglättet, nie unter dem Gelände); „Von unten“-Ansicht ebenfalls geländebewusst.

## Update 129
- Flug-Grenzen (Stadt): Höhengrenze 80 m über dem Untergrund, in der Polizeijagd 30 m (`Input.chase`). In der Jagd zählen Häuser als Wände in jeder Höhe, Dächer sind keine Landefläche (`roofH` wird ignoriert) – der Bandit kann nicht auf einem Haus warten.
- Polizei fährt in der Jagd einen Roadster (fliegt); Bots steigen auf, wenn der Bandit mehr als 2,5 m höher ist, und sinken sonst.
- Auto bleibt in der Luft gerade (`levelAir`, kein Nicken), Düsenstrahl/Rauch folgt der echten Flughöhe und reicht nur ~5 m unter das Auto (`carFx(..., alt)`).

## Update 130
- Fix: Gelände-/Dach-Höhen (`camGround`, Hang-Neigung, Düsen) gelten nur in der Stadt (`levelAir`); auf Rennstrecken sind dieselben Koordinaten ohne Berge/Häuser – dort wechselte die Kamera in Kurven ständig die Höhe. Rennstrecken-Kamera wieder wie vor Update 128.
- Admin-Supercar fliegt in der Stadt nicht mehr (Stats `fly:false`, kein FLIEGEN-Knopf); in der Polizeijagd Höhengrenze für alle 10 m (`Input.chase`).

## Update 131
- Tunnel-Zufahrten: die Straßen-Tunnel sind an den Enden geschlossen (`r0/r1: false` in `TunnelSeg`, kein Abtauchen mitten auf der Straße). Einfahrten sind 7 Garagen (`GARAGES` in `city.ts`, Stichröhren Index 8–14): Man fährt von der Straße durch ein Tor unter einem Sturz (`Bld.lo`, Unterkante 6 m; Auto passt darunter durch, `cityPush` liefert `lo`) in ein Haus und dort die Rampe hinunter. Scene: Ground-Löcher/Schilder nur an offenen Enden, Stirnwände an geschlossenen Enden, gelbes Torschild.
- Parkhaus (`parkhaus.ts`, Block bei (-180,-180)): Metall, 4 Ebenen à 4,5 m, Rampenspur im Westen (Zick-Zack: Rampe k steigt nach Norden, Wenden am Südende der Ebene, Platte der Gegenspur), Einfahrt von Süden. `parkSurfaces(x,z)` liefert die Flächenhöhen, `parkPush` die Wände; Physik: `surfAt(x,z,y,chase)` = max(Gelände, Dach, Parkhausflächen), jeweils nur wenn ≤ y+1,4 m. Minimap zeichnet das Parkhaus blau.
- Polizei-Bots: `entranceFor` → beste Garage (`bestGarage`), erst zur Straße vor dem Tor, vor dem Tor auf Schritttempo, dann geradeaus hinein; unten Bremsen vor Querröhren (`cross`), Ausgang bei Bandit oben über die beste Garage.
- Enthält alle Änderungen von Update 130.
- Hotfix: mkStats nutzte isCity vor der Deklaration (TDZ, leerer Bildschirm); jetzt def.mode.

## Update 132
- Garagen: Gehweg des Garagen-Blocks hat ein Loch über der Rampe (sonst grauer Boden von oben); „Mauer“ vor dem Tunnel war das seitliche Wegschieben bei Tempo ≤ 3 in der Rampe – jetzt fährt man bei Ausrichtung (>0,75) auch im Schritttempo hinunter. Minimap: orange Punkte mit Pfeil an jeder Garage, Parkhaus blau mit weißem Rand.
- Parkhaus: Cockpit-Kamera automatisch (wie im Tunnel) unter dem Dach; `PARK_TOP` = 19 (Brüstung des Dachs), darüber keine Wand; `inParkXZ`. Jagd-Flughöhe um das Parkhaus (45 m Rand) bis PARK_TOP+10, damit man oben landen kann.
- Bots: `parkNav` (chase.ts) – von außen zur Straße vor der Einfahrt, dann geradeaus hinein, im Zick-Zack hinauf/hinunter (Ostspur zurück nach Süden), Schritttempo; Bots fliegen am Parkhaus nicht mehr (`inParkXZ` in `want`).
- Admin-Supercar: Schalter „In der Stadt fliegen erlauben“ im Supercar-Feld (localStorage `vt-race-supfly`).

## Update 133
- Bots am Parkhaus: Ziel im Parkhaus → Bot fährt zur Straße davor, hält (`hold` in `parkNav`), fliegt über die Wand (PARK_TOP+2,5), fliegt direkt aufs Dach, sinkt über dem Parkhaus und fährt dann die Rampen hinunter zum Bandit (`want` in RaceView: außen bis 45 m Rand fliegen, innen nicht).
- Motorrad in der Jagd: `chaseCar(role, admin, bot, onBike)` → wer mit Motorrad kommt, fährt Bandit/Polizei als `sportbike`.
- Showroom (`Showroom.tsx`, erster Tab im Autohaus): 3D-Drehscheibe (`Turntable`, Three.js mit RoomEnvironment, Ziehen dreht), Pfeile wechseln das Auto, Lieblingsauto + Lackfarbe je Auto lokal (`carPrefs.ts`: `vt-car-pick`, `vt-car-color:<id>`; `useRaceCars` wendet die Farbe an), Kaufen, Tuning mit „+N km/h“-Animation, Fahrwert-Balken, darunter „Offene Lobby“ und „Rennen“ (`RaceMenu` mit `only`/`onClose`).
- Eigene Autos (Admin): `customCar.ts` – Bauplan als JSON (nur Zahlen/Formen, streng geprüft mit `parseCarSpec`), `buildSpecCar`, Registry (`registerCustom` setzt KIND_STATS/KIND_DIMS/BIKE_KINDS/CUSTOM_FLY, kind = `c_<id>`), `carList` registriert alle Baupläne; RaceView lädt `carList` beim Start (auch Autos der Mitfahrer). `AdminCarBuilder.tsx`: KI-Anweisung kopieren, JSON einfügen, Vorschau, Werte/Preis/Fliegen/Motorrad, speichern. SQL `0109_custom_cars.sql`: `cars.spec`, `car_list` mit spec, `admin_car_custom_save`.

## Update 134
- Parkhaus: 2 Untergeschosse (`PARK.under = 2`, Ebenen −9 / −4,5 / 0 / 4,5 … 18); Rampen und Platten für k = −under…floors−1, Betonwände der Grube, Bodenloch in der Szene. Wandkollision `parkPush(x, z, y, px, pz)` ist „swept“ (Seite aus der vorigen Position), damit man nicht in der Wand stecken bleibt.
- Rennstrecke rund um die Stadt (`RING` in mountains.ts, Mittellinie |x|,|z| = 800, ±15 m, `ringPath`, Teil von `outRoads`; Start/Ziel-Tor bei (0, −800), Randsteine). `cityPush`: Außenwelt ist ein Rechteck x ±900, z −900…2150 (Weltgrenze schiebt zurück), Stadtmauer 4 m dick, nur Nordtor offen; `WORLD.z0 = −900`. Wiese für Süd/West/Ost in der Szene, Minimap zeigt den Ring.
- Bots außerhalb: `copDrive` fährt zum Nordtor und um die Mauer über die Ecken der Rennstrecke (`RING_CORNERS`, `routeLen`, `wallBlocks`), vor Ecken Tempo raus.
- Wald (`forest.ts`): ~7000 deterministische Bäume um die Berge (nicht auf Straßen, Gipfel kahl), als InstancedMesh (Stamm + 2 Kronen); Kollision `treePush` (Stammradius 1,1 m × Größe), eingebunden in `stepCar`.
- Tests: `ring.test.ts`, Parkhaus-/Chase-Tests erweitert.

## Update 135
- Parkhaus neu: drei Westspuren/Ost-Spur (`PARK_LANES` up/dn/east, Abfahrt D1 von der Straße bis −4,5, D2 −9→−4,5), `parkShaft` (Fliegen nur im Schacht), Tunnelanschluss `PARK_TUNNEL` (z −180, y −4,5) als Stub Nr. 15 in `TUNNELS`; Ost-Betonwand mit 12-m-Tunnelöffnung. Bots: `parkNav` höhenbewusst (Ebenen `floor((y+2.25)/4.5)`).
- Zu Fuß (`foot.ts`, `walkerMesh.ts`): X aussteigen/einsteigen (auch parkende Autos, Polizei-Bots), N Auto spawnen, Shift rennen. Aussteigen während der Fahrt (Schwung 0,55·v, Fallschaden >11 m/s), Auto rollt aus (`tickParked`). Überfahren: `carHit` (Schaden (|v|−2)·3,4, Rückstoß, Betäubung), HP 100, KO → Respawn (0,0). Polizisten steigen aus, laufen zum Banditen und fassen ihn. Netz: `wk:1` in Remote-Payload, parkende Autos als Pseudo-Remotes `pk-<uid>-<i>`, Cop-Walker `<pbid>w`.
- Häuser innen (`interior.ts`, `interiorMesh.ts`): jedes begehbare Haus (ohne Garagen-Häuser mit `lo`) hat eine Tür zur Blockseite (`doorSide`), Treppenhaus mit gegenläufigen Läufen (`flights`), Zimmer durch Zwischenwände mit Türlücken, Geschosshöhe `FLOOR_H` 3,6. `interiorPush`/`interiorSurfaces` sind in `foot.ts` (`pushAt`/`groundAt`) eingebunden; Szene: Türdekal an der Fassade, `showInterior(b)` blendet die Außenhaut aus (Vertexbereiche je Haus) und baut den Innenraum; Kamera bleibt im Haus. `CELL` aus city.ts exportiert.
- Tests: `foot.test.ts`, `interior.test.ts` (Tür, Läufe, Weg Straße→Obergeschoss), Parkhaus-/Chase-Tests.

## Update 136
- Parkhaus: über der Abfahrt (dn-Spur) liegt ab Ebene 1 eine Platte (`parkSurfaces`, `scene.ts`), sonst kam man von der Mittelspur nicht auf die nächste Rampe; `parkShaft` = nur Rampenspur (up). `carY` in RaceView zog Autos unter der Erde auf Höhe 0 (Anzeige „oben“, Physik „unten“) – jetzt wird negatives y gezeichnet.
- Figur (`foot.ts`): Springen (Leertaste/Knopf, `JUMP_V`), in der Luft ×1,3 schneller, Teilschritte ≤ 0,2 m (kein Durchlaufen von Wänden), `lvl` (Tunnel −1 / Brücke 1) mit `tunnelClamp`; Aussteigen überall außer in der Luft, `exitFromCar` sucht einen Ausstiegsort auf Höhe des Autos; `footConfig`/`setFootSpeeds` (Admin: Lauf-/Sprinttempo). Name über der Figur (`makeWalker(…, name)`). Joystick links (`joyRef`) statt Pfeile, Springen-Knopf.
- Kamera zu Fuß: im Parkhaus nah, unter der Decke, in den Wänden; im Tunnel mit `tunnelClamp`.
- Polizisten: `walkNav` (interior.ts) – Tür, Zimmer-Türlücken (Breitensuche über Zellen, `gaps`/`cellOf`), Treppenläufe auf/ab.
- Mitfahren/Sitze: `seatConfig.n` (Admin im Showroom, Standard 4); wer zuerst einsteigt, fährt; Mitfahrer senden `rd:<Fahrer-ID>`, sind unsichtbar und spiegeln das Auto (`tickRide`); Zähler `n/m` oben. Verlassene Autos anderer (`pk-<uid6>-<id>`) sind einsteigbar; Übernahme per Broadcast-Event `cl` (Besitzer und Peers entfernen das Auto). Auto-Auswahl beim Spawnen (Liste der eigenen Autos via `useRaceCars`).
- Server-Split: `gameRealtime.ts` speichert die vom Server gelieferte Datenbank-Liste lokal (`gamedbs-v1`), RaceView verbindet erst, wenn sie geladen ist (`gameDbsLoaded`), und verbindet bei Änderung neu (`onGameDbsChange`). Pausierte Datenbanken müssen im Admin (Spiel-Datenbanken) aus der Liste entfernt werden.
- SQL `0110_car_seats.sql`: Einstellungen car_seats/walk_speed/run_speed, `admin_seats_set`, `admin_foot_set`, `race_super_info` mit seats/walk/run.

## Update 137
- Leben im Auto (`RaceView`: `myHp`, `prevV/prevDmg/burnT/wreck`): Autoschaden kostet Leben (×0,9), brennendes Auto (>85 % Schaden) −3,5 HP/s und explodiert nach 7 s; Einschlag aus >300 km/h (Tempo halbiert, `car.hit`) oder Schaden-Sprung >40 oder HP 0 → `explode()` (Feuer-/Rauchpartikel, 3,6 s, danach neues Auto bei Start). HP gehen beim Aus-/Einsteigen mit (`exitFromCar(…, hp)`), keine Erholung im Auto, HP-Balken auch im Auto sichtbar.
- Spawn: N öffnet die Auswahl, N dann 1…9 spawnt das n-schnellste eigene Auto (`bestFirst` nach `carKmh`).
- Verkaufen: SQL `car_sell` (50 % von `car_owned.paid`, Tuning wird gelöscht), Showroom-Knopf mit Bestätigung.
- Netz: Kanal-Status wird überwacht (CHANNEL_ERROR/TIMED_OUT/CLOSED + Wächter alle 4 s) und neu verbunden; vorher konnte ein toter Empfangskanal weiter per REST senden (einer sieht den anderen, umgekehrt nicht).


## Update 138
- **Keine Stadtmauer mehr**: `cityPush` (city.ts) kennt nur noch Häuser und die Außenwelt-Grenzen; scene.ts zeichnet nur noch die äußeren Streifen. Polizei-Bots (`copDrive`, chase.ts): von draußen zuerst zur Randstraße (`edge`), aus der Stadt hinaus zum nächsten Randknoten (`exitPt`), dann querfeldein. Mauer-Tests (city/foot/mountains/ring) auf „frei“ umgestellt.
- **Mitfahrer-Ruckeln**: Der Fahrer ignoriert Mitfahrer (`r.rd`) in der Crash-Schleife gegen Remotes.
- **Joystick**: analoges Drehen (`WalkInput.turn`, Totzone 0,12, Kurve ^1,6) mit Empfindlichkeit ×0,2–1 (Zahnrad-Panel, localStorage `vt-race-joyturn`, Standard 0,5).
- **Figurenfarbe**: Farbwähler im Panel (`vt-race-wcolor`), per Payload `wc` an andere gesendet. (Minecraft-Skin: Teil B, nur Pro.)
- **Schlagen**: Taste Q / Knopf SCHLAG; nächste Figur zu Fuß im Umkreis 2,6 m und ±70°, Event `pn` {to,dx,dz}; Empfänger: −8 Leben, Rückstoß, kurz betäubt. Kein Schaden gegen Polizei-Bot-Figuren.
- **Explosion**: `blastAt/tickBlasts` (Feuerball, Druckwelle, Lichtblitz, 14 Trümmer); Zähler `ex` im Payload, andere sehen die Explosion ebenfalls.
- **Umkreis rendern** (Panel, aus/250/500/900 m, `vt-race-radius`): Kamera-Far, Nebel, Pixelratio 1, Remotes außerhalb ausgeblendet.
- **Börsencrash**: SQL 0111 (`admin_stock_crash`, Spalten crash_at/crash_from_cents/crash_ratio, `_stock_tick` erweitert): jede Aktie fällt linear in 5 h auf 0–10 % des Kurses; Button auf der Börse-Seite (nur Admin).
- Teil B (offen): Shops, Fitnessstudio, Bank-Raub, Minecraft-Skin (Pro).


## Update 139 (Teil B)
- **Besondere Häuser** (`race/poi.ts`): feste Auswahl aus den Stadthäusern: 1 Bank (gelb, B), 4 Shops (cyan, S), 2 Fitnessstudios (pink, F). Leuchtsäule + Schild an der Tür, Markierung auf der Karte (am Rand, wenn weit weg). Benutzen: zu Fuß innerhalb 7 m der Tür, Knopf oder Taste G.
- **Vokabel-Abfrage** (`race/VocabShop.tsx`): Fragen aus dem eigenen Lernpool (`getLearningPool`), Antwort prüft `isAnswerCorrect`, jede richtige zählt der Server (`race_perk_answer`, mind. 1,5 s Abstand). Shop: 10 richtige = 30 Min Spawn-Limit 5 statt 2 (zählt nur gespawnte Autos, `Parked.sp`). Fitness: 10 richtige = +10 Leben, höchstens +100 (`hpCfg.max` in foot.ts, HP-Balken relativ). Das Vokabelwissen (Stufen) wird dabei nicht verändert.
- **Bank**: Knopf AUSRAUBEN → `race_bank_claim` (Server, global), dann normale Polizeijagd mit 6 Bots (`startChase(..., heist=true)`, Event `go` mit `hz:1`). Wer zu Fuß in 11 m um die Bank steht, wird automatisch Mit-Räuber (bis 4, Server: Beitritt 40 s lang). Überlebt man die 6 Minuten ungefangen: `race_bank_pay` (1000 Coins, durch Räuber geteilt, erst nach 350 s). Danach 16 Min gesperrt (6 Jagd + 10 Ruhe); Status `race_bank_status` wird an der Bank alle 4 s abgefragt.
- **Eingabefelder**: Tastatur-Steuerung ignoriert Eingaben in `<input>`.
- SQL 0112 (race_perks, race_bank, 5 RPCs). Offen: Minecraft-Skin-Import (nur Pro).


## Update 140
- **Häuser mit Einrichtung** (`race/poi.ts`, `interior.ts`): Bank, Krankenhaus, 4 Shops, 2 Fitnessstudios sind jetzt „Hallen“ (`setSpecial`: ein Raum, ein Geschoss, keine Treppen) mit `Layout.solids` (Quader mit Höhe/Farbe; `deco` = nur Anzeige). `interiorPush` kollidiert mit ihnen, `interiorMesh` zeichnet sie. Einrichtung wird in kanonischen Koordinaten (u quer, v Tiefe, `canon(b)`) geplant. Bedienstellen (`Spot`: Tresor, Theke, Gerät) → Knopf/Taste G (`spotNear`).
- **Bank**: Tresen + Tresor (Tür dreht auf, `rs.setVault`). Am Tresor G → `race_bank_claim`, Jagd mit 6 Bots startet, Mit-Räuber sind alle zu Fuß im Bankhaus. Fluchtautos (ein Bandit-Roadster je Räuber, `Parked`) stehen vor der Tür, man bleibt zu Fuß. Auszahlung wie in 139.
- **Shop-Theke / Fitness** (`VocabShop.tsx`, SQL 0113): richtige Vokabeln = Punkte (`race_perks.shop_correct/gym_correct`), Artikel per `race_perk_buy`: Autoschlüssel (5 Spawns), Turnschuhe (×1,4), Sprungfedern (×1,35), Schutzweste (halber Schaden), Erste Hilfe (heilt), Training (+10 Leben). Admin: alles gratis, 8 Auto-Spawns ohne Lernen.
- **Krankenhaus**: Tod (Auto explodiert, zu Fuß 0 Leben, Mitfahrer) → zu Fuß im Bett, kein neues Auto (`hospitalRespawn`). Mitfahrer nehmen Schaden/Feuer des Fahrer-Autos, sterben bei dessen Explosion (`tickRide`, `ex`-Zähler).
- **Vollbild**: Knopf oben Mitte (Fullscreen-API, sonst die ganze Seite).
- **Minecraft-Skin** (Pro/Admin): PNG 64×64/64×32 im Zahnrad-Panel, `makeSkinWalker` (Skin-UV, Überlagerungsschicht, altes Format gespiegelt), Event `sk` (alle 15 s und bei Änderung), Empfang prüft Daten-URL (<45 kB).
- **Schlag-Animation**: `poseWalker(..., punch)` (0..1, 320 ms): Arm schnellt vor, Oberkörper dreht, Ausfallschritt; andere sehen sie über den Zähler `pc` im Payload.
- Einstellungen (Joystick-Drehung, Figurenfarbe, Render-Umkreis, Minecraft-Skin) liegen jetzt im Menü „⚙ Karte & Steuerung“ (vorher nur im Supercar-Panel).

## Update 141
- **SWAT-Panzerwagen** (`kind: 'swat'`): stats.ts (`KIND_STATS/DIMS`, `canFly`, `KIND_TOUGH` 0,24 → bei 200 km/h ≈ 10 % Schaden, `seatsOf` = 10), physics.ts (`CarStats.tough`, in `stepCar`/`crash` auf den Schaden angewandt), scene.ts (`addSwatParts`: Panzerplatten, Rammbügel, Lichtbalken, Geschützturm, „SWAT“-Schrift), CarArt-Bild, SQL `0114_swat_car.sql` (kaufbar im Autohaus, 250 000).
- **Polizeiwache** (poi.ts, Art `police`, blau „P“, weit weg von der Bank): Empfang, Zellen, Waffenkammer (Spot `armory`: Einbruch → 6-Min-Jagd, bei Sieg Schlagstock, `vt-baton` in localStorage, Schlag 22 statt 8 Schaden) und Schlüsselbrett (Spot `steal`: SWAT-Wagen klauen → sofort Jagd mit 4 fliegenden SWAT-Wagen). `crimeRef`, `startChase(..., heist, extra)`.
- **Jagd-Umbau** (RaceView): Polizei startet an der Wache (`mkPbot`); „gefangen“ nur noch durch Tod als Bandit (`hospitalRespawn` → `markCaught`); keine Berührungs-Fang-Regel mehr; Polizei-Bots rammen mein Auto (`crash` beidseitig), schlagen zu Fuß (`pn` mit Schaden `d`). Ein Schlag auf einen Polizisten (`killCop`) schaltet ihn aus → SWAT-Wagen von der Wache (höchstens 4 je Jagd).
- **SWAT-Männer** (swatMan.ts: selbstgemalter 64×64-Skin + Pistole): steigen bei Bandit zu Fuß aus (`deploySwat`, höchstens 10 je Jagd), `swatMen` laufen/schießen (Leuchtspur `tracer`, Event `sd` = Schuss-Schaden), SWAT-Wagen-Geschütz der Bots (`swatTruckFire`). Menschlicher Fahrer: Taste Q im SWAT-Wagen (`fireSwat`), nur als Polizist in der Jagd oder Admin, geradeaus entlang der Fahrtrichtung, kein Button. Männer werden über `k:'swatman'` zu den Mitspielern gesendet.
- **Polizeihof** (city.ts `POLICE`, eigener Block bei (−420, 300), `Bld.col/door/kind`): blaue Wache (Tür nach Süden zum Hof, weißes Dach-Band, Schilder, Lichtbalken), Parkplatz mit Buchten, offene Garage (Wände + Dach mit Sturz `lo`), 6 Startplätze (`POLICE.slots`) für die Streifenwagen/SWAT; Deko in scene.ts `policeDecor`. Innen hellblau.
- Nicht im Browser getestet.

## Update 142
- **SWAT-Panzerung**: im SWAT-Wagen kein Autoschaden/Feuer/Explosion; Leben kostet nur Beschuss (`hurtByShot`) und Rammen durch schnellere Polizei (`swatHurt`). Rammt man selbst einen Polizei-Bot, kostet es nichts, aber `callSwat()` ruft SWAT.
- **Schlagstock** sichtbar (`addBaton` in swatMan.ts): eigener Läufer, Polizei-Bots, Mitspieler (Payload `bt`). **Skin bleibt in der Jagd** (`makeFootMesh`, Remote-Läufer).
- **Geschütz zielt** auf letzte Mausposition/Tippen (`aimDir`, Raycast auf Bodenebene; Klick/Tipp feuert, Q auch).
- **Krankenhaus-Block** wie die Wache (`HOSPITAL` in city.ts, `blockLayout`; scene.ts `blockDecor` mit rotem Kreuz, Hof, Rettungsgarage); Betten mit bunten Decken.
- **Rettung** (RaceView `startRescue/tickRescue`): Tod → bewusstlos; Krankenwagen-Bot fährt aus der Garage, parkt mit Abstand, 2 Sanitäter holen die Trage, Fahrt zurück, Aufwachen im Bett (`hospitalWake`). Sofort-Wiederbelebung 10 Coins (`race_revive_pay`, Admin gratis); Admin kann andere per Event `rv` freigeben. Sanitäter-Spieler im Dienst (Events `mc/mp/mh`, Payload `dn/dc/od`) fahren selbst; Lohn `race_duty_pay('medic')`.
- **Dienste**: Spot `dress` (Ankleidezimmer) in Wache/Krankenhaus schaltet Dienst (`dutyRef`). Polizei im Dienst wird bei Bankraub/Diebstahl/Waffenkammer zur Wache teleportiert (`go`-Nachricht mit `cops`, `ex`), Lohn `race_duty_pay('police')`. Gestrichelte Wegelinie (`dashMesh`, `setRoute`) auf den Straßen.
- SQL `0115_race_duty_revive.sql`. Nicht im Browser getestet.

## Update 143
- **Rettung repariert**: Ziel ist nur noch das Krankenhaus-**Gelände** (`inHospGrounds`: Block + 20 m Straße), dann Aufwachen im Bett (Bot und Sanitäter-Spieler). Vorher fehlte das Setzen der Sanitäter-Figuren; jetzt werden sie pro Frame positioniert/animiert (Arme tragen), mit Notfall-Teleports bei Hängern (`stuckFor`).
- **Krankenwagen** als eigene Art `ambulance` (stats.ts, scene.ts `addAmbulanceParts`: rote/gelbe Streifen, Kreuze, „AMBULANZ“ (vorn gespiegelt), Blaulichtbalken vorn/hinten, Hecktüren); **Sanitäter-Skin** (`medicSkin/makeMedic` in swatMan.ts).
- Nicht im Browser getestet.

## Update 144
- **Bank** als echtes Haus (city.ts `BANK`, scene.ts `bankDecor`): Parkplatz, Eingangs-Säulen, Schilder, 6 zerschlagbare Glasscheiben (`RaceScene.smashGlass`; Schlag oder schnelles Auto an der Fassade → `tickBank`/`smashAt`), Geldautomaten innen und außen (Spot `atm` → `raceAtmPay`, 40 s Pause), Tresortür mit Rad und Gold (interiorMesh.ts).
- **Waffenladen** (poi.ts `weapons`, Spot `weapons`, `WeaponShop.tsx`, `gear.ts`): Schussweste, Helm, Schlagstock, Pistole kaufen (`raceGearBuy`, Admin gratis). Wirkung: Weste ×0.55, Helm ×0.85 auf `hpCfg.armor`; Stock = `batonRef`; Pistole zu Fuß (Tippen/Klick, 150 m, Polizisten brauchen 3 Treffer). Sichtbar am Läufer (`addGear`, Payload `gr` für Mitspieler).
- **SWAT-Geschütz für alle** im SWAT-Wagen: `fireGun('swat')`, 400 m, 3D-Zielen (Kamerastrahl mit Zielhilfe, auch nach oben/unten), Treffer per Linie–Punkt in 3D.
- **Polizei-Taktik**: SWAT-Männer in 2 Gruppen (vorrücken / Feuerschutz im Wechsel, eigener Winkel um das Ziel), Pistole hebt beim Schuss den Arm; Fuß-Polizisten teilen sich in Deckungsschützen (12 m, schießen) und Nahkämpfer (umkreisen).
- **Streifenwagen** (`patrols`, `tickPatrols`): 4 Wagen fahren lokal durch die Straßen (nicht synchronisiert); Rammen → `ramPatrol` startet eine Jagd.
- SQL `0116_race_gear_atm.sql`. Nicht im Browser getestet. Hubschrauber folgen in Update 145.

## Update 145
- **Fahndungsstufe (Sterne 0–5)** in RaceView (`stars`, `setStars`, `addStar`, `tickStars`, `startWanted`): Jagdstart gibt 1 Stern (SWAT-Auto klauen 2), jede weitere Tat +1 (Polizist/SWAT-Mann ausgeschaltet, Polizeiauto hart gerammt, Passanten getötet bis 2 Sterne), 3 Sterne rufen SWAT, 5 doppelt. Pro 60 s ohne neue Tat verschwindet ein Stern, Tod (`startRescue`) löscht alle. Mindestabstand 3,5 s zwischen Sternen. HUD oben mittig.
- **Passanten** (`peds`, `tickPeds`, `spawnPed`, `killPed`, `punchPed`): bis 16 Läufer auf den Gehwegen um den Spieler (nur lokal, nicht synchronisiert); sterben beim Überfahren, per Schlag, Pistole oder Geschütz; wer geschlagen wird kämpft zurück (5 Schaden über `pedHurt` im Fuß-Tick) oder flieht. 2 getötete Passanten → Zeugen rufen die Polizei (`startWanted('ped')`).
- Geplant: 146 Hubschrauber, 147 Armee-Gelände. Nicht im Browser getestet.

## Update 146 (Armee, Hubschrauber, Panzer, Rettungshubschrauber)
- **Fahrzeuge**: `stats.ts` kennt `tank`, `heli`, `armycar` (`isArmored`: swat/tank/heli); Modelle in `armyMesh.ts` (`makeArmyModel`, von `scene.ts buildCar` benutzt; Rotor dreht in `place`). Der Hubschrauber hat eigene Flugphysik `heli.ts` (`stepHeli`: W/S vor/zurück, A/D/Pfeile drehen, E hoch, R runter, bleibt über Dächern).
- **Armee-Gelände** am Nordrand (city.ts `ARMY` bei 420/660): Zaun 2,6 m (überkletterbar) mit Tor im Süden, Wachtürme, Kaserne (Spot `vest` = Schutzweste bis zum Tod), Parkplatz-Decor `armyDecor`. POI `army` mit Spots `tank/heli/armycar` (Fahrzeug klauen per G → `stealArmy`: Waffenauto 2, Panzer 3, Hubschrauber 4 Sterne; Fahrzeug kommt nach 120 s wieder).
- **Wachen** (`soldiers`, `tickSoldiers`): 6 Soldaten patrouillieren und schießen nur, was sie sehen (Blickkegel + `clearLine`); sie sind per Schlag, Pistole, Geschütz ausschaltbar (+Stern).
- **Armee-Angriff** (`armyWave`, `mkArmy`, `heliAI`, `tankFire`): ab 3 Sternen 2 Kampfhubschrauber + 3 Panzer, jeder weitere Stern +1/+1 (nur beim Jagd-Besitzer). Hubschrauber umkreisen in 28 m und schießen von oben, Panzer feuern aufs Ziel. Schüsse mit `a:1` verletzen Panzer/Heli-Fahrer; Rammen und Polizei nicht (`hurtByShot(d, onFoot, army)`).
- **Steuerung Panzer/Heli**: Geschütz über `fireGun('swat')` (Panzer 320 m, Heli 260 m, Q = geradeaus, Tippen = Zielpunkt), Wischen/Ziehen dreht (`onPtrRot`), Panzer dreht auf der Stelle.
- **Rettungshubschrauber** (`mkMedHeli`, `heliTo`, `holdCar`): stirbt man mehr als 260 m vom Krankenhaus entfernt, fliegt ein Heli zur Leiche, landet, die Sanitäter tragen wie beim Krankenwagen und er fliegt zum Krankenhaus zurück. Außerdem wird das Rettungsauto jetzt lokal sichtbar platziert (`place` für `rescue.amb`).
- Offen: Polizeihubschrauber (mit SWAT), Armee-Fahrzeuge werden nur beim Jagd-Besitzer simuliert, Passanten/Wachen/Streifenwagen nur lokal. Nichts im Browser getestet.

## Update 147 (Bank aus Stahl und Glas, Waffen in der Hand, Armee-Feinschliff)
- **Bank** (`scene.ts bankDecor`, `Bld.hid`): das Haus wird nicht mehr als Kasten gezeichnet (`hid` = solide, aber eigenes Modell): Stahlstützen (Doppel-T), Riegel, Decken, X-Verstrebungen, Glasfassade aus 2 Scheibenreihen je Raster (am Eingang unten offen), Schalterhalle (Tresen, Tresorblock mit goldenem Rad, Lampen) und Dach mit Überstand. `smashGlass(x,z,r,y?)` zerschlägt Scheiben (ohne y nur die untere Reihe); Pistole/Gewehr/Geschütz durchschlagen Scheiben entlang der Schusslinie (`fireGun`). Innenwände der Bank sind fast durchsichtig.
- **Waffen in der Hand** (`gunMesh.ts`: `makeGunModel`, `armUp`): Pistole, Sturmgewehr, Scharfschützengewehr sitzen in der rechten Hand, der Arm ist nach vorn gestreckt (`armUp` nach `poseWalker`; Spieler, Mitspieler, Soldaten, SWAT-Männer). `gear.ts addGear` Bits 8/16/32.
- **Kaserne**: Sturmgewehr (Schussrate 110 ms, braucht mehr Treffer) und Scharfschützengewehr (600 m, ein Treffer, Zoom mit Z oder Knopf) als Spots `rifle/sniper` (gelten bis zum Tod, `armyGun`).
- **Zaun klettern**: Spots `climb` rund um den Zaun (G / Knopf) springen auf die andere Seite (`climbFence`). Soldaten schießen nur auf Ziele innerhalb des Geländes (`inBase`).
- **Fahrzeug behalten**: Banditen in einer Polizeijagd behalten ihr Fahrzeug (`applyRole`, `carSwapped`) – also auch den geklauten Panzer oder Hubschrauber; nur Polizei bekommt Dienstfahrzeuge.
- **Aussehen**: Panzer, Kampfhubschrauber (`armyMesh.ts`), Armee-Gelände (`armyDecor`: Zaun mit Maschendraht und Stacheldraht, Wachtürme, Kaserne mit Fensterbändern, Bunker, Fahrzeughalle, Tanks, Fahne, Flutlicht, Sandsäcke, Tor); Zaun/Türme/Kaserne sind `hid`. Vorschau per Playwright gerendert (Bank, Armee, Fahrzeuge), Spielszenen nicht.

## Update 148 (Fahndung zu Fuß, Mord-Sterne, Dach-Fix, Iron Man, Heli-Sanitäter, Straßenroute)
- `startWanted` gilt jetzt auch zu Fuß und ersetzt eine beendete Jagd; als Polizist im Dienst wechselt man bei eigener Straftat die Seite. `addStar` startet ab 2 Sternen ohne Jagd automatisch eine (`'crime'`).
- Mord: `markHit(id)` merkt den zuletzt getroffenen Spieler (nur eigene Schläge/Schüsse), geht er innerhalb 8 s zu Boden (`dn` 0→1), gibt es +2 Sterne (`killedPlayer`, nicht für Polizisten).
- Dach: `groundAt` (foot.ts) kennt die Dachhöhe (`bi.h`/`roofH`), man fällt nach dem Aussteigen auf einem Dach nicht mehr durch.
- `route.ts`: `streetRoute` (Dijkstra auf dem Straßenraster, Start/Ziel auf nächstes Straßenstück) für die gestrichelte Linie; Test `route.test.ts`.
- Autos ohne Fahrer (`parked`) explodieren nach 7 Treffern (`blowParked`, Armee-Fahrzeuge ausgenommen).
- SQL `0117_revive_pro_free.sql`: Pro belebt gratis wieder (wie Admin).
- Sanitäter-Einsatz: Patient > 260 m vom Krankenhaus → eigener Rettungshubschrauber (`heli`, `#f8fafc`, ohne Waffe), Aufladen/Abliefern nur in Bodennähe.
- Iron Man (nur Admin, Taste I/Button): `ironman.ts` `stepIron` (E hoch, R runter, W/S, A/D, Shift schneller), schießt wie Sturmgewehr, Rüstung über `addGear` Bit 64 (synchron über `gr`).
- Nicht im Browser getestet.

## Update 149 (Wände, Bank-/Kasernen-Obergeschoss, Raketen, Ego, Q-Schuss)
- `shoot.ts`: `shotWallT/shotBlocked` – Kugeln und Raketen stoppen an Hauswänden (Bank-Glas und Zaun lassen durch, Türen offen, Dächer frei, im selben Haus zählen Innenwände nicht). `fireGun` und alle Schützen (SWAT-Männer, Polizeiautos, Soldaten, Heli) prüfen damit.
- `glass.ts`: kaputte Bankscheiben (`addGlassHole`, von `smashGlass` in scene.ts) sind für Fußgänger durchlässig (`interiorPush` überspringt dort die Außenwand, je Geschoss).
- `interior.ts`: `Layout.fh` (Geschosshöhe) und `setSpecial(b, solids, {floors, fh, stair})`: Bank 2 Geschosse (fh 8,15, Treppe 15 m), Kaserne 2 Geschosse (fh 5, Treppe 11 m). `interiorMesh.ts` und die Kamera nutzen `fh`.
- Armee ab 4 Sternen (2 Heli + 3 Panzer, je Stern mehr). Panzer (Spieler) nehmen von Schüssen keinen Schaden, nur von Raketen/Panzerfaust (`hurtByShot(..., rocket)`). Armee-Heli (Bot) mit 140 Trefferpunkten abschießbar (`wreckBot`), Panzer-Bots nur durch Raketen.
- Raketen (`launchRocket/tickRockets/rocketBlast`): Spieler im Armee-Heli startet mit M/Button eine Lenkrakete (Ziel vor dem Heli, ±30°, 520 m, 3,5 s Nachladen); jeder dritte Soldat feuert Panzerfäuste auf Fahrzeuge. Treffer tötet alles im Radius 7–8 m, Autos explodieren, Netz-Event `rk`.
- Passanten brauchen 2 Treffer (Pistole), SWAT/Polizei 3.
- Q schießt mit Waffe (Pistole/Gewehr/Sniper/Iron Man) automatisch auf das nächste Ziel in Bildmitte (`fireGun(.., auto)`).
- Ego-Perspektive zu Fuß (V/Button), mit Sniper-Zoom immer (behebt den Zoom nach unten); eigene Figur dann unsichtbar.
- Touch: RUNTER-Button im Heli (und Iron Man), RAKETE-Button.
- Kaserne: Schlüsselbrett-Spots (Panzer/Heli/Waffenauto) holen das nächste freie Fahrzeug im Hof.
- Nicht im Browser getestet.

## Update 150
- Q-Auto-Aim zielt auf die nächste Person im Blickfeld (±55°) statt blind geradeaus.
- `race/ironSuit.ts`: Iron-Man-Rüstung (rot/gold) mit Anlege-Animation (`SUIT_MS`, `tickSuit`, `suitReady`); Gear-Bit 64. Iron Man ist unverwundbar und schießt Lenkraketen ohne Cooldown.
- Sterne bis 7; ab 6 Sternen greifen 2 feindliche Iron Men an (`ironBots`, `ironWave`), ihre Mega-Raketen zerstören auch Panzer.
- `cars/fr.ts`: Französisch per Wörterbuch (`FR`) + Muster (`PATTERNS`) und MutationObserver-DOM-Übersetzer (Texte, aria-label, title, placeholder), Wahl in localStorage `vt-race-lang`; `LangToggle.tsx` in Cars-Seite und RaceView. Neue deutsche Texte brauchen einen Eintrag in `fr.ts`.

## Update 151
- Absturz bei ≥6 Sternen: Sterne-Anzeige rief `'★'.repeat(5 - stars)` mit negativer Zahl auf (RangeError → schwarzer Bildschirm); jetzt `Math.max(0, …)`.
- Explosionen (`blastAt`): feste 2 Lichter + geteilte Geometrien, höchstens 6 gleichzeitig, höchstens 24 Raketen – neue PointLights/Geometrien pro Explosion ließen bei Raketen-Salven den WebGL-Kontext abstürzen.
- `blowPbot`: Streifen-/SWAT-Wagen explodieren bei Raketen oder vollem Schaden (SWAT).
- Iron Man: Admin kann ihn per Broadcast `ig` vergeben/nehmen (nur für die Sitzung, kein SQL); Teleport (T) zu Spielern in der Stadt; Iron-Man-Raketen zielen auf Polizei/Soldaten/SWAT/Spieler, nicht auf Passanten oder geparkte Autos (`pickRocketTarget(..., humans)`).
- Skin: nach dem asynchronen Skin-Tausch werden Anzug/Weste/Helm/Stock/Waffe neu angelegt (`scene.makeWalker`).

## Update 152
- Trennung Spiele/Vokabeln: `features/vocabApi.ts` ist die einzige Schnittstelle der Spiele zum Vokabel-Teil, `src/boundary.test.ts` prüft das, `SPIELE_SCHNITTSTELLE.md` beschreibt Bereiche, Register und Vorgehen für neue Spiele.
- Offline: `public/sw.js` cacht die App-Hülle (Navigation netzwerk-zuerst, Dateien stale-while-revalidate, nie fremde Hosts); `lib/offlineCache.ts` + `services/rpc.ts`: Lese-RPCs (`get_learning_pool`, `get_book_boxes`, `get_card_box`) aus dem Zwischenspeicher, `submit_session` offline in Warteschlange (`offline-…`-Kennung, `add_repeat_answers` dazu wird übersprungen), Senden beim Start/`online`.
- Serverlast: `rpc()` begrenzt auf 6 parallele Aufrufe und fasst gleiche Lese-Aufrufe zusammen.
- Zu Fuß laufende Figuren (Sanitäter, Polizisten, SWAT) nutzen `walkSafe.ts` (gerade, wenn frei, sonst Straßenroute um Häuser). Rettungshubschrauber bleibt nach der Landung stehen (`holdCar` ohne Bremsrückwärtsflug).
- Update-Knopf: `VersionTag withButton` + `forceUpdate()` (lib/serviceWorker.ts) meldet Service Worker ab, leert Caches und lädt neu.
- **Feuerwehr:** `city.ts` `FIRE`-Block (-300,-420) mit `kind:'fire'`; `poi.ts` Feuerwache (Erdgeschoss Spinde/Ankleidezimmer = Dienst `f`, Obergeschoss Schlafsaal/Küche/Rutschstange; Spots haben `fl` = Geschoss, `spotNear` filtert nach Geschoss); `scene.ts` Löschzug `firetruck` (Body `fire`, `addFireParts`, Drehleiter `setFireLadder`), `blockDecor(..., fire)`; `gear.ts` Bit 128 = Feuerwehr-Jacke/Helm (Skin bleibt, Gear wird nach Skin-Tausch neu angelegt).
- `fire.ts`: Brände rein zeitgesteuert (alle 4 Min, `fireOfSlot`/`currentFire`), `flameLevel`, `douse`, `parkSpot`; RaceView „Brände und Feuerwehr“: Flammen/Rauch/Glühen, Wasser (`sprayAt`; Löschzug Q/Tippen, Feuerwehrmann zu Fuß Schlauch), Löschbroadcast `fo`, Bot-Löschzug (`fireBot`, nur der Spieler mit kleinster Kennung startet ihn), Alarm (`startAlarm` → Obergeschoss → Rutschstange → Halle → Einsteigen), Löschzüge in der Halle (`keepTrucks`). Lohn: `race_duty_pay('fire')` (SQL 0118, 120 Coins/60 s).
- Gebäude: `facade.ts` fügt allen Stadthäusern (außer Bank/Kaserne/Zäune/Garagen) Dachrand, Gesims (Farbe je Sonderhaus), Sockel, Dachaufbauten und Vordächer als ein Mesh hinzu (`scene.ts` buildCity). Brände zeigen zusätzlich Flammenkegel (`flames` in RaceView) und ein Glühen. Vorschaubilder entstehen mit einer temporären Seite + Playwright (swiftshader), nicht im Projekt.
