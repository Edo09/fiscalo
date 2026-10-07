// Facturas e-CF en vuelo (guardadas antes de enviarlas a la DGII, sin respuesta
// todavía): el conteo y el chip del listado, los datos del 502 "incierto" con
// que el formulario abre la factura, y los textos de la tarjeta y del pie del
// detalle (src/features/invoices/enVuelo.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-en-vuelo.ts
import { ApiError, errorDeRespuesta } from '../src/api/errores.ts'
import {
  PIE_DOCUMENTO, PIE_DOCUMENTO_EN_VUELO, contarSinConfirmar, datosEmisionIncierta, facturaEmisionIncierta,
  textoChipSinConfirmar, textoPieDocumento, textoTarjetaEnVuelo,
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

console.log('contarSinConfirmar / textoChipSinConfirmar (listado y dashboard e-CF)')
igual('suma solo PENDIENTE_ENVIO y ENVIO_INCIERTO de por_estado', contarSinConfirmar([
  { estado: 'PENDIENTE_ENVIO', total: 1 },
  { estado: 'ENVIO_INCIERTO', total: 2 },
  { estado: 'ENVIADO', total: 5 },
  { estado: 'ACEPTADO', total: 9 },
]), 3)
igual('sin stats todavía -> 0', [contarSinConfirmar(null), contarSinConfirmar(undefined), contarSinConfirmar([])], [0, 0, 0])
igual('chip en singular y en plural',
  [textoChipSinConfirmar(1), textoChipSinConfirmar(3)],
  ['1 comprobante sin confirmar · Ver', '3 comprobantes sin confirmar · Ver'])

console.log('datosEmisionIncierta (catch del formulario)')
// Lo que http.ts arma con el 502 incierto de POST /api/facturas (spec 7.1):
// el texto del servidor como mensaje y su `data` en `datos`. PDO puede mandar
// el id como texto.
const MSG = 'No se pudo confirmar si la DGII recibió la factura E310000000123. No la emitas de nuevo: ya quedó guardada. Búscala en Facturación con el filtro Pendientes y, si sigue sin confirmar, avisa a soporte con ese número.'
const DATOS = { factura_id: '41', e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' }
igual('502 con data.factura_id -> datos normalizados (id en número)',
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: DATOS })),
  { factura_id: 41, e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' })
igual('PENDIENTE_ENVIO también vale', datosEmisionIncierta(new ApiError(MSG, 502, {
  datos: { factura_id: 42, e_ncf: 'E320000000007', tipo_ecf: '32', estado_dgii: 'PENDIENTE_ENVIO' },
}))?.estado_dgii, 'PENDIENTE_ENVIO')
igual('otro status (500) -> null', datosEmisionIncierta(new ApiError(MSG, 500, { datos: DATOS })), null)
igual('502 sin data (fallo antes de enviar: nada quedó guardado) -> null',
  datosEmisionIncierta(new ApiError('No se pudo emitir la factura en la DGII.', 502)), null)
igual('factura_id 0, negativo, decimal o ausente -> null', [
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: 0 } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: -3 } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { ...DATOS, factura_id: '4.5' } })),
  datosEmisionIncierta(new ApiError(MSG, 502, { datos: { e_ncf: 'E310000000123' } })),
], [null, null, null, null])
igual('un Error que no es ApiError -> null', datosEmisionIncierta(new Error('x')), null)
// La cadena real de http.ts (:90-93): un cuerpo {status:false, error, data} se
// vuelve ApiError con errorDeRespuesta(texto, status, ctx, data). Los casos de
// arriba arman el ApiError a mano; este lo arma como lo hace http.ts.
igual('el ApiError que arma errorDeRespuesta (como http.ts) -> los mismos datos normalizados',
  datosEmisionIncierta(errorDeRespuesta(MSG, 502, { metodo: 'POST', path: '/api/facturas' }, DATOS)),
  { factura_id: 41, e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' })

console.log('facturaEmisionIncierta (la factura que abre "Ver factura")')
const f = facturaEmisionIncierta(
  { factura_id: 41, e_ncf: 'E310000000123', tipo_ecf: '31', estado_dgii: 'ENVIO_INCIERTO' },
  { cliente: 'Ferretería Ejemplo', clienteId: '7', rnc: '131234567', subtotal: 1000, itbis: 180, total: 1180, metodo: 'Efectivo' },
)
igual('id, e-NCF y estado de la fila guardada; montos y cliente del formulario', f, {
  id: '41', facturaId: 41, ncf: 'E310000000123', tipo: '31',
  cliente: 'Ferretería Ejemplo', clienteId: '7', rnc: '131234567',
  fecha: '—', vence: '—', subtotal: 1000, itbis: 180, total: 1180,
  estado: 'Emitida', dgii: 'Sin confirmar', metodo: 'Efectivo',
  trackId: null, codigoSeguridad: null, estadoDgiiRaw: 'ENVIO_INCIERTO',
})

console.log('tarjeta y pie del detalle')
igual('tarjeta en vuelo (spec 9.1)', textoTarjetaEnVuelo('E310000000123'),
  'Este comprobante quedó reservado con el e-NCF E310000000123, pero la DGII no ha confirmado su recepción.')
igual('pie de siempre', PIE_DOCUMENTO, 'Documento firmado y enviado a la DGII · la representación impresa se descarga en PDF')
igual('pie en vuelo', PIE_DOCUMENTO_EN_VUELO,
  'Documento firmado · pendiente de confirmación de la DGII · la representación impresa se descarga en PDF')
igual('textoPieDocumento: en vuelo -> pie en vuelo; lo demás -> el de siempre',
  ['ENVIO_INCIERTO', 'PENDIENTE_ENVIO', 'ACEPTADO', 'ENVIADO', null, undefined].map(textoPieDocumento),
  [PIE_DOCUMENTO_EN_VUELO, PIE_DOCUMENTO_EN_VUELO, PIE_DOCUMENTO, PIE_DOCUMENTO, PIE_DOCUMENTO, PIE_DOCUMENTO])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
