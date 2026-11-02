// screens/facturar/useWizard: la emisión de punta a punta contra un `fetch` falso, y la regla del dueño: una conexión caída no puede producir un segundo e-NCF.
// Lo que se fija: el registro de envío está escrito ANTES del POST, un doble toque manda UNA sola petición, una red caída deja el envío «sin saber» y bloquea emitir otra hasta que la persona
// confirme, una validación del servidor no deja registro, y un envío que quedó en vuelo tras recargar la página pasa a «sin saber». Ninguna petición sale de la máquina.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { borrar, claveUsuario } from '~/lib/almacen'
import { leerBorrador, leerEnvio, guardarEnvio, crearEnvio } from '~/lib/envio'
import { ahora } from '~/lib/reloj'
import { esperar } from './ayudas'

// La ventana falsa va ANTES de traer el asistente: el router toma `window` la primera vez que se navega.
const ventana = {
  location: {
    hash: '#/facturar/revisar',
    replace(url: string): void {
      this.hash = url
    },
  },
  history: { state: null as unknown, back(): void {}, replaceState(): void {} },
  addEventListener(): void {},
  removeEventListener(): void {},
}
Object.defineProperty(globalThis, 'window', { value: ventana, configurable: true, writable: true })
Object.defineProperty(globalThis, 'location', { value: ventana.location, configurable: true, writable: true })

const { confirmarNoSeEmitio, emitirAhora, iniciarWizard, useWizardStore, wizard } = await import('~/screens/facturar/useWizard')

const U = { tenantId: 12, userId: 5 }

interface Pendiente {
  url: string
  cuerpo: Record<string, unknown>
  /** El registro de envío tal como estaba en el almacenamiento en el instante de mandar la petición. */
  registroAlMandar: ReturnType<typeof leerEnvio>
  responder(r: Response | Error): void
}
const fetchReal = globalThis.fetch
let pendientes: Pendiente[] = []

const json = (status: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
const aceptada = (): Response => json(200, { status: true, data: { factura_id: 41, e_ncf: 'E450000000014', estado_dgii: 'ACEPTADO', total: 5900, tipo_ecf: '45' } })

beforeEach(() => {
  pendientes = []
  ventana.location.hash = '#/facturar/revisar'
  borrar(claveUsuario(U.tenantId, U.userId, 'borrador'))
  borrar(claveUsuario(U.tenantId, U.userId, 'envio'))
  useWizardStore.setState({ dueno: null, carrito: null, enviando: false, envio: null, errorEnvio: null, recuperado: false, ultimoTipoItem: undefined })
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      pendientes.push({
        url: String(url),
        cuerpo: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
        registroAlMandar: leerEnvio(U),
        responder: (r) => (r instanceof Error ? reject(r) : resolve(r)),
      })
    })) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = fetchReal
})

/** Un E45 de RD$ 5,900.00 con su cliente, listo para emitir. */
function cargarVenta(): void {
  iniciarWizard(U, ['45'])
  wizard.elegirCliente({ id: 3, nombre: 'Min. de Obras', rnc: '401123456', permiteCredito: true, descuento: 0 })
  wizard.agregarProducto({ id: 7, nombre: 'Asesoría', precio: 5000, indFact: 1, tipoItem: 2, unidad: '43' })
}
const estado = () => useWizardStore.getState()
const emitir = (idempotencia = false): Promise<void> => emitirAhora({ u: U, idempotencia })

test('un doble toque manda UNA petición, con el registro ya escrito, y al aceptarse borra el borrador', async () => {
  cargarVenta()
  const a = emitir()
  const b = emitir() // el segundo toque, en el mismo instante
  await esperar()
  assert.equal(pendientes.length, 1)
  assert.match(pendientes[0].url, /\/api\/facturas$/)
  assert.equal(pendientes[0].registroAlMandar?.fase, 'enviando') // escrito ANTES del POST
  assert.equal(pendientes[0].registroAlMandar?.total, 5900)
  assert.equal(estado().enviando, true)
  assert.equal(ventana.location.hash, `#/facturar/resultado/${estado().envio?.clave}`) // ya está en la pantalla del resultado
  pendientes[0].responder(aceptada())
  await Promise.all([a, b])
  assert.equal(pendientes.length, 1)
  assert.equal(estado().enviando, false)
  assert.deepEqual([estado().envio?.fase, estado().envio?.eNcf, estado().envio?.facturaId], ['terminada', 'E450000000014', 41])
  assert.equal(leerEnvio(U)?.fase, 'terminada')
  assert.equal(leerBorrador(U, ahora().getTime()), null) // la venta ya es una factura: el borrador se borra
  assert.equal(estado().carrito?.lineas.length, 0)
})

test('el payload es el de la venta, sin nada prohibido y sin clave de idempotencia mientras la cuenta no la anuncie', async () => {
  cargarVenta()
  const p = emitir(false)
  await esperar()
  assert.deepEqual(Object.keys(pendientes[0].cuerpo).sort(), ['client_id', 'descuento', 'items', 'tipo_ecf', 'tipo_pago'])
  assert.equal(pendientes[0].cuerpo.tipo_ecf, '45')
  assert.equal(pendientes[0].cuerpo.client_id, 3)
  pendientes[0].responder(aceptada())
  await p
})

test('con idempotencia, la clave del registro viaja en el payload', async () => {
  cargarVenta()
  const p = emitir(true)
  await esperar()
  assert.equal(pendientes[0].cuerpo.clave_idempotencia, estado().envio?.clave)
  assert.match(String(pendientes[0].cuerpo.clave_idempotencia), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  pendientes[0].responder(aceptada())
  await p
})

test('una red caída deja el envío sin saber: el borrador se queda, no se puede emitir otra y no se reintenta solo', async () => {
  cargarVenta()
  const p = emitir()
  await esperar()
  pendientes[0].responder(new TypeError('Failed to fetch'))
  await p
  assert.equal(estado().enviando, false)
  assert.equal(estado().envio?.fase, 'comprobando')
  assert.equal(leerEnvio(U)?.fase, 'comprobando')
  assert.equal(estado().carrito?.lineas.length, 1) // el borrador se conserva
  await emitir() // otro intento: no manda nada
  await esperar()
  assert.equal(pendientes.length, 1)
  // La persona miró Facturas y no está: suelta el registro y ya puede emitir.
  confirmarNoSeEmitio(U)
  assert.equal(estado().envio, null)
  assert.equal(leerEnvio(U), null)
  const otra = emitir()
  await esperar()
  assert.equal(pendientes.length, 2)
  pendientes[1].responder(aceptada())
  await otra
  assert.equal(estado().envio?.fase, 'terminada')
})

test('un 502 con la factura guardada queda sin confirmar y bloquea emitir otra; el borrador se queda', async () => {
  cargarVenta()
  const p = emitir()
  await esperar()
  pendientes[0].responder(
    json(502, { status: false, error: 'No se pudo confirmar si la DGII recibió la factura E450000000014. No la emitas de nuevo.', data: { factura_id: 41, e_ncf: 'E450000000014', estado_dgii: 'ENVIO_INCIERTO' } }),
  )
  await p
  assert.deepEqual([estado().envio?.fase, estado().envio?.facturaId], ['incierta', 41])
  assert.equal(estado().carrito?.lineas.length, 1)
  await emitir()
  await esperar()
  assert.equal(pendientes.length, 1)
})

test('un rechazo de la DGII deja los motivos y conserva el borrador para corregir y emitir de nuevo', async () => {
  cargarVenta()
  const p = emitir()
  await esperar()
  pendientes[0].responder(
    json(422, { status: false, error: 'La DGII rechazó el comprobante.', data: { factura_id: 41, e_ncf: 'E450000000014', estado_dgii: 'RECHAZADO', dgii_response: { mensajes: [{ valor: 'El RNC del comprador no coincide con su nombre.', codigo: 1 }] } } }),
  )
  await p
  assert.deepEqual([estado().envio?.fase, estado().envio?.estado, estado().envio?.motivos], ['terminada', 'RECHAZADO', ['El RNC del comprador no coincide con su nombre.']])
  assert.equal(estado().carrito?.lineas.length, 1)
})

test('una validación del servidor no deja registro: la persona vuelve a Revisar con su texto y el borrador intacto', async () => {
  cargarVenta()
  const p = emitir()
  await esperar()
  assert.match(ventana.location.hash, /^#\/facturar\/resultado\//)
  pendientes[0].responder(json(422, { status: false, error: 'Este cliente no tiene RNC ni cédula, y la factura de crédito fiscal los necesita. Agrégale el RNC o emite una factura de consumo.' }))
  await p
  assert.equal(estado().envio, null)
  assert.equal(leerEnvio(U), null)
  assert.equal(estado().enviando, false)
  assert.equal(estado().errorEnvio?.mensaje, 'Este cliente no tiene RNC ni cédula, y la factura de crédito fiscal los necesita. Agrégale el RNC o emite una factura de consumo.')
  assert.equal(ventana.location.hash, '#/facturar/revisar')
  assert.equal(estado().carrito?.lineas.length, 1)
  wizard.cambiarCantidad(estado().carrito?.lineas[0].id ?? 0, 2) // al corregir, el aviso se va
  assert.equal(estado().errorEnvio, null)
})

test('un 403 por el plan vuelve a Revisar con el código, y el servidor que no guardó nada (502 sin datos) deja el borrador para volver a intentar', async () => {
  cargarVenta()
  const a = emitir()
  await esperar()
  pendientes[0].responder(json(403, { status: false, error: 'Tu plan Express no incluye esta función', codigo: 'EDICION_NO_INCLUYE' }))
  await a
  assert.equal(estado().errorEnvio?.codigo, 'EDICION_NO_INCLUYE')
  assert.equal(estado().envio, null)

  const b = emitir()
  await esperar()
  pendientes[1].responder(json(502, { status: false, error: 'No se pudo emitir la factura en la DGII. Espera unos minutos y vuelve a intentarlo; si sigue fallando, avisa a soporte.' }))
  await b
  assert.equal(estado().envio?.fase, 'noGuardada')
  assert.equal(estado().carrito?.lineas.length, 1)
  const c = emitir() // «no guardada» no bloquea: el servidor dijo que no hay factura
  await esperar()
  assert.equal(pendientes.length, 3)
  pendientes[2].responder(aceptada())
  await c
})

test('un envío que quedó en vuelo al recargar la página pasa a "sin saber" al abrir el asistente', () => {
  guardarEnvio(U, crearEnvio({ clave: '0e4f1c1e-6f3e-4a5b-9c1d-123456789abc', tipo: '45', total: 5900, ahora: Date.now() }))
  iniciarWizard(U, ['45'])
  assert.equal(estado().envio?.fase, 'comprobando')
  assert.equal(leerEnvio(U)?.fase, 'comprobando')
})

test('el borrador se guarda solo y el tipo que la cuenta ya no vende pasa al primero', async () => {
  cargarVenta()
  await esperar(550) // AUTOSAVE_MS es 400
  const guardado = leerBorrador(U, ahora().getTime())
  assert.equal(guardado?.carrito.lineas.length, 1)
  assert.equal(guardado?.carrito.cliente?.id, 3)
  useWizardStore.setState({ dueno: null, carrito: null })
  iniciarWizard(U, ['31', '32']) // la cuenta ya no vende el 45
  assert.equal(estado().carrito?.tipo, '31')
  assert.equal(estado().carrito?.lineas.length, 1)
  assert.equal(estado().recuperado, true)
})
