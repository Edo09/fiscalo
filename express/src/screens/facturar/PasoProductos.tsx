// Paso 2 del asistente de venta, «Productos y líneas» (anexo 6.5): se busca en el catálogo y se toca una ficha (agrega una línea de cantidad 1 con el precio neto, el ITBIS, el tipo
// y la unidad del producto; tocarla otra vez suma uno), o se agrega una «Línea libre». «En la factura» lista las líneas, cada una con su cantidad más y menos y su importe; tocar una
// la abre en una hoja. Quitar una línea (con menos desde 1, o desde la hoja) deja «Deshacer» a la vista 6 segundos.
//  - Los precios son NETOS y el ITBIS va encima: las fichas dicen «+ ITBIS» y el total de abajo ya lo incluye (lib/totales, con las cuentas del servidor).
//  - Las fichas son del catálogo, sin lo inactivo ni lo no facturable. La búsqueda es del servidor, que también acierta en almacén y categoría: por eso se filtra otra vez aquí por
//    nombre y código. Sin el módulo de productos solo hay «Línea libre».
//  - «Revisar» pide al menos una línea y un total mayor que 0; el detalle de lo que falta lo dice el paso siguiente.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { FRESCURA } from '@/config/cache'
import { coincide } from '@/pos/montos'
import { PAGINA_LISTAS } from '~/config'
import { tieneModulo, tiposVenta } from '~/entitlements'
import { lineaLibre, MAX_LINEAS, productoSel } from '~/lib/carrito'
import type { Deshacer, LineaCarrito, ProductoSel } from '~/lib/carrito'
import { rd } from '~/lib/dinero'
import { montosDe, resumenTotales } from '~/lib/totales'
import { useEnLinea } from '~/net/enLinea'
import { buscarProductos } from '~/net/catalogo'
import { navegar } from '~/router'
import { Banner } from '~/ui/Banner'
import { Button } from '~/ui/Button'
import { Cabecera } from '~/ui/Cabecera'
import { Skeleton } from '~/ui/Skeleton'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { mostrarToast } from '~/ui/Toast'
import { TextField } from '~/ui/TextField'
import { DEBOUNCE_MS, sinRepetir, useDebounced, useLenta } from './ayudas'
import { LineaSheet } from './LineaSheet'
import type { LineaNueva } from './LineaSheet'
import { PasoCargando, PasoDerecha } from './Paso'
import { iniciarWizard, useCuenta, useWizardStore, wizard } from './useWizard'
import './PasoProductos.css'

/** Cuántas fichas se ven antes de «Ver todos»: las demás están a un toque, y la lista de la factura no queda lejos. */
const FICHAS_INICIALES = 8

/** El rótulo de lo que falta o sobra del ITBIS en una ficha o una línea: el 18 % se da por sabido. */
const SUFIJO_ITBIS: Record<number, string> = { 1: '+ ITBIS', 2: '+ ITBIS 16%', 3: 'tasa 0', 4: 'exento' }
const ETIQUETA_ITBIS: Record<number, string> = { 2: '16%', 3: 'Tasa 0', 4: 'Exento' }

/** Avisa que una línea se quitó y deja «Deshacer» a la vista (6 s). */
function avisarQuitada(d: Deshacer | null): void {
  if (d !== null) mostrarToast('Línea quitada', { deshacer: () => wizard.restaurarLinea(d) })
}

export default function PasoProductos(): JSX.Element {
  const { entitlements, u } = useCuenta()
  const carrito = useWizardStore((s) => s.carrito)
  const ultimoTipoItem = useWizardStore((s) => s.ultimoTipoItem)
  const enLinea = useEnLinea()

  const tiposClave = tiposVenta(entitlements).join(',')
  const tipos = useMemo(() => (tiposClave === '' ? [] : tiposClave.split(',')), [tiposClave])
  useEffect(() => {
    if (u !== null) iniciarWizard(u, tipos)
  }, [u, tipos])

  const [texto, setTexto] = useState('')
  const consulta = useDebounced(texto, DEBOUNCE_MS).trim()
  const hayCatalogo = tieneModulo(entitlements, 'productos')
  const lista = useInfiniteQuery({
    queryKey: ['facturar', 'productos', consulta],
    queryFn: ({ pageParam }) => buscarProductos({ query: consulta, page: pageParam, pageSize: PAGINA_LISTAS }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.totalPages !== null && ultima.page < ultima.totalPages ? ultima.page + 1 : undefined),
    staleTime: FRESCURA.NORMAL,
    enabled: hayCatalogo,
  })
  const productos = useMemo(
    () =>
      sinRepetir(lista.data?.pages.flatMap((p) => p.items) ?? []).flatMap((v) => {
        const p = productoSel(v)
        return p !== null && coincide({ nombre: v.nombre, sku: v.sku }, consulta) ? [p] : []
      }),
    [lista.data, consulta],
  )
  const lenta = useLenta(lista.isFetching)
  const [verTodos, setVerTodos] = useState(false)

  // La hoja de una línea: `id` es la línea que se edita, o null para una línea libre nueva; `n` cambia en cada apertura para que la hoja empiece limpia.
  const [hoja, setHoja] = useState<{ n: number; id: number | null } | null>(null)
  const aperturas = useRef(0)
  const abrirHoja = (id: number | null): void => {
    aperturas.current += 1
    setHoja({ n: aperturas.current, id })
  }

  if (carrito === null || entitlements === null) return <PasoCargando titulo="Nueva factura" />

  const { lineas } = carrito
  const totales = resumenTotales(lineas)
  const enCarrito = (id: number): number => lineas.find((l) => l.productoId === id)?.cant ?? 0
  const editada = hoja !== null && hoja.id !== null ? lineas.find((l) => l.id === hoja.id) : undefined

  let razon: string | undefined
  if (lineas.length === 0) razon = 'Agrega al menos un producto o servicio.'
  else if (!(totales.total > 0)) razon = 'El total debe ser mayor que 0.'

  const tocar = (p: ProductoSel): void => {
    const r = wizard.agregarProducto(p)
    if (r.lineaId === null) mostrarToast(`Una factura admite hasta ${MAX_LINEAS} líneas.`, { tipo: 'error' })
    else if (r.abrirLinea) abrirHoja(r.lineaId)
  }
  const nuevaLibre = (): void => {
    if (lineas.length >= MAX_LINEAS) mostrarToast(`Una factura admite hasta ${MAX_LINEAS} líneas.`, { tipo: 'error' })
    else abrirHoja(null)
  }
  const cambiar = (l: LineaCarrito, cant: number): void => avisarQuitada(wizard.cambiarCantidad(l.id, cant))

  const reintentar = (): void => void (lista.isFetchNextPageError ? lista.fetchNextPage() : lista.refetch())
  const visibles = verTodos || consulta !== '' ? productos : productos.slice(0, FICHAS_INICIALES)

  let catalogo: JSX.Element | null
  if (!hayCatalogo) catalogo = <p className="paso__tipo">Tu plan no incluye Productos: agrega los conceptos con «Línea libre».</p>
  else if (lista.data === undefined) {
    catalogo =
      lista.isError || !enLinea ? (
        <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: reintentar }}>
          {enLinea ? 'No se pudo cargar el catálogo. Puedes seguir con «Línea libre».' : 'Sin conexión: no se puede cargar el catálogo. Puedes seguir con «Línea libre».'}
        </Banner>
      ) : (
        <div aria-busy="true">
          <Skeleton filas={3} alto={72} />
        </div>
      )
  } else if (productos.length === 0) {
    catalogo = <p className="paso__tipo">{consulta === '' ? 'Aún no tienes productos. Usa «Línea libre» para agregar un concepto.' : `Sin resultados para «${consulta}».`}</p>
  } else {
    catalogo = (
      <>
        {lista.isError && (
          <Banner tono="danger" accion={{ etiqueta: 'Reintentar', onClick: reintentar }}>
            No se pudo cargar el catálogo.
          </Banner>
        )}
        <ul className="pp-fichas">
          {visibles.map((p) => {
            const cant = enCarrito(p.id)
            return (
              <li key={p.id}>
                <button type="button" className="pp-ficha" onClick={() => tocar(p)}>
                  <span className="pp-ficha__nombre">{p.nombre}</span>
                  <span className="pp-ficha__precio">{p.precio > 0 ? `${rd(p.precio)} ${SUFIJO_ITBIS[p.indFact]}` : 'Sin precio'}</span>
                  {cant > 0 && <span className="pp-ficha__cant">En la factura: {cant}</span>}
                </button>
              </li>
            )
          })}
        </ul>
        {!verTodos && consulta === '' && productos.length > FICHAS_INICIALES && (
          <Button variante="texto" bloque onClick={() => setVerTodos(true)}>
            Ver todos los productos
          </Button>
        )}
        {(verTodos || consulta !== '') && lista.hasNextPage && (
          <Button variante="secundario" bloque cargando={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
            Cargar más
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="pantalla paso">
      <Cabecera titulo={`Nueva factura E${carrito.tipo}`} atras={{ id: 'facturar' }} derecha={<PasoDerecha paso={2} />} />
      <div className="paso__cuerpo">
        {hayCatalogo && <TextField tipo="search" etiqueta="Buscar producto o servicio" valor={texto} onCambio={setTexto} limpiable enterkeyhint="search" autoComplete="off" />}
        {lenta && <Banner tono="info">Tarda más de lo normal</Banner>}
        {catalogo}
        <Button variante="secundario" bloque icono="plus" onClick={nuevaLibre}>
          Línea libre
        </Button>

        <h2 className="paso__seccion">En la factura</h2>
        {lineas.length === 0 ? (
          <p className="paso__tipo">Aún no hay nada. Toca un producto o agrega una línea libre.</p>
        ) : (
          <ul className="pp-lineas">
            {lineas.map((l) => (
              <li key={l.id} className="paso__tarjeta pp-linea">
                <button type="button" className="pp-linea__editar" aria-label={`Editar ${l.nombre === '' ? 'línea' : l.nombre}`} onClick={() => abrirHoja(l.id)}>
                  <span className="pp-linea__nombre">{l.nombre === '' ? 'Sin nombre' : l.nombre}</span>
                  <span className="pp-linea__detalle">
                    {l.cant} × {rd(l.precio)}
                    {l.desc > 0 && ` · Dto. ${l.desc}%`}
                    {ETIQUETA_ITBIS[l.indFact] !== undefined && ` · ${ETIQUETA_ITBIS[l.indFact]}`}
                  </span>
                </button>
                <span className="pp-linea__importe">{rd(montosDe(l).importe)}</span>
                <div className="pp-paso" role="group" aria-label={`Cantidad de ${l.nombre === '' ? 'la línea' : l.nombre}`}>
                  <button type="button" className="pp-paso__boton" aria-label="Menos" onClick={() => cambiar(l, l.cant - 1)}>
                    −
                  </button>
                  <span className="pp-paso__cantidad">{l.cant}</span>
                  <button type="button" className="pp-paso__boton" aria-label="Más" onClick={() => cambiar(l, l.cant + 1)}>
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <StickyActionBar>
        <div className="pp-total">
          <span>
            {lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'}
          </span>
          <span className="pp-total__monto">Total {rd(totales.total)}</span>
        </div>
        <Button bloque disabled={razon !== undefined} razon={razon} onClick={() => navegar({ id: 'facturar-revisar' })}>
          Revisar
        </Button>
      </StickyActionBar>

      {hoja !== null && (hoja.id === null || editada !== undefined) && (
        <LineaSheet
          key={hoja.n}
          titulo={hoja.id === null ? 'Línea libre' : 'Editar línea'}
          inicial={editada ?? lineaLibre(carrito, ultimoTipoItem)}
          existente={hoja.id !== null}
          onListo={(l: LineaNueva) => {
            if (hoja.id === null) {
              if (wizard.agregarLinea(l) === null) mostrarToast(`Una factura admite hasta ${MAX_LINEAS} líneas.`, { tipo: 'error' })
            } else wizard.actualizarLinea(hoja.id, l)
            setHoja(null)
          }}
          onQuitar={() => {
            if (hoja.id !== null) avisarQuitada(wizard.quitarLinea(hoja.id))
            setHoja(null)
          }}
          onCerrar={() => setHoja(null)}
        />
      )}
    </div>
  )
}
