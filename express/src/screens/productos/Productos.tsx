// Productos (anexo 6.10): el catálogo de lo que la empresa vende, el más nuevo primero, con su buscador y la acción «+ Nuevo producto» sobre la barra inferior.
//  - El servidor busca en nombre, SKU, descripción, categoría y almacén (LIKE); con menos de 2 caracteres no se busca (se ve la lista entera). La búsqueda espera `ESPERA_BUSQUEDA_MS` tras la última tecla y las
//    filas de antes siguen a la vista hasta que llegan las nuevas. 20 filas por página (`PAGINA_LISTAS`) y «Cargar más»: siempre con `page` y `pageSize`, que sin ellos el servidor manda toda la tabla.
//  - Una tarjeta es el nombre (dos líneas), el precio NETO con su ITBIS aparte («RD$ 5,000.00 + ITBIS 18%»), «Servicio · Unidad» y, si aplica, «Inactivo» (la tarjeta se atenúa) y «Se acorta en la factura» (un nombre de
//    más de 80 caracteres: el catálogo guarda 150 y una línea de la factura lleva 80). Toda la tarjeta abre su edición.
//  - Sin filas: el esqueleto (a los 150 ms), el error con «Reintentar» y el vacío de cada razón: sin catálogo, o una búsqueda sin resultados que ofrece crear el producto con lo escrito.
//  - «+ Nuevo producto» abre la hoja de alta sobre esta pantalla; sin conexión está apagado con su razón.
import { useState } from 'react'
import { PAGINA_LISTAS } from '~/config'
import { rd } from '~/lib/dinero'
import { normalizarProducto } from '~/lib/filas'
import type { ProductoVista } from '~/lib/filas'
import { consultaProducto, etiquetaItbis, MAX_NOMBRE_PRODUCTO, nombreDeUnidad } from '~/lib/productos'
import { useUnidades } from '~/lib/unidades'
import type { UnidadMedida } from '@/api/types'
import { useEnLinea } from '~/net/enLinea'
import { buscarProductos, claves } from '~/net/productos'
import { navegar } from '~/router'
import { precargarRuta } from '~/screens/precarga'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { EmptyState } from '~/ui/EmptyState'
import { Skeleton } from '~/ui/Skeleton'
import { TextField } from '~/ui/TextField'
import { AccionDePestana } from '../clientes/AccionDePestana'
import { useBusqueda, usePaginas } from '../clientes/usePaginas'
import { NuevoProducto } from './NuevoProducto'
import './Productos.css'

/** El alto de una tarjeta de producto con sus tres líneas, en px: el del esqueleto. */
const ALTO_DE_TARJETA = 96

/** La tarjeta de un producto: un botón (todo `span`, que dentro de un `<button>` solo caben frases) que abre su edición. */
function Tarjeta(p: { v: ProductoVista; catalogo: UnidadMedida[] }): JSX.Element {
  const { v, catalogo } = p
  const unidad = nombreDeUnidad(catalogo, v.unidad)
  const meta = [v.indicadorBienServicio === 2 ? 'Servicio' : 'Producto', unidad].filter((t) => t !== '').join(' · ')
  return (
    <button type="button" className={v.activo ? 'producto-tarjeta' : 'producto-tarjeta producto-tarjeta--inactivo'} onPointerDown={() => precargarRuta('producto')} onClick={() => navegar({ id: 'producto', productoId: v.id })}>
      <span className="producto-tarjeta__nombre">{v.nombre}</span>
      <span className="producto-tarjeta__precio tabular">
        {rd(v.precio)} <span className="producto-tarjeta__itbis">{etiquetaItbis(v.indicadorFacturacion)}</span>
      </span>
      <span className="producto-tarjeta__meta">{meta}</span>
      {(!v.activo || v.nombre.length > MAX_NOMBRE_PRODUCTO) && (
        <span className="producto-tarjeta__chips">
          {!v.activo && <span className="producto-chip">Inactivo</span>}
          {v.nombre.length > MAX_NOMBRE_PRODUCTO && <span className="producto-chip">Se acorta en la factura</span>}
        </span>
      )}
    </button>
  )
}

export default function Productos(): JSX.Element {
  const { texto, cambiar, consulta, buscarYa } = useBusqueda()
  const query = consultaProducto(consulta)
  const enLinea = useEnLinea()
  const { catalogo } = useUnidades()
  const [nuevo, setNuevo] = useState<{ nombre?: string } | null>(null)

  const lista = usePaginas({
    clave: claves.lista(query),
    pedir: (pagina) => buscarProductos({ query, page: pagina, pageSize: PAGINA_LISTAS }),
    mapear: normalizarProducto,
    pageSize: PAGINA_LISTAS,
  })

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
    cuerpo = (
      <div className="productos__vacio">
        {query === '' ? (
          <EmptyState
            icono="package"
            titulo="Agrega lo que vendes"
            texto="También puedes facturar sin catálogo: en el paso 2 de una factura escribes cada concepto."
            accion={{ etiqueta: '+ Nuevo producto', onClick: () => setNuevo({}) }}
          />
        ) : (
          <EmptyState icono="search" titulo={`Sin resultados para «${query}»`} accion={{ etiqueta: `+ Crear producto «${query}»`, onClick: () => setNuevo({ nombre: query }) }} />
        )}
      </div>
    )
  } else {
    cuerpo = (
      <>
        {lista.falloMas && errorDeLista}
        <ul className="productos__lista">
          {lista.items.map((v) => (
            <li key={v.id}>
              <Tarjeta v={v} catalogo={catalogo} />
            </li>
          ))}
        </ul>
        {lista.hayMas && (
          <div className="productos__mas">
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
      <Cabecera titulo="Productos" />
      <div className="productos__cuerpo">
        <TextField
          etiqueta="Buscar producto..."
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
        <Button bloque icono="plus" disabled={!enLinea} razon="Sin conexión: no puedes guardar ahora." onClick={() => setNuevo({})}>
          Nuevo producto
        </Button>
      </AccionDePestana>
      {nuevo !== null && <NuevoProducto nombre={nuevo.nombre} onCerrar={() => setNuevo(null)} />}
    </div>
  )
}
