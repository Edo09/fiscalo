// Avatar con iniciales y color determinístico por nombre.
import { colorFor } from '@/lib/format'

export interface AvatarProps {
  name?: string
  color?: string
  size?: number
  className?: string
}
export function Avatar({ name, color, size = 30, className = '' }: AvatarProps) {
  const ini = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?'
  const c = color || colorFor(name || 'x')
  return (
    <span
      className={'avatar ' + className}
      style={{ background: c, width: size, height: size, fontSize: size * 0.4 }}
    >
      {ini}
    </span>
  )
}
