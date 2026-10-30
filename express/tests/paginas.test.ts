// lib/paginas: el paginado del historial de Facturas sin falso vacío. Con `archivadas=0` el API ya deja fuera las filas `*_ARCHIVADO`; mientras no lo
// conozca (o si una fila vieja se le escapa) la pantalla las oculta ella, y una página cuyas filas están todas ocultas no puede ni decir «Aún no has
// emitido nada» ni quedarse parada: pide la siguiente (Review Focus 4). Todo son funciones puras sobre las páginas que ya se cargaron.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PAGINA } from '~/config'
import { PORCLAVE } from '~/lib/etiquetas'
import { normalizarFactura } from '~/lib/filas'
import type { FacturaVista } from '~/lib/filas'
import { estadoVacio, necesitaMasPaginas, visibles } from '~/lib/paginas'
import type { PaginaFacturas } from '~/lib/paginas'

/** `n` filas del listado en ese `estado_dgii`, con ids desde `desde`. Pasan por `normalizarFactura`, como las de la pantalla. */
function filas(estado: string, n: number, desde = 1): FacturaVista[] {
  return Array.from({ length: n }, (_, i) =>
    normalizarFactura({ id: desde + i, e_ncf: `E45${String(desde + i).padStart(10, '0')}`, tipo_ecf: '45', client_name: 'Cliente', date: '2026-10-27 10:00:00', total: '100.00', estado_dgii: estado }),
  )
}

const quince = (estado: string): FacturaVista[] => filas(estado, 15)

test('todas ocultas: ni vacio falso ni parada, pide la siguiente', () => {
  // Review Focus 4
  const p1 = { items: quince('RECHAZADO_ARCHIVADO'), page: 1, totalPages: 3 }
  assert.equal(visibles([p1], { ocultarArchivadas: true }).length, 0)
  assert.equal(necesitaMasPaginas([p1], { ocultarArchivadas: true }), true)
  assert.equal(necesitaMasPaginas([p1, { items: quince('ACEPTADO'), page: 2, totalPages: 3 }], { ocultarArchivadas: true }), false)
  assert.equal(necesitaMasPaginas([{ items: [...quince('ACEPTADO').slice(0, 3)], page: 3, totalPages: 3 }], { ocultarArchivadas: true }), false) // ultima pagina: lista corta legitima
  assert.equal(necesitaMasPaginas([{ ...p1, totalPages: null }], { ocultarArchivadas: true }), false)
  assert.equal(visibles([p1], { ocultarArchivadas: false }).length, 15)
})

test('estadoVacio: la primera vez es solo total_ecf 0 sin filtro ni busqueda', () => {
  // Review Focus 4
  const vacia = [{ items: [], page: 1, totalPages: 1 }]
  const ocultas = [{ items: quince('RECHAZADO_ARCHIVADO'), page: 1, totalPages: 1 }]
  const o = { totalEcf: 0, filtro: '', busqueda: '', paginas: vacia, ocultarArchivadas: true }
  assert.equal(estadoVacio(o), 'primeraVez')
  assert.equal(estadoVacio({ ...o, totalEcf: null }), 'sinVisibles') // sin stats no se afirma "primera vez"
  assert.equal(estadoVacio({ ...o, totalEcf: 15, paginas: ocultas }), 'sinVisibles') // hay facturas y todas estan ocultas: nunca "Aun no has emitido nada"
  assert.equal(estadoVacio({ ...o, filtro: 'pendiente' }), 'filtro')
  assert.equal(estadoVacio({ ...o, filtro: 'pendiente', busqueda: 'abc' }), 'busqueda')
  assert.equal(estadoVacio({ ...o, totalEcf: 15, paginas: [{ ...ocultas[0], totalPages: 3 }] }), null) // pide la siguiente: no hay estado vacio todavia
  assert.equal(estadoVacio({ ...o, totalEcf: 15, paginas: [{ items: quince('ACEPTADO'), page: 1, totalPages: 1 }] }), null)
})

// --- visibles -----------------------------------------------------------------------------------------------------------------------------

test('visibles: las páginas en orden, quitando solo las filas reemplazadas (archivadas)', () => {
  const p1: PaginaFacturas = { items: [...filas('ACEPTADO', 2, 1), ...filas('RECHAZADO_ARCHIVADO', 1, 3)], page: 1, totalPages: 2 }
  const p2: PaginaFacturas = { items: [...filas('ENVIADO', 1, 4), ...filas('NO_ENCONTRADO_ARCHIVADO', 1, 5)], page: 2, totalPages: 2 }
  assert.deepEqual(visibles([p1, p2], { ocultarArchivadas: true }).map((f) => f.id), [1, 2, 4])
  assert.deepEqual(visibles([p1, p2], { ocultarArchivadas: false }).map((f) => f.id), [1, 2, 3, 4, 5])
})

test('visibles: de los 25 estados que conoce lib/etiquetas se ocultan los reemplazados, también los cortados a 20 caracteres, y ningún otro', () => {
  const ocultar = (estado: string): number => visibles([{ items: filas(estado, 1), page: 1, totalPages: 1 }], { ocultarArchivadas: true }).length
  const reemplazados = Object.entries(PORCLAVE).filter(([, bucket]) => bucket === 'reemplazada').map(([estado]) => estado)
  // Los cuatro archivados y los tres que el VARCHAR(20) de antes cortó: si la tabla gana otro, entra solo; la prueba no lo olvida.
  assert.ok(reemplazados.includes('RECHAZADO_ARCHIVADO') && reemplazados.includes('RFCE_RECHAZADO_ARCHI') && reemplazados.includes('RFCE_NO_ENCONTRADO_A'))
  for (const [estado, bucket] of Object.entries(PORCLAVE)) assert.equal(ocultar(estado), bucket === 'reemplazada' ? 0 : 1, `${estado} (${bucket})`)
})

test('visibles: lo desconocido, lo vacío y lo que casi se llama archivado se ven: ante la duda la factura se muestra', () => {
  for (const estado of ['', 'ESTADO_NUEVO', 'archivado', 'rechazado_archivado', 'RECHAZADO_ARCHIVADO_X', ' RECHAZADO_ARCHIVADO', 'constructor']) {
    assert.equal(visibles([{ items: filas(estado, 1), page: 1, totalPages: 1 }], { ocultarArchivadas: true }).length, 1, estado || '(vacío)')
  }
})

test('visibles: sin páginas no hay filas, y las que se devuelven son las mismas filas, sin copiar ni reordenar', () => {
  assert.deepEqual(visibles([], { ocultarArchivadas: true }), [])
  const p1: PaginaFacturas = { items: filas('ACEPTADO', 3), page: 1, totalPages: 1 }
  const [a] = visibles([p1], { ocultarArchivadas: true })
  assert.equal(a, p1.items[0])
})

// --- necesitaMasPaginas ------------------------------------------------------------------------------------------------------------------

test('necesitaMasPaginas: faltan filas por ver (menos del mínimo) y hay otra página; por omisión el mínimo es PAGINA', () => {
  const corta = (n: number, page = 1, totalPages: number | null = 2): PaginaFacturas[] => [{ items: filas('ACEPTADO', n), page, totalPages }]
  assert.equal(necesitaMasPaginas(corta(PAGINA - 1), { ocultarArchivadas: true }), true)
  assert.equal(necesitaMasPaginas(corta(PAGINA), { ocultarArchivadas: true }), false)
  assert.equal(necesitaMasPaginas(corta(PAGINA + 1), { ocultarArchivadas: true }), false)
  // Con otro mínimo.
  assert.equal(necesitaMasPaginas(corta(3), { ocultarArchivadas: true, minimo: 5 }), true)
  assert.equal(necesitaMasPaginas(corta(5), { ocultarArchivadas: true, minimo: 5 }), false)
  assert.equal(necesitaMasPaginas(corta(0), { ocultarArchivadas: true, minimo: 0 }), false)
  // Sin ocultar nada, una página corta con otra detrás también pide la siguiente (el API devolvió menos de lo pedido).
  assert.equal(necesitaMasPaginas(corta(4), { ocultarArchivadas: false }), true)
})

test('necesitaMasPaginas: mira la última página cargada, y sin otra página (o sin saber si la hay) no pide nada', () => {
  const ocultas = (page: number, totalPages: number | null): PaginaFacturas => ({ items: filas('RECHAZADO_ARCHIVADO', 15, page * 100), page, totalPages })
  const o = { ocultarArchivadas: true }
  assert.equal(necesitaMasPaginas([], o), false)
  assert.equal(necesitaMasPaginas([ocultas(1, 3)], o), true)
  assert.equal(necesitaMasPaginas([ocultas(1, 3), ocultas(2, 3)], o), true) // la 2 tampoco trajo nada que ver y falta la 3
  assert.equal(necesitaMasPaginas([ocultas(1, 3), ocultas(2, 3), ocultas(3, 3)], o), false) // la última: no hay más
  assert.equal(necesitaMasPaginas([ocultas(1, 1)], o), false)
  assert.equal(necesitaMasPaginas([ocultas(1, 0)], o), false) // un API que cuenta cero páginas cuando no hay filas
  assert.equal(necesitaMasPaginas([ocultas(1, null)], o), false) // sin paginación no se sabe si hay otra: no se pide a ciegas
  // Se acumulan las filas visibles de todas las páginas: 5 de la primera y 10 de la segunda ya son 15.
  const parcial = (page: number, n: number): PaginaFacturas => ({ items: [...filas('ACEPTADO', n, page * 100), ...filas('RECHAZADO_ARCHIVADO', 15 - n, page * 100 + 50)], page, totalPages: 3 })
  assert.equal(necesitaMasPaginas([parcial(1, 5)], o), true)
  assert.equal(necesitaMasPaginas([parcial(1, 5), parcial(2, 10)], o), false)
})

// --- estadoVacio -------------------------------------------------------------------------------------------------------------------------

test('estadoVacio: con filas que ver nunca hay estado vacío, haya filtro o búsqueda', () => {
  const conFilas = [{ items: filas('ACEPTADO', 2), page: 1, totalPages: 1 }]
  for (const [filtro, busqueda] of [['', ''], ['pendiente', ''], ['', 'abc'], ['accion', 'abc']]) {
    assert.equal(estadoVacio({ totalEcf: 0, filtro, busqueda, paginas: conFilas, ocultarArchivadas: true }), null, `${filtro}/${busqueda}`)
  }
})

test('estadoVacio: gana la primera que coincide: búsqueda, filtro, primera vez, sin visibles', () => {
  const vacia = [{ items: [], page: 1, totalPages: 1 }]
  const base = { totalEcf: 0, filtro: '', busqueda: '', paginas: vacia, ocultarArchivadas: true }
  assert.equal(estadoVacio({ ...base, busqueda: 'abc' }), 'busqueda') // una búsqueda sin resultados no es «primera vez» aunque no haya facturas
  assert.equal(estadoVacio({ ...base, filtro: 'accion' }), 'filtro') // ni un chip sin filas
  assert.equal(estadoVacio({ ...base, totalEcf: 0, filtro: 'aprobado', busqueda: 'x' }), 'busqueda')
  assert.equal(estadoVacio({ ...base, totalEcf: 3 }), 'sinVisibles')
  assert.equal(estadoVacio({ ...base, totalEcf: 1 }), 'sinVisibles')
  assert.equal(estadoVacio({ ...base, totalEcf: null, filtro: 'pendiente' }), 'filtro') // sin stats un filtro sigue siendo un filtro
  assert.equal(estadoVacio({ ...base, totalEcf: null, busqueda: 'abc' }), 'busqueda')
})

test('estadoVacio: con las filas ocultas del todo y otra página por pedir no hay estado vacío; en la última, sí, y nunca es «primera vez» si hay facturas', () => {
  const ocultas = (page: number, totalPages: number | null): PaginaFacturas[] => [{ items: quince('RECHAZADO_ARCHIVADO'), page, totalPages }]
  const o = { totalEcf: 45, filtro: '', busqueda: '', ocultarArchivadas: true }
  assert.equal(estadoVacio({ ...o, paginas: ocultas(1, 3) }), null)
  assert.equal(estadoVacio({ ...o, paginas: ocultas(3, 3) }), 'sinVisibles')
  assert.equal(estadoVacio({ ...o, paginas: ocultas(1, null) }), 'sinVisibles') // sin paginación no se puede esperar una página que quizá no existe
  // Aunque las stats digan 0 (todavía no llegaron las nuevas) y las filas estén ocultas, con otra página por pedir se espera.
  assert.equal(estadoVacio({ ...o, totalEcf: 0, paginas: ocultas(1, 3) }), null)
  // Sin ocultar, esas mismas filas son filas que ver.
  assert.equal(estadoVacio({ ...o, ocultarArchivadas: false, paginas: ocultas(1, 3) }), null)
  assert.equal(estadoVacio({ ...o, ocultarArchivadas: false, paginas: ocultas(3, 3) }), null)
})
