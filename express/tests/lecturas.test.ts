// net/lecturas: las lecturas de Facturas (lista, detalle, estado, estadísticas, avisos y recibo) sobre `getList`, `getJson` y `qs` de la app
// completa, sin pasar por api/facturas.ts, que trae zod y no puede estar en el primer pintado. Como las URLs están escritas a mano, esta prueba
// las ata a las de los servicios de siempre: se recorren los dos con un `fetch` que graba lo que se pide y contesta `{ status: true, data: [] }`.
// Ninguna petición sale de la máquina.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { ApiError } from '@/api/errores'
import * as kernel from '@/api/facturas'
import * as kernelStats from '@/api/stats'
import { _reiniciarCapacidades, claves, getAvisos, getEstado, getFactura, getReciboDatos, getStatsLight, listFacturas } from '~/net/lecturas'

/** Lo que contesta el servidor falso: el código HTTP y el cuerpo JSON. */
interface Contestacion {
  status: number
  cuerpo: unknown
}

const VACIA: Contestacion = { status: 200, cuerpo: { status: true, data: [] } }
const MENSAJE_ESTADO = 'Ese filtro de estado no es válido. Elige otro en la lista.'
/** El 422 que da un API anterior al plan 05 a `estado=accion`, igual que a cualquier valor que no es un filtro. */
const ESTADO_NO_VALIDO: Contestacion = { status: 422, cuerpo: { status: false, error: MENSAJE_ESTADO } }
/** Un origen cualquiera para leer con `URL` las rutas relativas del API: solo importan la ruta y la query. */
const ORIGEN = 'http://prueba.test'

const fetchReal = globalThis.fetch
let pedidas: string[] = []
let porContestar: Contestacion[] = []

/** Las próximas contestaciones del servidor falso, en orden; pasadas esas contesta `{ status: true, data: [] }`. */
function respuestas(lista: Contestacion[]): void {
  porContestar = [...lista]
}

beforeEach(() => {
  pedidas = []
  porContestar = []
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    pedidas.push(String(url))
    const { status, cuerpo } = porContestar.shift() ?? VACIA
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  _reiniciarCapacidades()
})

afterEach(() => {
  globalThis.fetch = fetchReal
})

/** La URL (ruta y query) de la única petición que hace `fn`; falla si hace más o ninguna. */
async function urlDe(fn: () => Promise<unknown>): Promise<string> {
  const antes = pedidas.length
  await fn()
  const nuevas = pedidas.slice(antes)
  assert.equal(nuevas.length, 1, `se esperaba una petición y hubo ${nuevas.length}: ${nuevas.join(', ')}`)
  return nuevas[0]
}

/** Los parámetros de una URL como pares [nombre, valor] ordenados: el orden en que viajan no cuenta. */
const params = (url: string): string[][] => [...new URL(url, ORIGEN).searchParams].sort()

/** La ruta de una URL, sin la query. */
const ruta = (url: string): string => new URL(url, ORIGEN).pathname

/** El `estado` de cada petición hecha hasta ahora, en orden (null si no lo llevaba). */
const estadosEnviados = (): (string | null)[] => pedidas.map((url) => new URL(url, ORIGEN).searchParams.get('estado'))

// --- Paridad con los servicios de la app completa ---------------------------------------------------------------------------------------

test('paridad de URLs con el kernel', async () => {
  assert.equal(await urlDe(() => getFactura(7)), await urlDe(() => kernel.getFactura(7))) // /api/facturas?id=7
  assert.equal(await urlDe(() => getEstado(7)), await urlDe(() => kernel.getEstado(7))) // /api/facturas/7/estado
  assert.equal(await urlDe(() => getReciboDatos(7)), '/api/facturas/7/pdf?format=datos&formato=pos') // igual al kernel con el ancho 80 por defecto
  assert.equal(await urlDe(() => getReciboDatos(7)), await urlDe(() => kernel.getReciboFactura(7)))
  assert.equal(await urlDe(() => getStatsLight()), (await urlDe(() => kernelStats.getStats())) + '?stats=light')
  assert.equal(await urlDe(() => getAvisos()), await urlDe(() => kernelStats.getAvisosEcf())) // /api/facturas/avisos

  const lista = await urlDe(() => listFacturas({ page: 2, pageSize: 15, query: 'abc', estado: 'pendiente', tipo_ecf: '45', client_id: 9, lean: true, archivadas: false }))
  const delKernel = await urlDe(() => kernel.listFacturas({ page: 2, pageSize: 15, query: 'abc', estado: 'pendiente', tipoEcf: '45' }))
  assert.equal(ruta(lista), ruta(delKernel))
  assert.equal(ruta(lista), '/api/facturas')
  assert.deepEqual(params(lista), [...params(delKernel), ['archivadas', '0'], ['client_id', '9'], ['lean', '1']].sort())
})

test('sin filtros la lista pide la misma URL pelada que el kernel, y lo vacío no viaja', async () => {
  assert.equal(await urlDe(() => listFacturas({})), await urlDe(() => kernel.listFacturas()))
  assert.equal(await urlDe(() => listFacturas()), '/api/facturas')
  // El campo de búsqueda vacío y el filtro sin elegir no son parámetros: `qs` los deja fuera, como al kernel.
  assert.equal(await urlDe(() => listFacturas({ query: '', estado: '', tipo_ecf: '' })), '/api/facturas')
})

test('lean y archivadas son tokens de Express: solo viajan lean=1 y archivadas=0, y el resto del tiempo el API contesta lo de siempre', async () => {
  assert.deepEqual(params(await urlDe(() => listFacturas({ lean: true }))), [['lean', '1']])
  assert.deepEqual(params(await urlDe(() => listFacturas({ archivadas: false }))), [['archivadas', '0']])
  // El API lee `lean` solo si vale '1' y `archivadas` solo si vale '0': lo demás no se manda, no se manda otro valor.
  assert.equal(await urlDe(() => listFacturas({ lean: false })), '/api/facturas')
  assert.equal(await urlDe(() => listFacturas({ archivadas: true })), '/api/facturas')
  assert.equal(await urlDe(() => listFacturas({ client_id: 9 })), '/api/facturas?client_id=9')
})

// --- Lo que devuelve cada lectura ---------------------------------------------------------------------------------------------------------

test('listFacturas devuelve la lista con su paginación, tal como la lee getList', async () => {
  respuestas([{ status: 200, cuerpo: { status: true, data: [{ id: 2 }, { id: 1 }], pagination: { total: 30, page: 2, pageSize: 15, totalPages: 2 } } }])
  assert.deepEqual(await listFacturas({ page: 2, pageSize: 15 }), { items: [{ id: 2 }, { id: 1 }], total: 30, page: 2, pageSize: 15, totalPages: 2 })
})

test('getFactura entrega la fila: el API manda [fila], una fila suelta o nada', async () => {
  const sobre = (data: unknown): Contestacion => ({ status: 200, cuerpo: { status: true, data } })
  respuestas([sobre([{ id: 7, e_ncf: 'E450000000007' }])])
  assert.deepEqual(await getFactura(7), { id: 7, e_ncf: 'E450000000007' })
  respuestas([sobre({ id: 7 })])
  assert.deepEqual(await getFactura(7), { id: 7 })
  respuestas([sobre([])])
  assert.equal(await getFactura(7), null)
  respuestas([sobre(null)])
  assert.equal(await getFactura(7), null)
})

test('estado, estadísticas, avisos y recibo entregan lo que el API pone en data, sin tocarlo', async () => {
  const sobre = (data: unknown): Contestacion => ({ status: 200, cuerpo: { status: true, data } })
  respuestas([sobre({ estado_dgii: 'ENVIADO' }), sobre({ por_estado: [] }), sobre({ secuencias: [] }), sobre({ titulo: 'FACTURA' })])
  assert.deepEqual(await getEstado(7), { estado_dgii: 'ENVIADO' })
  assert.deepEqual(await getStatsLight(), { por_estado: [] })
  assert.deepEqual(await getAvisos(), { secuencias: [] })
  assert.deepEqual(await getReciboDatos(7), { titulo: 'FACTURA' })
})

test('un error del API sale como ApiError, con su texto y su código HTTP', async () => {
  respuestas([{ status: 403, cuerpo: { status: false, error: 'Tu plan Express no incluye esta función', codigo: 'EDICION_NO_INCLUYE' } }])
  await assert.rejects(getStatsLight(), (e: unknown) => e instanceof ApiError && e.status === 403 && e.codigo === 'EDICION_NO_INCLUYE')
})

// --- estado=accion y el API que todavía no lo conoce ----------------------------------------------------------------------------------

test('estado=accion cae a rechazado una sola vez', async () => {
  // Review Focus 4
  respuestas([ESTADO_NO_VALIDO, { status: 200, cuerpo: { status: true, data: [] } }])
  await listFacturas({ estado: 'accion' })
  assert.deepEqual(estadosEnviados(), ['accion', 'rechazado'])
  await listFacturas({ estado: 'accion' })
  const e = estadosEnviados()
  assert.equal(e[e.length - 1], 'rechazado') // la segunda llamada ya no prueba accion
  assert.deepEqual(e, ['accion', 'rechazado', 'rechazado'])

  // Con la bandera apagada se vuelve a probar accion; un 500 en accion no la enciende (no es el 422 del filtro) y no se reintenta con rechazado.
  _reiniciarCapacidades()
  respuestas([{ status: 500, cuerpo: { status: false, error: 'El servidor tuvo un problema.' } }])
  await assert.rejects(listFacturas({ estado: 'accion' }), (err: unknown) => err instanceof ApiError && err.status === 500)
  assert.deepEqual(estadosEnviados().slice(3), ['accion'])
  await listFacturas({ estado: 'accion' })
  assert.deepEqual(estadosEnviados().slice(3), ['accion', 'accion']) // sigue probando accion: la bandera nunca se encendió
})

test('el reintento con rechazado conserva el resto de los parámetros y es lo que devuelve', async () => {
  const filtros = { page: 2, pageSize: 15, query: 'abc', tipo_ecf: '45', client_id: 9, lean: true, archivadas: false }
  respuestas([ESTADO_NO_VALIDO, { status: 200, cuerpo: { status: true, data: [{ id: 3 }], pagination: { total: 31, page: 2, pageSize: 15, totalPages: 3 } } }])
  const lista = await listFacturas({ ...filtros, estado: 'accion' })
  assert.deepEqual(lista.items, [{ id: 3 }])
  assert.equal(lista.totalPages, 3)
  const [primera, segunda] = pedidas
  assert.deepEqual(params(primera).filter(([k]) => k !== 'estado'), params(segunda).filter(([k]) => k !== 'estado'))
  assert.deepEqual([params(primera).filter(([k]) => k === 'estado'), params(segunda).filter(([k]) => k === 'estado')], [[['estado', 'accion']], [['estado', 'rechazado']]])
})

test('solo estado=accion se sustituye: otro filtro con 422 falla tal cual, y el filtro recordado no toca a los demás', async () => {
  respuestas([ESTADO_NO_VALIDO])
  await assert.rejects(listFacturas({ estado: 'pendiente' }), (e: unknown) => e instanceof ApiError && e.status === 422 && e.message === MENSAJE_ESTADO)
  assert.deepEqual(estadosEnviados(), ['pendiente']) // un 422 de otro filtro no se reintenta

  respuestas([ESTADO_NO_VALIDO, VACIA])
  await listFacturas({ estado: 'accion' }) // aprende que el API no conoce accion
  await listFacturas({ estado: 'pendiente' })
  await listFacturas({ estado: 'aprobado' })
  await listFacturas({})
  assert.deepEqual(estadosEnviados().slice(1), ['accion', 'rechazado', 'pendiente', 'aprobado', null])
})

test('si el reintento también falla no se queda recordado: el 422 era de otra cosa y la próxima vez se prueba accion', async () => {
  // Con `estado=accion` y un `client_id` que el API rechaza el 422 no dice nada del filtro: se reintenta una vez y el segundo error sale tal cual.
  const CLIENTE_NO_VALIDO: Contestacion = { status: 422, cuerpo: { status: false, error: 'El cliente que elegiste para filtrar no es válido. Elige otro.' } }
  respuestas([CLIENTE_NO_VALIDO, CLIENTE_NO_VALIDO])
  await assert.rejects(listFacturas({ estado: 'accion', client_id: 99 }), (e: unknown) => e instanceof ApiError && e.status === 422 && /cliente/.test(e.message))
  assert.deepEqual(estadosEnviados(), ['accion', 'rechazado']) // una sola vez, no un bucle
  await listFacturas({ estado: 'accion' })
  assert.deepEqual(estadosEnviados(), ['accion', 'rechazado', 'accion'])
})

test('una falla de red en el reintento sale como falla de red y deja la bandera apagada', async (t) => {
  const avisos = t.mock.method(console, 'warn', () => {}) // http.ts avisa de las fallas de red en la consola: aquí es lo esperado
  let llamadas = 0
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    pedidas.push(String(url))
    llamadas += 1
    if (llamadas === 1) return new Response(JSON.stringify(ESTADO_NO_VALIDO.cuerpo), { status: 422, headers: { 'content-type': 'application/json' } })
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await assert.rejects(listFacturas({ estado: 'accion' }), (e: unknown) => e instanceof ApiError && e.status === 0)
  assert.equal(avisos.mock.callCount(), 1)
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    pedidas.push(String(url))
    return new Response(JSON.stringify(VACIA.cuerpo), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  await listFacturas({ estado: 'accion' })
  assert.deepEqual(estadosEnviados(), ['accion', 'rechazado', 'accion'])
})

test('_reiniciarCapacidades vuelve a probar accion', async () => {
  respuestas([ESTADO_NO_VALIDO, VACIA])
  await listFacturas({ estado: 'accion' })
  _reiniciarCapacidades()
  await listFacturas({ estado: 'accion' })
  assert.deepEqual(estadosEnviados(), ['accion', 'rechazado', 'accion'])
})

// --- Las claves de la caché de consultas --------------------------------------------------------------------------------------------------

test('claves: la forma que usan las pantallas y que invalidan por prefijo (facturas y stats)', () => {
  const filtros = { estado: 'accion', tipo: '45', query: 'abc' }
  assert.deepEqual(claves.lista(filtros), ['facturas', 'lista', filtros])
  assert.deepEqual(claves.detalle(7), ['facturas', 'detalle', 7])
  assert.deepEqual(claves.estado(7), ['facturas', 'estado', 7])
  assert.deepEqual(claves.recibo(7), ['facturas', 'recibo', 7])
  assert.deepEqual(claves.stats, ['stats', 'light'])
  assert.deepEqual(claves.avisos, ['avisos'])
  assert.deepEqual(claves.emisor, ['emisor'])
  // Invalidar ['facturas'] cubre la lista, el detalle, el estado y el recibo; ['stats'] cubre la ligera. Las demás claves no se mezclan.
  for (const clave of [claves.lista(filtros), claves.detalle(7), claves.estado(7), claves.recibo(7)]) assert.equal(clave[0], 'facturas')
  assert.equal(claves.stats[0], 'stats')
  assert.notDeepEqual(claves.lista({ estado: 'accion' }), claves.lista({ estado: 'pendiente' })) // otro filtro, otra clave
  assert.notDeepEqual(claves.detalle(7), claves.detalle(8))
})
