// lib/compartir: compartir una factura aceptada desde el teléfono (anexo 6.3): qué hace el botón según lo que el aparato sabe hacer (`decidirCompartir`), el texto del
// mensaje (`textoCompartir`), el enlace de WhatsApp y el mensaje a soporte, y traer y entregar el PDF (`prepararPdf`, `descargarBlob`). Ninguna petición sale de la
// máquina: `fetch` es falso, y el DOM, el mínimo que `descargarBlob` toca.
import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import type { TestContext } from 'node:test'
import { ApiError } from '@/api/errores'
import { decidirCompartir, descargarBlob, prepararPdf, textoCompartir, textoSoporte, urlWhatsApp } from '~/lib/compartir'

test('compartir', () => {
  assert.equal(decidirCompartir({ puedeCompartirArchivos: true, tieneBlob: true }), 'archivo')
  assert.equal(decidirCompartir({ puedeCompartirArchivos: false, tieneBlob: true }), 'descargar')
  assert.equal(decidirCompartir({ puedeCompartirArchivos: true, tieneBlob: false }), 'cargar')
  assert.equal(
    textoCompartir({ eNcf: 'E450000000013', cliente: 'Min. de Obras Públicas', total: 11800 }, 'Constructora Cibao SRL'),
    'Factura E450000000013 de Constructora Cibao SRL para Min. de Obras Públicas por RD$ 11,800.00',
  )
  assert.equal(urlWhatsApp('', 'x'), null)
  assert.equal(urlWhatsApp('18095550100', 'a b'), 'https://wa.me/18095550100?text=a%20b')
  assert.ok(!/token|bearer/i.test(textoSoporte({ empresa: 'Cibao', build: '26.10.26-a1b2c3d', eNcf: 'E450000000014' })))
})

// --- decidirCompartir ----------------------------------------------------------------------------------------------------------------

test('decidirCompartir: sin el PDF en mano se carga primero, sea cual sea lo que el aparato sepa compartir', () => {
  // `navigator.share` hay que llamarlo en el toque, sincrónico y con el archivo ya listo: sin el archivo no se puede compartir, y tras bajarlo el toque ya pasó.
  assert.equal(decidirCompartir({ puedeCompartirArchivos: true, tieneBlob: false }), 'cargar')
  assert.equal(decidirCompartir({ puedeCompartirArchivos: false, tieneBlob: false }), 'cargar')
  assert.equal(decidirCompartir({ puedeCompartirArchivos: true, tieneBlob: true }), 'archivo')
  assert.equal(decidirCompartir({ puedeCompartirArchivos: false, tieneBlob: true }), 'descargar')
})

// --- textoCompartir ------------------------------------------------------------------------------------------------------------------

test('textoCompartir: factura, emisor, cliente y total en pesos, en una línea', () => {
  const f = { eNcf: 'E310000000007', cliente: 'Ferretería La Unión SRL', total: 1234.5 }
  assert.equal(textoCompartir(f, 'Constructora Cibao SRL'), 'Factura E310000000007 de Constructora Cibao SRL para Ferretería La Unión SRL por RD$ 1,234.50')
  assert.ok(!/\n/.test(textoCompartir(f, 'Constructora Cibao SRL')))
  assert.equal(textoCompartir({ ...f, total: 0 }, 'X'), 'Factura E310000000007 de X para Ferretería La Unión SRL por RD$ 0.00')
  assert.equal(textoCompartir({ ...f, total: 250000 }, 'X'), 'Factura E310000000007 de X para Ferretería La Unión SRL por RD$ 250,000.00')
})

test('textoCompartir sin el nombre de la empresa no deja un hueco: «Factura … para … por …»', () => {
  const f = { eNcf: 'E450000000013', cliente: 'Min. de Obras Públicas', total: 11800 }
  for (const emisor of ['', '   ']) assert.equal(textoCompartir(f, emisor), 'Factura E450000000013 para Min. de Obras Públicas por RD$ 11,800.00', JSON.stringify(emisor))
  assert.equal(textoCompartir(f, '  Cibao SRL '), 'Factura E450000000013 de Cibao SRL para Min. de Obras Públicas por RD$ 11,800.00')
})

// --- urlWhatsApp ---------------------------------------------------------------------------------------------------------------------

test('urlWhatsApp: el número solo con dígitos y el texto codificado, y sin número no hay enlace', () => {
  assert.equal(urlWhatsApp('18095550100', 'a b'), 'https://wa.me/18095550100?text=a%20b')
  // wa.me pide solo dígitos: el + y los separadores del número se quitan (Más hace lo mismo)
  for (const numero of ['+1 (809) 555-0100', '+1-809-555-0100', ' 1809 555 0100 ', '1.809.555.0100']) assert.equal(urlWhatsApp(numero, 'x'), 'https://wa.me/18095550100?text=x', numero)
  // sin número, o sin ni un dígito: no hay a quién escribirle
  for (const numero of ['', '   ', '+', '()-', 'sin número']) assert.equal(urlWhatsApp(numero, 'x'), null, JSON.stringify(numero))
  // el texto va con encodeURIComponent: acentos, saltos de línea, & y # no rompen la URL ni cambian lo que se lee
  const texto = 'Hola, necesito ayuda con la factura E450000000014 & el RNC #401 100% «ya»\nGracias'
  const url = urlWhatsApp('18095550100', texto)
  assert.ok(url !== null)
  assert.ok(!/[\s&#«»]/.test(url.slice(url.indexOf('?text=') + 6)), 'el texto codificado no tiene espacios, & ni #')
  assert.equal(new URL(url).searchParams.get('text'), texto)
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://wa.me/18095550100')
  assert.equal(urlWhatsApp('18095550100', ''), 'https://wa.me/18095550100?text=')
})

// --- textoSoporte --------------------------------------------------------------------------------------------------------------------

test('textoSoporte: empresa, versión y, si la hay, la factura; nada más', () => {
  const texto = textoSoporte({ empresa: 'Cibao', build: '26.10.26-a1b2c3d', eNcf: 'E450000000014' })
  assert.equal(texto, 'Hola, necesito ayuda con Fiscalpoint Express. Empresa: Cibao. Versión: 26.10.26-a1b2c3d. Factura: E450000000014.')
  assert.ok(texto.includes('Cibao') && texto.includes('26.10.26-a1b2c3d') && texto.includes('E450000000014'))
  assert.equal(textoSoporte({ empresa: 'Cibao', build: '26.10.26-a1b2c3d' }), 'Hola, necesito ayuda con Fiscalpoint Express. Empresa: Cibao. Versión: 26.10.26-a1b2c3d.')
  assert.equal(textoSoporte({ empresa: 'Cibao', build: '26.10.26-a1b2c3d', eNcf: undefined }), textoSoporte({ empresa: 'Cibao', build: '26.10.26-a1b2c3d' }))
  // lo que viene vacío no deja «Empresa: .»
  assert.equal(textoSoporte({ empresa: '', build: 'dev' }), 'Hola, necesito ayuda con Fiscalpoint Express. Versión: dev.')
  assert.equal(textoSoporte({ empresa: '  ', build: '', eNcf: '' }), 'Hola, necesito ayuda con Fiscalpoint Express.')
})

test('textoSoporte solo dice lo que se le pasa: un objeto con más campos (la sesión entera, un token) no se cuela', () => {
  const sesion = { empresa: 'Cibao', build: 'dev', eNcf: 'E450000000014', token: 'secreto-9f8e7d', password: 'mock-clave', authorization: 'Bearer secreto-9f8e7d', usuario: { id: 7, email: 'a@express.test' } }
  const texto = textoSoporte(sesion)
  for (const prohibido of ['secreto-9f8e7d', 'mock-clave', 'a@express.test', 'Bearer', 'token', 'password', 'authorization']) assert.ok(!texto.includes(prohibido), prohibido)
  assert.ok(!/token|bearer/i.test(texto))
  assert.equal(texto, 'Hola, necesito ayuda con Fiscalpoint Express. Empresa: Cibao. Versión: dev. Factura: E450000000014.')
})

test('el mensaje a soporte viaja entero por urlWhatsApp', () => {
  const texto = textoSoporte({ empresa: 'Distribuidora Caribe SRL', build: '26.10.26-a1b2c3d', eNcf: 'E450000000014' })
  const url = urlWhatsApp('18095550100', texto)
  assert.ok(url !== null)
  assert.equal(new URL(url).searchParams.get('text'), texto)
})

// --- prepararPdf ---------------------------------------------------------------------------------------------------------------------

const fetchReal = globalThis.fetch
let pedidas: string[] = []
let contestacion: () => Response

const PDF = '%PDF-1.4\n%mock\n'
const pdf = (cabeceras: Record<string, string> = { 'content-type': 'application/pdf' }): Response => new Response(PDF, { status: 200, headers: cabeceras })

beforeEach(() => {
  pedidas = []
  contestacion = () => pdf()
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    pedidas.push(String(url))
    return contestacion()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = fetchReal
})

/** Corre `fn` con `navigator.connection` puesto en `valor` (no existe en Node) y lo devuelve a como estaba. */
async function conConexion<T>(valor: unknown, fn: () => Promise<T>): Promise<T> {
  const previo = Object.getOwnPropertyDescriptor(navigator, 'connection')
  Object.defineProperty(navigator, 'connection', { value: valor, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    if (previo) Object.defineProperty(navigator, 'connection', previo)
    else Reflect.deleteProperty(navigator, 'connection')
  }
}

test('prepararPdf pide el PDF por id, sin format, y devuelve el blob con el nombre que manda el API', async () => {
  contestacion = () => pdf({ 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="E450000000013.pdf"' })
  const listo = await prepararPdf(412)
  assert.deepEqual(pedidas, ['/api/facturas/412/pdf']) // el PDF en streaming: `format=datos` es el recibo, que es otra cosa
  assert.ok(listo !== null)
  assert.equal(listo.filename, 'E450000000013.pdf')
  assert.equal(listo.blob.type, 'application/pdf')
  assert.equal(await listo.blob.text(), PDF)
})

test('prepararPdf sin Content-Disposition: el nombre es el último tramo de la ruta', async () => {
  // Es lo que hace getBlob y lo que hace el mock: la pantalla puede ponerle el suyo al descargar (`E450000000013.pdf`).
  const listo = await prepararPdf(7)
  assert.ok(listo !== null)
  assert.equal(listo.filename, 'pdf')
})

test('prepararPdf con el ahorro de datos encendido no baja nada y devuelve null', async () => {
  const resultado = await conConexion({ saveData: true, effectiveType: '4g' }, () => prepararPdf(412))
  assert.equal(resultado, null)
  assert.deepEqual(pedidas, []) // ni una petición: es la precarga, y el ahorro de datos pidió que no se baje lo que nadie tocó
})

test('prepararPdf sin ahorro de datos, o en un navegador sin navigator.connection (Safari), baja el PDF', async () => {
  for (const conexion of [{ saveData: false }, {}, { effectiveType: '3g' }, undefined, null]) {
    pedidas = []
    const listo = await conConexion(conexion, () => prepararPdf(412))
    assert.ok(listo !== null, JSON.stringify(conexion))
    assert.deepEqual(pedidas, ['/api/facturas/412/pdf'], JSON.stringify(conexion))
  }
  pedidas = []
  assert.ok((await prepararPdf(412)) !== null) // y sin tocar nada del navegador
})

test('prepararPdf deja pasar el error del API: la pantalla lo muestra y ofrece reintentar', async () => {
  contestacion = () => new Response(JSON.stringify({ status: false, error: 'No se pudo generar el documento.' }), { status: 500, headers: { 'content-type': 'application/json' } })
  await assert.rejects(prepararPdf(412), (e: unknown) => e instanceof ApiError && e.status === 500)
  contestacion = () => new Response(JSON.stringify({ status: false, error: 'No encontramos esta factura. Puede que ya no exista.' }), { status: 404, headers: { 'content-type': 'application/json' } })
  await assert.rejects(prepararPdf(99999), (e: unknown) => e instanceof ApiError && e.status === 404 && /No encontramos esta factura/.test(e.message))
})

// --- descargarBlob -------------------------------------------------------------------------------------------------------------------

/** Un navegador de mentira con lo que toca `descargarBlob`: un ancla, el cuerpo del documento, los temporizadores y `window.open` (que no debe usarse). */
function navegadorFalso() {
  const eventos: string[] = []
  const ancla = {
    href: '',
    download: '',
    click: () => eventos.push('click'),
    remove: () => eventos.push('quitar'),
  }
  const documento = {
    createElement: (nombre: string) => {
      eventos.push(`crear ${nombre}`)
      return ancla
    },
    body: {
      appendChild: (nodo: unknown) => {
        eventos.push('agregar')
        return nodo
      },
    },
  }
  const temporizadores: { fn: () => void; ms: number }[] = []
  const ventana = {
    setTimeout: (fn: () => void, ms: number) => temporizadores.push({ fn, ms }),
    open: () => {
      eventos.push('window.open')
    },
  }
  const previos = (['document', 'window'] as const).map((nombre) => [nombre, Object.getOwnPropertyDescriptor(globalThis, nombre)] as const)
  Object.defineProperty(globalThis, 'document', { value: documento, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'window', { value: ventana, configurable: true, writable: true })
  const restaurar = (): void => {
    for (const [nombre, descriptor] of previos) {
      if (descriptor) Object.defineProperty(globalThis, nombre, descriptor)
      else Reflect.deleteProperty(globalThis, nombre)
    }
  }
  return { eventos, ancla, temporizadores, restaurar }
}

/** Espía lo que pasa por `URL.createObjectURL` y `URL.revokeObjectURL` sin cambiarlo (se devuelven solos al terminar la prueba). */
function espiarUrls(t: TestContext) {
  const crear = t.mock.method(URL, 'createObjectURL')
  const soltar = t.mock.method(URL, 'revokeObjectURL')
  return { crear, soltar }
}

test('descargarBlob baja el archivo con un ancla con `download`: la agrega, la toca, la quita, y no abre ninguna ventana', (t) => {
  const { eventos, ancla, temporizadores, restaurar } = navegadorFalso()
  t.after(restaurar)
  const { crear } = espiarUrls(t)
  const blob = new Blob([PDF], { type: 'application/pdf' })

  assert.equal(descargarBlob(blob, 'E450000000013.pdf'), undefined)

  assert.deepEqual(eventos, ['crear a', 'agregar', 'click', 'quitar']) // en el documento antes del toque (algunos navegadores no tocan un ancla suelta); nunca window.open
  assert.equal(crear.mock.callCount(), 1)
  assert.equal(crear.mock.calls[0].arguments[0], blob)
  assert.ok(String(ancla.href).startsWith('blob:'))
  assert.equal(ancla.href, crear.mock.calls[0].result)
  assert.equal(ancla.download, 'E450000000013.pdf')
  assert.equal(temporizadores.length, 1)
})

test('descargarBlob suelta la URL a los 60 segundos, ni antes ni dos veces: el navegador todavía puede estar copiando el archivo', (t) => {
  const { temporizadores, restaurar } = navegadorFalso()
  t.after(restaurar)
  const { crear, soltar } = espiarUrls(t)

  descargarBlob(new Blob([PDF], { type: 'application/pdf' }), 'a.pdf')

  assert.equal(temporizadores[0].ms, 60_000)
  assert.equal(soltar.mock.callCount(), 0) // al terminar de tocar el ancla la URL sigue viva
  temporizadores[0].fn()
  assert.equal(soltar.mock.callCount(), 1)
  assert.equal(soltar.mock.calls[0].arguments[0], crear.mock.calls[0].result) // la misma que se creó
})

test('descargarBlob: dos descargas, dos URLs y dos plazos, cada una con la suya', (t) => {
  const { ancla, temporizadores, restaurar } = navegadorFalso()
  t.after(restaurar)
  const { crear, soltar } = espiarUrls(t)

  descargarBlob(new Blob(['uno']), 'uno.pdf')
  const primera = ancla.href
  descargarBlob(new Blob(['dos']), 'dos.pdf')
  const segunda = ancla.href

  assert.notEqual(primera, segunda)
  assert.equal(crear.mock.callCount(), 2)
  assert.equal(temporizadores.length, 2)
  temporizadores[0].fn()
  assert.deepEqual(
    soltar.mock.calls.map((c) => c.arguments[0]),
    [primera],
  )
  temporizadores[1].fn()
  assert.deepEqual(
    soltar.mock.calls.map((c) => c.arguments[0]),
    [primera, segunda],
  )
})
