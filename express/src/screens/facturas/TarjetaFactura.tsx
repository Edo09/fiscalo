// Una factura en la lista de Facturas (anexo 6.2): el cliente (o «Consumidor final»), el número y el momento, las líneas de vínculo («Anulada por ...», «Modifica ...»),
// el total con su signo (una nota de crédito resta y lleva su etiqueta) y el chip del estado DGII. Toda la tarjeta es un botón que abre el detalle: `precargarRuta` baja el trozo
// del detalle en el `pointerdown`, antes de que el dedo suba. Es un botón y no un enlace por lo mismo que las filas de Alertas: la entrada del historial la marca `navegar`.
// Dentro de un `<button>` solo cabe contenido de frase, por eso todo son `span` (en bloque con CSS). Con `atenuada` (sin conexión, datos que no se pueden actualizar) se ve
// apagada pero se sigue pudiendo tocar.
import { lineasVinculo } from '@/features/invoices/notasVinculadas'
import { rd } from '~/lib/dinero'
import { etiquetaDia } from '~/lib/fechas'
import type { FacturaVista } from '~/lib/filas'
import { navegar } from '~/router'
import { precargarRuta } from '~/screens/precarga'
import { StatusChip } from '~/ui/StatusChip'

export function TarjetaFactura(p: { f: FacturaVista; hoy: string; atenuada: boolean }): JSX.Element {
  const { f, hoy, atenuada } = p
  const vinculos = lineasVinculo(f)
  // El número solo (un intento archivado sin e-NCF tiene el que se guardó) y el momento: si falta uno, no queda un separador colgando.
  const numeroYMomento = [f.numero, etiquetaDia(f.fecha, hoy)].filter((parte) => parte !== '').join(' · ')
  return (
    <button
      type="button"
      className={atenuada ? 'tarjeta tarjeta--atenuada' : 'tarjeta'}
      onPointerDown={() => precargarRuta('factura')}
      onClick={() => navegar({ id: 'factura', facturaId: f.id })}
    >
      <span className="tarjeta__cliente">{f.cliente}</span>
      {numeroYMomento !== '' && <span className="tarjeta__numero">{numeroYMomento}</span>}
      {vinculos.map((linea) => (
        <span key={linea.texto} className={`tarjeta__vinculo tarjeta__vinculo--${linea.tono}`}>
          {linea.texto}
        </span>
      ))}
      <span className="tarjeta__pie">
        <span className="tarjeta__total">
          <span className="tarjeta__monto tabular">{rd(f.totalConSigno)}</span>
          {f.tipo === '34' && <span className="tarjeta__etiqueta">Nota de crédito</span>}
        </span>
        <StatusChip estado={f.estado} tipoEcf={f.tipo} />
      </span>
    </button>
  )
}
