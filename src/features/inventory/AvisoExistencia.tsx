import { Icon, Btn } from '@/components/ui'
import { puedeVerVista, type Nav } from '@/config/navigation'
import { fmtCantidad } from '@/lib/format'
import { useSession } from '@/stores/auth'
import { lineasPrefillAjuste, type FaltanteStock } from './existencia'

/* FISCALO — Aviso de "no hay existencia suficiente" (spec control de existencias, 4.6).
   Lo muestran los dos formularios de factura (e-CF y simple) cuando el API rechaza
   la venta con STOCK_INSUFICIENTE: una fila por producto con lo que pide la venta y
   lo que hay, y la salida, que es Ajuste de inventario. El botón abre ese formulario
   con las cantidades que faltan ya puestas (AjustePrefill); no vuelve a la venta
   (C9/C16), así que en la e-CF el formulario avisa antes de salir si hay líneas.
   Quien no puede abrir Ajuste (sin el módulo de productos) no ve un botón que lo
   mandaría de vuelta al dashboard: ve la frase que le dice a quién pedírselo (C11).
   Solo muestra lo que el API mandó: nunca bloquea nada por sí mismo. */
export function AvisoExistencia({ faltantes, nav }: { faltantes: FaltanteStock[]; nav: Nav }) {
  const { user } = useSession()
  if (faltantes.length === 0) return null
  // Mismo criterio que el menú: el módulo de productos abre Ajuste (ajuste-nuevo es subvista de ajustes).
  const puedeAjustar = puedeVerVista(user, 'ajuste-nuevo')

  return (
    <div role="alert" className="card card-pad col gap-sm" style={{ background: 'var(--danger-soft)', borderColor: 'transparent' }}>
      <div className="row gap-sm" style={{ alignItems: 'flex-start' }}>
        <Icon name="alert-triangle" size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div className="fw6 text-sm">
            {faltantes.length === 1 ? 'No hay existencia suficiente de este producto' : 'No hay existencia suficiente de estos productos'}
          </div>
          <div className="text-sm mt-sm">
            {puedeAjustar
              ? 'Baja la cantidad o agrega existencia en Ajuste de inventario.'
              : 'Pide a un administrador que agregue existencia en Ajuste de inventario.'}
          </div>
        </div>
      </div>

      <ul className="col gap-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {faltantes.map((f) => (
          <li key={f.productId} className="row between gap-md text-sm" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span>
              <span className="fw6">{f.nombre}</span>
              {f.sku && <span className="cell-sub mono"> {f.sku}</span>}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              Pides {fmtCantidad(f.solicitado)} · Hay {fmtCantidad(Math.max(0, f.disponible))}
            </span>
          </li>
        ))}
      </ul>

      {puedeAjustar && (
        <div>
          <Btn
            variant="secondary" size="sm" icon="git-compare"
            onClick={() => nav('ajuste-nuevo', { kind: 'ajuste-prefill', lineas: lineasPrefillAjuste(faltantes) })}
          >
            Ir a Ajuste de inventario
          </Btn>
        </div>
      )}
    </div>
  )
}
