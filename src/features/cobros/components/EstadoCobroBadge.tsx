import { Badge } from '@/components/ui'
import type { EstadoCobro } from '@/api'
import { TONO_ESTADO } from '../format'

/**
 * La pastilla de estado de un cobro: azul pendiente, ámbar parcial, rojo vencido, verde pagado, gris cancelado.
 * Un cobro vencido con abonos sigue "Vencido" (es lo urgente) y lleva además una pastilla "Parcial": también es un
 * cobro parcial, y es lo que muestra el filtro "Parcial".
 */
export function EstadoCobroBadge({ estado, conAbonos = false }: { estado: EstadoCobro; conAbonos?: boolean }) {
  const parcial = estado === 'Vencido' && conAbonos
  return (
    <span className="cobros-estado" title={parcial ? 'Vencido, con pagos parciales: todavía debe una parte' : undefined}>
      <Badge tone={TONO_ESTADO[estado]} dot>{estado}</Badge>
      {parcial && <Badge tone="warning">Parcial</Badge>}
    </span>
  )
}
