// Selector de unidad de medida DGII (catálogo /api/unidades-medida, cacheado).
// El value/onChange manejan el código numérico DGII (id; 43 = Unidad).
import type { CSSProperties } from 'react'
import { listUnidadesMedida } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

interface UnidadMedidaSelectProps {
  value: number
  onChange: (id: number) => void
  className?: string
  style?: CSSProperties
}

export function UnidadMedidaSelect({ value, onChange, className = 'select', style }: UnidadMedidaSelectProps) {
  const { data } = useApiQuery(['unidades-medida'], () => listUnidadesMedida())
  const items = data ?? []
  return (
    <select className={className} style={style} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {/* Mientras el catálogo carga, mantener visible el valor actual. */}
      {items.length === 0 && <option value={value}>{value === 43 ? 'UND · Unidad' : value}</option>}
      {items.map((u) => (
        <option key={u.id} value={u.id}>{u.codigo} · {u.descripcion}</option>
      ))}
    </select>
  )
}
