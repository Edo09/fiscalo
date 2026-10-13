import { Icon } from '@/components/ui'
import { ClientCombobox } from '@/features/clients/ClientCombobox'
import { NombreClienteLibre } from '@/features/clients/NombreClienteLibre'
import type { Cliente } from '@/types/domain'
import { formatearRnc } from './lineas'

/* FISCALO — Cliente del papel de Ferretería (cotización y conduce).

   El rótulo de la hoja impresa ("Nombre o razón social"), el buscador de
   clientes con su botón + para uno nuevo, el nombre libre que se guarda como
   cliente, el RNC o la cédula del elegido y el error del campo. Salió tal
   cual de FerreteriaCotizacionForm (spec conduces 5.5).

   El estado es de quien lo usa: lo necesita para validar y para el aviso de
   salida. El modal de cliente nuevo (NewClientModal) también lo pone quien lo
   usa, y FUERA de la hoja: `.fx-sheet` recorta lo que se sale (overflow
   hidden) y su animación de entrada anima `transform`, que la vuelve el
   contenedor de los position: fixed. Dentro de la hoja, el overlay del modal
   quedaría encerrado y cortado por ella. */

export interface BloqueClienteProps {
  cliente: Cliente | null
  /** false mientras el cliente es la ficha provisional de la fila (todavía sin su RNC): el RNC no se muestra. */
  clienteCompleto: boolean
  /** Nombre escrito a mano (NombreClienteLibre) que todavía no se guardó como cliente. */
  clienteLibre: string
  /** Error del campo, ya en texto; undefined = sin error. */
  error?: string
  /** Lo que se dice si el cliente elegido no tiene RNC ni cédula: qué documento sale sin ese dato. */
  avisoSinDoc: string
  /** Cliente elegido en el buscador o guardado desde el nombre libre; null al vaciar el buscador. */
  onSeleccionar: (c: Cliente | null) => void
  /** Lo escrito en el buscador sin elegir un resultado (ver ClientCombobox). */
  onBusquedaChange: (texto: string) => void
  /** Cada cambio del nombre libre. */
  onLibreChange: (nombre: string) => void
  /** El botón +: quien lo usa abre NewClientModal. */
  onNuevoCliente: () => void
  /**
   * Ocupa todo el ancho de la hoja en vez de los 46ch del bloque de cliente:
   * en el conduce no hay nada a su derecha y un nombre largo se partía en tres
   * líneas dejando la mitad de la fila en blanco.
   */
  anchoCompleto?: boolean
}

export function BloqueCliente({
  cliente, clienteCompleto, clienteLibre, error, avisoSinDoc, onSeleccionar, onBusquedaChange, onLibreChange, onNuevoCliente,
  anchoCompleto = false,
}: BloqueClienteProps) {
  return (
    <section className={'fx-a-quien' + (anchoCompleto ? ' fx-a-quien--completo' : '')}>
      <span className="fx-eyebrow">Nombre o razón social <span className="req">*</span></span>
      <div className="fx-cliente-row">
        <div className="fx-cliente">
          <ClientCombobox
            value={cliente}
            onChange={onSeleccionar}
            onBusquedaChange={onBusquedaChange}
            invalido={error != null}
          />
        </div>
        <button
          type="button"
          className="fx-cliente-add"
          onClick={onNuevoCliente}
          title="Nuevo cliente"
          aria-label="Crear un cliente nuevo"
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      {/* Un nombre escrito se guarda como cliente con su botón "Guardar",
          como en la factura simple: el documento necesita un client_id. */}
      {!cliente && (
        <NombreClienteLibre
          value={clienteLibre}
          onChange={onLibreChange}
          onGuardado={onSeleccionar}
        />
      )}
      {cliente && clienteCompleto && (
        <span className="text-xs muted-3 mono" style={{ display: 'block', marginTop: 4 }}>
          {cliente.doc
            ? `${cliente.doc.replace(/\D/g, '').length === 11 ? 'Cédula' : 'RNC'} ${formatearRnc(cliente.doc)}`
            : avisoSinDoc}
        </span>
      )}
      {error && <span className="fx-err"><Icon name="alert-circle" size={12} />{error}</span>}
    </section>
  )
}
