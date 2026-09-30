import { Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import Placeholder from './pages/Placeholder'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="buecher" element={<Placeholder title="Bücher" phase="Phase 3" />} />
        <Route path="lernen" element={<Placeholder title="Lernen" phase="Phase 6" />} />
        <Route path="test" element={<Placeholder title="Test" phase="Phase 8" />} />
        <Route path="statistik" element={<Placeholder title="Statistik" phase="Phase 9" />} />
        <Route path="rangliste" element={<Placeholder title="Rangliste" phase="Phase 10" />} />
        <Route path="einstellungen" element={<Placeholder title="Einstellungen" phase="Phase 2" />} />
        <Route path="*" element={<Placeholder title="Nicht gefunden" phase="Fehlerseite" />} />
      </Route>
    </Routes>
  )
}
