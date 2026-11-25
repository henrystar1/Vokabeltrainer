# Spiele und Vokabel-Teil – getrennte Bereiche

Ziel: Spiele können in eigenen Chats gebaut und geändert werden, ohne dass der Vokabel-Teil (Lernen, Bücher, Tests …) versehentlich kaputtgeht.

## Aufteilung
| Bereich | Ordner | Darf was? |
|---|---|---|
| **Vokabel-Teil** | `features/learning, cram, entry, french, irregular, books, memorize, speedread, test, ocr, progress`, `services/learning, entry, books` | gehört nicht den Spielen – Spiele-Chats ändern hier **nichts** |
| **Spiele** | `features/cars` (Auto-Spiel, `race/`), `parkour`, `games`, `gambling`, `stocks`, `duel`, `math`, `panic`, `advent` | eigener Ordner pro Spiel; nur die erlaubten Schnittstellen unten |
| **Gemeinsam** | `components/ui`, `lib`, `services/rpc, koins, play, cars, …`, `features/koins/WalletProvider`, `features/auth` | von beiden nutzbar, aber nur abwärtskompatibel ändern |

## Die Vokabel-Schnittstelle: `src/features/vocabApi.ts`
Spiele holen sich Vokabeln/Fragen **nur** hierüber:
`getLearningPool`, `getBookEntries`, `buildIndexes`, `makeQuestion`, `isAnswerCorrect`, `shuffle`, `mulberry32` (+ Typen `Question`, `Indexes`, `VocabLike`, `Rng`).
`src/boundary.test.ts` lässt den Build/Test scheitern, wenn ein Spiel den Vokabel-Teil direkt importiert.

## Ein neues Spiel anlegen
1. Ordner `src/features/<spiel>/` (Code, Tests, Modelle). Seite in `src/pages/<Spiel>.tsx`, Route in `App.tsx`.
2. In diese Datei (unten) eintragen: was das Spiel anzeigt, welche Schnittstellen es nutzt.
3. Coins/Belohnungen nur über die vorhandenen RPCs (`services/koins`, `services/play`), neue RPCs als neue SQL-Datei in `supabase/migrations/` (nächste freie Nummer).
4. Neuen Ordner in `GAME_DIRS` von `src/boundary.test.ts` eintragen.
5. Texte fürs Auto-Spiel zusätzlich in `features/cars/fr.ts` (Französisch) ergänzen.

## Spiele-Register
| Spiel | Ordner | Zeigt | Nutzt |
|---|---|---|---|
| Auto-Spiel / Stadt | `features/cars` | Showroom, Rennen, offene Stadt (Polizei, Sanitäter, Armee …) | vocabApi (Shop-Fragen), WalletProvider, `services/cars`, Supabase-Realtime (Lobby) |
| Parkour | `features/parkour` | Parkour-Level mit Lernfragen | vocabApi, `services/play` |
| Minispiele | `features/games` | Snake, Tetris, 2048, Flappy … | vocabApi (nur `Rng`/`shuffle`), `services/play` |
| Glücksspiel / Börse | `features/gambling`, `features/stocks` | Coins-Spiele | `services/koins`, `services/chips`, `services/stocks` |

## Offline und Last (gilt für alle)
- `services/rpc.ts`: alle Datenbank-Aufrufe laufen darüber – höchstens 6 gleichzeitig, Lese-Aufrufe (Vokabelpool, Fächer) werden offline aus dem Zwischenspeicher bedient, `submit_session` wird offline vorgemerkt und später gesendet (`lib/offlineCache.ts`).
- `public/sw.js`: speichert die App-Dateien, damit sie ohne Internet startet.
