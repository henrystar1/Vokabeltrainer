# Vokabeltrainer – Architektur

## Tech-Stack
- Frontend: React + TypeScript, Vite, Tailwind CSS, React Router, lucide-react (Icons)
- Backend: Supabase (Auth, PostgreSQL, Row Level Security, RPC-Funktionen)
- Tests: Vitest (Lernalgorithmus als reine, testbare Logik)
- Hosting: statischer Build (`dist/`), deploybar auf Vercel/Netlify; nur `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` im Frontend, niemals der Service-Key.

## Projektstruktur
```
vokabeltrainer/
├─ ARCHITEKTUR.md
├─ package.json, vite.config.ts, tsconfig.json, tailwind.config.js, index.html
├─ .env.example
├─ supabase/
│  └─ migrations/0001_schema.sql        (Tabellen, RLS, Views)
└─ src/
   ├─ main.tsx, App.tsx, index.css
   ├─ types/          (Domain-Typen: Book, Unit, Page, Vocabulary, Progress …)
   ├─ lib/            (supabaseClient, Konstanten)
   ├─ utils/          (answerMatching, weightedPick, dates)
   ├─ services/       (booksService, vocabService, learningService, statsService …)
   ├─ hooks/          (useAuth, useBooks, useSettings …)
   ├─ components/     (layout/Sidebar, layout/MobileNav, ui/Card, ui/Button, ui/StarField …)
   ├─ pages/          (Dashboard, Books, Learn, Test, Stats, Leaderboard, Settings, Login)
   └─ features/learning/   (algorithm.ts, algorithm.test.ts, session.ts)
```

## Datenbanktabellen
| Tabelle | Zweck |
|---|---|
| languages | Erweiterbare Sprachliste (`en`, `fr`); neue Sprache = neue Zeile |
| profiles | 1:1 zu auth.users; öffentlicher Anzeigename (eindeutig, per Trigger bei Registrierung angelegt) |
| user_settings | Lernrichtungen, Vokabeln pro Runde (1–200), Groß-/Kleinschreibung |
| books | Name, Sprache (`en`, `fr`, erweiterbar), Beschreibung, owner_id |
| units | Buch, Nummer/Name, Sortierung |
| pages | Buch, Seitenzahl, **unit_id** (Unit kann über mehrere Seiten gehen; die Seite gehört zur Unit) |
| vocabulary | Deutsche Grundform je Buch (normalisiert für Duplikaterkennung) |
| vocabulary_placements | Verweis Vokabel → Seite + Position (dieselbe Vokabel kann an mehreren Seiten/Units referenziert werden) |
| translations | Mehrere richtige Übersetzungen je Vokabel |
| user_vocabulary_progress | **user + vocabulary + learning_level** (1–5 in 0,5er-Schritten, CHECK-Constraint) |
| learning_sessions | Lern-/Testrunden mit Modus, Zeit, Ergebnis |
| learning_answers | Einzelantworten je Session und Richtung |
| daily_stats | Aggregierte Tageswerte je Nutzer (Basis für Statistik, Rangliste, Durchschnitte) |

## Sicherheit (RLS)
- Alle Tabellen mit RLS. Bücher/Units/Seiten/Vokabeln/Übersetzungen nur für den Besitzer.
- Fortschritt, Sessions, Antworten, Statistik: nur `user_id = auth.uid()`.
- Rangliste und Durchschnitte ausschließlich über `security definer`-Funktionen/Views, die nur Anzeigename und Punkte bzw. aggregierte Werte liefern.

## Lernalgorithmus (Kurzfassung)
- Start Stufe 1, Bereich 1–5, halbe Stufen intern.
- Beide richtig: +1 · eine richtig: +0,5 · beide falsch: −1 · Clamp auf [1, 5].
- Auswahl gewichtet (niedrige Stufe = hohes Gewicht, Stufe 5 nicht fällig), ohne Zufallsdominanz durch Mindestgewicht.
- Wiederholungsrunde („Fehler wiederholen“) ändert den Lernstand nicht.

## Phasenplan
1 Gerüst + UI · 2 Supabase/Auth · 3 Bücher/Units/Seiten/Vokabeln · 4 Vokabeleingabe · 5 Suche · 6 Lernmodus · 7 Algorithmus · 8 Test · 9 Statistik · 10 Rangliste · 11 Import/Export · 12 OCR-Vorbereitung
(Der Algorithmus wird bereits vorgezogen test-first umgesetzt, da er reine Logik ist.)
