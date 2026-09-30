export default function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-space-700"
    >
      <div className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  )
}
