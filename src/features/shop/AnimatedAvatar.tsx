import type { CSSProperties } from 'react'
import './avatars.css'

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
] as const

export const isAnimatedAvatar = (id: string | null | undefined): boolean => !!id && (ANIMATED_AVATARS as readonly string[]).includes(id)

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
          <i className="halo" /><i className="space" /><i className="swirl2" /><i className="swirl" />
          <span className="band back" /><i className="core" /><i className="ring" /><span className="band front" />
        </span>
      )
    default:
      return null
  }
}
