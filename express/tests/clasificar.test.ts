// lib/clasificar y net/emitir: qué pasó con una emisión. El estado manda sobre el HTTP (un 422 con `data` y ERROR es una factura guardada sin confirmar, un 200 ENVIADO no es
// aceptada), sin datos manda el HTTP, y todo lo que no se entiende es `desconocido`: la regla del dueño es que una conexión caída no produzca un segundo e-NCF.
// Ninguna petición sale de la máquina: `emitirVenta` corre contra un `fetch` falso.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { bucketDe, PORCLAVE } from '~/lib/etiquetas'
import { clasificar, clasificarEstado } from '~/lib/clasificar'
import type { RespuestaEmision } from '~/lib/clasificar'
import { emitirVenta } from '~/net/emitir'

const GENERICO = 'No se pudo emitir la factura en la DGII. Espera unos minutos y vuelve a intentarlo; si sigue fallando, avisa a soporte.'

const conData = (estado_dgii: string | undefined, extra: Record<string, unknown> = {}): unknown => ({ factura_id: '41', e_ncf: 'E450000000014', total: '11800.00', ...(estado_dgii === undefined ? {} : { estado_dgii }), ...extra })
const sobre = (status: number, p: Partial<RespuestaEmision> = {}): RespuestaEmision => ({ status, sobre: true, ...p })

const ACEPTADAS = ['ACEPTADO', 'RFCE_ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDIC']
const EN_PROCESO = ['ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO']
const RECHAZADAS = ['RECHAZADO', 'RFCE_RECHAZADO']
/** La categoría de cada estado de la DGII, escrita a mano: solo NO_ENCONTRADO es `noEncontrada`; lo demás que no es aceptada, en proceso o rechazada queda guardado sin confirmar. */
const esperada = (estado: string): string =>
  ACEPTADAS.includes(estado) ? 'aceptada' : EN_PROCESO.includes(estado) ? 'enProceso' : RECHAZADAS.includes(estado) ? 'rechazada' : estado === 'NO_ENCONTRADO' ? 'noEncontrada' : 'guardadaIncierta'

test('con datos decide el estado, cualquiera sea el HTTP: los 25 estados mas uno desconocido por 200, 422 y 502', () => {
  const claves = [...Object.keys(PORCLAVE), 'XYZ']
  assert.ok(claves.length >= 26)
  for (const estado of claves) {
    for (const status of [200, 422, 502]) {
      const o = clasificar(sobre(status, { data: conData(estado) }))
      assert.equal(o.kind, esperada(estado), `${estado} por ${status}`)
      if (o.kind !== 'noGuardada' && o.kind !== 'validacion' && o.kind !== 'bloqueada' && o.kind !== 'enCurso' && o.kind !== 'desconocido') {
        assert.equal(o.facturaId, 41) // el id llega como texto de MySQL y sale como número
        assert.equal(o.eNcf, 'E450000000014')
        assert.equal(o.total, 11800)
      }
    }
  }
  assert.equal(clasificar(sobre(422, { data: conData('ERROR') })).kind, 'guardadaIncierta') // ERROR llega como 422 con datos
  assert.equal(clasificar(sobre(200, { data: conData('RECHAZADO') })).kind, 'rechazada')
  assert.equal(clasificar(sobre(200, { data: conData(undefined) })).kind, 'guardadaIncierta') // sin estado, también
})

test('clasificarEstado coincide con bucketDe en cada estado', () => {
  for (const estado of Object.keys(PORCLAVE)) {
    const bucket = bucketDe(estado)
    const kind = clasificarEstado(estado)
    if (bucket === 'aceptada') assert.equal(kind, 'aceptada')
    if (bucket === 'enProceso') assert.equal(kind, 'enProceso')
    if (bucket === 'rechazada') assert.equal(kind, 'rechazada')
    if (bucket !== 'aceptada' && bucket !== 'enProceso' && bucket !== 'rechazada') assert.equal(kind, estado === 'NO_ENCONTRADO' ? 'noEncontrada' : 'guardadaIncierta')
  }
  assert.equal(clasificarEstado(null), 'guardadaIncierta')
  assert.equal(clasificarEstado(''), 'guardadaIncierta')
})

test('sin datos: un 502 del servidor es no guardada con su texto; un 502 que es una página, no', () => {
  assert.deepEqual(clasificar(sobre(502, { error: GENERICO })), { kind: 'noGuardada', mensaje: GENERICO })
  assert.equal(clasificar({ status: 502, sobre: false }).kind, 'desconocido') // la página HTML de un proxy
  assert.equal(clasificar(sobre(502, { data: { factura_id: '41' } })).kind, 'guardadaIncierta') // con el id ya es una factura guardada
  assert.equal(clasificar(sobre(502, { data: { factura_id: 0 } })).kind, 'noGuardada') // un id que no sirve no cuenta
})

test('sin datos: 400, 404 y 422 son validación con el texto del servidor; los textos claros pasan sin cambios y los técnicos no', () => {
  const textos = [
    'Elige un cliente para esta factura. Solo las facturas de consumo y de gastos menores pueden ir sin cliente.',
    'Agrega al menos un producto o servicio.',
    'Este cliente no tiene RNC ni cédula, y la factura de crédito fiscal los necesita. Agrégale el RNC o emite una factura de consumo.',
    'Las facturas de consumo de RD$250,000 o más tienen que identificar al comprador. Elige un cliente con RNC o cédula.',
    'El RNC de este cliente (131000001) es el de tu propia empresa, y no puedes facturarte a ti mismo. Elige otro cliente.',
    'Línea 2: la cantidad debe ser mayor que 0.',
  ]
  for (const error of textos) for (const status of [400, 404, 422]) assert.deepEqual(clasificar(sobre(status, { error })), { kind: 'validacion', mensaje: error })
  const tecnico = clasificar(sobre(422, { error: 'SQLSTATE[22007]: Invalid datetime format' }))
  assert.equal(tecnico.kind, 'validacion')
  assert.doesNotMatch((tecnico as { mensaje: string }).mensaje, /SQLSTATE/)
})

test('403 es bloqueada con su codigo (o SIN_PERMISO); 409 EN_CURSO es enCurso y CLAVE_REUTILIZADA bloqueada', () => {
  const o = clasificar(sobre(403, { error: 'Tu plan no incluye este comprobante.', codigo: 'TIPO_NO_HABILITADO' }))
  assert.deepEqual(o, { kind: 'bloqueada', codigo: 'TIPO_NO_HABILITADO', mensaje: 'Tu plan no incluye este comprobante.' })
  assert.equal((clasificar(sobre(403, { error: 'No tienes permiso para hacer esto.' })) as { codigo: string }).codigo, 'SIN_PERMISO')
  assert.deepEqual(clasificar(sobre(409, { codigo: 'EN_CURSO' })), { kind: 'enCurso' })
  assert.equal((clasificar(sobre(409, { codigo: 'CLAVE_REUTILIZADA', error: 'Esa clave ya se usó.' })) as { codigo: string }).codigo, 'CLAVE_REUTILIZADA')
  assert.equal(clasificar(sobre(409, {})).kind, 'desconocido')
})

test('lo demás es desconocido: 401, un 5xx del servidor, un 200 sin datos y la red caída', () => {
  assert.equal(clasificar(sobre(401, { error: 'Invalid or inactive API token' })).kind, 'desconocido')
  assert.equal(clasificar(sobre(500, { error: 'Error interno' })).kind, 'desconocido')
  assert.equal(clasificar(sobre(503, {})).kind, 'desconocido')
  assert.equal(clasificar(sobre(200, {})).kind, 'desconocido')
  assert.equal(clasificar(sobre(200, { data: 'ok' })).kind, 'desconocido')
  assert.equal(clasificar({ status: 0, sobre: false }).kind, 'desconocido')
  assert.equal(clasificar(sobre(200, { data: { total: 1 } })).kind, 'desconocido') // sin factura_id no hay factura
})

test('los motivos de un rechazo: los de la DGII, el de una repetición y el texto del servidor, en ese orden', () => {
  const motivos = (r: RespuestaEmision): string[] => (clasificar(r) as { motivos: string[] }).motivos
  const dgii = (dgii_response: unknown): RespuestaEmision => sobre(422, { data: conData('RECHAZADO', { dgii_response }), error: 'El servidor dice otra cosa.' })
  assert.deepEqual(motivos(dgii({ mensajes: [{ valor: 'El RNC del comprador no coincide con su nombre.', codigo: 1 }, { valor: 'El RNC del comprador no coincide con su nombre.' }] })), ['El RNC del comprador no coincide con su nombre.'])
  assert.deepEqual(motivos(dgii({ mensajes: ['Uno', 'Dos'] })), ['Uno', 'Dos'])
  assert.deepEqual(motivos(dgii({ mensaje: 'Un mensaje suelto' })), ['Un mensaje suelto'])
  assert.deepEqual(motivos(sobre(200, { data: conData('RECHAZADO', { repetida: true, mensaje_rechazo: 'Rechazada antes' }) })), ['Rechazada antes'])
  assert.deepEqual(motivos(dgii(null)), ['El servidor dice otra cosa.'])
  assert.deepEqual(motivos(sobre(422, { data: conData('RECHAZADO') })), []) // sin nada que decir no se inventa un motivo
})

// --- emitirVenta: lo que pasa de la respuesta del servidor a lo que clasifica ---------------------------------------------------------

const fetchReal = globalThis.fetch
let pedidas: { url: string; init: RequestInit | undefined }[] = []

/** El servidor falso: contesta lo que diga `como` (una respuesta, o un error de red). */
function servidor(como: () => Response | Error): void {
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    pedidas.push({ url: String(url), init })
    const r = como()
    if (r instanceof Error) throw r
    return r
  }) as typeof fetch
}
const json = (status: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  pedidas = []
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

test('emitirVenta hace POST a /api/facturas con el JSON y devuelve el sobre del 200 completo', async () => {
  servidor(() => json(200, { status: true, data: conData('ACEPTADO') }))
  const r = await emitirVenta({ tipo_ecf: '45' })
  assert.equal(pedidas.length, 1)
  assert.match(pedidas[0].url, /\/api\/facturas$/)
  assert.equal(pedidas[0].init?.method, 'POST')
  assert.equal(pedidas[0].init?.body, JSON.stringify({ tipo_ecf: '45' }))
  assert.equal(r.status, 200)
  assert.equal(clasificar(r).kind, 'aceptada')
})

test('emitirVenta deja pasar el 422 con datos (rechazada) y el 502 con datos (sin confirmar) con su HTTP, su codigo y su texto', async () => {
  servidor(() => json(422, { status: false, error: 'El RNC del comprador no coincide.', data: conData('RECHAZADO', { dgii_response: { mensajes: ['Motivo uno'] } }) }))
  const rechazada = await emitirVenta({})
  assert.equal(rechazada.status, 422)
  assert.deepEqual(clasificar(rechazada), { kind: 'rechazada', motivos: ['Motivo uno'], facturaId: 41, eNcf: 'E450000000014', estado: 'RECHAZADO', total: 11800 })

  servidor(() => json(502, { status: false, error: 'No se pudo confirmar si la DGII recibió la factura E450000000014.', data: { factura_id: 41, e_ncf: 'E450000000014', estado_dgii: 'ENVIO_INCIERTO' } }))
  assert.equal(clasificar(await emitirVenta({})).kind, 'guardadaIncierta')

  servidor(() => json(403, { status: false, error: 'Tu plan Express no incluye esta función', codigo: 'EDICION_NO_INCLUYE' }))
  const bloqueada = await emitirVenta({})
  assert.equal(bloqueada.codigo, 'EDICION_NO_INCLUYE')
  assert.equal(clasificar(bloqueada).kind, 'bloqueada')
})

test('emitirVenta: la página de un proxy, un 502 sin datos del servidor y la red caída no se confunden', async () => {
  servidor(() => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
  const pagina = await emitirVenta({})
  assert.equal(pagina.sobre, false)
  assert.equal(clasificar(pagina).kind, 'desconocido')

  servidor(() => json(502, { status: false, error: GENERICO }))
  assert.equal(clasificar(await emitirVenta({})).kind, 'noGuardada')

  servidor(() => new TypeError('Failed to fetch'))
  const caida = await emitirVenta({})
  assert.equal(caida.status, 0)
  assert.equal(clasificar(caida).kind, 'desconocido')
  assert.equal(pedidas.length, 3) // un envío por llamada: nunca se reintenta solo
})
