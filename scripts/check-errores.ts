// Textos que ve el cajero alrededor de la emisión de un e-CF: las etiquetas de
// los estados DGII (src/api/estadosDgii.ts) y, en las secciones siguientes, los
// textos del servidor y del front que errores.ts debe dejar pasar o elegir.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/check-errores.ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'
import { clasificar, humanizar, networkError } from '../src/api/errores.ts'
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
  'El servidor tardó demasiado en responder. Puede que el comprobante sí se haya emitido: revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'
const MSG_TARDO_ESCRITURA =
  'El servidor tardó demasiado en responder. Puede que sí se haya guardado: revisa el listado antes de intentarlo otra vez.'
const MSG_TARDO = 'El servidor tardó demasiado en responder. Inténtalo de nuevo.'
const TEXTO_SERVIDOR_EMISION =
  'No se pudo completar la emisión del e-CF. Revisa el filtro Pendientes del listado de facturas antes de intentarlo otra vez.'

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
} finally {
  console.warn = warn
}
igual('504 de POST /api/facturas -> MSG_TARDO_EMISION', humanizar('', 504, EMISION).mensaje, MSG_TARDO_EMISION)
igual('504 de otra escritura -> MSG_TARDO_ESCRITURA de siempre',
  humanizar('', 504, { metodo: 'POST', path: '/api/clients' }).mensaje, MSG_TARDO_ESCRITURA)
const caido = humanizar('', 500, EMISION).mensaje
chk(`500 sin texto en POST /api/facturas -> manda al filtro Pendientes (dio "${caido}")`,
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

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
