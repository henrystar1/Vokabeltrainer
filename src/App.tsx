import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
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
          <Route path="statistik" element={<Stats />} />
          <Route path="rangliste" element={<Leaderboard />} />
          <Route path="shop" element={<Shop />} />
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
