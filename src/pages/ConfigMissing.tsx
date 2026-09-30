import AuthLayout from './auth/AuthLayout'

export default function ConfigMissing() {
  return (
    <AuthLayout title="Nicht konfiguriert" subtitle="Die Verbindung zu Supabase fehlt.">
      <p className="text-sm text-slate-300">
        Beim Build waren <code className="font-mono text-accent-cyan">VITE_SUPABASE_URL</code> und{' '}
        <code className="font-mono text-accent-cyan">VITE_SUPABASE_PUBLISHABLE_KEY</code> nicht gesetzt. Lokal gehören sie in die Datei
        <code className="font-mono"> .env</code>, auf GitHub in Settings → Secrets and variables → Actions → Variables.
      </p>
    </AuthLayout>
  )
}
