/** Frosch auf Seerose: blinzelt, fängt eine Fliege, springt. Reine CSS-/SVG-Animation. */
export function FrogScene() {
  return (
    <svg className="fg-svg" viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <radialGradient id="fgPond" cx="50%" cy="30%" r="80%">
          <stop offset="0" stopColor="#0e7490" />
          <stop offset="1" stopColor="#042f2e" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#fgPond)" />
      <circle className="fg-ripple r1" cx="50" cy="82" r="8" fill="none" stroke="#a5f3fc" strokeWidth="1.5" />
      <circle className="fg-ripple r2" cx="50" cy="82" r="8" fill="none" stroke="#a5f3fc" strokeWidth="1.5" />
      <ellipse cx="50" cy="82" rx="30" ry="9" fill="#15803d" />
      <path d="M50 82L72 76" stroke="#052e16" strokeWidth="1.4" />
      <g className="fg-frog">
        <ellipse cx="34" cy="76" rx="9" ry="4" fill="#22c55e" />
        <ellipse cx="66" cy="76" rx="9" ry="4" fill="#22c55e" />
        <ellipse cx="50" cy="66" rx="21" ry="16" fill="#4ade80" />
        <ellipse cx="50" cy="71" rx="13" ry="9" fill="#bbf7d0" />
        <ellipse className="fg-throat" cx="50" cy="63" rx="7" ry="3.2" fill="#86efac" />
        <path d="M37 59Q50 67 63 59" fill="none" stroke="#166534" strokeWidth="1.8" strokeLinecap="round" />
        <line className="fg-tongue" x1="50" y1="60" x2="73" y2="31" pathLength="1" stroke="#fb7185" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="38" cy="50" r="8.5" fill="#4ade80" />
        <circle cx="62" cy="50" r="8.5" fill="#4ade80" />
        <circle cx="38" cy="50" r="5.6" fill="#fefce8" />
        <circle cx="62" cy="50" r="5.6" fill="#fefce8" />
        <circle className="fg-pupil" cx="39.5" cy="50" r="3" fill="#0f172a" />
        <circle className="fg-pupil" cx="63.5" cy="50" r="3" fill="#0f172a" />
        <circle className="fg-lid" cx="38" cy="50" r="6" fill="#4ade80" />
        <circle className="fg-lid" cx="62" cy="50" r="6" fill="#4ade80" />
      </g>
      <g className="fg-fly">
        <circle r="1.6" fill="#111827" />
        <ellipse className="fg-wing" cx="-1.6" cy="-2" rx="2.2" ry="1.1" fill="#e0f2fe" opacity="0.85" />
        <ellipse className="fg-wing" cx="1.6" cy="-2" rx="2.2" ry="1.1" fill="#e0f2fe" opacity="0.85" />
      </g>
    </svg>
  )
}

/** Kleiner Frosch (Seitenansicht) für den Namen-Effekt. */
export function FrogMini() {
  return (
    <svg className="fg-mini" viewBox="0 0 28 20" aria-hidden focusable="false">
      <ellipse cx="9" cy="16.5" rx="7" ry="2.4" fill="#16a34a" />
      <ellipse cx="14" cy="11.5" rx="10" ry="7.2" fill="#4ade80" />
      <ellipse cx="14" cy="14.5" rx="6.2" ry="3.6" fill="#bbf7d0" />
      <circle cx="19" cy="5.6" r="3.6" fill="#4ade80" />
      <circle cx="11" cy="5.6" r="3.6" fill="#4ade80" />
      <circle cx="19.6" cy="5.4" r="2.2" fill="#fefce8" />
      <circle cx="11.6" cy="5.4" r="2.2" fill="#fefce8" />
      <circle cx="20.3" cy="5.4" r="1.1" fill="#0f172a" />
      <circle cx="12.3" cy="5.4" r="1.1" fill="#0f172a" />
      <path d="M17 12.6Q22 14.6 25.5 11.6" fill="none" stroke="#166534" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
