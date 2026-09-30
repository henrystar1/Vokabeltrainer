import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export default function Card({ interactive = false, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`glass rounded-2xl p-5 ${
        interactive ? 'transition hover:-translate-y-0.5 hover:border-accent-cyan/40 hover:shadow-glow' : ''
      } ${className}`}
      {...rest}
    />
  )
}
