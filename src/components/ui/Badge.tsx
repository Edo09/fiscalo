// Pills de estado: Badge genérico y EstadoBadge con tono por estado conocido.
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'
export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  children?: ReactNode
  className?: string
}
export function Badge({ tone = 'neutral', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="dotp"></span>}
      {children}
    </span>
  )
}

const ESTADO_TONE: Record<string, BadgeTone> = {
  Emitida: 'info', Pagada: 'success', Borrador: 'neutral', Vencida: 'danger', Anulada: 'neutral',
  Aceptado: 'success', 'En proceso': 'warning', Rechazado: 'danger', Pendiente: 'neutral', Anulado: 'neutral',
  'Al día': 'success', Vencido: 'danger', 'Por vencer': 'warning', Activo: 'success', Inactivo: 'neutral',
  Disponible: 'success', Bajo: 'warning', Agotado: 'danger', Pagado: 'success',
  // Estados del módulo de Gastos
  Registrado: 'info', 'Por emitir': 'warning', Error: 'danger',
}
export function EstadoBadge({ estado }: { estado: string }) {
  return <Badge tone={ESTADO_TONE[estado] ?? 'neutral'} dot>{estado}</Badge>
}
