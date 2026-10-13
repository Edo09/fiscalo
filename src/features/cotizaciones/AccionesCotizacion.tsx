import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, Dropdown, MenuItem } from '@/components/ui'
import { ApiError, getCotizacionPdf } from '@/api'
import type { CotizacionRow } from '@/api'
import { presentDocument } from '@/lib/file'
import { aNumero } from '@/lib/format'
import type { Nav } from '@/config/navigation'
import type { FacturaPrefill } from '@/types/domain'
import { formatoDeFila } from './formatos/formatoId'
import { ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill } from './formatos/ferreteria/conversion'
import type { PermisosCotizacion } from './permisosCotizacion'

/** Borrador de factura a partir de una cotización (cliente + líneas). */
function toFacturaPrefill(c: CotizacionRow): FacturaPrefill {
  return {
    kind: 'factura-prefill',
    clienteId: c.client_id != null ? String(c.client_id) : '',
    clienteNombre: c.client_name || '',
    origen: c.code || `#${c.id}`,
    lineas: (c.items ?? [])
      .filter((it) => (it.description ?? '').trim() !== '')
      // Llegan como texto DECIMAL. La cantidad pasa tal cual (0.5 ya no sube a
      // 1): si no sirve para el e-CF, la factura lo marca en la línea al emitir.
      .map((it) => ({
        nombre: (it.description ?? '').trim(),
        cantidad: aNumero(it.quantity ?? 1),
        precio: aNumero(it.amount),
      })),
  }
}

/* FISCALO — Acciones de una cotización GUARDADA: PDF, Conduce y Facturar.

   Las mismas en el listado (una fila) y en el editor (la cotización abierta).
   Todas salen de la fila guardada, no de lo que haya en pantalla: el editor
   las bloquea con `bloqueo` mientras tiene cambios sin guardar.

   Van por el formato de la fila (una cotización guardada con otro formato se
   factura con sus reglas). Devuelve los botones sueltos: quien la usa pone el
   contenedor. */
export function AccionesCotizacion({
  cotizacion: c, nav, permisos, bloqueo = null,
}: {
  cotizacion: CotizacionRow
  nav: Nav
  permisos: PermisosCotizacion
  /** Por qué no se pueden usar ahora (va de title). null = disponibles. */
  bloqueo?: string | null
}) {
  const [pdfBusy, setPdfBusy] = useState(false)
  const { puedeEcf, puedeSimple, puedeConduce } = permisos
  const bloqueada = bloqueo != null

  const openPdf = async () => {
    setPdfBusy(true)
    try {
      presentDocument(await getCotizacionPdf(c.id))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  const facturarFerreteria = (
    <Btn variant="secondary" size="sm" icon="file-text" iconRight="chevron-down"
      title={bloqueo ?? 'Convertir en factura'} disabled={bloqueada}>
      Facturar
    </Btn>
  )

  return (
    <>
      <Btn variant="ghost" size="sm" icon="printer" onClick={() => void openPdf()} disabled={pdfBusy || bloqueada}
        title={bloqueo ?? undefined}>
        {pdfBusy ? '…' : 'PDF'}
      </Btn>
      {formatoDeFila(c) === 'ferreteria' ? (
        <>
          {/* Conduce: fuera de la condición de Facturar, porque un rol
              sin facturas también entrega mercancía. */}
          {puedeConduce && (
            <Btn variant="secondary" size="sm" icon="truck" disabled={bloqueada}
              title={bloqueo ?? 'Crear un conduce de mercancía con esta cotización'}
              onClick={() => nav('conduce-editar', { kind: 'conduce-desde-cotizacion', cotizacionId: c.id })}>
              Conduce
            </Btn>
          )}
          {/* Ferretería factura a e-CF o a factura simple. Cada destino
              sale solo si el rol puede abrirlo; sin ninguno, no hay botón.
              Bloqueado va sin menú: un botón deshabilitado no lo abre en
              todos los navegadores. */}
          {(puedeEcf || puedeSimple) && (bloqueada ? facturarFerreteria : (
            <Dropdown align="right" width={220} trigger={facturarFerreteria}>
              {puedeEcf && (
                <MenuItem icon="file-text" onClick={() => nav('factura-nueva', ferreteriaAFacturaPrefill(c))}>
                  Factura electrónica (e-CF)
                </MenuItem>
              )}
              {puedeSimple && (
                <MenuItem icon="file" onClick={() => nav('factura-simple-nueva', ferreteriaAFacturaSimplePrefill(c))}>
                  Factura simple
                </MenuItem>
              )}
            </Dropdown>
          ))}
        </>
      ) : (
        <Btn variant="secondary" size="sm" icon="file-text" disabled={bloqueada}
          title={bloqueo ?? 'Convertir a factura e-CF'}
          onClick={() => nav('factura-nueva', toFacturaPrefill(c))}>
          Facturar
        </Btn>
      )}
    </>
  )
}
