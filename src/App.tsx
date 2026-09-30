import { Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import RequireAuth from './components/layout/RequireAuth'
import { isSupabaseConfigured } from './lib/supabaseClient'
import BookDetail from './pages/BookDetail'
import BookEntry from './pages/BookEntry'
import Books from './pages/Books'
import ConfigMissing from './pages/ConfigMissing'
import Dashboard from './pages/Dashboard'
import ImportBook from './pages/ImportBook'
import Leaderboard from './pages/Leaderboard'
import Learn from './pages/Learn'
import Placeholder from './pages/Placeholder'
import Search from './pages/Search'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
import Test from './pages/Test'
import ForgotPassword from './pages/auth/ForgotPassword'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ResetPassword from './pages/auth/ResetPassword'

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
          <Route path="buecher/:bookId/eingabe" element={<BookEntry />} />
          <Route path="suche" element={<Search />} />
          <Route path="lernen" element={<Learn />} />
          <Route path="test" element={<Test />} />
          <Route path="statistik" element={<Stats />} />
          <Route path="rangliste" element={<Leaderboard />} />
          <Route path="einstellungen" element={<Settings />} />
          <Route path="*" element={<Placeholder title="Nicht gefunden" phase="Fehlerseite" />} />
        </Route>
      </Route>
    </Routes>
  )
}
