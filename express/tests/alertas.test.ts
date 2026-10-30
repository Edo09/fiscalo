// lib/alertas: lo que Facturas cuenta de un vistazo sin pedir nada más que las estadísticas y los avisos: los dos tiles (Hoy y Este mes), los avisos
// (por revisar, sin confirmar, en proceso y la numeración), la insignia de la barra y el punto de Más. Todo son funciones puras: «hoy» se pasa, así que
// el resultado no depende de la zona del teléfono (Review Focus 5), y todo lo que llega del API entra como `unknown`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { conZona } from './ayudas'
import { badgeFacturas, calcularAlertas, contarEnProceso, contarPorRevisar, puntoMas, tilesDe } from '~/lib/alertas'
import type { Alerta } from '~/lib/alertas'
import { parseHash } from '~/router'
import { ICONOS } from '~/ui/iconos'

// --- Los tiles ----------------------------------------------------------------------------------------------------------------------------

test('tile Hoy a las 23:30', () => {
  // Review Focus 5
  const s = {
    ventas_por_dia: [
      { dia: '2026-10-27', total: 2, monto_total: '23600.00' },
      { dia: '2026-10-28', total: 9, monto_total: '1.00' },
    ],
    ventas_por_mes: [{ mes: '2026-10', total: 17, monto_total: 184250 }],
  }
  assert.deepEqual(tilesDe(s, '2026-10-27').hoy, { monto: 'RD$ 23,600', cantidad: '2 facturas' })
  assert.equal(tilesDe(s, '2026-10-27').mes?.cantidad, '17 facturas')
  assert.deepEqual(tilesDe(s, '2026-10-29').hoy, { monto: 'RD$ 0', cantidad: '0 facturas' })
  assert.equal(tilesDe({}, '2026-10-27').hoy, null)
})

test('tilesDe: sin fila es cero, sin la lista no se dibuja, y cada tile depende solo de su lista', () => {
  const dia = { ventas_por_dia: [{ dia: '2026-10-27', total: 1, monto_total: '100.00' }] }
  const mes = { ventas_por_mes: [{ mes: '2026-10', total: 4, monto_total: '1500.40' }] }
  // La lista está y no trae la fila: el día o el mes todavía no vendió, y eso es RD$ 0 (no un tile escondido).
  assert.deepEqual(tilesDe({ ...dia, ventas_por_mes: [] }, '2026-10-27'), { hoy: { monto: 'RD$ 100', cantidad: '1 factura' }, mes: { monto: 'RD$ 0', cantidad: '0 facturas' } })
  // Una lista ausente esconde su tile y deja el otro.
  assert.deepEqual(tilesDe(dia, '2026-10-27'), { hoy: { monto: 'RD$ 100', cantidad: '1 factura' }, mes: null })
  assert.deepEqual(tilesDe(mes, '2026-10-27'), { hoy: null, mes: { monto: 'RD$ 1,500', cantidad: '4 facturas' } })
  // El mes se busca por los siete primeros caracteres de «hoy»: el primero de noviembre todavía no tiene fila de noviembre.
  assert.deepEqual(tilesDe(mes, '2026-11-01').mes, { monto: 'RD$ 0', cantidad: '0 facturas' })
  // Neto de notas de crédito: si restan más de lo que se vendió, el monto sale negativo y con el signo antes de la moneda.
  assert.equal(tilesDe({ ventas_por_dia: [{ dia: '2026-10-27', total: 1, monto_total: '-1200.00' }] }, '2026-10-27').hoy?.monto, '-RD$ 1,200')
})

test('tilesDe: lo que no es un objeto, una lista o una fila no lanza', () => {
  for (const malo of [null, undefined, 'x', 7, [], true]) assert.deepEqual(tilesDe(malo, '2026-10-27'), { hoy: null, mes: null })
  assert.deepEqual(tilesDe({ ventas_por_dia: 'x', ventas_por_mes: {} }, '2026-10-27'), { hoy: null, mes: null })
  const sucio = { ventas_por_dia: [null, 7, 'x', [], { dia: '2026-10-27', total: 'abc', monto_total: null }] }
  assert.deepEqual(tilesDe(sucio, '2026-10-27').hoy, { monto: 'RD$ 0', cantidad: '0 facturas' })
})

// --- Los avisos ---------------------------------------------------------------------------------------------------------------------------

const E = { tipos_ecf: ['45', '34'], tenant: { ambiente: 'ecf' } } as any
const PE = (o: Record<string, number>) => Object.entries(o).map(([estado, total]) => ({ estado, total }))
const SEC = (type: string, restantes: number | null, vencimiento: string | null = null) => ({ type, total_emitidos: 5, restantes, vencimiento })
const calc = (stats: object, avisos: object = {}, admin = true) => calcularAlertas({ stats, avisos, entitlements: E, admin, hoy: '2026-10-27' })
const dos = (a: Alerta) => [a.texto, a.tono]

test('alertas: textos, tonos y destinos', () => {
  const NUM = '#/mas/numeracion'
  assert.deepEqual(
    calc({ por_estado: PE({ RECHAZADO: 1 }) }).visibles.map((a) => [a.texto, a.tono, a.hash]),
    [['1 factura por revisar', 'danger', '#/facturas?estado=accion']],
  )
  assert.equal(
    calc({ por_estado: PE({ RECHAZADO: 1, RFCE_RECHAZADO: 1, NO_ENCONTRADO: 1, RFCE_NO_ENCONTRADO: 1, ERROR: 1, RFCE_ERROR: 1, RECHAZADO_ARCHIVADO: 9, ACEPTADO: 4 }) }).visibles[0].texto,
    '6 facturas por revisar',
  ) // los archivados no cuentan
  assert.deepEqual(
    calc({ secuencias: [SEC('E45', 0)] }).visibles.map((a) => [a.texto, a.tono, a.hash]),
    [['E45: sin números disponibles', 'danger', NUM]],
  )
  assert.equal(calc({ secuencias: [SEC('E45', null)] }).visibles[0].texto, 'E45: sin numeración autorizada')
  assert.deepEqual(dos(calc({ por_estado: PE({ PENDIENTE_ENVIO: 1, ENVIO_INCIERTO: 1, ENVIADO: 4 }) }).visibles[0]), ['2 sin confirmar. Ver', 'warning']) // solo esos dos estados
  assert.deepEqual(dos(calc({ por_estado: PE({ ENVIADO: 2, EN_PROCESO: 1 }) }).visibles[0]), ['3 en proceso con la DGII', 'info'])
  assert.deepEqual(
    [23, 1].map((n) => calc({ secuencias: [SEC('E45', n)] }).visibles[0].texto),
    ['E45: quedan 23 números', 'E45: queda 1 número'],
  )
  for (const [venc, texto, tono] of [
    ['2026-11-08', 'E45: el rango vence en 12 días', 'warning'],
    ['2026-10-30', 'E45: el rango vence en 3 días', 'danger'],
    ['2026-10-28', 'E45: el rango vence mañana', 'danger'],
    ['2026-10-27', 'E45: el rango vence hoy', 'danger'],
  ]) {
    assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, venc)] }).visibles[0]), [texto, tono], venc)
  }
  assert.equal(calc({ secuencias: [SEC('E41', 0)] }).visibles.length, 0) // un tipo fuera de tipos_ecf se ignora
  assert.equal(calc({ secuencias: [SEC('E45', 0)] }, {}, false).visibles[0].texto, 'E45: sin números disponibles Avisa al administrador.')
  assert.equal(calc({ por_estado: PE({ RECHAZADO: 1 }) }, {}, false).visibles[0].texto, '1 factura por revisar') // el sufijo es solo de numeracion
  assert.equal(
    calc({ secuencias: [] }, { secuencias: [{ tipo: 'E45', ambiente: 'ecf', restantes: 0, estado: 'agotada' }] }).visibles[0].texto,
    'E45: sin números disponibles',
  ) // avisos solo rellena un tipo sin fila en stats
})

test('alertas: «sin confirmar» son exactamente los dos estados en vuelo: ni lo enviado ni las filas viejas que quedaron en PENDIENTE', () => {
  // PENDIENTE es el valor por defecto de las filas viejas: nunca va a cambiar, y avisarlo dejaría el aviso (y la insignia) encendidos para siempre.
  assert.deepEqual(calc({ por_estado: PE({ PENDIENTE: 4, ACEPTADO: 1 }) }).visibles, [])
  assert.equal(calc({ por_estado: PE({ PENDIENTE: 4, PENDIENTE_ENVIO: 1 }) }).visibles[0].texto, '1 sin confirmar. Ver')
  assert.equal(calc({ por_estado: PE({ ENVIO_INCIERTO: 1 }) }).visibles[0].texto, '1 sin confirmar. Ver')
  assert.deepEqual(calc({ por_estado: PE({ ENVIADO: 4 }) }).visibles.map((a) => a.clave), ['enProceso'])
})

test('alertas: orden y tope de dos', () => {
  const r = calc({ por_estado: PE({ PENDIENTE_ENVIO: 1, ENVIADO: 1 }), secuencias: [SEC('E34', 23), SEC('E45', 10, '2026-10-30')] })
  assert.deepEqual(r.visibles.map((a) => a.clave), ['num-45', 'sinConfirmar'])
  assert.equal(r.extra, 2) // el vence pronto en danger sube; quedan enProceso y num-34
})

test('alertas: el orden completo, par por par y sin importar el orden en que llegan los datos', () => {
  // Por revisar; la numeración en danger (agotada, sin rango, vence pronto); sin confirmar; en proceso; pocos; por vencer. Un tipo de numeración por estado.
  const ORDEN = ['porRevisar', 'num-31', 'num-32', 'num-33', 'sinConfirmar', 'enProceso', 'num-34', 'num-45']
  const piezas: Record<string, { estados?: Record<string, number>; fila?: object }> = {
    porRevisar: { estados: { RECHAZADO: 1 } },
    'num-31': { fila: SEC('E31', 0) }, // agotada
    'num-32': { fila: SEC('E32', null) }, // sin rango
    'num-33': { fila: SEC('E33', 100, '2026-10-30') }, // vence pronto
    sinConfirmar: { estados: { PENDIENTE_ENVIO: 1 } },
    enProceso: { estados: { ENVIADO: 1 } },
    'num-34': { fila: SEC('E34', 23) }, // pocos
    'num-45': { fila: SEC('E45', 100, '2026-11-08') }, // por vencer
  }
  const todos = { tipos_ecf: ['31', '32', '33', '34', '45'], tenant: { ambiente: 'ecf' } } as any
  const unir = (nombres: string[]) => ({
    por_estado: PE(Object.assign({}, ...nombres.map((n) => piezas[n].estados ?? {}))),
    secuencias: nombres.flatMap((n) => (piezas[n].fila === undefined ? [] : [piezas[n].fila])),
  })
  const verlas = (nombres: string[]) => calcularAlertas({ stats: unir(nombres), avisos: {}, entitlements: todos, admin: true, hoy: '2026-10-27' })
  // Cada pieza produce el aviso que dice su nombre.
  for (const n of ORDEN) assert.deepEqual(verlas([n]).visibles.map((a) => a.clave), [n], n)
  for (let i = 0; i < ORDEN.length; i++) {
    for (let j = i + 1; j < ORDEN.length; j++) {
      const esperado = [ORDEN[i], ORDEN[j]]
      assert.deepEqual(verlas(esperado).visibles.map((a) => a.clave), esperado, `${ORDEN[i]} antes de ${ORDEN[j]}`)
      assert.deepEqual(verlas([ORDEN[j], ORDEN[i]]).visibles.map((a) => a.clave), esperado, `${ORDEN[i]} antes de ${ORDEN[j]} (al revés)`)
    }
  }
  const completo = verlas(ORDEN)
  assert.deepEqual(completo.visibles.map((a) => a.clave), ['porRevisar', 'num-31'])
  assert.equal(completo.extra, 6)
})

test('alertas: los límites de la numeración, con y sin vencimiento', () => {
  // 50 números es pocos y 51 no; 7 días es vence pronto (danger) y 8 es por vencer (warning); 30 días es por vencer y 31 no avisa.
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 50)] }).visibles[0]), ['E45: quedan 50 números', 'warning'])
  assert.equal(calc({ secuencias: [SEC('E45', 51)] }).visibles.length, 0)
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, '2026-11-03')] }).visibles[0]), ['E45: el rango vence en 7 días', 'danger'])
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, '2026-11-04')] }).visibles[0]), ['E45: el rango vence en 8 días', 'warning'])
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, '2026-11-26')] }).visibles[0]), ['E45: el rango vence en 30 días', 'warning'])
  assert.equal(calc({ secuencias: [SEC('E45', 100, '2026-11-27')] }).visibles.length, 0)
  // Con pocos números y el rango por vencer manda el primero que coincide (pocos): un tipo es un aviso, no dos.
  assert.deepEqual(calc({ secuencias: [SEC('E45', 10, '2026-11-20')] }).visibles.map((a) => a.texto), ['E45: quedan 10 números'])
  // Un vencimiento que ya pasó sigue siendo vence pronto: la numeración sigue sin servir.
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, '2026-10-26')] }).visibles[0]), ['E45: el rango venció ayer', 'danger'])
  assert.deepEqual(dos(calc({ secuencias: [SEC('E45', 100, '2026-10-20')] }).visibles[0]), ['E45: el rango venció hace 7 días', 'danger'])
  // PDO manda los números como texto.
  assert.equal(calc({ secuencias: [{ type: 'E45', total_emitidos: '5', restantes: '23', vencimiento: null }] }).visibles[0].texto, 'E45: quedan 23 números')
  // Sin vencimiento legible (vacío, no es una fecha, el 0000-00-00 de MySQL) las reglas de fecha no coinciden.
  for (const venc of ['', 'pronto', '0000-00-00', '2026-02-30']) assert.equal(calc({ secuencias: [SEC('E45', 100, venc)] }).visibles.length, 0, venc)
  // Cero números con cero emitidos no es agotada (la regla de lib/numeracion): sigue de largo hasta «pocos», y sin número que decir se dice «pocos».
  assert.equal(calc({ secuencias: [{ type: 'E45', total_emitidos: 0, restantes: 0, vencimiento: null }] }).visibles[0].texto, 'E45: quedan pocos números')
})

test('alertas: sin límite (pruebas y certificación) no es un problema, y el resto de los estados se avisan igual', () => {
  for (const ambiente of ['testecf', 'certecf']) {
    const pruebas = (stats: object) => calcularAlertas({ stats, avisos: {}, entitlements: { ...E, tenant: { ambiente } }, admin: true, hoy: '2026-10-27' }).visibles
    assert.deepEqual(pruebas({ secuencias: [SEC('E45', null)] }), [], ambiente)
    assert.equal(pruebas({ secuencias: [SEC('E45', 0)] })[0].texto, 'E45: sin números disponibles', ambiente)
  }
  assert.equal(calc({ secuencias: [SEC('E45', null)] }).visibles.length, 1) // en producción sí: sin numeración autorizada
})

test('alertas: el sufijo para quien no administra va en todos los avisos de numeración y en ningún otro', () => {
  const sufijo = ' Avisa al administrador.'
  const mixto = { por_estado: PE({ RECHAZADO: 1 }), secuencias: [SEC('E45', 0)] }
  assert.deepEqual(calc(mixto, {}, false).visibles.map((a) => a.texto), ['1 factura por revisar', 'E45: sin números disponibles' + sufijo])
  assert.deepEqual(calc(mixto, {}, true).visibles.map((a) => a.texto), ['1 factura por revisar', 'E45: sin números disponibles'])
  // Cada estado de la numeración lleva el sufijo; los avisos de facturas, ninguno.
  assert.equal(calc({ secuencias: [SEC('E45', null)] }, {}, false).visibles[0].texto, 'E45: sin numeración autorizada' + sufijo)
  assert.equal(calc({ secuencias: [SEC('E34', 23)] }, {}, false).visibles[0].texto, 'E34: quedan 23 números' + sufijo)
  assert.equal(calc({ secuencias: [SEC('E45', 100, '2026-10-30')] }, {}, false).visibles[0].texto, 'E45: el rango vence en 3 días' + sufijo)
  assert.equal(calc({ secuencias: [SEC('E45', 100, '2026-11-08')] }, {}, false).visibles[0].texto, 'E45: el rango vence en 12 días' + sufijo)
  assert.equal(calc({}, { secuencias: [{ tipo: 'E45', ambiente: 'ecf', restantes: 23, estado: 'pocos' }] }, false).visibles[0].texto, 'E45: quedan 23 números' + sufijo)
  assert.equal(calc({ por_estado: PE({ PENDIENTE_ENVIO: 1 }) }, {}, false).visibles[0].texto, '1 sin confirmar. Ver')
  assert.equal(calc({ por_estado: PE({ ENVIADO: 1 }) }, {}, false).visibles[0].texto, '1 en proceso con la DGII')
})

test('alertas: avisos solo rellena un tipo que no tiene fila en stats, y nunca uno de otro tipo de comprobante', () => {
  const agotada = { tipo: 'E45', ambiente: 'ecf', restantes: 0, estado: 'agotada' }
  // Una fila de stats manda aunque diga «vigente»: lo de avisos no la contradice.
  assert.equal(calc({ secuencias: [SEC('E45', 312)] }, { secuencias: [agotada] }).visibles.length, 0)
  // Sin fila, avisos pone su estado: agotada (sin números) o pocos (con su `restantes`).
  assert.deepEqual(dos(calc({}, { secuencias: [agotada] }).visibles[0]), ['E45: sin números disponibles', 'danger'])
  assert.deepEqual(dos(calc({}, { secuencias: [{ tipo: 'E45', ambiente: 'ecf', restantes: 23, estado: 'pocos' }] }).visibles[0]), ['E45: quedan 23 números', 'warning'])
  assert.equal(calc({}, { secuencias: [{ tipo: 'E45', ambiente: 'ecf', restantes: 1, estado: 'pocos' }] }).visibles[0].texto, 'E45: queda 1 número')
  assert.equal(calc({}, { secuencias: [{ tipo: 'E45', ambiente: 'ecf', restantes: null, estado: 'pocos' }] }).visibles[0].texto, 'E45: quedan pocos números')
  // Un tipo fuera de tipos_ecf, un estado que no es de aviso y una fila repetida no cuentan o cuentan una vez.
  assert.equal(calc({}, { secuencias: [{ ...agotada, tipo: 'E41' }] }).visibles.length, 0)
  assert.equal(calc({}, { secuencias: [{ ...agotada, estado: 'vigente' }] }).visibles.length, 0)
  assert.equal(calc({}, { secuencias: [agotada, agotada] }).visibles.length, 1)
  // Cada tipo sin fila aporta su aviso; el que tiene fila, el suyo.
  const r = calc({ secuencias: [SEC('E34', 23)] }, { secuencias: [agotada, { tipo: 'E34', ambiente: 'ecf', restantes: 0, estado: 'agotada' }] })
  assert.deepEqual(r.visibles.map((a) => [a.clave, a.texto]), [['num-45', 'E45: sin números disponibles'], ['num-34', 'E34: quedan 23 números']])
})

test('alertas: una fila repetida de un tipo da un solo aviso, para que la clave sea única', () => {
  const r = calc({ secuencias: [SEC('E45', 0), SEC('E45', 0), SEC('e45', 23)] })
  assert.deepEqual(r.visibles.map((a) => a.clave), ['num-45'])
  assert.equal(r.extra, 0)
})

test('alertas: lo que llega del API a medias no tira la pantalla: lo que no es una fila no cuenta', () => {
  const sucio = {
    por_estado: [null, 5, 'RECHAZADO', [], { estado: 7, total: 3 }, { total: 4 }, { estado: 'RECHAZADO', total: '2' }, { estado: 'ERROR', total: 'abc' }],
    secuencias: [null, 'E45', { type: 7 }, {}, { type: '' }, SEC('E45', 0)],
  }
  assert.deepEqual(calc(sucio, { secuencias: [null, 3, { tipo: 5 }, {}] }).visibles.map((a) => a.texto), ['2 facturas por revisar', 'E45: sin números disponibles'])
  for (const malo of [null, undefined, 'x', 7, [], { por_estado: 'x', secuencias: {} }]) assert.deepEqual(calc(malo as any, malo as any), { visibles: [], extra: 0 })
})

test('alertas: los destinos son rutas que entiende el router y los iconos son de los que se dibujan', () => {
  const stats = { por_estado: PE({ RECHAZADO: 1, PENDIENTE_ENVIO: 1, ENVIADO: 1 }), secuencias: [SEC('E45', 0), SEC('E34', 23)] }
  const todas = [
    ...calc(stats).visibles,
    ...calc({ por_estado: PE({ ENVIADO: 1 }) }).visibles,
    ...calc({ por_estado: PE({ PENDIENTE_ENVIO: 1 }) }).visibles,
    ...calc({ secuencias: [SEC('E34', 23)] }).visibles,
  ]
  assert.deepEqual(parseHash(calc({ por_estado: PE({ RECHAZADO: 1 }) }).visibles[0].hash), { id: 'facturas', estado: 'accion' })
  assert.deepEqual(parseHash(calc({ por_estado: PE({ PENDIENTE_ENVIO: 1 }) }).visibles[0].hash), { id: 'facturas', estado: 'pendiente' })
  assert.deepEqual(parseHash(calc({ por_estado: PE({ ENVIADO: 1 }) }).visibles[0].hash), { id: 'facturas', estado: 'pendiente' })
  assert.deepEqual(parseHash(calc({ secuencias: [SEC('E45', 0)] }).visibles[0].hash), { id: 'mas-numeracion' })
  for (const a of todas) {
    assert.ok(a.icono in ICONOS, `${a.clave}: ${a.icono} no es un icono de ui/iconos`)
    assert.match(a.hash, /^#\//)
    assert.ok(['danger', 'warning', 'info'].includes(a.tono), a.clave)
    assert.ok(a.texto.length > 0)
  }
})

test('tilesDe y calcularAlertas no dependen de la zona del teléfono', () => {
  // Review Focus 5: «hoy» es un dato que se pasa, y los días se cuentan sobre el calendario. Si alguien lee `new Date()` aquí, esto cambia con la zona.
  const stats = {
    ventas_por_dia: [{ dia: '2026-10-27', total: 2, monto_total: '23600.00' }],
    ventas_por_mes: [{ mes: '2026-10', total: 17, monto_total: 184250 }],
    por_estado: PE({ RECHAZADO: 1 }),
    secuencias: [SEC('E45', 100, '2026-10-30')],
  }
  const lectura = () => JSON.stringify([tilesDe(stats, '2026-10-27'), calc(stats)])
  const referencia = lectura()
  for (const zona of ['America/Santo_Domingo', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    conZona(zona, () => assert.equal(lectura(), referencia, zona))
  }
})

// --- La insignia de Facturas y el punto de Más ----------------------------------------------------------------------------------------------

test('badge de Facturas y punto de Mas', () => {
  const b = (o: Record<string, number>) => badgeFacturas(PE(o))
  assert.deepEqual(b({ RECHAZADO: 2 }), { n: 2, texto: '2', tono: 'danger', etiqueta: 'Facturas, 2 con alertas' })
  assert.equal(b({ ENVIO_INCIERTO: 1 })?.tono, 'danger')
  assert.equal(b({ ENVIADO: 3 })?.tono, 'info')
  assert.equal(b({ RECHAZADO: 10 })?.texto, '9+')
  assert.equal(b({ ACEPTADO: 5, RECHAZADO_ARCHIVADO: 2 }), null)
  const num = [{ clave: 'num-45', tono: 'danger', icono: 'circle-alert', texto: 'x', hash: '#/mas/numeracion' }] as any
  assert.equal(puntoMas({ alertas: num, versionNueva: false, admin: true }), true)
  assert.equal(puntoMas({ alertas: num, versionNueva: false, admin: false }), false)
  assert.equal(puntoMas({ alertas: [], versionNueva: true, admin: false }), true)
  assert.equal(puntoMas({ alertas: [], versionNueva: false, admin: true, certificadoMalo: true }), true)
})

test('badge: cuenta lo que tiene un aviso (por revisar, sin confirmar y en proceso), manda el más urgente y dice 9+ desde diez', () => {
  const b = (o: Record<string, number>) => badgeFacturas(PE(o))
  assert.deepEqual(b({ RECHAZADO: 1, PENDIENTE_ENVIO: 1, ENVIADO: 3, ACEPTADO: 40 }), { n: 5, texto: '5', tono: 'danger', etiqueta: 'Facturas, 5 con alertas' })
  assert.deepEqual(b({ ENVIADO: 2, EN_PROCESO: 1, RFCE_ENVIADO: 1, RFCE_EN_PROCESO: 1 }), { n: 5, texto: '5', tono: 'info', etiqueta: 'Facturas, 5 con alertas' })
  // El tono es el del aviso más urgente aunque lo en proceso sea más: por revisar y sin confirmar mandan.
  assert.equal(b({ RECHAZADO: 1, ENVIADO: 30 })?.tono, 'danger')
  assert.equal(b({ NO_ENCONTRADO: 1 })?.tono, 'danger')
  assert.equal(b({ RFCE_ERROR: 1 })?.tono, 'danger')
  // El número y el texto: 9 se ve como 9, 10 y más como 9+, y `n` sigue siendo la cuenta de verdad.
  assert.deepEqual(b({ RECHAZADO: 9 }), { n: 9, texto: '9', tono: 'danger', etiqueta: 'Facturas, 9 con alertas' })
  assert.deepEqual(b({ RECHAZADO: 10 }), { n: 10, texto: '9+', tono: 'danger', etiqueta: 'Facturas, 10 con alertas' })
  assert.deepEqual(b({ RECHAZADO: 120 }), { n: 120, texto: '9+', tono: 'danger', etiqueta: 'Facturas, 120 con alertas' })
  // Una sola factura: «1 con alerta», en singular.
  assert.equal(b({ RECHAZADO: 1 })?.etiqueta, 'Facturas, 1 con alerta')
  // Nada que avisar: ni aceptadas, ni archivadas, ni reemplazadas, ni las filas viejas que quedaron en PENDIENTE (no están en vuelo: no se avisan).
  assert.equal(b({ ACEPTADO: 5, RFCE_ACEPTADO: 2, ACEPTADO_CONDICIONAL: 1, PENDIENTE: 4, RECHAZADO_ARCHIVADO: 2, RFCE_RECHAZADO_ARCHI: 1 }), null)
  assert.equal(b({}), null)
  assert.equal(badgeFacturas(undefined), null)
  assert.equal(badgeFacturas('x'), null)
})

test('el badge cuenta lo mismo que dicen los avisos: la suma de los tres números que se leen en ellos', () => {
  // Cada aviso se lee solo (con la numeración quieta el primero visible es el suyo) y el badge es la suma de lo que dicen.
  const solo = (o: Record<string, number>) => calc({ por_estado: PE(o) }).visibles[0].texto
  assert.equal(solo({ RECHAZADO: 2, NO_ENCONTRADO: 1, ACEPTADO: 9 }), '3 facturas por revisar')
  assert.equal(solo({ PENDIENTE_ENVIO: 1, ENVIO_INCIERTO: 2, ACEPTADO: 9 }), '3 sin confirmar. Ver')
  assert.equal(solo({ ENVIADO: 3, EN_PROCESO: 1, ACEPTADO: 9 }), '4 en proceso con la DGII')
  const todo = { RECHAZADO: 2, NO_ENCONTRADO: 1, PENDIENTE_ENVIO: 1, ENVIO_INCIERTO: 2, ENVIADO: 3, EN_PROCESO: 1, ACEPTADO: 9 }
  assert.equal(badgeFacturas(PE(todo))?.n, 3 + 3 + 4)
})

test('contarPorRevisar y contarEnProceso: por el bucket de cada estado, sin archivados, y toleran lo que no es una lista', () => {
  const por = PE({ RECHAZADO: 1, RFCE_RECHAZADO: 2, NO_ENCONTRADO: 3, RFCE_NO_ENCONTRADO: 4, ERROR: 5, RFCE_ERROR: 6, RECHAZADO_ARCHIVADO: 7, ENVIADO: 8, EN_PROCESO: 9, RFCE_ENVIADO: 10, RFCE_EN_PROCESO: 11, ACEPTADO: 12, PENDIENTE_ENVIO: 13 })
  assert.equal(contarPorRevisar(por), 1 + 2 + 3 + 4 + 5 + 6)
  assert.equal(contarEnProceso(por), 8 + 9 + 10 + 11)
  // El API manda los totales como texto y un estado que no conoce no es ninguno de los dos.
  assert.equal(contarPorRevisar([{ estado: 'RECHAZADO', total: '4' }, { estado: 'rechazado', total: 9 }, { estado: 'OTRO', total: 5 }]), 4)
  assert.equal(contarEnProceso([{ estado: 'ENVIADO', total: '2' }, { estado: ' ENVIADO', total: 9 }]), 2)
  for (const malo of [undefined, null, 'x', 7, {}, [], [null, 3, 'x', { estado: 3, total: 1 }, { estado: 'RECHAZADO' }, { estado: 'RECHAZADO', total: -4 }]]) {
    assert.equal(contarPorRevisar(malo), 0)
    assert.equal(contarEnProceso(malo), 0)
  }
})

test('puntoMas: una versión nueva la ve cualquiera; la numeración y el certificado, solo el administrador', () => {
  const alerta = (clave: string) => ({ clave, tono: 'warning', icono: 'hash', texto: 'x', hash: '#/mas/numeracion' }) as any
  // Una versión nueva: para todos.
  for (const admin of [true, false]) assert.equal(puntoMas({ alertas: [], versionNueva: true, admin }), true)
  // Un aviso de numeración (clave num-): solo si administra, de cualquier tono.
  assert.equal(puntoMas({ alertas: [alerta('num-34')], versionNueva: false, admin: true }), true)
  assert.equal(puntoMas({ alertas: [alerta('num-34')], versionNueva: false, admin: false }), false)
  // Un aviso de facturas no pone punto en Más.
  assert.equal(puntoMas({ alertas: [alerta('porRevisar'), alerta('sinConfirmar'), alerta('enProceso')], versionNueva: false, admin: true }), false)
  assert.equal(puntoMas({ alertas: [alerta('porRevisar'), alerta('num-45')], versionNueva: false, admin: true }), true)
  // El certificado en mal estado: solo el administrador lo puede arreglar.
  assert.equal(puntoMas({ alertas: [], versionNueva: false, admin: true, certificadoMalo: true }), true)
  assert.equal(puntoMas({ alertas: [], versionNueva: false, admin: false, certificadoMalo: true }), false)
  assert.equal(puntoMas({ alertas: [], versionNueva: false, admin: true, certificadoMalo: false }), false)
  assert.equal(puntoMas({ alertas: [], versionNueva: false, admin: true }), false)
})
