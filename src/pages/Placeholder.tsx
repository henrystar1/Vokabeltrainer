import Card from '../components/ui/Card'

interface PlaceholderProps {
  title: string
  phase: string
}

/** Leerer Zustand für Bereiche, die in späteren Phasen umgesetzt werden. */
export default function Placeholder({ title, phase }: PlaceholderProps) {
  return (
    <div className="space-y-6">
      <header>
        <p className="label-mono">{phase}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      </header>
      <Card className="flex min-h-[220px] items-center justify-center text-center text-slate-400">
        Dieser Bereich wird in {phase} umgesetzt.
      </Card>
    </div>
  )
}
