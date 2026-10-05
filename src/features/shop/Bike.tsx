import { memo } from 'react'

/** Gemeinsame Fahrrad-Grafik (Profilbild und Namen-Effekt): drehende Räder, tretende Beine. */
const BikeSvg = memo(function BikeSvg() {
  return (
    <svg className="bk-svg" viewBox="0 -14 64 54" aria-hidden focusable="false">
      <g className="bk-wheel">
        <circle cx="14" cy="28" r="10" fill="none" stroke="#e2e8f0" strokeWidth="2" />
        <path d="M14 18V38M4 28H24M7 21L21 35M21 21L7 35" stroke="#94a3b8" strokeWidth="1" />
      </g>
      <g className="bk-wheel">
        <circle cx="50" cy="28" r="10" fill="none" stroke="#e2e8f0" strokeWidth="2" />
        <path d="M50 18V38M40 28H60M43 21L57 35M57 21L43 35" stroke="#94a3b8" strokeWidth="1" />
      </g>
      <path d="M14 28L30 28L26 12L44 12L30 28M44 12L46 8M46 9L50 28M23 11H29M45 7.5H51" fill="none" stroke="#f43f5e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M26 11L38 -3" stroke="#22d3ee" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M38 -3L48 6.5" stroke="#22d3ee" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="40" cy="-8" r="4.2" fill="#fcd9b6" />
      <path d="M35.6 -9.5A4.6 4.6 0 0 1 44.4 -9.5Z" fill="#fbbf24" />
      <path fill="none" stroke="#1e293b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <animate attributeName="d" dur="0.9s" repeatCount="indefinite" values="M27.0 9.0 L37.6 15.7 L35.5 28.0;M27.0 9.0 L35.4 18.3 L34.8 30.8;M27.0 9.0 L32.4 20.3 L32.8 32.8;M27.0 9.0 L30.5 21.0 L30.0 33.5;M27.0 9.0 L31.0 20.8 L27.2 32.8;M27.0 9.0 L32.2 20.4 L25.2 30.8;M27.0 9.0 L33.7 19.5 L24.5 28.0;M27.0 9.0 L35.5 18.1 L25.2 25.2;M27.0 9.0 L37.4 15.9 L27.2 23.2;M27.0 9.0 L38.7 13.5 L30.0 22.5;M27.0 9.0 L39.0 12.4 L32.8 23.2;M27.0 9.0 L38.7 13.4 L34.8 25.2;M27.0 9.0 L37.6 15.7 L35.5 28.0" />
      </path>
      <path fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <animate attributeName="d" dur="0.9s" repeatCount="indefinite" values="M27.0 9.0 L33.7 19.5 L24.5 28.0;M27.0 9.0 L35.5 18.1 L25.2 25.2;M27.0 9.0 L37.4 15.9 L27.2 23.2;M27.0 9.0 L38.7 13.5 L30.0 22.5;M27.0 9.0 L39.0 12.4 L32.8 23.2;M27.0 9.0 L38.7 13.4 L34.8 25.2;M27.0 9.0 L37.6 15.7 L35.5 28.0;M27.0 9.0 L35.4 18.3 L34.8 30.7;M27.0 9.0 L32.4 20.3 L32.8 32.8;M27.0 9.0 L30.5 21.0 L30.0 33.5;M27.0 9.0 L31.0 20.8 L27.2 32.8;M27.0 9.0 L32.2 20.4 L25.2 30.8;M27.0 9.0 L33.7 19.5 L24.5 28.0" />
      </path>
    </svg>
  )
})

export default BikeSvg
