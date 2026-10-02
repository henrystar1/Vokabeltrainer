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
