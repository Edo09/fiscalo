// Textos que ve el cajero alrededor de la emisión de un e-CF: las etiquetas de
// los estados DGII (src/api/estadosDgii.ts) y, en las secciones siguientes, los
// textos del servidor y del front que errores.ts debe dejar pasar o elegir.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/check-errores.ts
import { ESTADOS_EN_VUELO, dgiiLabel, isEnVuelo, isRechazo, puedeReenviarEstado } from '../src/api/estadosDgii.ts'
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
import type { EstadoDgii } from '../src/api/types.ts'
import {
  PIE_DOCUMENTO_EN_VUELO, textoChipSinConfirmar, textoTarjetaEnVuelo,
} from '../src/features/invoices/enVuelo.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves.
const ordenar = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
      : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

// --- Etiquetas de los estados DGII ------------------------------------------
console.log('dgiiLabel / isEnVuelo / isRechazo (src/api/estadosDgii.ts)')
// Todos los estados de facturas.estado_dgii (spec 4.3) y los literales que un
// VARCHAR(20) sin modo estricto cortó antes de la migración 028 (spec 9.1).
const ESTADOS = [
  'PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'ACEPTADO', 'ACEPTADO_CONDICIONAL',
  'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO', 'RFCE_ACEPTADO',
  'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_RECHAZADO', 'RFCE_NO_ENCONTRADO', 'RFCE_ERROR', 'RECHAZADO_ARCHIVADO',
  'NO_ENCONTRADO_ARCHIVADO', 'RFCE_RECHAZADO_ARCHIVADO', 'RFCE_NO_ENCONTRADO_ARCHIVADO',
  'RFCE_ACEPTADO_CONDIC', 'RFCE_RECHAZADO_ARCHI', 'NO_ENCONTRADO_ARCHIV', 'RFCE_NO_ENCONTRADO_A',
]
for (const e of ESTADOS) {
  const l = dgiiLabel(e)
  chk(`${e} -> "${l}" (una etiqueta, no el código)`, l !== e && l !== '—')
}
igual('en vuelo: Por enviar / Sin confirmar',
  [dgiiLabel('PENDIENTE_ENVIO'), dgiiLabel('ENVIO_INCIERTO')], ['Por enviar', 'Sin confirmar'])
igual('vacío o nulo -> "—"; desconocido -> el código tal cual',
  [dgiiLabel(null), dgiiLabel(undefined), dgiiLabel(''), dgiiLabel('OTRO_ESTADO')], ['—', '—', '—', 'OTRO_ESTADO'])
igual('isEnVuelo: solo PENDIENTE_ENVIO y ENVIO_INCIERTO',
  ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', null, ''].map(isEnVuelo), [true, true, false, false, false])
igual('isRechazo no cambia: RECHAZADO, RECHAZADO_ARCHIVADO y RFCE_RECHAZADO',
  ['RECHAZADO', 'RECHAZADO_ARCHIVADO', 'RFCE_RECHAZADO', 'ENVIO_INCIERTO', 'NO_ENCONTRADO_ARCHIVADO'].map(isRechazo),
  [true, true, true, false, false])

// Reenviar a la DGII (decisión U7): solo un comprobante RECHAZADO o NO_ENCONTRADO,
// sin archivar. Uno sin confirmar (en vuelo, ENVIADO, EN_PROCESO) NUNCA se
// reenvía desde la app: lo resuelve soporte o, en el POS, el reenvío automático.
igual('puedeReenviarEstado: solo RECHAZADO, RFCE_RECHAZADO y NO_ENCONTRADO',
  [
    'RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO',
    'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO',
    'ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'ERROR', 'RECHAZADO_ARCHIVADO', 'NO_ENCONTRADO_ARCHIVADO',
    null, undefined, '',
  ].map(puedeReenviarEstado),
  [true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false])
chk('un comprobante en vuelo nunca se reenvía desde la app', ESTADOS_EN_VUELO.every((e) => !puedeReenviarEstado(e)))

// --- Textos de la emisión (src/api/errores.ts) -------------------------------
// Copias LITERALES de textos del servidor. Si uno cambia allá, se cambia aquí:
//   - FACTURA_EMISION_INCIERTA, FACTURA_NOTA_EN_VUELO y FACTURA_NOTA_ENVIADO_SIN_TRACK:
//     api-gratex src/Controllers/facturaController.php (constantes globales);
//   - EcfNumeroOcupadoException::MENSAJE_USUARIO:
//     api-gratex src/Utils/FacturacionElectronica/EcfNumeroOcupadoException.php;
//   - la guarda del total: handleEmisionECF en facturaController.php (422).
const FACTURA_EMISION_INCIERTA =
  'No se pudo confirmar si la DGII recibió la factura %s. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.'
const NUMERO_OCUPADO = 'No se pudo asignar el número de comprobante. Inténtalo de nuevo.'
const TOTAL_SIN_CALCULAR = 'No se pudo calcular el total de la factura. Revisa las líneas e inténtalo de nuevo.'
const FACTURA_NOTA_EN_VUELO =
  'La DGII todavía no ha confirmado este comprobante. No lo emitas de nuevo; si sigue así en unos minutos, avisa a soporte con el número %s.'
const FACTURA_NOTA_ENVIADO_SIN_TRACK =
  'La DGII recibió este comprobante, pero no devolvió su número de seguimiento y por eso no se puede consultar su estado desde aquí. Si necesitas confirmarlo, avisa a soporte con el número %s.'
// Textos propios del front (errores.ts no los exporta): se comparan literales.
const MSG_TARDO_EMISION =
  'El servidor tardó demasiado en responder. Puede que el comprobante sí se haya emitido: revisa el listado de facturas, en Todos (las que esperan respuesta de la DGII están en Pendientes), antes de intentarlo otra vez.'
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
const MSG_TARDO = 'El servidor tardó demasiado en responder. Inténtalo de nuevo.'
const MSG_SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.'
const MSG_SIN_CONEXION_EMISION =
  'Se perdió la conexión mientras se emitía. Puede que el comprobante sí se haya emitido: revisa el listado de facturas, en Todos (las que esperan respuesta de la DGII están en Pendientes), antes de intentarlo otra vez.'
const TEXTO_SERVIDOR_EMISION =
  'No se pudo completar la emisión del e-CF. Revisa el listado de facturas, en Todos (las que esperan respuesta de la DGII están en Pendientes), antes de intentarlo otra vez.'

const ENCF = 'E310000000123'
const conNcf = (texto: string): string => texto.replace('%s', ENCF)
const EMISION = { metodo: 'POST', path: '/api/facturas' }

console.log('humanizar: los textos del servidor sobre la emisión pasan tal cual')
igual('502 incierto (FACTURA_EMISION_INCIERTA)', humanizar(conNcf(FACTURA_EMISION_INCIERTA), 502, EMISION),
  { mensaje: conNcf(FACTURA_EMISION_INCIERTA), reemplazado: false })
igual('502 número ocupado', humanizar(NUMERO_OCUPADO, 502, EMISION), { mensaje: NUMERO_OCUPADO, reemplazado: false })
igual('422 total sin calcular', humanizar(TOTAL_SIN_CALCULAR, 422, EMISION), { mensaje: TOTAL_SIN_CALCULAR, reemplazado: false })

console.log('clasificar: textos que citan los estados en vuelo no son técnicos')
for (const [desc, texto] of [
  ['nota en vuelo (GET /estado)', conNcf(FACTURA_NOTA_EN_VUELO)],
  ['nota ENVIADO sin seguimiento (GET /estado)', conNcf(FACTURA_NOTA_ENVIADO_SIN_TRACK)],
  ['texto que cita ENVIO_INCIERTO', `La factura ${ENCF} está en estado ENVIO_INCIERTO.`],
  ['texto que cita PENDIENTE_ENVIO', `La factura ${ENCF} está en estado PENDIENTE_ENVIO.`],
] as const) {
  const tipo = clasificar(texto)
  chk(`${desc} -> null (dio ${tipo})`, tipo === null)
}

console.log('tiempos de espera y fallos del servidor en la emisión')
// networkError avisa por consola en cada llamada: se calla mientras corre.
const warn = console.warn
console.warn = () => {}
try {
  const timeout = () => new DOMException('', 'TimeoutError')
  igual('timeout de POST /api/facturas -> MSG_TARDO_EMISION', networkError(timeout(), EMISION).message, MSG_TARDO_EMISION)
  igual('timeout de otra escritura (POST /api/clients) -> MSG_TARDO_ESCRITURA de siempre',
    networkError(timeout(), { metodo: 'POST', path: '/api/clients' }).message, MSG_TARDO_ESCRITURA)
  igual('timeout de una lectura -> MSG_TARDO de siempre',
    networkError(timeout(), { metodo: 'GET', path: '/api/facturas' }).message, MSG_TARDO)
  // Fallo de red que NO es timeout (fetch lanza TypeError: conexion cortada, Wi-Fi,
  // proxy que cierra el socket). En la emision la factura puede estar ya guardada
  // y enviada: no se invita a repetir.
  const sinRed = () => new TypeError('Failed to fetch')
  igual('corte de red en POST /api/facturas -> MSG_SIN_CONEXION_EMISION',
    networkError(sinRed(), EMISION).message, MSG_SIN_CONEXION_EMISION)
  igual('corte de red en una lectura (GET /api/facturas) -> MSG_SIN_CONEXION de siempre',
    networkError(sinRed(), { metodo: 'GET', path: '/api/facturas' }).message, MSG_SIN_CONEXION)
  igual('corte de red en otra escritura (POST /api/clients) -> MSG_SIN_CONEXION de siempre',
    networkError(sinRed(), { metodo: 'POST', path: '/api/clients' }).message, MSG_SIN_CONEXION)
  igual('corte de red en POST /api/facturas/ (barra final) -> MSG_SIN_CONEXION_EMISION',
    networkError(sinRed(), { metodo: 'POST', path: '/api/facturas/' }).message, MSG_SIN_CONEXION_EMISION)
  igual('timeout de POST /api/facturas sigue siendo MSG_TARDO_EMISION (el corte no lo pisa)',
    networkError(timeout(), EMISION).message, MSG_TARDO_EMISION)
} finally {
  console.warn = warn
}
igual('504 de POST /api/facturas -> MSG_TARDO_EMISION', humanizar('', 504, EMISION).mensaje, MSG_TARDO_EMISION)
igual('504 de otra escritura -> MSG_TARDO_ESCRITURA de siempre',
  humanizar('', 504, { metodo: 'POST', path: '/api/clients' }).mensaje, MSG_TARDO_ESCRITURA)
{
  // El texto nuevo pasa por clasificar como cualquier aviso: no puede parecer tecnico.
  const tipo = clasificar(MSG_SIN_CONEXION_EMISION)
  chk(`clasificar(MSG_SIN_CONEXION_EMISION) -> null, no 'interno' (dio ${tipo})`, tipo === null)
}
const caido = humanizar('', 500, EMISION).mensaje
chk(`500 sin texto en POST /api/facturas -> manda al listado, en Todos (dio "${caido}")`,
  caido.startsWith(TEXTO_SERVIDOR_EMISION))

// --- Textos del front para una factura en vuelo (enVuelo.ts) -----------------
// Pasan por clasificar como cualquier aviso: ninguno puede parecer técnico.
console.log('clasificar: tarjeta, pie y chip de una factura en vuelo')
for (const [desc, texto] of [
  ['tarjeta del detalle', textoTarjetaEnVuelo(ENCF)],
  ['pie del documento en vuelo', PIE_DOCUMENTO_EN_VUELO],
  ['chip del listado', textoChipSinConfirmar(2)],
] as const) {
  const tipo = clasificar(texto)
  chk(`${desc} -> null (dio ${tipo})`, tipo === null)
}

// --- Merge con main (Task 2): estados y reenvío de las dos ramas -------------
// types.ts une los estados de las dos ramas. Lo comprueba tsc: scripts/ entra en
// el typecheck (el runtime de node borra el `satisfies`).
const ESTADOS_DE_LAS_DOS_RAMAS = [
  'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', // Release 1: en vuelo
  'RFCE_PENDIENTE', 'ENVIO_PENDIENTE', // main: ventas del POS sin respuesta (la API ya no los produce)
] as const satisfies readonly EstadoDgii[]
console.log('merge con main: estados y textos de las dos ramas')
chk(`EstadoDgii une los estados en vuelo y los del POS de main (${ESTADOS_DE_LAS_DOS_RAMAS.length})`,
  ESTADOS_DE_LAS_DOS_RAMAS.length === 4)
{
  // RE_ESTADO_DGII une los dos regex: citar un estado de main no parece técnico.
  const tipo = clasificar(`La venta ${ENCF} está en estado ENVIO_PENDIENTE.`)
  chk(`texto que cita ENVIO_PENDIENTE -> null (dio ${tipo})`, tipo === null)
}
// POST /api/facturas/{id}/reenviar emite un e-CF nuevo (main): un fallo a mitad
// pudo dejarlo ya enviado, así que usa los textos de la emisión y no los de una
// escritura cualquiera.
const REENVIO = { metodo: 'POST', path: '/api/facturas/41/reenviar' }
console.warn = () => {}
try {
  igual('timeout de POST /reenviar -> MSG_TARDO_EMISION',
    networkError(new DOMException('', 'TimeoutError'), REENVIO).message, MSG_TARDO_EMISION)
  igual('corte de red en POST /reenviar -> MSG_SIN_CONEXION_EMISION',
    networkError(new TypeError('Failed to fetch'), REENVIO).message, MSG_SIN_CONEXION_EMISION)
  igual('corte de red en GET /api/facturas/41/reenviar -> MSG_SIN_CONEXION de siempre',
    networkError(new TypeError('Failed to fetch'), { metodo: 'GET', path: '/api/facturas/41/reenviar' }).message, MSG_SIN_CONEXION)
} finally {
  console.warn = warn
}
igual('504 de POST /reenviar -> MSG_TARDO_EMISION', humanizar('', 504, REENVIO).mensaje, MSG_TARDO_EMISION)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
