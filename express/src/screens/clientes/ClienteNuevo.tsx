// Nuevo cliente (anexo 6.9, `#/clientes/nuevo`): el formulario completo a pantalla completa, con el botón «Guardar» pegado sobre el teclado. Es el mismo `ClienteForm` de la hoja «Cliente nuevo» del asistente
// de venta: una pantalla da el enlace directo y el sitio del teclado. Al abrirse trae escrito lo que la pantalla anterior dejó (`fijarPrecarga`: el nombre buscado o el RNC); se lee UNA vez en el estado
// (con el modo estricto el segundo dibujo es el que queda) y se limpia en un efecto. Guardar, o usar el cliente que ya existe con ese RNC, lleva al detalle del cliente SIN dejar esta pantalla en el historial.
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ClientRow } from '@/api/types'
import { limpiarPrecarga, leerPrecarga } from '~/lib/clientes'
import { claves } from '~/net/clientes'
import { atras, navegar } from '~/router'
import { Cabecera } from '~/ui/Cabecera'
import { ClienteForm } from '~/ui/ClienteForm'
import './Clientes.css'

export default function ClienteNuevo(): JSX.Element {
  const [inicial] = useState(() => leerPrecarga())
  useEffect(() => {
    limpiarPrecarga()
  }, [])
  const cliente = useQueryClient()

  /** Al detalle del cliente (el recién creado o el que ya existía), reemplazando esta pantalla: un atrás desde el detalle cae en la lista, no en un formulario vacío. */
  const verCliente = (c: ClientRow): void => {
    void cliente.invalidateQueries({ queryKey: claves.todos })
    navegar({ id: 'cliente', clienteId: Number(c.id) }, { reemplazar: true })
  }

  return (
    <div className="pantalla">
      <Cabecera titulo="Nuevo cliente" atras={{ id: 'clientes' }} />
      <div className="cliente__cuerpo">
        <ClienteForm modo="completo" inicial={inicial} anclarAccion onGuardado={verCliente} onUsarExistente={verCliente} onCancelar={() => atras({ id: 'clientes' })} />
      </div>
    </div>
  )
}
