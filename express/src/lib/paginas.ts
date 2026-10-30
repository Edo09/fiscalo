// El paginado del historial de Facturas sin falso vacío (anexo 5.5). La lista se pide con `archivadas=0`, pero un API que todavía no lo conoce (o una fila
// vieja que se le escapa) trae los intentos archivados, y la pantalla los oculta ella. Una página cuyas filas quedan todas ocultas no puede decir «Aún no
// has emitido nada» ni quedarse parada con un «Cargar más» que no se ve: pide la siguiente por sí sola (Review Focus 4). Son funciones puras sobre las páginas
// que ya se cargaron; la pantalla pone el `useInfiniteQuery` y solo les pregunta.
import { PAGINA } from '~/config'
import { bucketDe } from '~/lib/etiquetas'
import type { FacturaVista } from '~/lib/filas'

/** Una página ya cargada de la lista: sus filas, el número de página que dijo el API y cuántas páginas hay (null si no mandó la paginación). */
export interface PaginaFacturas {
  items: FacturaVista[]
  page: number
  totalPages: number | null
}

/** Por qué no hay nada que mostrar: ver `estadoVacio`. */
export type EstadoVacio = 'primeraVez' | 'filtro' | 'busqueda' | 'sinVisibles'

/**
 * Las filas que se ven, de todas las páginas y en su orden. Con `ocultarArchivadas` se quitan las reemplazadas: los intentos archivados de un número que
 * se volvió a emitir, cualquiera de sus siete grafías (tres son las que el VARCHAR(20) de antes cortó). Lo rechazado, lo no encontrado, lo desconocido y
 * lo vacío se ven: ante la duda la factura se muestra.
 */
export function visibles(paginas: readonly PaginaFacturas[], o: { ocultarArchivadas: boolean }): FacturaVista[] {
  const todas = paginas.flatMap((p) => p.items)
  return o.ocultarArchivadas ? todas.filter((f) => bucketDe(f.estado) !== 'reemplazada') : todas
}

/**
 * ¿Hay que pedir la página siguiente sin que nadie lo pida? Sí si se ven menos filas que `minimo` (por omisión `PAGINA`, lo que llena una página) y la última
 * página cargada dice que hay otra. Una última página corta es una lista corta de verdad y no pide nada, y sin paginación (`totalPages` null) tampoco: no se
 * pide a ciegas una página que quizá no existe.
 */
export function necesitaMasPaginas(paginas: readonly PaginaFacturas[], o: { ocultarArchivadas: boolean; minimo?: number }): boolean {
  const ultima = paginas[paginas.length - 1]
  if (ultima === undefined || ultima.totalPages === null || ultima.page >= ultima.totalPages) return false
  return visibles(paginas, o).length < (o.minimo ?? PAGINA)
}

/**
 * Por qué una lista cargada no muestra nada, o null si no hay nada que explicar. Gana la primera que coincide:
 *  1. Hay filas que ver: null.
 *  2. Falta pedir la siguiente página (`necesitaMasPaginas`): null, que se está cargando sola y todavía no se sabe si hay algo.
 *  3. Hay una búsqueda: `busqueda`. Una búsqueda sin resultados no es «primera vez» aunque el negocio no haya emitido nada.
 *  4. Hay un chip de filtro: `filtro`.
 *  5. `totalEcf` (el `resumen.total_ecf` de las estadísticas) es 0: `primeraVez`, el único caso en que se dice «Aún no has emitido nada».
 *  6. Todo lo demás, también un `totalEcf` que todavía no llegó (null): `sinVisibles`. Sin las estadísticas no se afirma que es la primera vez, y con facturas
 *     que están todas ocultas tampoco. Su texto es «No hay facturas para mostrar», con la acción «Actualizar».
 * La pantalla la llama solo con una lista cargada, nunca mientras la primera página está pidiéndose.
 */
export function estadoVacio(o: {
  totalEcf: number | null
  filtro: string
  busqueda: string
  paginas: readonly PaginaFacturas[]
  ocultarArchivadas: boolean
}): EstadoVacio | null {
  const ocultar = { ocultarArchivadas: o.ocultarArchivadas }
  if (visibles(o.paginas, ocultar).length > 0) return null
  if (necesitaMasPaginas(o.paginas, ocultar)) return null
  if (o.busqueda !== '') return 'busqueda'
  if (o.filtro !== '') return 'filtro'
  if (o.totalEcf === 0) return 'primeraVez'
  return 'sinVisibles'
}
