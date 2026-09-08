// Selector del "Tipo de Costos y Gastos" DGII — campo 3 del Formato 606.
// Catálogo cacheado desde /api/tipos-bienes-servicios.
//
// El valor es SIEMPRE la cadena de 2 dígitos ('01'..'11'), nunca un número:
// '01' convertido a number es 1, y el 606 saldría con un campo de un dígito que
// la DGII rechaza (y rechaza el archivo entero, no solo esa línea).
import type { CSSProperties } from 'react'
import { listTiposBienesServicios } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

interface TipoBienesServiciosSelectProps {
  value: string
  onChange: (codigo: string) => void
  id?: string
  className?: string
  style?: CSSProperties
  /** Solo para accesibilidad; el borde rojo lo pone `.field-error` del contenedor. */
  invalid?: boolean
}

export function TipoBienesServiciosSelect({
  value, onChange, id, className = 'select', style, invalid = false,
}: TipoBienesServiciosSelectProps) {
  const { data, loading } = useApiQuery(['tipos-bienes-servicios'], () => listTiposBienesServicios())
  const items = data ?? []

  return (
    <select
      id={id}
      className={className}
      style={style}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      title={items.find((t) => t.codigo === value)?.descripcion}
    >
      {/* Sin opción por defecto elegida: el tipo lo decide quien registra el
          gasto, y un valor preseleccionado se declara solo sin que nadie lo
          mire — que es justo lo que hacía el '09' fijo de antes. */}
      <option value="">{loading ? 'Cargando…' : '— Selecciona el tipo —'}</option>
      {items.map((t) => (
        <option key={t.codigo} value={t.codigo}>{t.codigo} - {t.descripcion}</option>
      ))}
    </select>
  )
}
