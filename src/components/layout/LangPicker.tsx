import { NAV_LANGS } from '../../lib/navigation'
import { useSettings } from '../../features/settings/SettingsProvider'

/** Sprachauswahl im Menü: Englisch und Französisch oben, Spanisch und Latein darunter. Setzt die Lernsprache. */
export default function LangPicker({ collapsed = false, onPick }: { collapsed?: boolean; onPick?: () => void }) {
  const { settings, update } = useSettings()
  return (
    <div className={`grid gap-1 px-1 pb-2 ${collapsed ? 'grid-cols-1' : 'grid-cols-2'}`} role="radiogroup" aria-label="Lernsprache">
      {NAV_LANGS.map((l) => {
        const on = settings.learn_language === l.id
        return (
          <button
            key={l.id}
            role="radio"
            aria-checked={on}
            title={l.label}
            onClick={() => { if (!on) void update({ learn_language: l.id }); onPick?.() }}
            className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold transition ${on ? 'bg-accent-cyan/15 text-accent-cyan shadow-[inset_0_0_0_1px_rgb(var(--c-cyan)/0.35)]' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-100'}`}
          >
            {collapsed ? l.short : l.label}
          </button>
        )
      })}
    </div>
  )
}
