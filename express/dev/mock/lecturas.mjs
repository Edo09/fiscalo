// Lecturas del mock de Express (plan 06): los manejadores PUROS de las seis rutas de lectura. Reciben el tenant que siembra datos.mjs
// y devuelven la `Respuesta` del esqueleto (mock-api.mjs); el cableado a las rutas (y a la persona de la petición) está allí.
//
// Copian lo que hace el API real: `tipo_ecf` sin la E, el dinero como texto con dos decimales, `data: [fila]` en el detalle, el 422
// de un estado desconocido, `lean` y `archivadas=0` (los trae solo Express), y el 422 del recibo sin ancho de papel. Las fichas de
// falla de la lectura (`Prueba [500]`, ...) se buscan en el nombre del cliente de la fila que se lee: honran las tres lecturas de
// una fila (detalle, /estado y /pdf) y nunca la lista, porque buscar «Prueba» tiene que devolver esas cinco filas y no fallar.

// Import circular a propósito (mock-api.mjs importa este módulo para cablear las rutas): aquí solo se usa una función declarada,
// que ya existe al enlazar, y solo cuando llega una petición; nada de mock-api.mjs se toca al cargar este archivo.
import { parseFaultTokens } from '../mock-api.mjs'
import { avanzarEstado, diaDe, respuestaDgii, sumarDias } from './datos.mjs'

/** @typedef {import('../mock-api.mjs').Respuesta} Respuesta */
/** @typedef {import('./datos.mjs').Tenant} Tenant */
/** @typedef {import('./datos.mjs').FacturaMock} FacturaMock */

const MSG_ESTADO = 'Ese filtro de estado no es válido. Elige otro en la lista.'
const MSG_RECIBO = 'No se pudo preparar el recibo. Revisa el ancho de papel en Configuración → Impresora de recibos o imprime en hoja carta.'
const MSG_NO_EXISTE = 'Factura no encontrada.'
// El texto exacto lo fija el API real; aquí solo importa que empiece como el que cita el plan y que la pantalla lo muestre tal cual.
const MSG_SIN_SEGUIMIENTO = 'Esta factura no se envió a la DGII (no tiene número de seguimiento), así que no hay nada que consultar.'
const NOTA_EN_VUELO = 'La factura quedó guardada, pero la DGII todavía no confirma que la recibió. No la vuelvas a emitir.'
// Mismo texto, byte a byte, que MSG_EDICION de mock-api.mjs (contrato 4.3(b)), sin punto final. mock-api.test.mjs fija aquel y
// mock-lecturas.test.ts fija este: si uno cambia sin el otro, falla una de las dos pruebas.
const MSG_EDICION = 'Tu plan Express no incluye esta función'
const MSG_TOKEN = 'Invalid or inactive API token' // el mismo 401 de una sesión inválida
const PAGINA_502 = '<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head>\n<body><h1>Bad Gateway</h1></body></html>\n'

// Por encima de LECTURA_LENTA_MS (12 s) y por debajo del tiempo límite de lectura de http.ts (30 s). MOCK_SLOW_MS lo cambia.
const LENTA_POR_OMISION_MS = 15000

// ---------------------------------------------------------------------------
// Fichas de falla
// ---------------------------------------------------------------------------

/** La demora de `[slow]`: MOCK_SLOW_MS (milisegundos, 0 o más) o 15 s. Se lee en cada llamada, no al cargar el módulo. */
function demoraLenta() {
  const pedida = process.env.MOCK_SLOW_MS
  const n = pedida === undefined || pedida.trim() === '' ? Number.NaN : Number(pedida)
  return Number.isFinite(n) && n >= 0 ? n : LENTA_POR_OMISION_MS
}

/**
 * Lo que dicen las fichas de un texto libre (el nombre del cliente): `[500]` un 500 sin cuerpo, `[html502]` una página 502 de
 * proxy, `[403]` un 403 EDICION_NO_INCLUYE, `[401]` un 401 de sesión inválida y `[slow]` una demora (`demoraMs`) con HTTP 200, que
 * quien llama suma a su respuesta normal. Si hay una de error y `[slow]`, la de error sale con la demora. Sin fichas: null.
 * @param {string | null | undefined} texto
 * @returns {Respuesta | null}
 */
export function falloDeLectura(texto) {
  const fichas = parseFaultTokens(/** @type {string} */ (texto))
  const demora = fichas.has('slow') ? demoraLenta() : undefined
  const con = (/** @type {Respuesta} */ r) => (demora === undefined ? r : { ...r, demoraMs: demora })
  if (fichas.has('500')) return con({ http: 500 })
  if (fichas.has('html502')) return con({ http: 502, html: PAGINA_502 })
  if (fichas.has('403')) return con({ http: 403, cuerpo: { status: false, error: MSG_EDICION, codigo: 'EDICION_NO_INCLUYE' } })
  if (fichas.has('401')) return con({ http: 401, cuerpo: { status: false, error: MSG_TOKEN } })
  return demora === undefined ? null : { http: 200, demoraMs: demora }
}

/**
 * Atiende una lectura de `f` aplicando las fichas de su cliente: una de error responde sin hacer nada (ni mutar el tenant), y
 * `[slow]` retrasa la respuesta normal.
 * @param {FacturaMock} f
 * @param {() => Respuesta} atender
 * @returns {Respuesta}
 */
function conFalloDeFila(f, atender) {
  const fallo = falloDeLectura(f.client_name)
  if (fallo !== null && fallo.http >= 400) return fallo
  const r = atender()
  return fallo === null ? r : { ...r, demoraMs: fallo.demoraMs }
}

// ---------------------------------------------------------------------------
// Lo común: sobres, búsqueda, notas vinculadas
// ---------------------------------------------------------------------------

const ok = (/** @type {unknown} */ data) => ({ http: 200, cuerpo: { status: true, data } })
const noExiste = () => ({ http: 404, cuerpo: { status: false, error: MSG_NO_EXISTE } })
const buscar = (/** @type {Tenant} */ t, /** @type {number} */ id) => t.facturas.find((f) => f.id === Number(id))
const clienteDe = (/** @type {Tenant} */ t, /** @type {FacturaMock} */ f) => (f.client_id == null ? null : (t.clientes.find((c) => c.id === f.client_id) ?? null))

/** Minúsculas y sin acentos: el LIKE de MySQL con su cotejo por omisión no distingue ni una cosa ni la otra. */
const plano = (/** @type {string} */ texto) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Entero de 1 o más que viene de la URL, o `porOmision` si falta o no lo es. */
function entero(/** @type {string | null} */ valor, /** @type {number} */ porOmision) {
  const n = Number.parseInt(valor ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : porOmision
}

const esRechazada = (/** @type {string} */ estado) => estado.includes('RECHAZADO')
const EN_VUELO = new Set(['PENDIENTE_ENVIO', 'ENVIO_INCIERTO'])

/**
 * Las notas (E33 y E34, no rechazadas: una en proceso o en vuelo ya cuenta para el saldo) que modifican esta fila, por id ascendente.
 * Se leen de las filas del tenant, así que una nota emitida después aparece sola en el original.
 */
function notasDe(/** @type {Tenant} */ t, /** @type {FacturaMock} */ f) {
  if (!f.e_ncf) return []
  return t.facturas
    .filter((n) => n.ncf_modificado === f.e_ncf && (n.tipo_ecf === '33' || n.tipo_ecf === '34') && !esRechazada(n.estado_dgii))
    .map((n) => ({ id: String(n.id), e_ncf: n.e_ncf, tipo_ecf: n.tipo_ecf, codigo_modificacion: n.codigo_modificacion, total: n.total, estado_dgii: n.estado_dgii, date: n.date }))
}

/** En una nota, el comprobante que modifica (con todo null si es un NCF de papel que no está en `facturas`); null en las demás filas. */
function modificaDe(/** @type {Tenant} */ t, /** @type {FacturaMock} */ f) {
  if (!f.ncf_modificado) return null
  const o = t.facturas.find((x) => x.e_ncf === f.ncf_modificado)
  if (o === undefined) return { id: null, e_ncf: f.ncf_modificado, tipo_ecf: null, total: null, date: null }
  return { id: String(o.id), e_ncf: o.e_ncf, tipo_ecf: o.tipo_ecf, total: o.total, date: o.date }
}

/**
 * La fila tal como sale en la lista: las columnas más el resumen plano (`company_name`, `description`) y las notas vinculadas. `lean`
 * quita lo pesado (`items`, `respuesta_dgii`, `xml_firmado`); `cliente` y `emisor` solo van en el detalle.
 */
function filaDeLista(/** @type {Tenant} */ t, /** @type {FacturaMock & { xml_firmado?: string | null }} */ f, /** @type {boolean} */ lean) {
  const { items = [], respuesta_dgii: respuesta = null, xml_firmado: xml, ...plana } = f
  return {
    ...plana,
    company_name: f.client_name,
    description: items.length > 0 ? items[0].description : null,
    ...(lean ? {} : { items, respuesta_dgii: respuesta, ...(xml === undefined ? {} : { xml_firmado: xml }) }),
    notas: notasDe(t, f),
    modifica: modificaDe(t, f),
  }
}

// ---------------------------------------------------------------------------
// GET /api/facturas: lista y detalle
// ---------------------------------------------------------------------------

// Los filtros de `estado` (en minúsculas). `accion` solo existe desde el plan 05: sin él el API contesta 422 como con cualquier otro.
const GRUPOS_ESTADO = new Map([
  ['aprobado', ['ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'RFCE_ACEPTADO_CONDICIONAL']],
  ['rechazado', ['RECHAZADO', 'RFCE_RECHAZADO']],
  ['pendiente', ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO']],
  ['accion', ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO', 'ERROR', 'RFCE_ERROR']],
])

/** Lo que busca `query` en una fila: e-NCF, cliente (con RNC, teléfono y correo, que la fila de lista no trae) y descripciones de líneas. */
function textoDeBusqueda(/** @type {Tenant} */ t, /** @type {FacturaMock} */ f) {
  const c = clienteDe(t, f)
  return plano([f.e_ncf, f.no_factura, f.client_name, c?.rnc, c?.phone_number, c?.email, ...(f.items ?? []).map((i) => i.description)].filter((x) => x).join(' '))
}

/**
 * GET /api/facturas sin `id`: página (`page`, `pageSize` hasta 100) de lo más nuevo a lo más viejo, con `estado`, `tipo_ecf`
 * (con o sin la E), `archivadas=0`, `lean=1` y `query`. La lista por omisión incluye las filas `*_ARCHIVADO`.
 * `opciones.sinAccion` finge el API anterior al plan 05, que no conoce `estado=accion` (la variable MOCK_SIN_ACCION=1 la enciende).
 * @param {Tenant} t
 * @param {URLSearchParams} params
 * @param {{ sinAccion?: boolean }} [opciones]
 * @returns {Respuesta}
 */
export function listarFacturas(t, params, { sinAccion = false } = {}) {
  const estado = params.get('estado') ?? ''
  const estados = GRUPOS_ESTADO.get(estado)
  if (estado !== '' && (estados === undefined || (estado === 'accion' && sinAccion))) return { http: 422, cuerpo: { status: false, error: MSG_ESTADO } }
  const tipo = (params.get('tipo_ecf') ?? '').replace(/^E/i, '')
  const sinArchivadas = params.get('archivadas') === '0'
  const lean = params.get('lean') === '1'
  const buscado = plano(params.get('query') ?? '').trim()
  const pageSize = Math.min(100, entero(params.get('pageSize'), 20))
  const page = entero(params.get('page'), 1)

  const coinciden = t.facturas
    .filter((f) => estados === undefined || estados.includes(f.estado_dgii))
    .filter((f) => tipo === '' || f.tipo_ecf === tipo)
    .filter((f) => !(sinArchivadas && f.estado_dgii.endsWith('ARCHIVADO')))
    .filter((f) => buscado === '' || textoDeBusqueda(t, f).includes(buscado))
    .sort((a, b) => b.id - a.id)
  const total = coinciden.length
  const data = coinciden.slice((page - 1) * pageSize, page * pageSize).map((f) => filaDeLista(t, f, lean))
  return { http: 200, cuerpo: { status: true, data, pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } } }
}

/** El `emisor` de una fila de detalle: la fila de emisor_config (sin lo que solo trae GET /api/emisor). */
function emisorDeFila(/** @type {Tenant} */ t) {
  const { rnc, razon_social, nombre_comercial, sucursal, direccion, municipio, provincia, telefono, correo, website } = t.emisor
  return { id: 1, rnc, razon_social, nombre_comercial, sucursal, direccion, municipio, provincia, telefono, correo, website }
}

/**
 * GET /api/facturas?id=: `data` es un arreglo de una fila con `items`, `cliente` (con su RNC), `emisor`, `notas`, `modifica` y
 * `respuesta_dgii` como texto JSON; un id que no existe da `data: []`.
 * @param {Tenant} t
 * @param {number} id
 * @returns {Respuesta}
 */
export function detalleFactura(t, id) {
  const f = buscar(t, id)
  if (f === undefined) return ok([])
  return conFalloDeFila(f, () => {
    const cliente = clienteDe(t, f)
    return ok([{ ...filaDeLista(t, f, false), cliente: cliente === null ? null : { ...cliente }, emisor: emisorDeFila(t) }])
  })
}

// ---------------------------------------------------------------------------
// GET /api/facturas/{id}/estado
// ---------------------------------------------------------------------------

/** Los motivos de rechazo que ya trae `respuesta_dgii`. */
function mensajesDe(/** @type {FacturaMock} */ f) {
  try {
    const mensajes = JSON.parse(f.respuesta_dgii ?? 'null')?.mensajes
    return Array.isArray(mensajes) ? mensajes : []
  } catch {
    return []
  }
}

/**
 * GET /api/facturas/{id}/estado. Una fila en vuelo (PENDIENTE_ENVIO, ENVIO_INCIERTO) responde con lo guardado: `en_vuelo` y una
 * `nota`, sin consultar nada. Una sin número de seguimiento (salvo el resumen de consumo, que se consulta por e-NCF) da el 422 de
 * «no se envió». El resto consulta a la DGII: ENVIADO pasa a EN_PROCESO y este a ACEPTADO, un paso por llamada (ver
 * `avanzarEstado`), y el veredicto queda guardado en la fila.
 * @param {Tenant} t
 * @param {number} id
 * @returns {Respuesta}
 */
export function estadoFactura(t, id) {
  const i = t.facturas.findIndex((f) => f.id === Number(id))
  if (i === -1) return noExiste()
  const f = t.facturas[i]
  return conFalloDeFila(f, () => {
    const encf = f.e_ncf ?? f.no_factura
    if (EN_VUELO.has(f.estado_dgii)) {
      return ok({ factura_id: f.id, e_ncf: encf, track_id: f.track_id, estado_dgii: f.estado_dgii, secuencia_utilizada: null, tipo_ecf: f.tipo_ecf, en_vuelo: true, nota: NOTA_EN_VUELO })
    }
    if (!f.track_id && !f.estado_dgii.startsWith('RFCE_')) return { http: 422, cuerpo: { status: false, error: MSG_SIN_SEGUIMIENTO } }
    const g = avanzarEstado(f)
    const consulta = JSON.parse(String(respuestaDgii(g.estado_dgii, { trackId: g.track_id, rnc: t.emisor.rnc, encf, fecha: g.fecha_emision_dgii, mensajes: mensajesDe(f) })))
    if (g !== f) t.facturas[i] = { ...g, respuesta_dgii: JSON.stringify(consulta) }
    return ok({ factura_id: f.id, e_ncf: encf, track_id: g.track_id, estado_dgii: g.estado_dgii, secuencia_utilizada: consulta.secuenciaUtilizada, tipo_ecf: g.tipo_ecf, consulta })
  })
}

// ---------------------------------------------------------------------------
// GET /api/facturas/stats y /api/facturas/avisos
// ---------------------------------------------------------------------------

const ENVIADOS = new Set(['ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'])
const centavos = (/** @type {FacturaMock} */ f) => Math.round(Number(f.total) * 100)
const conSigno = (/** @type {FacturaMock} */ f) => (f.tipo_ecf === '34' ? -centavos(f) : centavos(f))
// Lo que cuenta como venta (por día y por mes): sin lo rechazado ni lo que todavía no salió hacia la DGII; la nota de crédito resta.
const esVenta = (/** @type {FacturaMock} */ f) => !esRechazada(f.estado_dgii) && !EN_VUELO.has(f.estado_dgii)

/** Agrupa por `clave` y devuelve [clave, { total, centavos }] ordenado por clave. */
function agrupar(/** @type {FacturaMock[]} */ filas, /** @type {(f: FacturaMock) => string} */ clave, /** @type {(f: FacturaMock) => number} */ monto) {
  const grupos = new Map()
  for (const f of filas) {
    const k = clave(f)
    const g = grupos.get(k) ?? { total: 0, centavos: 0 }
    g.total += 1
    g.centavos += monto(f)
    grupos.set(k, g)
  }
  return [...grupos.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * GET /api/facturas/stats. `ventas_por_dia` (31 días) y `ventas_por_mes` (12 meses) cuentan lo que no está rechazado ni sin enviar, con
 * la nota de crédito restando; `por_estado` agrupa por el texto exacto de `estado_dgii` (también lo archivado). `stats=light` deja
 * `por_estado`, `secuencias`, `ventas_por_dia`, `ventas_por_mes`, `resumen` y `ambiente_activo`, y suelta `por_tipo` y `por_mes`.
 * @param {Tenant} t
 * @param {URLSearchParams} params
 * @param {Date} ahora  El "hoy" local desde el que se miran los 31 días y los 12 meses.
 * @returns {Respuesta}
 */
export function estadisticas(t, params, ahora) {
  const desdeDia = diaDe(sumarDias(ahora, -30))
  const desdeMes = diaDe(new Date(ahora.getFullYear(), ahora.getMonth() - 11, 1)).slice(0, 7)
  const ventas = t.facturas.filter(esVenta)
  const comoFilas = (/** @type {Array<[string, { total: number, centavos: number }]>} */ grupos, /** @type {string} */ llave) =>
    grupos.map(([k, g]) => ({ [llave]: k, total: g.total, monto_total: g.centavos / 100 }))
  const conNumero = t.facturas.filter((f) => f.e_ncf)
  const nombreDe = (/** @type {string} */ tipo) => t.secuencias.find((s) => s.type === `E${tipo}`)?.nombre ?? `E${tipo}`

  const data = {
    resumen: {
      total_ecf: t.facturas.length,
      monto_total: t.facturas.reduce((suma, f) => suma + centavos(f), 0) / 100,
      monto_neto: (t.facturas.filter((f) => !esRechazada(f.estado_dgii)).reduce((suma, f) => suma + conSigno(f), 0) / 100).toFixed(2),
      tipos_distintos: new Set(t.facturas.map((f) => f.tipo_ecf)).size,
      primer_ecf: conNumero.length > 0 ? conNumero[0].e_ncf : null,
      ultimo_ecf: conNumero.length > 0 ? conNumero[conNumero.length - 1].e_ncf : null,
    },
    por_tipo: [...new Set(t.facturas.map((f) => f.tipo_ecf))].sort().map((tipo) => {
      const filas = t.facturas.filter((f) => f.tipo_ecf === tipo)
      return {
        tipo_ecf: tipo,
        nombre: nombreDe(tipo),
        total: filas.length,
        monto_total: filas.reduce((suma, f) => suma + centavos(f), 0) / 100,
        aceptados: filas.filter((f) => f.estado_dgii.includes('ACEPTADO')).length,
        rfce: filas.filter((f) => f.estado_dgii.startsWith('RFCE_')).length,
        rechazados: filas.filter((f) => esRechazada(f.estado_dgii)).length,
        enviados: filas.filter((f) => ENVIADOS.has(f.estado_dgii)).length,
        ultimo_emitido: filas.reduce((ultimo, f) => (f.date > ultimo ? f.date : ultimo), '') || null,
      }
    }),
    por_estado: agrupar(t.facturas, (f) => f.estado_dgii, centavos).map(([estado, g]) => ({ estado, total: g.total, monto_total: g.centavos / 100 })),
    por_mes: comoFilas(agrupar(t.facturas, (f) => f.date.slice(0, 7), centavos), 'mes'),
    ventas_por_mes: comoFilas(agrupar(ventas.filter((f) => f.date.slice(0, 7) >= desdeMes), (f) => f.date.slice(0, 7), conSigno), 'mes'),
    ventas_por_dia: comoFilas(agrupar(ventas.filter((f) => f.date.slice(0, 10) >= desdeDia), (f) => f.date.slice(0, 10), conSigno), 'dia'),
    secuencias: t.secuencias.map((s) => ({ ...s })),
    ambiente_activo: t.ambiente,
  }
  if (params.get('stats') === 'light') {
    const { por_tipo: _porTipo, por_mes: _porMes, ...ligera } = data
    return ok(ligera)
  }
  return ok(data)
}

/**
 * GET /api/facturas/avisos: las secuencias a las que quedan 50 números o menos (`pocos`) o ninguno (`agotada`). En Express no hay
 * ventas del POS, así que el certificado que falló y las ventas sin rango van en cero.
 * @param {Tenant} t
 * @returns {Respuesta}
 */
export function avisos(t) {
  return ok({
    certificado_fallo: { ventas_hoy: 0 },
    secuencias: t.secuencias
      .filter((s) => s.restantes !== null && s.restantes <= 50)
      .map((s) => ({ tipo: s.type, ambiente: t.ambiente, restantes: s.restantes, estado: s.restantes === 0 ? 'agotada' : 'pocos' })),
    sin_rango: { ventas: 0 },
  })
}

/**
 * GET /api/emisor: los datos fiscales del emisor, con el nombre, el RNC y el ambiente de la identidad con que se sembró el tenant.
 * @param {Tenant} t
 * @returns {Respuesta}
 */
export function emisor(t) {
  return ok({ ...t.emisor })
}

// ---------------------------------------------------------------------------
// GET /api/facturas/{id}/pdf: el PDF y el recibo como datos
// ---------------------------------------------------------------------------

const miles = (/** @type {string | number} */ n) => Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const ANCHOS_TIRILLA = new Map([['pos', 80], ['pos76', 76], ['pos72', 72]]) // lo que manda parametroFormato('pos') de la app
const TITULOS = new Map([
  ['31', 'FACTURA DE CRÉDITO FISCAL ELECTRÓNICA'],
  ['32', 'FACTURA DE CONSUMO ELECTRÓNICA'],
  ['33', 'NOTA DE DÉBITO ELECTRÓNICA'],
  ['34', 'NOTA DE CRÉDITO ELECTRÓNICA'],
  ['45', 'COMPROBANTE GUBERNAMENTAL ELECTRÓNICO'],
])

/**
 * Un PDF de una página (Helvetica, una línea por renglón) con la tabla xref bien calculada, para que el visor del teléfono lo abra.
 * Lleva la leyenda de que es un documento de prueba. Todo el texto tiene que caber en Latin-1.
 * @param {string[]} renglones
 * @returns {Uint8Array}
 */
function pdfDeTexto(renglones) {
  const escapar = (/** @type {string} */ s) => s.replace(/[\\()]/g, '\\$&')
  const contenido = ['BT', '/F1 12 Tf', '50 760 Td', '18 TL', ...renglones.map((r) => `(${escapar(r)}) Tj T*`), 'ET'].join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = objetos.map((objeto, i) => {
    const posicion = pdf.length
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`
    return posicion
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

/**
 * Un cuadro que parece un QR (tres cuadros de posición y relleno que depende de `semilla`) como imagen SVG en un data URI. NO es
 * un QR legible: solo ocupa el lugar del timbre de la DGII para que la pantalla lo dibuje.
 * @param {string} semilla
 * @returns {string}
 */
function qrDeMentira(semilla) {
  const N = 25
  let s = 2166136261
  for (let i = 0; i < semilla.length; i++) s = Math.imul(s ^ semilla.charCodeAt(i), 16777619) >>> 0
  if (s === 0) s = 1
  const siguiente = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s
  }
  const esquinas = [[0, 0], [0, N - 7], [N - 7, 0]]
  const negro = (/** @type {number} */ f, /** @type {number} */ c) => {
    for (const [f0, c0] of esquinas) {
      const i = f - f0
      const j = c - c0
      if (i >= -1 && i <= 7 && j >= -1 && j <= 7) {
        if (i < 0 || j < 0 || i > 6 || j > 6) return false // el margen blanco del cuadro de posición
        return i === 0 || j === 0 || i === 6 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)
      }
    }
    return siguiente() % 2 === 0
  }
  let ruta = ''
  for (let f = 0; f < N; f++) for (let c = 0; c < N; c++) if (negro(f, c)) ruta += `M${c + 2} ${f + 2}h1v1h-1z`
  const lado = N + 4 // dos módulos de margen blanco a cada lado
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${ruta}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** El recibo de tirilla como datos (`ReciboDatos`), con los textos ya formateados como los manda el API. */
function reciboDatos(/** @type {Tenant} */ t, /** @type {FacturaMock} */ f, /** @type {number} */ ancho) {
  const cliente = clienteDe(t, f)
  const items = f.items ?? []
  const [dia, hora] = (f.fecha_emision_dgii ?? f.date).split(' ')
  const fecha = dia.split('-').reverse().join('-') // dd-mm-aaaa
  const base = items.reduce((suma, i) => suma + Number(i.subtotal), 0)
  const itbis = items.reduce((suma, i) => suma + Number(i.itbis_amount), 0)
  return {
    nombre: `Factura_${f.e_ncf ?? f.no_factura}_POS${ancho}`,
    papel: { opcion: ancho, ancho_mm: ancho, margen_mm: 3 },
    fuente: 'Arial',
    logo: null,
    emisor: { razon_social: t.emisor.razon_social, rnc: t.emisor.rnc, direccion: `${t.emisor.direccion}, ${t.emisor.municipio}`, contacto: `Tel. ${t.emisor.telefono}` },
    titulo: TITULOS.get(f.tipo_ecf) ?? `COMPROBANTE ELECTRÓNICO E${f.tipo_ecf}`,
    identificacion: [['e-NCF', f.e_ncf ?? f.no_factura ?? ''], ['Fecha de emisión', fecha], ['Condición de pago', Number(f.tipo_pago) === 2 ? 'Crédito' : 'Contado']],
    receptor: {
      pares: cliente === null ? [['Razón social', 'Consumidor final']] : [['Razón social', cliente.razon_social], ...(cliente.rnc ? [['RNC', cliente.rnc]] : [])],
      contacto: cliente?.phone_number ?? '',
    },
    lineas: items.map((i) => ({ descripcion: i.description, cantidad_precio: `${Number(i.quantity)} x ${miles(i.amount)}`, itbis: miles(i.itbis_amount), valor: miles(i.subtotal) })),
    motivo: f.ncf_modificado ? `Modifica ${f.ncf_modificado}` : '',
    totales: [
      { etiqueta: 'Subtotal', valor: miles(base), total: false },
      { etiqueta: 'ITBIS', valor: miles(itbis), total: false },
      { etiqueta: 'Total RD$', valor: miles(f.total), total: true },
    ],
    timbre: { qr: qrDeMentira(`${f.e_ncf ?? f.no_factura}${f.codigo_seguridad}`), aviso_preview: '', codigo_seguridad: f.codigo_seguridad, fecha_firma: `${fecha} ${hora}` },
    leyenda_qr: 'Escanee el código para verificar este comprobante en la DGII',
    gracias: 'Gracias por su preferencia',
  }
}

/**
 * GET /api/facturas/{id}/pdf. Sin `format` responde el PDF como `binario` (application/pdf). Con `format=datos` responde el recibo de
 * tirilla como datos, y exige `formato=pos` (o `pos76`, `pos72`): sin él, o con otro, el 422 del recibo. El QR del timbre es un data URI.
 * @param {Tenant} t
 * @param {number} id
 * @param {URLSearchParams} params
 * @returns {Respuesta}
 */
export function pdfFactura(t, id, params) {
  const f = buscar(t, id)
  if (f === undefined) return noExiste()
  return conFalloDeFila(f, () => {
    if (params.get('format') === 'datos') {
      const ancho = ANCHOS_TIRILLA.get(params.get('formato') ?? '')
      if (ancho === undefined) return { http: 422, cuerpo: { status: false, error: MSG_RECIBO } }
      return ok(reciboDatos(t, f, ancho))
    }
    const renglones = [
      'FACTURA ELECTRONICA - DOCUMENTO DE PRUEBA, SIN VALIDEZ FISCAL',
      `${t.emisor.razon_social}   RNC ${t.emisor.rnc}`,
      `e-NCF ${f.e_ncf ?? f.no_factura}`,
      `Fecha ${f.date}`,
      `Cliente ${f.client_name ?? 'Consumidor final'}`,
      `Total RD$ ${miles(f.total)}`,
      `Estado DGII ${f.estado_dgii}`,
    ]
    return { http: 200, binario: pdfDeTexto(renglones), tipo: 'application/pdf' }
  })
}
