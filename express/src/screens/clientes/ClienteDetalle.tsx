// El detalle de un cliente (anexo 6.9, `#/clientes/:id`): su nombre y RNC, llamarle, escribirle por WhatsApp o por correo (enlaces `tel:`, `https://wa.me/...` y `mailto:` armados con lo que tiene: lo que
// falta no sale), sus datos, «Editar» en la cabecera y, sobre la barra inferior, la acción de facturarle.
//  - Se pide con GET /api/clients?id=. Un 404 (lo borraron en otro sitio) dice «Este cliente ya no existe» y reemplaza la ruta por la lista; cualquier otro fallo, «Reintentar».
//  - «Contacto» solo sale si es distinto del nombre; «Pago: Solo contado» solo si no tiene crédito; «Descuento» solo si es mayor que 0 (lo que es lo habitual no se repite).
//  - «Facturar a este cliente» deja el cliente en `facturarA` (el contrato con el asistente de venta: id, nombre, RNC o null, crédito y descuento) y abre `#/facturar`. Si el cliente no tiene RNC y todos
//    los tipos que la cuenta vende lo exigen (E31, E45) la acción es «Agregar RNC», que abre la edición con el cursor en el RNC; si su RNC es el de la propia empresa el servidor no deja facturarle y el
//    botón está apagado con su razón.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { formatoRnc } from '@/pos/montos'
import { tiposVenta } from '~/entitlements'
import { escribirJson, claveUsuario } from '~/lib/almacen'
import { accionFacturar, datosFacturarA, fichaCliente, urlContacto } from '~/lib/clientes'
import { claves, leerCliente } from '~/net/clientes'
import { navegar } from '~/router'
import type { Ruta } from '~/router'
import { precargarRuta } from '~/screens/precarga'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { Skeleton } from '~/ui/Skeleton'
import { mostrarToast } from '~/ui/Toast'
import { AccionDePestana } from './AccionDePestana'
import { EditarCliente } from './EditarCliente'
import { useCuenta } from './useCuenta'
import './Clientes.css'

/** Un enlace con la cara de un botón secundario de 48 px: llamar, WhatsApp, correo. */
function Enlace(p: { href: string; externo?: boolean; children: string }): JSX.Element {
  return (
    <a className="boton boton--secundario" href={p.href} {...(p.externo === true ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      <span className="boton__contenido">{p.children}</span>
    </a>
  )
}

export default function ClienteDetalle(p: { ruta: Ruta }): JSX.Element {
  const id = p.ruta.id === 'cliente' ? p.ruta.clienteId : 0
  const { usuario, entitlements } = useCuenta()
  const [edicion, setEdicion] = useState<{ foco?: 'rnc' } | null>(null)

  const q = useQuery({
    queryKey: claves.item(id),
    queryFn: () => leerCliente(id),
    enabled: id > 0,
    // Un 404 es una respuesta, no un fallo de la red: no se repite.
    retry: (veces, e) => !(e instanceof ApiError && e.status === 404) && veces < 1,
  })
  const noExiste = q.error instanceof ApiError && q.error.status === 404
  useEffect(() => {
    if (!noExiste) return
    mostrarToast('Este cliente ya no existe', { tipo: 'error' })
    navegar({ id: 'clientes' }, { reemplazar: true })
  }, [noExiste])

  const ficha = useMemo(() => (q.data === undefined ? null : fichaCliente(q.data)), [q.data])

  /** Deja el cliente para el asistente de venta y lo abre. Sin cuenta que lo guarde se abre igual: el asistente pide el cliente él mismo. */
  const facturar = (): void => {
    if (ficha !== null && usuario !== null && entitlements !== null) escribirJson(claveUsuario(entitlements.tenant.id, usuario.id, 'facturarA'), datosFacturarA(ficha))
    navegar({ id: 'facturar' })
  }

  let cuerpo: JSX.Element
  let accion: JSX.Element | null = null
  if (ficha === null) {
    cuerpo =
      q.isError && !noExiste ? (
        <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: () => void q.refetch() }}>
          No se pudo cargar el cliente.
        </Banner>
      ) : (
        <div aria-busy="true">
          <Skeleton filas={3} alto={72} />
        </div>
      )
  } else {
    const contacto = urlContacto({ telefono: ficha.telefono, email: ficha.correo })
    const distinto = ficha.contacto !== '' && ficha.contacto !== ficha.nombre
    const filas: [string, string][] = []
    if (distinto) filas.push(['Contacto', ficha.contacto])
    if (ficha.telefono !== '') filas.push(['Teléfono', ficha.telefono])
    if (ficha.correo !== '') filas.push(['Correo', ficha.correo])
    if (ficha.direccion !== '') filas.push(['Dirección', ficha.direccion])
    if (!ficha.permiteCredito) filas.push(['Pago', 'Solo contado'])
    if (ficha.descuento > 0) filas.push(['Descuento', `${ficha.descuento}%`])
    cuerpo = (
      <>
        <div>
          <h2 className="cliente__nombre">{ficha.nombre}</h2>
          <p className="cliente__rnc">{ficha.rnc === '' ? 'Sin RNC' : `RNC ${formatoRnc(ficha.rnc)}`}</p>
        </div>
        {(contacto.tel !== null || contacto.wa !== null || contacto.mailto !== null) && (
          <div className="cliente__contactos">
            {contacto.tel !== null && <Enlace href={contacto.tel}>Llamar</Enlace>}
            {contacto.wa !== null && (
              <Enlace href={contacto.wa} externo>
                WhatsApp
              </Enlace>
            )}
            {contacto.mailto !== null && <Enlace href={contacto.mailto}>Correo</Enlace>}
          </div>
        )}
        {filas.length > 0 && (
          <dl className="cliente__datos">
            {filas.map(([etiqueta, valor]) => (
              <div key={etiqueta} className="cliente__dato">
                <dt>{etiqueta}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
        )}
      </>
    )
    const que = entitlements === null ? null : accionFacturar(ficha, tiposVenta(entitlements), entitlements.tenant.rnc)
    if (que?.accion === 'facturar') {
      accion = (
        <Button bloque onPointerDown={() => precargarRuta('facturar')} onClick={facturar}>
          Facturar a este cliente
        </Button>
      )
    } else if (que?.accion === 'agregarRnc') {
      accion = (
        <Button bloque onClick={() => setEdicion({ foco: 'rnc' })}>
          Agregar RNC
        </Button>
      )
    } else if (que?.accion === 'esMiEmpresa') {
      accion = (
        <Button bloque disabled razon="Es el RNC de tu empresa">
          Facturar a este cliente
        </Button>
      )
    }
  }

  return (
    <div className="pantalla">
      <Cabecera
        titulo="Cliente"
        atras={{ id: 'clientes' }}
        derecha={
          ficha !== null ? (
            <Button variante="texto" onClick={() => setEdicion({})}>
              Editar
            </Button>
          ) : undefined
        }
      />
      <div className="cliente__cuerpo">{cuerpo}</div>
      {accion !== null && <AccionDePestana>{accion}</AccionDePestana>}
      {ficha !== null && edicion !== null && <EditarCliente ficha={ficha} foco={edicion.foco} onCerrar={() => setEdicion(null)} />}
    </div>
  )
}
