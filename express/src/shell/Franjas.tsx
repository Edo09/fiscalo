// Las franjas de la factura en curso (anexo 5.1 y 5.4), en el flujo, arriba de toda pantalla y debajo de «Sin conexión»:
//  - «Enviando factura...» mientras una petición de emisión está en vuelo. Es solo un aviso: volver al envío es el botón central de la barra (plan 07).
//  - «Factura sin confirmar {e-NCF}. Ver» mientras haya un registro abierto cuyo resultado no se conoce: no bloquea el negocio (Facturar abre un asistente nuevo),
//    pero no se pierde de vista. «Ver» lleva a esa factura.
// Las dos salen de `useIndicadoresFacturar` (lib/indicadores.ts); mientras ese gancho sea el relleno del plan 06 no devuelve nada y no sale ninguna.
//
// Son franjas y no una tarjeta como `Banner`: ocupan el ancho completo, pegadas arriba, con el tono del aviso. No son pegajosas, como `OfflineBanner`: las cabeceras de
// las pantallas lo son y una franja pegajosa más se solaparía con ellas. Como allí, la región de anuncio existe siempre, vacía, y la franja entra dentro de ella:
// un lector de pantalla solo anuncia lo que cambia en una región que ya estaba.
import { useIndicadoresFacturar } from '~/lib/indicadores'
import type { IndicadoresFacturar } from '~/lib/indicadores'
import { navegar } from '~/router'
import type { Ruta } from '~/router'
import { precargarRuta } from '~/screens/registro'
import { Icon } from '~/ui/Icon'
import './Franjas.css'

type SinConfirmar = NonNullable<IndicadoresFacturar['sinConfirmar']>

/**
 * Adónde lleva «Ver»: a la factura si ya se guardó (su id) y, si no, a la pantalla de resultado de ese envío, que se identifica por su clave. La hoja de cerrar
 * sesión de Más lleva al mismo sitio con su «Ver factura» (screens/Mas.tsx): si cambia una, cambia la otra.
 */
const destinoDe = (s: SinConfirmar): Ruta => (s.facturaId !== null ? { id: 'factura', facturaId: s.facturaId } : { id: 'facturar-resultado', clave: s.clave })

export function Franjas(): JSX.Element {
  const { enviando, sinConfirmar } = useIndicadoresFacturar()
  const destino = sinConfirmar === null ? null : destinoDe(sinConfirmar)
  return (
    <div role="status">
      {enviando && (
        <div className="franja franja--enviando">
          <span className="franja__giro" aria-hidden="true" />
          <span className="franja__texto">Enviando factura...</span>
        </div>
      )}
      {sinConfirmar !== null && destino !== null && (
        <div className="franja franja--aviso">
          <Icon name="triangle-alert" size={20} />
          {/* Sin e-NCF todavía (la respuesta no lo trajo) la franja no lo inventa. */}
          <span className="franja__texto">{sinConfirmar.eNcf === '' ? 'Factura sin confirmar.' : `Factura sin confirmar ${sinConfirmar.eNcf}.`}</span>
          <button
            type="button"
            className="franja__ver"
            aria-label="Ver factura sin confirmar"
            onPointerDown={() => precargarRuta(destino.id)}
            onClick={() => navegar(destino)}
          >
            Ver
          </button>
        </div>
      )}
    </div>
  )
}
