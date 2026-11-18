// Cobros (src/features/cobros + src/api/schemas/cobros.ts), sin navegador ni servidor:
//   1. CONTRATO: las respuestas REALES del modelo de la API (scripts/fixtures/cobros/*.json, volcadas por
//      `php tools/test_cobros.php --fixtures=<carpeta>` en api-gratex) pasan por los esquemas Zod. Si la API
//      cambia de forma y el esquema no, esto falla aquí y no con un "undefined" en pantalla.
//   2. Reglas de los formularios (dinero en centavos, fechas, saldo, hora) y sus mensajes.
//   3. Textos y tonos (format.ts), incluida la misma regla de vencimiento que el servidor (dia 31 -> 28).
//   4. El store de interfaz (Zustand): filtros que vuelven a la página 1 y reinicio al cambiar de sesión.
//   5. Navegación: la vista, el menú, el permiso y la señal "abrir el cliente en Cobros".
//
// Para regenerar los fixtures (en api-gratex, con pdo_sqlite):
//   php -d extension=php_pdo_sqlite.dll tools/test_cobros.php --fixtures=<ruta de fiscalo-react>/scripts/fixtures/cobros
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-cobros.ts
import { readFileSync } from 'node:fs'
import {
  CANALES_RECORDATORIO, ESTADOS_COBRO, METODOS_PAGO, aCentavos, centavosDeTexto, cobroActualizadoSchema, cobroDetalleSchema,
  cobroFormSchema, cobroSchema, configCobroSchema, configFormSchema, deCentavos, erroresPorCampo, esFechaReal, esPeriodo,
  fechaHoraApi, motivoFormSchema, pagoAnuladoSchema, pagoFormSchema, pagoResultadoSchema, panelClienteSchema, problemaDeMonto,
  recordatorioFormSchema, recordatorioResultadoSchema, recordatoriosCobrosSchema, resumenCobrosSchema, textoDinero,
  textoMontoCampo, type EstadoCobro,
} from '../src/api/schemas/cobros.ts'
import {
  TONO_ESTADO, admitePago, cobrosTexto, conceptoCobro, diasDelMes, diasTexto, fechaCorta, fechaHoraCorta, periodoCorto, periodoLargo,
  periodoSiguiente, resumenPeriodos, textoSiguiente, textoVencimiento, vencimientoDe,
} from '../src/features/cobros/format.ts'
import { relojDeServidor } from '../src/features/cobros/reloj.ts'
import { nuevaClave } from '../src/features/cobros/clave.ts'
import {
  NAV, TITLES, isClienteCobrosRef, mismoDestino, navModuleFor, navTopFor, puedeVerItem, puedeVerVista, type ViewId,
} from '../src/config/navigation.ts'
import { MODULE_CATALOG } from '../src/config/permissions.ts'
import { staleTimeFor, FRESCURA } from '../src/config/cache.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido).slice(0, 400)}`}`)
}
const igual = (desc: string, obtenido: unknown, esperado: unknown) =>
  chk(desc, JSON.stringify(obtenido) === JSON.stringify(esperado), obtenido)

const fixture = (nombre: string): { data: unknown; pagination?: unknown } =>
  JSON.parse(readFileSync(new URL(`./fixtures/cobros/${nombre}.json`, import.meta.url), 'utf8'))

// ---------------------------------------------------------------------------
console.log('1. Contrato con la API: las respuestas reales pasan por los esquemas')
const lista = fixture('lista')
const filas = (lista.data as unknown[]).map((f) => cobroSchema.safeParse(f))
chk(`la lista (${filas.length} cobros) pasa por cobroSchema`, filas.length > 10 && filas.every((f) => f.success), filas.filter((f) => !f.success).map((f) => !f.success && f.error.issues[0]))
const cobros = filas.flatMap((f) => (f.success ? [f.data] : []))
chk('la lista trae los cinco estados', ESTADOS_COBRO.every((e) => cobros.some((c) => c.estado === e)), [...new Set(cobros.map((c) => c.estado))])
chk('la paginación del sobre trae page, pageSize, total y totalPages', ['page', 'pageSize', 'total', 'totalPages'].every((k) => typeof (lista.pagination as Record<string, unknown>)[k] === 'number'))
chk('un cobro vencido con abonos sigue "Vencido" y lo dice con_abonos', cobros.some((c) => c.estado === 'Vencido' && c.con_abonos === true))
chk('un cobro generado solo apunta a su origen (generado_de_cobro_id)', cobros.some((c) => c.generado_de_cobro_id !== null))
chk('los montos son números, con saldo = monto - pagado (salvo cancelado = 0)', cobros.every((c) =>
  typeof c.monto === 'number' && aCentavos(c.saldo) === (c.estado === 'Cancelado' ? 0 : aCentavos(c.monto) - aCentavos(c.monto_pagado))))
chk('el cobro de A para octubre tiene a su cliente con nombre de razón social y contacto', cobros.some((c) => c.cliente.nombre === 'ACME SRL' && c.cliente.contacto === 'Ana Gómez'))

const detalle = cobroDetalleSchema.safeParse(fixture('detalle').data)
chk('detalle (GET /api/cobros/{id}) pasa por cobroDetalleSchema', detalle.success, !detalle.success && detalle.error.issues[0])
chk('cancelado (POST cancelar) pasa por cobroDetalleSchema y trae el motivo', (() => {
  const r = cobroDetalleSchema.safeParse(fixture('cancelado').data)
  return r.success && r.data.estado === 'Cancelado' && r.data.motivo_cancelacion !== null && r.data.saldo === 0
})())
const pago = pagoResultadoSchema.safeParse(fixture('pago').data)
chk('pago (POST pagos) pasa por pagoResultadoSchema', pago.success, !pago.success && pago.error.issues[0])
chk('el pago que completa el cobro lo deja Pagado y trae el siguiente generado ahora', pago.success && pago.data.cobro.estado === 'Pagado'
  && pago.data.siguiente_nuevo === true && pago.data.siguiente?.periodo === '2026-11' && pago.data.siguiente.monto === 6000 && pago.data.repetido === false
  && pago.data.siguiente_motivo === 'generado')
const repetido = pagoResultadoSchema.safeParse(fixture('pago-repetido').data)
chk('el pago repetido (misma clave) dice repetido y NO anuncia otro siguiente', repetido.success && repetido.data.repetido === true && repetido.data.siguiente_nuevo === false
  && repetido.data.siguiente_motivo === null
  && repetido.data.siguiente?.id === (pago.success ? pago.data.siguiente?.id : -1))
const anulado = pagoAnuladoSchema.safeParse(fixture('anulado').data)
chk('anular un pago (POST anular) pasa por pagoAnuladoSchema; el pago queda anulado con su motivo', anulado.success && anulado.data.pago.anulado === true && anulado.data.pago.motivo_anulacion === 'Se digito mal', !anulado.success && anulado.error.issues[0])
const actualizado = cobroActualizadoSchema.safeParse(fixture('actualizado').data)
chk('actualizar (PUT) pasa por cobroActualizadoSchema: {cobro, siguiente}', actualizado.success && actualizado.data.cobro.estado === 'Pagado' && actualizado.data.siguiente?.periodo === '2027-01'
  && actualizado.data.siguiente_motivo === 'generado', !actualizado.success && actualizado.error.issues[0])
const recordatorio = recordatorioResultadoSchema.safeParse(fixture('recordatorio').data)
chk('anotar un recordatorio (POST) pasa por recordatorioResultadoSchema', recordatorio.success && recordatorio.data.recordatorio.canal === 'llamada' && recordatorio.data.cobro.recordatorios === 1, !recordatorio.success && recordatorio.error.issues[0])
const recs = recordatoriosCobrosSchema.safeParse(fixture('recordatorios').data)
chk('recordatorios (GET) pasa por recordatoriosCobrosSchema, con el motivo de cada item', recs.success && recs.data.items.length > 3 && recs.data.items.every((i) => i.motivo === 'vencido' || i.motivo === 'por_vencer'), !recs.success && recs.error.issues[0])
chk('recordatorios POR CLIENTE: G, H y F (el recordado, al final), con lo vencido y lo por vencer, sin truncar y con la hora de RD', recs.success
  && JSON.stringify(recs.data.clientes.map((c) => c.client_id)) === '[7,8,6]' && recs.data.truncado === false
  && recs.data.resumen.clientes === 3 && recs.data.resumen.clientes_por_recordar === 2 && recs.data.resumen.clientes_recordados === 1
  && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(recs.data.ahora), !recs.success ? recs.error.issues[0] : recs.success && recs.data.resumen)
chk('...el cliente recordado trae su último recordatorio (la llamada) y el que no, no; lo vencido y lo por vencer suman por cliente', recs.success && (() => {
  const f = recs.data.clientes.find((c) => c.client_id === 6)
  const g = recs.data.clientes.find((c) => c.client_id === 7)
  const h = recs.data.clientes.find((c) => c.client_id === 8)
  return f?.requiere_recordatorio === false && f.ultimo?.canal === 'llamada' && f.recordatorios === 1 && f.cobros_vencidos === 2 && f.saldo_vencido === 2500
    && f.mas_antiguo === '2026-08-15' && g?.requiere_recordatorio === true && g.ultimo === null && g.cobros_vencidos === 1 && g.cobros_por_vencer === 1
    && g.saldo_por_vencer === 1200 && h?.mas_antiguo === null && h.proximo_vencimiento === '2026-11-16' && h.cobros_vencidos === 0
})())
const panel = panelClienteSchema.safeParse(fixture('panel').data)
chk('panel del cliente (GET clientes/{id}) pasa por panelClienteSchema', panel.success, !panel.success && panel.error.issues[0])
chk('el panel trae configuración, resumen, lo sugerido y los cobros con sus pagos (uno anulado a la vista)', panel.success && panel.data.config?.monto_mensual === 6000
  && panel.data.config.dia_vencimiento === 31 && panel.data.cobros.length === 6 && panel.data.cobros.some((c) => c.pagos.some((p) => p.anulado))
  && panel.data.sugerido.periodo === '2027-04' && panel.data.sugerido.fecha_vencimiento === '2027-04-30')
const sinConfig = panelClienteSchema.safeParse(fixture('panel-sin-config').data)
chk('el panel de un cliente SIN configuración trae config null y el sugerido sin monto ni fecha', sinConfig.success && sinConfig.data.config === null
  && sinConfig.data.sugerido.monto === null && sinConfig.data.sugerido.fecha_vencimiento === null && sinConfig.data.recordatorios.length === 1, !sinConfig.success && sinConfig.error.issues[0])
const resumen = resumenCobrosSchema.safeParse(fixture('resumen').data)
chk('resumen (GET) pasa por resumenCobrosSchema, con la fecha y la hora de RD del servidor', resumen.success && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(resumen.data.ahora)
  && resumen.data.ahora.startsWith(resumen.data.hoy), !resumen.success && resumen.error.issues[0])
chk('el resumen: pendiente 21,000, vencido 3,300, cinco tramos de antigüedad que suman lo pendiente', resumen.success && resumen.data.totales.pendiente === 21000 && resumen.data.totales.vencido === 3300
  && resumen.data.antiguedad.length === 5 && aCentavos(resumen.data.antiguedad.reduce((a, t) => a + t.monto, 0)) === 2100000)
chk('config (PUT config) pasa por configCobroSchema', configCobroSchema.safeParse(fixture('config').data).success)

// Control negativo: el esquema SÍ rechaza lo que no encaja.
const base = cobros[0]
chk('un estado desconocido ("Abierto") no pasa', !cobroSchema.safeParse({ ...base, estado: 'Abierto' }).success)
chk('un cobro sin saldo no pasa', !cobroSchema.safeParse({ ...base, saldo: undefined }).success)
chk('un monto como texto ("5000.00") no pasa: la API manda números', !cobroSchema.safeParse({ ...base, monto: '5000.00' }).success)
chk('un método de pago inventado no pasa', !pagoResultadoSchema.safeParse({ ...(pago.success ? pago.data : {}), pago: { ...(pago.success ? pago.data.pago : {}), metodo: 'cheque' } }).success)

// ---------------------------------------------------------------------------
console.log('\n2. Dinero en centavos (nunca float)')
for (const [texto, esperado] of [
  ['1500', 150000], ['1,500.50', 150050], ['1500.5', 150050], ['RD$ 1,500', 150000], ['0.05', 5], ['1,234,567.89', 123456789],
  [' 12.30 ', 1230], ['0', 0], ['9999999999.99', 999999999999],
] as [string, number][]) igual(`centavosDeTexto(${JSON.stringify(texto)}) = ${esperado}`, centavosDeTexto(texto), esperado)
for (const malo of ['', 'abc', '1.005', '1,50', '12,34.5', '-5', '1e3', '1.', '.5', '1,5000', 'RD$']) {
  chk(`centavosDeTexto(${JSON.stringify(malo)}) = null`, centavosDeTexto(malo) === null)
}
let suma = 0
for (let i = 0; i < 1000; i++) suma += centavosDeTexto('0.10') as number
chk('mil sumas de 0.10 dan exactamente 100.00 (en flotante darían 99.9999…)', suma === 10000 && textoMontoCampo(suma) === '100.00')
igual('aCentavos / deCentavos: 0.29 y 1234.56 sin ruido binario', [aCentavos(0.29), aCentavos(1234.56), deCentavos(29), deCentavos(123456)], [29, 123456, 0.29, 1234.56])
igual('textoMontoCampo rellena el campo: 150050 -> "1500.50", 5 -> "0.05"', [textoMontoCampo(150050), textoMontoCampo(5)], ['1500.50', '0.05'])
igual('textoDinero para mensajes: 123456 -> "RD$ 1,234.56"', textoDinero(123456), 'RD$ 1,234.56')
igual('problemaDeMonto: vacío, texto, cero y demasiado grande dan su mensaje; uno bueno da null', [
  problemaDeMonto(''), problemaDeMonto('abc'), problemaDeMonto('0'), problemaDeMonto('10000000000.00'), problemaDeMonto('150.25'),
], ['Escribe el monto.', 'El monto no es válido. Usa solo números, con hasta 2 decimales (por ejemplo 1500.50).', 'El monto tiene que ser mayor que 0.', 'El monto es demasiado grande. El máximo es RD$ 9,999,999,999.99.', null])

console.log('\n3. Fechas y periodos')
chk('esFechaReal: 2026-11-16 y 2028-02-29 sí; 2026-02-29, 2026-13-01, 1999-01-01 y vacío no',
  esFechaReal('2026-11-16') && esFechaReal('2028-02-29') && !esFechaReal('2026-02-29') && !esFechaReal('2026-13-01') && !esFechaReal('1999-01-01') && !esFechaReal(''))
chk('esPeriodo: 2026-11 sí; 2026-13, 2026-1, 1999-12 y 2026-11-01 no', esPeriodo('2026-11') && !esPeriodo('2026-13') && !esPeriodo('2026-1') && !esPeriodo('1999-12') && !esPeriodo('2026-11-01'))
igual('fechaHoraApi une fecha y hora para la API', fechaHoraApi('2026-11-16', '09:30'), '2026-11-16 09:30:00')

// ---------------------------------------------------------------------------
console.log('\n4. Formularios (Zod): mensajes y límites')
const campos = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.success ? {} : erroresPorCampo(r.error as never)
const cobroOk = { clientId: 3, periodo: '2026-12', fechaVencimiento: '2026-12-31', monto: '1,500.00', descripcion: 'Mensualidad' }
chk('cobro válido pasa', cobroFormSchema.safeParse(cobroOk).success)
igual('cobro sin cliente: "Elige un cliente."', campos(cobroFormSchema.safeParse({ ...cobroOk, clientId: null })), { clientId: 'Elige un cliente.' })
igual('cobro con periodo vacío y fecha vacía', campos(cobroFormSchema.safeParse({ ...cobroOk, periodo: '', fechaVencimiento: '' })),
  { periodo: 'Elige el periodo (mes y año).', fechaVencimiento: 'Elige la fecha de vencimiento.' })
igual('cobro con el 30 de febrero: "La fecha no es válida."', campos(cobroFormSchema.safeParse({ ...cobroOk, fechaVencimiento: '2026-02-30' })), { fechaVencimiento: 'La fecha no es válida.' })
igual('cobro con monto malo y descripción de 151 caracteres', Object.keys(campos(cobroFormSchema.safeParse({ ...cobroOk, monto: '0', descripcion: 'x'.repeat(151) }))).sort(), ['descripcion', 'monto'])
igual('config válida pasa; día 0, 32, "x" y vacío dan error de día', [
  configFormSchema.safeParse({ monto: '6000', dia: '31', descripcion: '', activo: true }).success,
  ...['0', '32', 'x', ''].map((dia) => campos(configFormSchema.safeParse({ monto: '6000', dia, descripcion: '', activo: true })).dia),
], [true, ...Array(4).fill('El día de vencimiento tiene que ser un número entre 1 y 31.')])
chk('config con monto vacío: "Escribe el monto."', campos(configFormSchema.safeParse({ monto: '', dia: '5', descripcion: '', activo: true })).monto === 'Escribe el monto.')

const SALDO = 300000
const HOY = '2026-11-16'
const pagoOk = { monto: '3000.00', fecha: '2026-11-16', metodo: 'efectivo', observaciones: '' }
const esquemaPago = pagoFormSchema(SALDO, HOY)
chk('pago del saldo exacto pasa; uno parcial pasa', esquemaPago.safeParse(pagoOk).success && esquemaPago.safeParse({ ...pagoOk, monto: '1000' }).success)
chk('pago de un centavo de más: error con el saldo en el texto', campos(esquemaPago.safeParse({ ...pagoOk, monto: '3000.01' })).monto === 'El pago no puede ser mayor que el saldo pendiente (RD$ 3,000.00).')
igual('pago con monto vacío, cero o texto', [
  campos(esquemaPago.safeParse({ ...pagoOk, monto: '' })).monto, campos(esquemaPago.safeParse({ ...pagoOk, monto: '0' })).monto, campos(esquemaPago.safeParse({ ...pagoOk, monto: 'abc' })).monto,
], ['Escribe el monto.', 'El monto tiene que ser mayor que 0.', 'El monto no es válido. Usa solo números, con hasta 2 decimales (por ejemplo 1500.50).'])
igual('pago de mañana, sin fecha o con fecha imposible', [
  campos(esquemaPago.safeParse({ ...pagoOk, fecha: '2026-11-17' })).fecha, campos(esquemaPago.safeParse({ ...pagoOk, fecha: '' })).fecha, campos(esquemaPago.safeParse({ ...pagoOk, fecha: '2026-02-30' })).fecha,
], ['La fecha del pago no puede ser posterior a hoy.', 'Elige la fecha del pago.', 'La fecha no es válida.'])
chk('pago de una fecha pasada pasa', esquemaPago.safeParse({ ...pagoOk, fecha: '2026-10-01' }).success)
igual('pago sin método o con uno inventado: "Elige cómo se pagó"', [
  campos(esquemaPago.safeParse({ ...pagoOk, metodo: '' })).metodo, campos(esquemaPago.safeParse({ ...pagoOk, metodo: 'cheque' })).metodo,
], Array(2).fill('Elige cómo se pagó: efectivo o transferencia.'))
chk('los dos métodos (efectivo y transferencia) pasan y son exactamente los del servidor', METODOS_PAGO.every((m) => esquemaPago.safeParse({ ...pagoOk, metodo: m }).success) && METODOS_PAGO.length === 2)
chk('pago con observaciones de 256 caracteres: error', 'observaciones' in campos(esquemaPago.safeParse({ ...pagoOk, observaciones: 'o'.repeat(256) })))

const AHORA = '2026-11-16T10:00'
const esquemaRec = recordatorioFormSchema(AHORA)
const recOk = { fecha: '2026-11-16', hora: '09:30', canal: 'llamada', nota: '' }
chk('recordatorio válido pasa; a la misma hora de ahora pasa', esquemaRec.safeParse(recOk).success && esquemaRec.safeParse({ ...recOk, hora: '10:00' }).success)
chk('recordatorio de un minuto en el futuro: error en la fecha', 'fecha' in campos(esquemaRec.safeParse({ ...recOk, hora: '10:01' })))
chk('recordatorio con hora 25:00, sin canal o con "whatsapp": un error cada uno', 'hora' in campos(esquemaRec.safeParse({ ...recOk, hora: '25:00' }))
  && 'canal' in campos(esquemaRec.safeParse({ ...recOk, canal: '' })) && 'canal' in campos(esquemaRec.safeParse({ ...recOk, canal: 'whatsapp' })))
chk('los canales son los del servidor: llamada, mensaje, correo, visita, otro', JSON.stringify(CANALES_RECORDATORIO) === JSON.stringify(['llamada', 'mensaje', 'correo', 'visita', 'otro']))
chk('motivo vacío pasa (es opcional); de 256 caracteres no', motivoFormSchema.safeParse({ motivo: '' }).success && !motivoFormSchema.safeParse({ motivo: 'm'.repeat(256) }).success)

// ---------------------------------------------------------------------------
console.log('\n5. Textos, tonos y la regla del vencimiento')
igual('periodoCorto / periodoLargo', [periodoCorto('2026-11'), periodoLargo('2026-11'), periodoCorto('2027-01'), periodoCorto('mal')], ['Nov 2026', 'noviembre 2026', 'Ene 2027', 'mal'])
igual('fechaCorta y fechaHoraCorta', [fechaCorta('2026-11-16'), fechaCorta('2027-02-05'), fechaHoraCorta('2026-11-16 09:30:00')], ['16 nov 2026', '5 feb 2027', '16 nov 2026 · 09:30'])
igual('diasTexto: 1 día, 5 días, 0 días', [diasTexto(1), diasTexto(5), diasTexto(0)], ['1 día', '5 días', '0 días'])
const filaBase = { estado: 'Pendiente' as EstadoCobro, dias_atraso: 0, dias_para_vencer: null as number | null }
igual('textoVencimiento: hoy, mañana, en N días, vencido hace N días, y nada si está pagado o cancelado', [
  textoVencimiento({ ...filaBase, dias_para_vencer: 0 }), textoVencimiento({ ...filaBase, dias_para_vencer: 1 }), textoVencimiento({ ...filaBase, estado: 'Parcial', dias_para_vencer: 14 }),
  textoVencimiento({ ...filaBase, estado: 'Vencido', dias_atraso: 16 }), textoVencimiento({ ...filaBase, estado: 'Vencido', dias_atraso: 1 }),
  textoVencimiento({ ...filaBase, estado: 'Pagado' }), textoVencimiento({ ...filaBase, estado: 'Cancelado', dias_para_vencer: 3 }),
], ['Vence hoy', 'Vence mañana', 'Vence en 14 días', 'Vencido hace 16 días', 'Vencido hace 1 día', null, null])
igual('admitePago: solo Pendiente, Parcial y Vencido', ESTADOS_COBRO.map((e) => admitePago({ estado: e })), [true, true, true, false, false])
igual('conceptoCobro: la descripción o "Cobro mensual"', [conceptoCobro({ descripcion: 'Plan Pro' }), conceptoCobro({ descripcion: null }), conceptoCobro({ descripcion: '  ' })], ['Plan Pro', 'Cobro mensual', 'Cobro mensual'])
igual('cada estado tiene su tono: rojo vencido, verde pagado, ámbar parcial, azul pendiente, gris cancelado', TONO_ESTADO,
  { Pendiente: 'info', Parcial: 'warning', Vencido: 'danger', Pagado: 'success', Cancelado: 'neutral' })
// La MISMA tabla que la prueba del servidor (api-gratex tools/test_cobros.php, CobroReglas::vencimientoDe).
for (const [periodo, dia, esperado] of [
  ['2026-11', 5, '2026-11-05'], ['2026-11', 31, '2026-11-30'], ['2026-12', 31, '2026-12-31'], ['2027-02', 31, '2027-02-28'],
  ['2027-02', 30, '2027-02-28'], ['2028-02', 30, '2028-02-29'], ['2028-02', 29, '2028-02-29'], ['2026-04', 31, '2026-04-30'],
  ['2026-04', 30, '2026-04-30'], ['2026-01', 1, '2026-01-01'],
] as [string, number, string][]) igual(`vencimientoDe(${periodo}, día ${dia}) = ${esperado} (igual que el servidor)`, vencimientoDe(periodo, dia), esperado)
igual('diasDelMes: enero 31, abril 30, febrero 2026 28, febrero 2028 29, febrero 2100 28', [diasDelMes('2026-01'), diasDelMes('2026-04'), diasDelMes('2026-02'), diasDelMes('2028-02'), diasDelMes('2100-02')], [31, 30, 28, 29, 28])
igual('periodoSiguiente: nov -> dic, dic -> ene del año siguiente', [periodoSiguiente('2026-11'), periodoSiguiente('2026-12'), periodoSiguiente('2026-01')], ['2026-12', '2027-01', '2026-02'])
const sig = { periodo: '2026-12', monto: 6000, fecha_vencimiento: '2026-12-31', estado: 'Pendiente' as EstadoCobro }
igual('textoSiguiente: generado, generado y ya vencido, sin config, desactivado, ya existía y nada que decir', [
  textoSiguiente('generado', sig),
  textoSiguiente('generado', { ...sig, periodo: '2026-11', fecha_vencimiento: '2026-11-30', estado: 'Vencido' }),
  textoSiguiente('sin_config', null), textoSiguiente('inactivo', null), textoSiguiente('ya_existia', sig), textoSiguiente('ya_existia', null),
  textoSiguiente(null, null), textoSiguiente('generado', null),
], [
  'Se generó el cobro de diciembre 2026 por RD$ 6,000.00, vence el 31 dic 2026.',
  'Se generó el cobro de noviembre 2026 por RD$ 6,000.00, que ya está vencido (venció el 30 nov 2026).',
  'No se generó el cobro del mes siguiente: este cliente no tiene cobro mensual configurado.',
  'No se generó el cobro del mes siguiente: el cobro mensual de este cliente está desactivado.',
  'El cobro de diciembre 2026 ya existía, así que no se creó otro.',
  'El cobro del mes siguiente ya existía, así que no se creó otro.',
  null, null,
])
igual('resumenPeriodos: sin repetir y del más viejo al más nuevo, con un tope y "y N más"', [
  resumenPeriodos(['2026-09', '2026-08']), resumenPeriodos(['2026-08', '2026-08']), resumenPeriodos(['2026-11', '2026-08', '2026-09', '2026-10', '2026-07']), resumenPeriodos([]),
], ['Ago 2026, Sep 2026', 'Ago 2026', 'Jul 2026, Ago 2026, Sep 2026 y 2 más', ''])
igual('cobrosTexto: 1 cobro, 3 cobros, 0 cobros', [cobrosTexto(1), cobrosTexto(3), cobrosTexto(0)], ['1 cobro', '3 cobros', '0 cobros'])
// La hora de RD que dice el servidor, avanzada con el reloj del navegador desde que se leyó.
igual('relojDeServidor: la hora del servidor más el tiempo que pasó (cruza la medianoche)', relojDeServidor('2026-11-16 23:59:30', 1000, 46_000), { hoy: '2026-11-17', ahora: '2026-11-17 00:00:15' })
igual('relojDeServidor: cruza el fin de año', relojDeServidor('2026-12-31 23:59:59', 0, 2000), { hoy: '2027-01-01', ahora: '2027-01-01 00:00:01' })
chk('relojDeServidor: sin tiempo transcurrido es la misma hora, y un reloj que va hacia atrás no la resta', relojDeServidor('2026-11-16 10:00:00', 5000, 5000)?.ahora === '2026-11-16 10:00:00'
  && relojDeServidor('2026-11-16 10:00:00', 5000, 1000)?.ahora === '2026-11-16 10:00:00')
chk('relojDeServidor: lo que no es fecha y hora da null (se usa el reloj del navegador)', relojDeServidor('mañana', 0, 0) === null && relojDeServidor('', 0, 0) === null && relojDeServidor('2026-13-45 99:99:99', 0, 0) === null)
const claves = new Set(Array.from({ length: 200 }, () => nuevaClave()))
chk('nuevaClave: UUID v4 válido y distinto cada vez', claves.size === 200 && [...claves].every((c) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(c)))

// ---------------------------------------------------------------------------
console.log('\n6. Store de interfaz (Zustand)')
// El store de sesión persiste en localStorage: en Node no existe, así que se le da uno en memoria ANTES de importarlo.
const memoria = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => memoria.get(k) ?? null, setItem: (k: string, v: string) => void memoria.set(k, v), removeItem: (k: string) => void memoria.delete(k) },
})
// Hay un store de interfaz por ámbito (empresa y tenants); esta parte prueba el de las empresas (el de la plataforma, test-cobros-tenants.ts).
const { cobrosUiEmpresa: useCobrosUi, FILTROS_VACIOS, hayFiltros, PAGE_SIZES, VENTANAS_RECORDATORIO } = await import('../src/features/cobros/store.ts')
const { useAuthStore } = await import('../src/stores/auth.ts')
const u = () => useCobrosUi.getState()
igual('estado inicial: pestaña cobros, sin filtros, página 1, tamaño 10, sin panel ni modal, ventana de recordatorios de 7 días, panel en el historial',
  [u().tab, u().filtros, u().page, u().pageSize, u().panelClienteId, u().modal, u().recordatoriosDias, u().panelPestana], ['cobros', FILTROS_VACIOS, 1, 10, null, null, 7, 'historial'])
u().setPage(4)
u().setFiltros({ estado: 'Vencido' })
igual('cambiar un filtro vuelve a la página 1 y conserva los demás', [u().page, u().filtros.estado, u().filtros.query], [1, 'Vencido', ''])
chk('hayFiltros: false sin filtros, true con uno', !hayFiltros(FILTROS_VACIOS) && hayFiltros(u().filtros) && hayFiltros({ ...FILTROS_VACIOS, clientId: 5 }) && hayFiltros({ ...FILTROS_VACIOS, venceHasta: '2026-12-01' }))
u().setPage(3)
u().setPageSize(25)
igual('cambiar el tamaño de página vuelve a la 1', [u().page, u().pageSize], [1, 25])
u().setFiltros({ clientId: 7, clienteNombre: 'Golf SA', periodo: '2026-11' })
u().limpiarFiltros()
igual('limpiar filtros los deja vacíos y en la página 1', [u().filtros, u().page], [FILTROS_VACIOS, 1])
u().abrirPanel(9)
u().abrirModal({ tipo: 'pago', cobroId: 3 })
u().setTab('recordatorios')
igual('panel, modal y pestaña se guardan', [u().panelClienteId, u().modal, u().tab], [9, { tipo: 'pago', cobroId: 3 }, 'recordatorios'])
u().cerrarModal()
u().cerrarPanel()
igual('cerrar el modal y el panel', [u().panelClienteId, u().modal], [null, null])
chk('el tamaño de página inicial es el primero de los ofrecidos', PAGE_SIZES[0] === 10)
chk('la ventana de recordatorios por defecto es la primera de las ofrecidas (la del servidor: 7 días)', VENTANAS_RECORDATORIO[0] === 7 && VENTANAS_RECORDATORIO.includes(30))
u().abrirPanel(5, 'config')
igual('abrirPanel con pestaña abre el panel en la de configuración (Cobro mensual de un cliente)', [u().panelClienteId, u().panelPestana], [5, 'config'])
u().abrirPanel(6)
igual('abrirPanel sin pestaña vuelve al historial', [u().panelClienteId, u().panelPestana], [6, 'historial'])
u().cerrarPanel()
const modalA = { tipo: 'pago', cobroId: 1 } as const
const modalB = { tipo: 'cancelar', cobroId: 2 } as const
u().abrirModal(modalA)
u().abrirModal(modalB)
u().cerrarModal(modalA)
chk('cerrarModal(modal) cierra SOLO si ese sigue abierto: un formulario que termina tarde no cierra otro que se abrió después', u().modal === modalB)
u().cerrarModal(modalB)
chk('...y cierra el suyo', u().modal === null)
u().abrirModal(modalA)
u().cerrarModal()
chk('cerrarModal() sin argumento cierra el que haya', u().modal === null)
u().setRecordatoriosDias(30)
chk('la ventana de recordatorios vive en el store (la usan la sección y el contador de la pestaña)', u().recordatoriosDias === 30)
u().abrirPanel(12)
u().setFiltros({ clientId: 12, clienteNombre: 'Cliente de la empresa anterior' })
useAuthStore.getState().setSession('token-de-otra-empresa', { id: 1, email: 'a@x.do', username: 'a', name: 'A', role: 'admin', permissions: ['*'] })
igual('al cambiar de sesión (otra empresa, otro usuario) el panel y los filtros de la anterior se borran: sus ids no valen en la nueva',
  [u().panelClienteId, u().filtros, u().modal, u().tab, u().recordatoriosDias, u().panelPestana], [null, FILTROS_VACIOS, null, 'cobros', 7, 'historial'])
u().abrirPanel(33)
useAuthStore.getState().clearSession()
chk('al cerrar sesión también se reinicia', u().panelClienteId === null)

// ---------------------------------------------------------------------------
console.log('\n7. Navegación, permiso y caché')
const ventas = NAV.find((g) => g.group === 'Ventas')?.items ?? []
const clientes = ventas.findIndex((i) => i.id === 'clientes')
chk('el menú tiene Cobros en Ventas, justo después de Clientes, con el módulo "cobros"', ventas[clientes + 1]?.id === 'cobros' && ventas[clientes + 1].module === 'cobros' && ventas[clientes + 1].icon === 'wallet' && ventas[clientes + 1].label === 'Cobros')
chk('el catálogo de módulos de la web trae "cobros" (espejo del API) y su vista tiene título', MODULE_CATALOG.some((m) => m.id === 'cobros' && m.label === 'Cobros') && TITLES.cobros === 'Cobros')
chk('la vista cobros hereda su módulo y es su propio item del menú', navModuleFor('cobros' as ViewId) === 'cobros' && navTopFor('cobros') === 'cobros')
const conCobros = { role: 'user', permissions: ['facturas', 'cobros'] }
const sinCobros = { role: 'user', permissions: ['facturas'] }
chk('quien tiene el módulo ve Cobros; quien no, no; admin (*) sí; una sesión previa a RBAC (sin lista) sí',
  puedeVerVista(conCobros, 'cobros') && !puedeVerVista(sinCobros, 'cobros') && puedeVerVista({ role: 'admin', permissions: ['*'] }, 'cobros') && puedeVerVista({ role: 'user' }, 'cobros'))
chk('puedeVerItem con el item del menú da lo mismo', puedeVerItem(conCobros, ventas[clientes + 1]) && !puedeVerItem(sinCobros, ventas[clientes + 1]))
chk('isClienteCobrosRef: solo { kind: "cliente-cobros", clientId entero positivo }', isClienteCobrosRef({ kind: 'cliente-cobros', clientId: 5 }) && !isClienteCobrosRef({ kind: 'cliente-cobros', clientId: 0 })
  && !isClienteCobrosRef({ kind: 'cliente-cobros', clientId: '5' }) && !isClienteCobrosRef({ kind: 'nuevo' }) && !isClienteCobrosRef(null))
chk('mismoDestino: el mismo cliente en Cobros es el mismo destino; otro cliente, no', mismoDestino('cobros', { kind: 'cliente-cobros', clientId: 5 }, 'cobros', { kind: 'cliente-cobros', clientId: 5 })
  && !mismoDestino('cobros', { kind: 'cliente-cobros', clientId: 5 }, 'cobros', { kind: 'cliente-cobros', clientId: 6 }))
chk('la caché de cobros es volátil (otro usuario cobra; el estado cambia con la fecha)', staleTimeFor(['cobros', 'lista', {}]) === FRESCURA.VOLATIL)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
