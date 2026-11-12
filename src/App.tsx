import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import VersionTag from './components/ui/VersionTag'
import { PANIC_KEYS, usePanic } from './features/panic/panic'
import { useLocks } from './features/locks/LocksProvider'
import type { LockKey } from './services/koins'
import { useAuth } from './features/auth/AuthProvider'
import AppShell from './components/layout/AppShell'
import RequireAuth from './components/layout/RequireAuth'
import { isSupabaseConfigured } from './lib/supabaseClient'
import BookDetail from './pages/BookDetail'
import BookPage from './pages/BookPage'
import Admin from './pages/Admin'
import Books from './pages/Books'
import { Spinner } from './components/ui/States'
import ConfigMissing from './pages/ConfigMissing'
import Dashboard from './pages/Dashboard'
import ImportBook from './pages/ImportBook'
import Leaderboard from './pages/Leaderboard'
import Copy from './pages/Copy'
import Learn from './pages/Learn'
import Placeholder from './pages/Placeholder'
import Feedback from './pages/Feedback'
import Games from './pages/Games'
import Gambling from './pages/Gambling'
import MathPage from './pages/Math'
import Memorize from './pages/Memorize'
import HomeworkPage from './pages/Homework'
import AdventPage from './pages/Advent'
import LootPage from './pages/Loot'
import OnlineGamesPage from './pages/OnlineGames'
import Stocks from './pages/Stocks'
import SpeedRead from './pages/SpeedRead'
import Cars from './pages/Cars'
import OnlineGamePage from './pages/OnlineGame'
import WebsitesPage from './pages/Websites'
import Cram from './pages/Cram'
import Flashcards from './pages/Flashcards'
import Practice from './pages/Practice'
import Conjugate from './pages/Conjugate'
import Irregular from './pages/Irregular'
import Gender from './pages/Gender'
import Chat from './pages/Chat'
import Board from './pages/Board'
import Presence from './pages/Presence'
import Duels from './pages/Duels'
import DuelPlay from './pages/DuelPlay'
import LiveDuel from './pages/LiveDuel'
import LiveDuelRoom from './pages/LiveDuelRoom'
import Parkour from './pages/Parkour'
import TeamRunRoom from './pages/TeamRunRoom'
import OpenDeathrun from './pages/OpenDeathrun'
import AdminRuns from './pages/AdminRuns'
import Quests from './pages/Quests'
import Sprint from './pages/Sprint'
import Profile from './pages/Profile'
import Shop from './pages/Shop'
// three.js ist groß: der 3D-Druck-Shop wird erst beim Öffnen geladen.
const PrintShop = lazy(() => import('./pages/PrintShop'))
const Umzug = lazy(() => import('./pages/Umzug'))
import Search from './pages/Search'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
import Grammar from './pages/Grammar'
import PlusPage from './pages/PlusPage'
import Test from './pages/Test'
import ForgotPassword from './pages/auth/ForgotPassword'
import Login from './pages/auth/Login'
import Impressum from './pages/legal/Impressum'
import Datenschutz from './pages/legal/Datenschutz'
import Register from './pages/auth/Register'
import ResetPassword from './pages/auth/ResetPassword'

/** Nur für Mods und Admins; alle anderen landen auf der Startseite. */
function StaffOnly({ children }: { children: ReactNode }) {
  const { isStaff, profileReady } = useAuth()
  if (!profileReady) return <Spinner />
  return isStaff ? <>{children}</> : <Navigate to="/" replace />
}

/** Zeigt statt der Seite einen Hinweis, wenn der Admin die Funktion gerade abgeschaltet hat. */
function Gate({ k, children }: { k: LockKey; children: ReactNode }) {
  const { locked } = useLocks()
  const panic = usePanic()
  // Im Panik-Modus soll nichts auf die Seite hinweisen: einfach zurück zum Start.
  if (panic && PANIC_KEYS.includes(k)) return <Navigate to="/" replace />
  if (locked.has(k)) return <Placeholder title="Gerade deaktiviert" phase="Der Admin hat diese Funktion vorübergehend abgeschaltet." />
  return <>{children}</>
}

/** Auf den Seiten ohne Menü (Anmelden usw.) steht die Versionsnummer fest unten; in der App zeigt sie AppShell. */
function AuthVersion() {
  const { pathname } = useLocation()
  const p = pathname.replace(/\/+$/, '').split('/').pop() ?? ''
  if (!['anmelden', 'registrieren', 'passwort-vergessen', 'passwort-neu'].includes(p)) return null
  return <VersionTag className="fixed inset-x-0 bottom-2 pointer-events-none" />
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />
  return (
    <>
    <Routes>
      <Route path="impressum" element={<Impressum />} />
      <Route path="datenschutz" element={<Datenschutz />} />
      <Route path="umzug" element={<Suspense fallback={<Spinner />}><Umzug /></Suspense>} />
      <Route path="anmelden" element={<Login />} />
      <Route path="registrieren" element={<Register />} />
      <Route path="passwort-vergessen" element={<ForgotPassword />} />
      <Route path="passwort-neu" element={<ResetPassword />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="buecher" element={<Gate k="books"><Books /></Gate>} />
          <Route path="buecher/import" element={<Gate k="books"><ImportBook /></Gate>} />
          <Route path="buecher/:bookId" element={<Gate k="books"><BookDetail /></Gate>} />
          <Route path="buecher/:bookId/eingabe" element={<Gate k="books"><BookPage /></Gate>} />
          <Route path="suche" element={<Gate k="search"><Search /></Gate>} />
          <Route path="lernen" element={<Gate k="learn"><Learn /></Gate>} />
          <Route path="abschreiben" element={<Gate k="copy"><Copy /></Gate>} />
          <Route path="test" element={<Gate k="test"><Test /></Gate>} />
          <Route path="grammatik" element={<Gate k="grammar"><Grammar /></Gate>} />
          <Route path="plus" element={<Gate k="plus"><PlusPage /></Gate>} />
          <Route path="spiele" element={<Gate k="games"><Games /></Gate>} />
          <Route path="gambling" element={<Gate k="gambling"><Gambling /></Gate>} />
          <Route path="mathe" element={<Gate k="math"><MathPage /></Gate>} />
          <Route path="auswendig" element={<Gate k="memorize"><Memorize /></Gate>} />
          <Route path="hausaufgaben" element={<Gate k="homework"><HomeworkPage /></Gate>} />
          <Route path="advent" element={<Gate k="advent"><AdventPage /></Gate>} />
          <Route path="schnelllesen" element={<SpeedRead />} />
          <Route path="autohaus" element={<Gate k="cars"><Cars /></Gate>} />
          <Route path="boerse" element={<Gate k="stocks"><Stocks /></Gate>} />
          <Route path="mehrspieler" element={<Gate k="online"><OnlineGamesPage /></Gate>} />
          <Route path="mehrspieler/:id" element={<Gate k="online"><OnlineGamePage /></Gate>} />
          <Route path="loot" element={<Gate k="loot"><LootPage /></Gate>} />
          <Route path="websites" element={<Gate k="websites"><WebsitesPage /></Gate>} />
          <Route path="crashkurs" element={<Gate k="cram"><Cram /></Gate>} />
          <Route path="karteikarten" element={<Gate k="cards"><Flashcards /></Gate>} />
          <Route path="ueben" element={<Gate k="practice"><Practice /></Gate>} />
          <Route path="konjugieren" element={<Gate k="conjugate"><Conjugate /></Gate>} />
          <Route path="unregelmaessig" element={<Gate k="irregular"><Irregular /></Gate>} />
          <Route path="genus" element={<Gate k="gender"><Gender /></Gate>} />
          <Route path="chat" element={<Gate k="chat"><Chat /></Gate>} />
          <Route path="online" element={<Gate k="presence"><Presence /></Gate>} />
          <Route path="brett" element={<Gate k="board"><Board /></Gate>} />
          <Route path="quests" element={<Gate k="quests"><Quests /></Gate>} />
          <Route path="sprint" element={<Gate k="sprint"><Sprint /></Gate>} />
          <Route path="duell" element={<Gate k="duels"><Duels /></Gate>} />
          <Route path="duell/:id" element={<Gate k="duels"><DuelPlay /></Gate>} />
          <Route path="live-duell" element={<Gate k="duels"><LiveDuel /></Gate>} />
          <Route path="live-duell/:id" element={<Gate k="duels"><LiveDuelRoom /></Gate>} />
          <Route path="parkour" element={<Gate k="duels"><Gate k="parkour"><Parkour /></Gate></Gate>} />
          <Route path="deathrun" element={<Gate k="duels"><OpenDeathrun /></Gate>} />
          <Route path="laeufe" element={<Gate k="duels"><AdminRuns /></Gate>} />
          <Route path="team/:id" element={<Gate k="duels"><TeamRunRoom /></Gate>} />
          <Route path="statistik" element={<Gate k="stats"><Stats /></Gate>} />
          <Route path="rangliste" element={<Gate k="ranking"><Leaderboard /></Gate>} />
          <Route path="shop" element={<Gate k="shop"><Shop /></Gate>} />
          <Route path="druckshop" element={<Gate k="print"><Suspense fallback={<Spinner />}><PrintShop /></Suspense></Gate>} />
          <Route path="profil" element={<Profile />} />
          <Route path="feedback" element={<Gate k="feedback"><Feedback /></Gate>} />
          <Route path="einstellungen" element={<Settings />} />
          <Route path="verwaltung" element={<StaffOnly><Admin /></StaffOnly>} />
          <Route path="*" element={<Placeholder title="Nicht gefunden" phase="Fehlerseite" />} />
        </Route>
      </Route>
    </Routes>
    <AuthVersion />
    </>
  )
}
