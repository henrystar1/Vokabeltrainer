import type { CSSProperties } from 'react'
import './avatars.css'
import BikeSvg from './Bike'
import { FrogScene } from './Frog'

/** Ids der animierten Profilbilder (alles andere sind Emojis aus catalog.ts). */
export const ANIMATED_AVATARS = [
  'avatar_plasma',
  'avatar_inferno',
  'avatar_frost',
  'avatar_storm',
  'avatar_galaxy',
  'avatar_portal',
  'avatar_supernova',
  'avatar_blackhole',
  'avatar_lava',
  'avatar_matrix',
  'avatar_aurora',
  'avatar_eclipse',
  'avatar_piano',
  'avatar_bike',
  'avatar_frog',
] as const

export const isAnimatedAvatar = (id: string | null | undefined): boolean => !!id && (ANIMATED_AVATARS as readonly string[]).includes(id)

const ARMS_MAIN = ["M97.0 50.0 L95.9 55.1 L94.3 60.0 L92.2 64.6 L89.6 68.9 L86.6 72.7 L83.2 76.2 L79.5 79.1 L75.6 81.6 L71.5 83.6 L67.3 85.1 L63.0 86.0 L58.8 86.5 L54.6 86.4 L50.5 85.9 L46.6 85.0 L42.9 83.6 L39.4 81.8 L36.3 79.7 L33.5 77.4 L31.0 74.7 L28.9 71.9 L27.3 68.9 L26.0 65.8 L25.1 62.7 L24.5 59.6 L24.4 56.5 L24.6 53.5 L25.2 50.7 L26.0 48.0 L27.2 45.5 L28.6 43.2 L30.2 41.2 L32.0 39.4 L33.9 38.0 L35.9 36.8 L38.0 35.9 L40.1 35.3 L42.1 35.0 L44.1 35.0 L46.0 35.2 L47.8 35.6 L49.5 36.3 L50.9 37.1 L52.2 38.0 L53.3 39.1 L54.2 40.3 L54.8 41.5 L55.3 42.7", "M26.5 90.7 L22.6 87.2 L19.2 83.4 L16.3 79.2 L13.9 74.8 L12.0 70.3 L10.8 65.7 L10.0 61.0 L9.8 56.4 L10.2 51.8 L11.0 47.4 L12.3 43.3 L14.0 39.3 L16.2 35.7 L18.7 32.5 L21.4 29.5 L24.5 27.0 L27.7 24.9 L31.1 23.3 L34.6 22.0 L38.1 21.2 L41.6 20.8 L45.0 20.8 L48.3 21.3 L51.5 22.0 L54.4 23.2 L57.2 24.6 L59.7 26.3 L61.8 28.2 L63.7 30.3 L65.3 32.5 L66.6 34.9 L67.5 37.3 L68.1 39.7 L68.5 42.1 L68.5 44.4 L68.2 46.6 L67.7 48.7 L66.9 50.7 L65.9 52.4 L64.8 54.0 L63.5 55.3 L62.2 56.4 L60.7 57.3 L59.3 57.9 L57.8 58.3 L56.3 58.5 L55.0 58.4 L53.7 58.2", "M26.5 9.3 L31.5 7.7 L36.5 6.6 L41.6 6.2 L46.6 6.3 L51.4 7.0 L56.1 8.2 L60.5 9.9 L64.6 12.0 L68.3 14.6 L71.7 17.5 L74.7 20.7 L77.2 24.2 L79.3 27.8 L80.9 31.6 L82.0 35.5 L82.7 39.4 L82.9 43.2 L82.6 47.0 L82.0 50.6 L80.9 54.1 L79.5 57.3 L77.8 60.2 L75.7 62.9 L73.5 65.2 L71.0 67.3 L68.4 68.9 L65.7 70.2 L63.0 71.2 L60.2 71.8 L57.5 72.0 L54.8 71.9 L52.3 71.5 L49.9 70.9 L47.6 69.9 L45.6 68.8 L43.8 67.4 L42.3 65.9 L41.0 64.3 L39.9 62.6 L39.2 60.8 L38.6 59.1 L38.4 57.3 L38.3 55.7 L38.5 54.1 L38.9 52.6 L39.5 51.2 L40.2 50.1 L41.0 49.1"]
const ARMS_THIN = ["M73.0 89.8 L69.0 91.2 L64.9 92.1 L60.8 92.6 L56.8 92.8 L52.8 92.6 L48.9 92.0 L45.1 91.0 L41.5 89.8 L38.1 88.2 L34.9 86.3 L32.0 84.2 L29.3 81.9 L26.9 79.3 L24.8 76.6 L22.9 73.7 L21.4 70.8 L20.2 67.7 L19.3 64.6 L18.7 61.5 L18.4 58.5 L18.5 55.4 L18.8 52.5 L19.3 49.6 L20.2 46.9 L21.2 44.3 L22.5 41.9 L24.0 39.6 L25.6 37.6 L27.4 35.8 L29.4 34.2 L31.4 32.8 L33.5 31.7 L35.6 30.8 L37.8 30.1 L40.0 29.7 L42.1 29.5 L44.2 29.5 L46.2 29.7 L48.2 30.1 L50.0 30.7 L51.7 31.4 L53.3 32.3 L54.7 33.3 L56.0 34.4 L57.1 35.7 L58.0 36.9 L58.8 38.2 L59.4 39.6", "M4.0 50.0 L4.9 45.9 L6.1 41.9 L7.7 38.1 L9.5 34.5 L11.7 31.1 L14.2 28.1 L16.9 25.3 L19.8 22.8 L22.8 20.6 L26.1 18.8 L29.4 17.3 L32.7 16.1 L36.2 15.3 L39.6 14.8 L43.0 14.7 L46.3 14.9 L49.5 15.3 L52.7 16.1 L55.6 17.1 L58.5 18.4 L61.1 20.0 L63.5 21.7 L65.7 23.6 L67.6 25.7 L69.3 27.9 L70.8 30.3 L72.0 32.7 L72.9 35.1 L73.6 37.6 L74.0 40.1 L74.2 42.5 L74.1 44.9 L73.8 47.2 L73.3 49.4 L72.6 51.5 L71.7 53.4 L70.7 55.3 L69.5 56.9 L68.2 58.4 L66.7 59.7 L65.2 60.8 L63.7 61.7 L62.1 62.4 L60.5 63.0 L58.9 63.3 L57.3 63.5 L55.8 63.5 L54.3 63.3", "M73.0 10.2 L76.2 13.0 L79.0 16.0 L81.5 19.3 L83.7 22.7 L85.5 26.3 L86.9 30.0 L88.0 33.7 L88.7 37.4 L89.0 41.2 L89.0 44.9 L88.6 48.5 L87.9 52.0 L86.9 55.4 L85.7 58.6 L84.1 61.6 L82.3 64.4 L80.2 66.9 L78.0 69.3 L75.6 71.3 L73.1 73.1 L70.5 74.6 L67.7 75.8 L65.0 76.8 L62.2 77.4 L59.4 77.8 L56.7 77.9 L54.0 77.7 L51.4 77.3 L49.0 76.6 L46.6 75.8 L44.4 74.7 L42.4 73.5 L40.5 72.1 L38.9 70.5 L37.4 68.8 L36.2 67.1 L35.1 65.3 L34.3 63.4 L33.7 61.5 L33.3 59.7 L33.0 57.8 L33.0 56.0 L33.2 54.3 L33.5 52.6 L34.0 51.0 L34.7 49.6 L35.4 48.3 L36.3 47.1"]

const WHITE_DELAYS = [0, 0.8, 0.4, 1.6, 1.2, 2.4, 2.0]
const BLACK = [{ at: 1, delay: 0.6 }, { at: 2, delay: 1.0 }, { at: 4, delay: 1.4 }, { at: 5, delay: 2.2 }, { at: 6, delay: 2.8 }]
const NOTE_COLORS = ['#fde68a', '#f9a8d4', '#93c5fd', '#86efac', '#fdba74', '#c4b5fd', '#67e8f9']
const dly = (d: number) => ({ '--d': `${d}s` }) as CSSProperties

const BOLT = 'M58 4 L36 46 L52 46 L40 96 L70 40 L54 40 Z'

export default function AnimatedAvatar({ id, size }: { id: string; size: number }) {
  const style = { '--s': `${size}px` } as CSSProperties
  switch (id) {
    case 'avatar_plasma':
      return (
        <span aria-hidden className="av av-plasma av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" />
        </span>
      )
    case 'avatar_inferno':
      return (
        <span aria-hidden className="av av-inferno av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" />
        </span>
      )
    case 'avatar_frost':
      return (
        <span aria-hidden className="av av-frost av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" />
        </span>
      )
    case 'avatar_storm':
      return (
        <span aria-hidden className="av av-storm av-clip" style={style}>
          <i className="a" /><i className="b" />
          <svg viewBox="0 0 100 100"><path d={BOLT} fill="#fff" /></svg>
          <svg viewBox="0 0 100 100"><path d={BOLT} fill="#e0e7ff" /></svg>
        </span>
      )
    case 'avatar_galaxy':
      return (
        <span aria-hidden className="av av-galaxy av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" /><i className="d" />
        </span>
      )
    case 'avatar_portal':
      return (
        <span aria-hidden className="av av-portal av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" /><i className="d" />
        </span>
      )
    case 'avatar_supernova':
      return (
        <span aria-hidden className="av av-supernova" style={style}>
          <i className="d" /><i className="e" /><i className="a av-clip" /><i className="b" /><i className="c" />
        </span>
      )
    case 'avatar_blackhole':
      return (
        <span aria-hidden className="av av-blackhole" style={style}>
          <i className="halo" /><i className="space" /><i className="rimglow" /><i className="rim" /><i className="dust" />
          <svg className="arms" viewBox="0 0 100 100">
            {ARMS_THIN.map((d, k) => <path key={`t${k}`} className="t" d={d} pathLength={100} />)}
            {ARMS_MAIN.map((d, k) => <path key={`m${k}`} d={d} pathLength={100} />)}
          </svg>
          <i className="arcs2" /><i className="arcs" /><i className="lens" /><i className="core" /><span className="disc" />
        </span>
      )
    case 'avatar_lava':
      return (
        <span aria-hidden className="av av-lava av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" /><i className="d" />
        </span>
      )
    case 'avatar_matrix':
      return (
        <span aria-hidden className="av av-matrix av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" /><i className="d" />
        </span>
      )
    case 'avatar_aurora':
      return (
        <span aria-hidden className="av av-aurora av-clip" style={style}>
          <i className="a" /><i className="b" /><i className="c" /><i className="d" />
        </span>
      )
    case 'avatar_eclipse':
      return (
        <span aria-hidden className="av av-eclipse" style={style}>
          <i className="a av-clip" /><i className="b" /><i className="c" /><i className="d" /><i className="e" />
        </span>
      )
    case 'avatar_piano':
      return (
        <span aria-hidden className="av av-piano av-clip" style={style}>
          <i className="a" />
          <span className="keys">
            {WHITE_DELAYS.map((d, k) => <b key={k} style={dly(d)} />)}
            {BLACK.map((b) => <u key={b.at} style={{ ...dly(b.delay), left: `${(b.at / 7) * 100 - 4.5}%` }} />)}
          </span>
          {WHITE_DELAYS.map((d, k) => (
            <em key={k} style={{ ...dly(d), left: `${8 + (k + 0.5) * 12}%`, color: NOTE_COLORS[k] }}>{k % 2 ? '♫' : '♪'}</em>
          ))}
        </span>
      )
    case 'avatar_bike':
      return (
        <span aria-hidden className="av av-bike" style={style}>
          <span className="scene">
            <i className="sun" /><i className="hills" /><i className="road" /><i className="dash" />
          </span>
          <span className="rider"><BikeSvg /></span>
        </span>
      )
    case 'avatar_frog':
      return (
        <span aria-hidden className="av av-frog av-clip" style={style}>
          <FrogScene />
        </span>
      )
    default:
      return null
  }
}
