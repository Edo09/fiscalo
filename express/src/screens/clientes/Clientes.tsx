// Clientes (anexo 6.9): la lista de los clientes de la empresa, el más nuevo primero, con su buscador y la acción «+ Nuevo cliente» sobre la barra inferior.
//  - El servidor busca en nombre, empresa, correo, teléfono y RNC (LIKE sobre lo guardado). Un texto de 9 u 11 dígitos es un RNC o una cédula y se busca por sus dígitos, que es como se guardan;
//    con menos de 2 caracteres no se busca (se ve la lista entera). La búsqueda espera `ESPERA_BUSQUEDA_MS` tras la última tecla y las filas de antes siguen a la vista hasta que llegan las nuevas.
//  - 20 filas por página (`PAGINA_LISTAS`) y «Cargar más»: siempre con `page` y `pageSize`, que sin ellos el servidor manda toda la tabla.
//  - Una tarjeta es el nombre, el RNC con su formato y el teléfono, y las etiquetas «Sin RNC» (en aviso solo si se vende E31 o E45, que lo exigen), «Solo contado» y «N% desc.». Toda la tarjeta abre el detalle.
//  - Sin filas: el esqueleto (a los 150 ms), el error con «Reintentar», y el vacío de cada razón: la empresa sin clientes, o una búsqueda sin resultados que ofrece crear el cliente con lo escrito.
import { PAGINA_LISTAS } from '~/config'
import { chipsCliente, consultaDeBusqueda, fijarPrecarga, formatearRnc, modoBusqueda } from '~/lib/clientes'
import { normalizarCliente } from '~/lib/filas'
import type { ClienteVista } from '~/lib/filas'
import { useEnLinea } from '~/net/enLinea'
import { buscarClientes, claves } from '~/net/clientes'
import { navegar } from '~/router'
import { precargarRuta } from '~/screens/precarga'
import { iniciales } from '@/pos/montos'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { EmptyState } from '~/ui/EmptyState'
import { Skeleton } from '~/ui/Skeleton'
import { TextField } from '~/ui/TextField'
import { AccionDePestana } from './AccionDePestana'
import { useCuenta } from './useCuenta'
import { useBusqueda, usePaginas } from './usePaginas'
import './Clientes.css'

/** El alto de una tarjeta de cliente con su RNC y sus etiquetas, en px: el del esqueleto. */
const ALTO_DE_TARJETA = 88

/** La tarjeta de un cliente: un botón (todo `span`, que dentro de un `<button>` solo caben frases) que abre su detalle. */
function Tarjeta(p: { c: ClienteVista; tiposEcf: string[] }): JSX.Element {
  const { c, tiposEcf } = p
  const rnc = c.rnc === null ? null : formatearRnc(c.rnc)
  const datos = [rnc === null || rnc === '' ? null : `RNC ${rnc}`, c.telefono].filter((d): d is string => d !== null && d !== '').join(' · ')
  const chips = chipsCliente(c, tiposEcf)
  return (
    <button type="button" className="cliente-tarjeta" onPointerDown={() => precargarRuta('cliente')} onClick={() => navegar({ id: 'cliente', clienteId: c.id })}>
      <span className="cliente-tarjeta__avatar" aria-hidden="true">
        {iniciales(c.nombre)}
      </span>
      <span className="cliente-tarjeta__texto">
        <span className="cliente-tarjeta__nombre">{c.nombre}</span>
        {datos !== '' && <span className="cliente-tarjeta__dato">{datos}</span>}
        {chips.length > 0 && (
          <span className="cliente-tarjeta__chips">
            {chips.map((chip) => (
              <span key={chip.texto} className={`cliente-chip cliente-chip--${chip.tono}`}>
                {chip.texto}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  )
}

export default function Clientes(): JSX.Element {
  const { texto, cambiar, consulta, buscarYa } = useBusqueda()
  const query = consultaDeBusqueda(consulta)
  const enLinea = useEnLinea()
  const { entitlements } = useCuenta()
  const tiposEcf = entitlements?.tipos_ecf ?? []

  const lista = usePaginas({
    clave: claves.lista(query),
    pedir: (pagina) => buscarClientes({ query, page: pagina, pageSize: PAGINA_LISTAS }),
    mapear: normalizarCliente,
    pageSize: PAGINA_LISTAS,
  })

  const nuevo = (precarga: { nombre?: string; rnc?: string }): void => {
    fijarPrecarga(precarga)
    navegar({ id: 'cliente-nuevo' })
  }

  const errorDeLista = (
    <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: lista.reintentar }}>
      No se pudo cargar la lista.
    </Banner>
  )

  let cuerpo: JSX.Element
  if (lista.estado === 'cargando') {
    cuerpo = (
      <div aria-busy="true">
        <Skeleton filas={5} alto={ALTO_DE_TARJETA} />
      </div>
    )
  } else if (lista.estado === 'error') {
    cuerpo = errorDeLista
  } else if (lista.estado === 'vacio') {
    const modo = modoBusqueda(consulta)
    cuerpo = (
      <div className="clientes__vacio">
        {query === '' ? (
          <EmptyState icono="users" titulo="Aún no tienes clientes" texto="Se guardan solos al facturar a un RNC nuevo." accion={{ etiqueta: '+ Nuevo cliente', onClick: () => nuevo({}) }} />
        ) : (
          <EmptyState
            icono="search"
            titulo={`Sin resultados para «${consulta.trim()}»`}
            accion={
              modo.kind === 'rnc'
                ? { etiqueta: 'Crear cliente con este RNC', onClick: () => nuevo({ rnc: modo.digitos }) }
                : { etiqueta: `+ Crear cliente «${consulta.trim()}»`, onClick: () => nuevo({ nombre: consulta.trim() }) }
            }
          />
        )}
      </div>
    )
  } else {
    cuerpo = (
      <>
        {lista.falloMas && errorDeLista}
        <ul className="clientes__lista">
          {lista.items.map((c) => (
            <li key={c.id}>
              <Tarjeta c={c} tiposEcf={tiposEcf} />
            </li>
          ))}
        </ul>
        {lista.hayMas && (
          <div className="clientes__mas">
            <Button variante="secundario" bloque cargando={lista.cargandoMas} onClick={lista.masPaginas}>
              Cargar más
            </Button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="pantalla">
      <Cabecera titulo="Clientes" />
      <div className="clientes__cuerpo">
        <TextField
          etiqueta="Buscar nombre, RNC, teléfono..."
          tipo="search"
          modoInput="search"
          enterkeyhint="search"
          autoComplete="off"
          autoCapitalize="none"
          limpiable
          valor={texto}
          onCambio={cambiar}
          onEnter={buscarYa}
        />
        {cuerpo}
      </div>
      <AccionDePestana>
        <Button bloque icono="plus" disabled={!enLinea} razon="Sin conexión: no puedes crear clientes ahora." onClick={() => nuevo({})}>
          Nuevo cliente
        </Button>
      </AccionDePestana>
    </div>
  )
}
