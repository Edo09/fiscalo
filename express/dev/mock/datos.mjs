// Datos sembrados del mock de Express (solo desarrollo, todo inventado): el tenant de cada persona con sus facturas, clientes,
// secuencias y datos del emisor. Los lee dev/mock/lecturas.mjs y, más adelante, los manejadores de emisión del plan 07, que
// empujan sus filas en `tenant.facturas`.
//
// Las fechas salen de `ahora` y son de calendario LOCAL (getFullYear/getDate, nunca toISOString): a las 23:30 el "hoy" de la
// semilla sigue siendo el día local de quien la pide. El dinero se calcula en centavos enteros y sale como texto con dos decimales,
// que es como PDO entrega un DECIMAL (los de las líneas, con 4 y 3). Cada llamada a `sembrarTenant` devuelve un tenant nuevo y sin
// estado compartido, y la semilla es determinista: dos llamadas con la misma `ahora` dan lo mismo.

/** @typedef {'ecf' | 'certecf' | 'testecf'} Ambiente */
/** @typedef {{ nombre: string, rnc: string, ambiente: Ambiente }} Identidad */

/**
 * Una fila de `factura_items`: los DECIMAL como texto (`amount` con 4 decimales, `quantity` con 3, el resto con 2).
 * @typedef {object} ItemMock
 * @property {number} id
 * @property {number} factura_id
 * @property {number | null} product_id
 * @property {string} description
 * @property {string} amount
 * @property {string} quantity
 * @property {string} subtotal
 * @property {string} descuento_monto
 * @property {string} itbis_amount
 * @property {number} indicador_facturacion  1: 18 %, 2: 16 %, 3: tasa cero, 4: exento.
 * @property {number} indicador_bien_servicio  1: bien, 2: servicio.
 * @property {string} unidad_medida
 */

/**
 * Una fila de `facturas` como la manda el API: columnas planas, el dinero como texto con dos decimales y `tipo_ecf` sin la E
 * (`45`, no `E45`). `respuesta_dgii` es lo último que dijo la DGII, como TEXTO JSON (null si todavía no ha dicho nada). Lo que no
 * es columna (`notas`, `modifica`, `cliente`, `emisor`) se arma al leer, en lecturas.mjs.
 * @typedef {object} FacturaMock
 * @property {number} id
 * @property {string | null} no_factura  El número tal como se guardó; en una fila archivada es lo único que queda del e-NCF.
 * @property {string | null} e_ncf  null en una fila `*_ARCHIVADO`: su número lo reusó el comprobante que la reemplazó.
 * @property {string} tipo_ecf
 * @property {string} date  'AAAA-MM-DD HH:MM:SS' (DATETIME de MySQL), hora local.
 * @property {number | null} client_id
 * @property {string | null} client_name
 * @property {string} total
 * @property {number} tipo_pago  1: contado, 2: crédito, 3: gratuito.
 * @property {string} estado_dgii
 * @property {string | null} track_id  Un resumen de consumo (RFCE_*), una en vuelo y una con ERROR no lo tienen.
 * @property {string} codigo_seguridad
 * @property {string} fecha_emision_dgii
 * @property {string} monto_gravado
 * @property {string} monto_exento
 * @property {string} total_itbis
 * @property {string | null} ncf_modificado  Solo las notas E33/E34: el e-NCF del comprobante que modifican.
 * @property {string | null} codigo_modificacion  Solo las notas: 1 anula, 2 corrige texto, 3 corrige montos, ...
 * @property {string | null} respuesta_dgii
 * @property {ItemMock[]} items
 */

/**
 * Una fila de `clients`.
 * @typedef {object} ClienteMock
 * @property {number} id
 * @property {string | null} email
 * @property {string | null} rnc  Solo dígitos; null en un cliente sin RNC.
 * @property {string} razon_social
 * @property {string} direccion
 * @property {string} municipio
 * @property {string} provincia
 * @property {string} client_name
 * @property {string} company_name
 * @property {string | null} phone_number
 * @property {string} descuento
 * @property {string} permitir_credito  '1' o '0', como los trae MySQL.
 */

/**
 * Un rango de numeración como lo cuenta `stats.secuencias`: `type` con la E, `secuencia_actual` es el ÚLTIMO número asignado
 * y `restantes` lo que queda en los rangos vigentes.
 * @typedef {object} SecuenciaMock
 * @property {string} type
 * @property {string} nombre
 * @property {number} secuencia_actual
 * @property {number} total_emitidos
 * @property {number | null} restantes
 * @property {string | null} vencimiento  'AAAA-MM-DD'.
 */

/**
 * El tenant de una persona: `facturas` es EL almacén (los manejadores de lectura y los de emisión lo comparten) y está en orden de id.
 * @typedef {object} Tenant
 * @property {Ambiente} ambiente
 * @property {string[]} tiposVenta  Los tipos de venta (31, 32, 45); el 34 se deriva y no está aquí.
 * @property {FacturaMock[]} facturas
 * @property {SecuenciaMock[]} secuencias
 * @property {ClienteMock[]} clientes
 * @property {{ rnc: string, razon_social: string, nombre_comercial: string, sucursal: string | null, direccion: string, municipio: string, provincia: string, telefono: string, correo: string, website: string | null, actividad_economica: string, fecha_vencimiento_secuencia: string | null, ambiente: Ambiente, fuente: string }} emisor  El cuerpo de GET /api/emisor.
 */

// ---------------------------------------------------------------------------
// Fechas locales y dinero
// ---------------------------------------------------------------------------

const dos = (n) => String(n).padStart(2, '0')

/** 'AAAA-MM-DD' del calendario local de `d`. */
export const diaDe = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`

/** `d` a medianoche local, `n` días después (negativo: antes). Suma por calendario, así que un cambio de hora no la mueve. */
export const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Centavos enteros a texto con `decimales`: 1180000 -> '11800.00'. */
const texto = (centavos, decimales = 2) => (centavos / 100).toFixed(decimales)

const TASA_ITBIS = new Map([[1, 18], [2, 16], [3, 0], [4, 0]])

/**
 * Una línea de factura. `precio` es el unitario sin ITBIS y `cantidad` admite decimales; el ITBIS sale del indicador
 * (1: 18 %, 2: 16 %, 3: tasa cero, 4: exento). Todo lo calculado va en centavos.
 */
function linea(descripcion, cantidad, precio, { indicador = 1, servicio = true } = {}) {
  const subtotalCent = Math.round(cantidad * precio * 100)
  return {
    descripcion,
    cantidad,
    precioCent: Math.round(precio * 100),
    subtotalCent,
    itbisCent: Math.round((subtotalCent * TASA_ITBIS.get(indicador)) / 100),
    indicador,
    servicio,
  }
}

const suma = (lineas, campo, cuales = () => true) => lineas.filter(cuales).reduce((acc, l) => acc + l[campo], 0)

// ---------------------------------------------------------------------------
// Lo que dice la DGII (respuesta_dgii) y su avance
// ---------------------------------------------------------------------------

// Veredicto de una consulta: [código, texto]. 0 no encontrado, 1 aceptado, 2 rechazado, 3 en proceso, 4 aceptado condicional.
const VEREDICTOS = new Map([
  ['NO_ENCONTRADO', ['0', 'No Encontrado']],
  ['ACEPTADO', ['1', 'Aceptado']],
  ['RECHAZADO', ['2', 'Rechazado']],
  ['EN_PROCESO', ['3', 'En Proceso']],
  ['ACEPTADO_CONDICIONAL', ['4', 'Aceptado Condicional']],
])

/**
 * El `respuesta_dgii` que corresponde a un estado, como texto JSON, o null cuando la DGII todavía no ha dicho nada (en vuelo).
 * ENVIADO guarda lo que contestó el envío (el número de seguimiento) y ERROR el fallo de la comunicación; el resto, el resultado de
 * una consulta, con `mensajes` (los motivos de un rechazo). El RFCE y lo archivado se leen con el estado base.
 * `fecha` es un DATETIME de MySQL y sale como la fecha de recepción de la DGII (dd/mm/aaaa hh:mm:ss).
 * @param {string} estado
 * @param {{ trackId?: string | null, rnc: string, encf: string | null, fecha: string, mensajes?: Array<{ valor: string, codigo: number }> }} datos
 * @returns {string | null}
 */
export function respuestaDgii(estado, { trackId = null, rnc, encf, fecha, mensajes = [] }) {
  const base = estado.replace(/^RFCE_/, '').replace(/_ARCHIVADO$/, '')
  if (base === 'PENDIENTE_ENVIO' || base === 'ENVIO_INCIERTO') return null
  if (base === 'ENVIADO') return JSON.stringify({ trackId, error: '', mensaje: '' })
  // Texto de ejemplo: lo que guarda el API en un ERROR depende de la falla. Trae `mensaje` (sin `mensajes`) porque es lo que lee el front
  // cuando no hay lista de motivos (anexo, facturaModel.php:1728).
  if (base === 'ERROR') return JSON.stringify({ trackId, error: 'No se pudo comunicar con la DGII', mensaje: 'Tiempo de espera agotado' })
  const veredicto = VEREDICTOS.get(base)
  if (veredicto === undefined) throw new Error(`respuestaDgii: falta el veredicto del estado ${estado}`)
  const [dia, hora] = fecha.split(' ')
  return JSON.stringify({
    trackId,
    codigo: veredicto[0],
    estado: veredicto[1],
    rnc,
    encf,
    secuenciaUtilizada: base.startsWith('ACEPTADO'),
    fechaRecepcion: `${dia.split('-').reverse().join('/')} ${hora}`,
    mensajes,
  })
}

const SIGUIENTE = new Map([
  ['ENVIADO', 'EN_PROCESO'],
  ['EN_PROCESO', 'ACEPTADO'],
  ['RFCE_ENVIADO', 'RFCE_EN_PROCESO'],
  ['RFCE_EN_PROCESO', 'RFCE_ACEPTADO'],
])

/**
 * Lo que pasa con una fila en una llamada a /estado: ENVIADO pasa a EN_PROCESO, EN_PROCESO a ACEPTADO y de ahí no se mueve (igual
 * el resumen de consumo, RFCE_*). Lo demás, entre ellos lo que está en vuelo, no cambia. Pura: devuelve la misma fila o una copia.
 * @param {FacturaMock} f
 * @returns {FacturaMock}
 */
export function avanzarEstado(f) {
  const siguiente = SIGUIENTE.get(f.estado_dgii)
  return siguiente === undefined ? f : { ...f, estado_dgii: siguiente }
}

// ---------------------------------------------------------------------------
// Identificadores inventados (deterministas)
// ---------------------------------------------------------------------------

/** mulberry32: una secuencia en [0, 1) que solo depende de la semilla. */
function azar(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), a | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/** Un número de seguimiento con la forma de un GUID. */
function trackIdDe(id) {
  const r = azar(id * 7919)
  const h = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** El código de seguridad: seis caracteres. */
function codigoDe(id) {
  const r = azar(id * 104729)
  return Array.from({ length: 6 }, () => ALFABETO[Math.floor(r() * ALFABETO.length)]).join('')
}

/** ¿Llegó a haber un número de seguimiento? No en lo que quedó en vuelo, en un ERROR ni en el resumen de consumo (RFCE_*). */
const tieneTrackId = (estado) => !estado.startsWith('RFCE_') && !['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ERROR'].includes(estado)

// ---------------------------------------------------------------------------
// Construcción del tenant a partir de una semilla
// ---------------------------------------------------------------------------

const NOMBRES_TIPO = new Map([['31', 'Factura de Crédito Fiscal'], ['32', 'Factura de Consumo'], ['34', 'Nota de Crédito'], ['45', 'Gubernamental']])

function clienteMock({ id, nombre, rnc = null }) {
  return {
    id,
    email: `cliente${id}@express.test`,
    rnc,
    razon_social: nombre,
    direccion: 'Calle Mock 1',
    municipio: 'Santiago de los Caballeros',
    provincia: 'Santiago',
    client_name: nombre,
    company_name: nombre,
    phone_number: `809555${1000 + id}`,
    descuento: '0.00',
    permitir_credito: '1',
  }
}

/**
 * Una fila por sembrar. `dia` es el desplazamiento en días desde hoy (0 hoy, -1 ayer) y `hora` 'HH:MM'. `cliente` es el id de un
 * cliente de la semilla o null (consumidor final). `extra` puede traer: `clave` (un nombre para que otra fila la referencie),
 * `modifica` y `codigo` (una nota que modifica la fila de esa clave, con su código de modificación), `archivadaDe` (un intento
 * archivado, que no gasta número: guarda el de la fila de esa clave) y `mensajes` (los motivos de un rechazo).
 */
const fila = (dia, hora, tipo, estado, cliente, lineas, extra = {}) => ({ dia, hora, tipo, estado, cliente, lineas, ...extra })

const DESCRIPCIONES = ['Suministro de materiales', 'Servicio de consultoría', 'Mantenimiento de equipos', 'Alquiler de maquinaria', 'Asesoría técnica', 'Transporte de carga', 'Instalación eléctrica', 'Supervisión de obra']

/** `n` filas del mismo estado repartidas entre los días `desde` y `hasta`, con el cliente, la descripción, la cantidad y el precio cambiando. */
function rellenos(n, { tipo, estado = 'ACEPTADO', clientes, desde, hasta, escala, descripciones = DESCRIPCIONES }) {
  return Array.from({ length: n }, (_, i) =>
    fila(
      Math.round(desde + (i * (hasta - desde)) / Math.max(1, n - 1)),
      `${dos(8 + ((i * 5) % 10))}:${dos((i * 17) % 60)}`,
      tipo,
      estado,
      clientes[i % clientes.length],
      [linea(descripciones[i % descripciones.length], 1 + (i % 3), escala * (1 + ((i * 7) % 17)))],
    ),
  )
}

/**
 * Pasa una semilla a facturas, clientes y secuencias. Las filas se ordenan por fecha y reciben el id en ese orden (así el id más alto
 * es siempre lo más reciente); el e-NCF sale de un contador por tipo, y un intento archivado no gasta número.
 */
function construir(hoy, { rnc }, { clientes: clientesBase, filas: especificaciones, secuencias: rangos }) {
  const clientes = clientesBase.map(clienteMock)
  const clientePorId = new Map(clientes.map((c) => [c.id, c]))
  const orden = especificaciones
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.dia - b.s.dia || (a.s.hora < b.s.hora ? -1 : a.s.hora > b.s.hora ? 1 : 0) || a.i - b.i) // sin localeCompare: no depende del ICU
    .map(({ s }) => s)

  // Los números primero: una nota y un intento archivado se refieren a un número que puede llegar después en el orden.
  const ultimo = {}
  const numeroDe = new Map()
  const numeroPorClave = new Map()
  for (const s of orden) {
    if (s.archivadaDe !== undefined) continue
    ultimo[s.tipo] = (ultimo[s.tipo] ?? 0) + 1
    const eNcf = `E${s.tipo}${String(ultimo[s.tipo]).padStart(10, '0')}`
    numeroDe.set(s, eNcf)
    if (s.clave !== undefined) numeroPorClave.set(s.clave, eNcf)
  }

  let idItem = 0
  const facturas = orden.map((s, k) => {
    const id = k + 1
    const eNcf = numeroDe.get(s) ?? null
    const noFactura = eNcf ?? numeroPorClave.get(s.archivadaDe)
    const cliente = s.cliente === null ? null : clientePorId.get(s.cliente)
    const fecha = `${diaDe(sumarDias(hoy, s.dia))} ${s.hora}:00`
    const gravado = suma(s.lineas, 'subtotalCent', (l) => l.indicador !== 4)
    const exento = suma(s.lineas, 'subtotalCent', (l) => l.indicador === 4)
    const itbis = suma(s.lineas, 'itbisCent')
    const trackId = tieneTrackId(s.estado) ? trackIdDe(id) : null
    return {
      id,
      no_factura: noFactura,
      e_ncf: eNcf,
      tipo_ecf: s.tipo,
      date: fecha,
      client_id: cliente ? cliente.id : null,
      client_name: cliente ? cliente.razon_social : null,
      total: texto(gravado + exento + itbis),
      tipo_pago: 1,
      estado_dgii: s.estado,
      track_id: trackId,
      codigo_seguridad: codigoDe(id),
      fecha_emision_dgii: fecha,
      monto_gravado: texto(gravado),
      monto_exento: texto(exento),
      total_itbis: texto(itbis),
      ncf_modificado: s.modifica === undefined ? null : numeroPorClave.get(s.modifica),
      codigo_modificacion: s.modifica === undefined ? null : s.codigo,
      respuesta_dgii: respuestaDgii(s.estado, { trackId, rnc, encf: noFactura, fecha, mensajes: s.mensajes }),
      items: s.lineas.map((l) => ({
        id: ++idItem,
        factura_id: id,
        product_id: null,
        description: l.descripcion,
        amount: texto(l.precioCent, 4),
        quantity: l.cantidad.toFixed(3),
        subtotal: texto(l.subtotalCent),
        descuento_monto: '0.00',
        itbis_amount: texto(l.itbisCent),
        indicador_facturacion: l.indicador,
        indicador_bien_servicio: l.servicio ? 2 : 1,
        unidad_medida: '43',
      })),
    }
  })

  const secuencias = rangos.map(({ tipo, restantes, vence }) => {
    const emitidos = ultimo[tipo] ?? 0
    return { type: `E${tipo}`, nombre: NOMBRES_TIPO.get(tipo), secuencia_actual: emitidos, total_emitidos: emitidos, restantes, vencimiento: vence }
  })
  return { facturas, clientes, secuencias }
}

// ---------------------------------------------------------------------------
// Las semillas
// ---------------------------------------------------------------------------

// Los motivos de rechazo los redacta la DGII y el API los guarda tal cual en `respuesta_dgii.mensajes` (`{ valor, codigo }`): no hay en el
// API nada contra qué compararlos, así que el mock no inventa ninguno y usa solo los dos que cita el plan. El primero es el de la tarea 7
// (el código 145 es un rechazo real de la DGII, lo citan los planes del POS); el segundo sale de la maqueta de una factura rechazada del
// anexo y es también el `rechazo` del plan 07.
const MOTIVO_145 = { valor: 'Fecha de vencimiento de la secuencia vencida', codigo: 145 }
const MOTIVO_RNC = { valor: 'El RNC del comprador no coincide con su nombre.', codigo: 1 }
const FICHAS_DE_FALLA = ['[500]', '[html502]', '[403]', '[401]', '[slow]']

/**
 * E45: la empresa de admin.e45 y user.e45 y la que reusan las personas sin semilla propia. Una fila por cada estado, 24 aceptadas de
 * relleno en 40 días (dos páginas de la lista), cinco aceptadas cuyo cliente lleva una ficha de falla (`Prueba [500]`, ...), un
 * intento rechazado reemplazado, una factura anulada por una E34 aceptada y otra con una E34 rechazada.
 */
function semillaE45(hoy) {
  const clientes = [
    { id: 1, nombre: 'Min. de Obras Públicas', rnc: '401123456' },
    { id: 2, nombre: 'Ayuntamiento de Santiago', rnc: '430145320' },
    { id: 3, nombre: 'Min. de Educación', rnc: '401508842' },
    { id: 4, nombre: 'Hospital Regional de Moca', rnc: '401872019' },
    { id: 5, nombre: 'Instituto Agrario Dominicano', rnc: '401034781' },
    ...FICHAS_DE_FALLA.map((ficha, i) => ({ id: 6 + i, nombre: `Prueba ${ficha}`, rnc: `10199900${1 + i}` })),
  ]
  const supervision = [linea('Supervisión de obra', 2, 4000)]
  // la factura anulada lleva una línea exenta y otra gravada: el detalle muestra el chip de ITBIS
  const anulada = [linea('Servicio de transporte', 1, 1500, { indicador: 4 }), linea('Materiales eléctricos', 1, 3500, { servicio: false })]
  const filas = [
    ...rellenos(24, { tipo: '45', clientes: [1, 2, 3, 4, 5], desde: -40, hasta: -15, escala: 500 }),
    ...FICHAS_DE_FALLA.map((_, i) => fila(-14 + i, '12:00', '45', 'ACEPTADO', 6 + i, [linea('Servicio de prueba', 1, 1000)])),
    // un rechazo reenviado: el intento archivado ya no tiene e-NCF y su reemplazo conserva el número
    fila(-9, '14:20', '45', 'RECHAZADO_ARCHIVADO', 3, supervision, { archivadaDe: 'reemitida', mensajes: [MOTIVO_145] }),
    fila(-9, '14:55', '45', 'ACEPTADO', 3, supervision, { clave: 'reemitida' }),
    fila(-7, '11:10', '45', 'ACEPTADO', 4, anulada, { clave: 'anulada' }),
    fila(-6, '09:40', '34', 'ACEPTADO', 4, anulada, { modifica: 'anulada', codigo: '1' }),
    fila(-5, '14:05', '45', 'ACEPTADO', 5, [linea('Mantenimiento de equipos', 1, 7500)], { clave: 'conNotaRechazada' }),
    fila(-4, '10:20', '34', 'RECHAZADO', 5, [linea('Ajuste de precio', 1, 2500)], {
      modifica: 'conNotaRechazada',
      codigo: '3',
      mensajes: [MOTIVO_RNC],
    }),
    fila(-3, '16:45', '45', 'NO_ENCONTRADO', 2, [linea('Suministro de materiales', 3, 2000)]),
    fila(-3, '17:10', '45', 'ERROR', 1, [linea('Asesoría técnica', 1, 3000)]),
    fila(-2, '13:25', '45', 'RECHAZADO', 3, [linea('Alquiler de maquinaria', 2, 4000)], { mensajes: [MOTIVO_145] }),
    fila(-1, '11:05', '45', 'ENVIO_INCIERTO', 2, [linea('Servicio de consultoría', 1, 3389.83)]), // RD$ 4,000.00
    fila(-1, '11:40', '45', 'PENDIENTE_ENVIO', 4, [linea('Instalación eléctrica', 1, 2000)]),
    fila(-1, '16:20', '45', 'ENVIADO', 5, [linea('Transporte de carga', 1, 4500)]),
    fila(0, '09:15', '45', 'EN_PROCESO', 2, [linea('Alquiler de maquinaria', 1, 10000)]),
    fila(0, '10:42', '45', 'ACEPTADO', 1, [linea('Asesoría técnica', 1, 6000), linea('Materiales de construcción', 4, 1000, { servicio: false })]),
  ]
  return {
    tiposVenta: ['45'],
    clientes,
    filas,
    secuencias: [
      { tipo: '45', restantes: 312, vence: '2027-12-31' },
      { tipo: '34', restantes: 23, vence: diaDe(sumarDias(hoy, 19)) },
    ],
  }
}

/**
 * admin.multi: ventas 31, 32 y 45 más una E34 que anula un E31. El E32 está agotado (restantes 0, con emitidos), el E31 vence en 5 días,
 * un E31 está rechazado y otro en proceso, y hay un E32 de 250,000 o más (a la DGII directo) junto a los de consumo por RFCE.
 */
function semillaMulti(hoy) {
  const clientes = [
    { id: 1, nombre: 'Ferretería La Unión SRL', rnc: '130850012' },
    { id: 2, nombre: 'Distribuidora Caribe SRL', rnc: '101456782' },
    { id: 3, nombre: 'Farmacia San Rafael SRL', rnc: '131204561' },
    { id: 4, nombre: 'Constructora Yaque SRL', rnc: '130674419' },
    { id: 5, nombre: 'Min. de Obras Públicas', rnc: '401123456' },
    { id: 6, nombre: 'Ayuntamiento de Santiago', rnc: '430145320' },
    { id: 7, nombre: 'Juan Pérez' },
  ]
  const credito = [linea('Suministro de materiales', 2, 6000)]
  const filas = [
    ...rellenos(8, { tipo: '31', clientes: [1, 2, 3, 4], desde: -34, hasta: -10, escala: 500 }),
    fila(-8, '11:30', '31', 'ACEPTADO', 2, credito, { clave: 'credito' }),
    fila(-7, '10:05', '34', 'ACEPTADO', 2, credito, { modifica: 'credito', codigo: '1' }),
    fila(-3, '15:40', '31', 'RECHAZADO', 3, [linea('Servicio de consultoría', 1, 5000)], { mensajes: [MOTIVO_145] }),
    fila(0, '09:30', '31', 'EN_PROCESO', 1, [linea('Mantenimiento de equipos', 1, 3500)]),
    ...rellenos(5, { tipo: '32', estado: 'RFCE_ACEPTADO', clientes: [null, 7, null], desde: -30, hasta: -2, escala: 100 }),
    fila(-12, '16:00', '32', 'ACEPTADO', 4, [linea('Equipos de oficina', 1, 250000, { servicio: false })]),
    ...rellenos(7, { tipo: '45', clientes: [5, 6], desde: -33, hasta: -3, escala: 700 }),
  ]
  return {
    tiposVenta: ['31', '32', '45'],
    clientes,
    filas,
    secuencias: [
      { tipo: '31', restantes: 180, vence: diaDe(sumarDias(hoy, 5)) },
      { tipo: '32', restantes: 0, vence: '2027-06-30' },
      { tipo: '45', restantes: 150, vence: '2027-12-31' },
      { tipo: '34', restantes: 60, vence: '2027-12-31' },
    ],
  }
}

/** admin.e32: solo E32 y todos por RFCE (menos de RD$ 250,000, sin número de seguimiento), con filas de consumidor final sin cliente. */
function semillaE32(hoy) {
  const clientes = [
    { id: 1, nombre: 'Juan Pérez' },
    { id: 2, nombre: 'María Gómez' },
    { id: 3, nombre: 'Colmado Los Hermanos SRL', rnc: '131402877' },
  ]
  const filas = [
    ...rellenos(15, {
      tipo: '32',
      estado: 'RFCE_ACEPTADO',
      clientes: [null, 1, null, 2, null, 3],
      desde: -30,
      hasta: -3,
      escala: 250,
      descripciones: ['Venta de mostrador', 'Bebidas y snacks', 'Artículos de limpieza', 'Papelería'],
    }),
    fila(0, '09:50', '32', 'RFCE_ACEPTADO', null, [linea('Venta de mostrador', 2, 450)]),
    fila(0, '10:20', '32', 'RFCE_EN_PROCESO', 1, [linea('Venta de mostrador', 1, 1250)]),
    fila(-1, '15:10', '32', 'RFCE_ENVIADO', null, [linea('Venta de mostrador', 3, 300)]),
    fila(-2, '12:30', '32', 'RFCE_RECHAZADO', 3, [linea('Venta al por mayor', 1, 8000)], { mensajes: [MOTIVO_RNC] }),
  ]
  return {
    tiposVenta: ['32'],
    clientes,
    filas,
    secuencias: [
      { tipo: '32', restantes: 480, vence: '2027-12-31' },
      { tipo: '34', restantes: 100, vence: '2027-12-31' },
    ],
  }
}

/** Qué semilla usa cada persona. Las demás (user.e45, admin.sinproductos, admin.completa, admin.sinbloque, flaky, slow, offline) usan la E45. */
const SEMILLAS = new Map([
  ['admin.multi', semillaMulti],
  ['admin.e32', semillaE32],
])

/** La identidad de las pruebas unitarias; el cableado del mock siempre pasa la de la persona (`entitlements.tenant`). */
const IDENTIDAD_POR_DEFECTO = { nombre: 'Constructora Cibao SRL', rnc: '131256432', ambiente: /** @type {Ambiente} */ ('testecf') }

/** El cuerpo de GET /api/emisor (datos fiscales del emisor, solo lectura). */
function emisorDe({ nombre, rnc, ambiente }, secuencias) {
  const vencimientos = secuencias.map((s) => s.vencimiento).filter((v) => v !== null).sort()
  return {
    rnc,
    razon_social: nombre,
    nombre_comercial: nombre,
    sucursal: null,
    direccion: 'Calle Duarte 25, Centro',
    municipio: 'Santiago de los Caballeros',
    provincia: 'Santiago',
    telefono: '8095550100',
    correo: 'facturacion@express.test',
    website: null,
    actividad_economica: 'Venta de bienes y servicios',
    fecha_vencimiento_secuencia: vencimientos.length > 0 ? vencimientos[0] : null,
    ambiente,
    fuente: 'emisor_config',
  }
}

/**
 * El tenant de una persona del mock, con las fechas relativas al día local de `ahora`. `persona` es su nombre de login: admin.multi y
 * admin.e32 tienen semilla propia y cualquier otra usa la E45. `identidad` (nombre, RNC y ambiente de la empresa) por omisión es la
 * de las pruebas unitarias; el cableado de mock-api.mjs pasa siempre la del bloque de la persona, para que `me`, /api/emisor y la
 * cabecera de Más muestren un solo nombre y un solo RNC.
 * @param {string} persona
 * @param {Date} ahora
 * @param {Identidad} [identidad]
 * @returns {Tenant}
 */
export function sembrarTenant(persona, ahora, identidad = IDENTIDAD_POR_DEFECTO) {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const semilla = (SEMILLAS.get(persona) ?? semillaE45)(hoy)
  const { facturas, clientes, secuencias } = construir(hoy, identidad, semilla)
  return { ambiente: identidad.ambiente, tiposVenta: semilla.tiposVenta, facturas, secuencias, clientes, emisor: emisorDe(identidad, secuencias) }
}
