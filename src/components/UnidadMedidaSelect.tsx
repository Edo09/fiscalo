// Selector de unidad de medida DGII (catálogo /api/unidades-medida, cacheado).
// El value/onChange manejan el código numérico DGII (id; 43 = Unidad).
import type { CSSProperties } from 'react'
import { unidadValida, useUnidadesMedida } from './unidadesMedida'

interface UnidadMedidaSelectProps {
  value: number
  onChange: (id: number) => void
  className?: string
  style?: CSSProperties
}

export function UnidadMedidaSelect({ value, onChange, className = 'select', style }: UnidadMedidaSelectProps) {
  const items = useUnidadesMedida()
  // Unidad que no está en el catálogo (datos migrados). Antes el select pintaba
  // la primera opción pero conservaba el valor malo, así que se veía bien y
  // fallaba al emitir. Ahora se ve que falta elegirla.
  const invalida = !unidadValida(value, items)
  return (
    <select
      className={className}
      style={style}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      title={invalida ? 'Esta unidad no está en el catálogo de la DGII: elige otra.' : items.find((u) => u.id === value)?.descripcion}
      aria-invalid={invalida || undefined}
    >
      {/* Mientras el catálogo carga, mantener visible el valor actual. */}
      {items.length === 0 && <option value={value}>{value === 43 ? 'UND' : value}</option>}
      {invalida && <option value={value} disabled>Elige…</option>}
      {/* Solo la sigla (codigo) para que quepa; la descripción va en el title. */}
      {items.map((u) => (
        <option key={u.id} value={u.id} title={u.descripcion}>{u.codigo}</option>
      ))}
    </select>
  )
}
