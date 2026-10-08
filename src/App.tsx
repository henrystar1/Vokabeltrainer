import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
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
import Learn from './pages/Learn'
import Placeholder from './pages/Placeholder'
import Feedback from './pages/Feedback'
import Games from './pages/Games'
import Gambling from './pages/Gambling'
import Practice from './pages/Practice'
import Conjugate from './pages/Conjugate'
import Gender from './pages/Gender'
import Chat from './pages/Chat'
import Board from './pages/Board'
import Presence from './pages/Presence'
import Duels from './pages/Duels'
import DuelPlay from './pages/DuelPlay'
import Quests from './pages/Quests'
import Sprint from './pages/Sprint'
import Profile from './pages/Profile'
import Shop from './pages/Shop'
import Search from './pages/Search'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
import Test from './pages/Test'
import ForgotPassword from './pages/auth/ForgotPassword'
import Login from './pages/auth/Login'
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
  if (locked.has(k)) return <Placeholder title="Gerade deaktiviert" phase="Der Admin hat diese Funktion vorübergehend abgeschaltet." />
  return <>{children}</>
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />
  return (
    <Routes>
      <Route path="anmelden" element={<Login />} />
      <Route path="registrieren" element={<Register />} />
      <Route path="passwort-vergessen" element={<ForgotPassword />} />
      <Route path="passwort-neu" element={<ResetPassword />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="buecher" element={<Books />} />
          <Route path="buecher/import" element={<ImportBook />} />
          <Route path="buecher/:bookId" element={<BookDetail />} />
          <Route path="buecher/:bookId/eingabe" element={<BookPage />} />
          <Route path="suche" element={<Search />} />
          <Route path="lernen" element={<Learn />} />
          <Route path="test" element={<Test />} />
          <Route path="spiele" element={<Gate k="games"><Games /></Gate>} />
          <Route path="gambling" element={<Gate k="gambling"><Gambling /></Gate>} />
          <Route path="ueben" element={<Practice />} />
          <Route path="konjugieren" element={<Conjugate />} />
          <Route path="genus" element={<Gender />} />
          <Route path="chat" element={<Gate k="chat"><Chat /></Gate>} />
          <Route path="online" element={<Presence />} />
          <Route path="brett" element={<Board />} />
          <Route path="quests" element={<Gate k="quests"><Quests /></Gate>} />
          <Route path="sprint" element={<Gate k="sprint"><Sprint /></Gate>} />
          <Route path="duell" element={<Gate k="duels"><Duels /></Gate>} />
          <Route path="duell/:id" element={<Gate k="duels"><DuelPlay /></Gate>} />
          <Route path="statistik" element={<Stats />} />
          <Route path="rangliste" element={<Leaderboard />} />
          <Route path="shop" element={<Gate k="shop"><Shop /></Gate>} />
          <Route path="profil" element={<Profile />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="einstellungen" element={<Settings />} />
          <Route path="verwaltung" element={<StaffOnly><Admin /></StaffOnly>} />
          <Route path="*" element={<Placeholder title="Nicht gefunden" phase="Fehlerseite" />} />
        </Route>
      </Route>
    </Routes>
  )
}
