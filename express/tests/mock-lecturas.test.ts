// Las lecturas del mock de Express (plan 06, tarea 7): el tenant sembrado de cada persona (dev/mock/datos.mjs), los manejadores puros
// que lo leen (dev/mock/lecturas.mjs) y su cableado en mock-api.mjs, que se prueba por HTTP contra un servidor en 127.0.0.1.
// `ahora` es siempre una hora local sin zona (`new Date('2026-10-27T10:00:00')`): las semillas usan el calendario local.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { avanzarEstado, sembrarTenant } from '../dev/mock/datos.mjs'
import { avisos, detalleFactura, emisor, estadisticas, estadoFactura, falloDeLectura, listarFacturas, pdfFactura } from '../dev/mock/lecturas.mjs'
import { PERSONAS, crearServidor, parseFaultTokens } from '../dev/mock-api.mjs'

// Las dos variables del mock que cambian respuestas se leen en cada petición: un valor puesto en el shell no puede mover estas pruebas.
delete process.env.MOCK_SLOW_MS
delete process.env.MOCK_SIN_ACCION

const AHORA = new Date('2026-10-27T10:00:00')
const t = sembrarTenant('admin.e45', AHORA)

const cuerpo = (r: { cuerpo?: unknown }): any => r.cuerpo
const q = (consulta = ''): URLSearchParams => new URLSearchParams(consulta)
const DOS_DECIMALES = /^-?\d+\.\d{2}$/
const MENSAJE_RECIBO = 'No se pudo preparar el recibo. Revisa el ancho de papel en Configuración → Impresora de recibos o imprime en hoja carta.'

test('lista: tipo, paginas, filtros', () => {
  const r = listarFacturas(t, new URLSearchParams('tipo_ecf=45&pageSize=15&page=1')).cuerpo as any
  assert.ok(r.data.length <= 15 && r.pagination.totalPages === Math.ceil(r.pagination.total / 15) && r.pagination.totalPages >= 2)
  const ESTADOS = (q: string) => new Set((listarFacturas(t, new URLSearchParams(q)).cuerpo as any).data.map((f: any) => f.estado_dgii))
  assert.deepEqual([...ESTADOS('estado=pendiente&pageSize=100')].sort(), ['ENVIADO', 'ENVIO_INCIERTO', 'EN_PROCESO', 'PENDIENTE_ENVIO'])
  assert.ok(![...ESTADOS('estado=accion&pageSize=100')].some((e) => String(e).endsWith('ARCHIVADO')))
  assert.equal(listarFacturas(t, new URLSearchParams('estado=zzz')).http, 422)
  assert.equal(listarFacturas(t, new URLSearchParams('estado=accion'), { sinAccion: true }).http, 422)
  assert.ok(ESTADOS('pageSize=100').has('RECHAZADO_ARCHIVADO') && !ESTADOS('pageSize=100&archivadas=0').has('RECHAZADO_ARCHIVADO'))
})

test('lista: estados, orden, lean, tipo, busqueda y paginas', () => {
  const filas = (consulta: string): any[] => cuerpo(listarFacturas(t, q(consulta))).data
  const estados = (consulta: string): string[] => [...new Set(filas(consulta).map((f) => f.estado_dgii as string))].sort()

  // el 422 de un estado desconocido lleva el texto del API y el sobre de error
  const malo = listarFacturas(t, q('estado=zzz'))
  assert.deepEqual([malo.http, cuerpo(malo).status, cuerpo(malo).error], [422, false, 'Ese filtro de estado no es válido. Elige otro en la lista.'])
  assert.equal(listarFacturas(t, q('estado=PENDIENTE')).http, 422, 'los estados van en minúsculas')

  assert.deepEqual(estados('estado=aprobado&pageSize=100'), ['ACEPTADO'])
  assert.deepEqual(estados('estado=rechazado&pageSize=100'), ['RECHAZADO'])
  assert.deepEqual(estados('estado=accion&pageSize=100'), ['ERROR', 'NO_ENCONTRADO', 'RECHAZADO'])
  assert.equal(listarFacturas(t, q('estado=accion'), { sinAccion: false }).http, 200)
  assert.equal(listarFacturas(t, q('estado=rechazado'), { sinAccion: true }).http, 200, 'sin `accion` el resto de filtros sigue igual')

  // lo más nuevo primero
  const ids = filas('pageSize=100').map((f) => f.id as number)
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a))
  assert.equal(new Set(ids).size, ids.length)

  // lean quita lo pesado y deja las notas
  const completa = filas('pageSize=5')[0]
  const lean = filas('pageSize=5&lean=1')[0]
  assert.ok('items' in completa && 'respuesta_dgii' in completa)
  assert.ok(!('items' in lean) && !('respuesta_dgii' in lean) && !('xml_firmado' in lean))
  assert.ok(Array.isArray(lean.notas) && 'modifica' in lean)

  // tipo_ecf se guarda sin la E, y la lista lo acepta con o sin ella
  assert.ok(filas('pageSize=100').every((f) => /^\d+$/.test(f.tipo_ecf)))
  assert.deepEqual(new Set(filas('tipo_ecf=34&pageSize=100').map((f) => f.tipo_ecf)), new Set(['34']))
  assert.deepEqual(filas('tipo_ecf=E45&pageSize=100').map((f) => f.id), filas('tipo_ecf=45&pageSize=100').map((f) => f.id))
  assert.equal(filas('tipo_ecf=31&pageSize=100').length, 0)

  // búsqueda: e-NCF, cliente sin acentos ni mayúsculas, RNC del cliente (que la fila de lista no trae) y descripción de línea
  const aceptadaHoy = t.facturas.find((f) => f.estado_dgii === 'ACEPTADO' && f.client_name === 'Min. de Obras Públicas' && f.date.startsWith('2026-10-27'))!
  assert.deepEqual(filas(`query=${aceptadaHoy.e_ncf}`).map((f) => f.id), [aceptadaHoy.id])
  assert.ok(filas('query=obras%20publicas&pageSize=100').every((f) => f.client_name === 'Min. de Obras Públicas'))
  assert.ok(filas('query=obras%20publicas&pageSize=100').some((f) => f.id === aceptadaHoy.id))
  assert.ok(filas('query=401123456&pageSize=100').some((f) => f.id === aceptadaHoy.id))
  assert.ok(!('rnc' in aceptadaHoy) && filas('query=401123456').every((f) => !('cliente' in f)))
  assert.ok(filas('query=materiales%20de%20construccion&pageSize=100').some((f) => f.id === aceptadaHoy.id))
  const sinCoincidencias = cuerpo(listarFacturas(t, q('query=zzzzzz')))
  assert.deepEqual([sinCoincidencias.data, sinCoincidencias.pagination.total, sinCoincidencias.pagination.totalPages], [[], 0, 0])

  // páginas: la última queda corta y una página fuera de rango viene vacía con el mismo total
  const p1 = cuerpo(listarFacturas(t, q('pageSize=15&page=1')))
  const p3 = cuerpo(listarFacturas(t, q('pageSize=15&page=3')))
  assert.deepEqual([p1.pagination.page, p1.pagination.pageSize, p1.data.length], [1, 15, 15])
  assert.equal(p3.data.length, p1.pagination.total - 30)
  const p9 = cuerpo(listarFacturas(t, q('pageSize=15&page=9')))
  assert.deepEqual([p9.data, p9.pagination.total], [[], p1.pagination.total])

  // la lista no lleva `cliente` ni `emisor`, y el dinero es texto con dos decimales
  for (const f of filas('pageSize=100')) {
    assert.ok(!('cliente' in f) && !('emisor' in f), String(f.id))
    for (const k of ['total', 'monto_gravado', 'monto_exento', 'total_itbis']) assert.match(f[k], DOS_DECIMALES, `${f.id} ${k}`)
  }

  // la fila archivada no tiene e_ncf y guarda en no_factura el número que reusó su reemplazo
  const archivada = t.facturas.find((f) => f.estado_dgii === 'RECHAZADO_ARCHIVADO')!
  assert.equal(archivada.e_ncf, null)
  assert.match(archivada.no_factura!, /^E45\d{10}$/)
  const reemplazo = t.facturas.filter((f) => f.e_ncf === archivada.no_factura)
  assert.deepEqual(reemplazo.map((f) => f.estado_dgii), ['ACEPTADO'])
  assert.ok(reemplazo[0].id > archivada.id)
})

test('detalle, estado, stats, pdf, fallos', () => {
  // --- detalle: data es [fila] con items/cliente/emisor/notas/modifica, dinero como texto
  const aceptada = t.facturas.find((f) => f.estado_dgii === 'ACEPTADO' && f.client_name === 'Min. de Obras Públicas' && f.date.startsWith('2026-10-27'))!
  const detalle = detalleFactura(t, aceptada.id)
  assert.equal(detalle.http, 200)
  assert.equal(cuerpo(detalle).status, true)
  assert.equal(cuerpo(detalle).data.length, 1)
  const fila = cuerpo(detalle).data[0]
  assert.equal(fila.id, aceptada.id)
  assert.equal(fila.cliente.rnc, '401123456') // el RNC del cliente solo viaja en el detalle, nunca en la lista
  assert.equal(fila.cliente.id, aceptada.client_id)
  assert.deepEqual([fila.emisor.rnc, fila.emisor.razon_social], ['131256432', 'Constructora Cibao SRL'])
  assert.equal(fila.items.length, 2)
  assert.deepEqual([fila.total, fila.monto_gravado, fila.monto_exento, fila.total_itbis], ['11800.00', '10000.00', '0.00', '1800.00'])
  assert.deepEqual([fila.notas, fila.modifica], [[], null])
  assert.equal(fila.tipo_ecf, '45') // `45`, no `E45`
  assert.equal(typeof fila.respuesta_dgii, 'string') // JSON como texto
  assert.doesNotThrow(() => JSON.parse(fila.respuesta_dgii))
  for (const i of fila.items) {
    assert.match(i.amount, /^\d+\.\d{4}$/)
    assert.match(i.quantity, /^\d+\.\d{3}$/)
    for (const k of ['subtotal', 'descuento_monto', 'itbis_amount']) assert.match(i[k], DOS_DECIMALES, k)
    assert.equal(i.factura_id, aceptada.id)
  }
  assert.equal(fila.items.reduce((suma: number, i: any) => suma + Number(i.subtotal), 0), 10000)
  assert.deepEqual(cuerpo(detalleFactura(t, 99999)).data, []) // id inexistente => data []
  assert.equal(detalleFactura(t, 99999).http, 200)
  assert.deepEqual(cuerpo(detalleFactura(t, Number.NaN)).data, [])

  // las filas sin cliente (un E32) traen `cliente: null`
  const consumo = sembrarTenant('admin.e32', AHORA)
  const sinCliente = consumo.facturas.find((f) => f.client_id === null)!
  assert.equal(cuerpo(detalleFactura(consumo, sinCliente.id)).data[0].cliente, null)

  // --- notas: la E34 aceptada aparece en notas del original, la rechazada no
  const e34Aceptada = t.facturas.find((f) => f.tipo_ecf === '34' && f.estado_dgii === 'ACEPTADO')!
  const original = t.facturas.find((f) => f.e_ncf === e34Aceptada.ncf_modificado)!
  const notas = cuerpo(detalleFactura(t, original.id)).data[0].notas
  assert.equal(notas.length, 1)
  assert.deepEqual([notas[0].e_ncf, notas[0].tipo_ecf, notas[0].codigo_modificacion, notas[0].estado_dgii, notas[0].total], [e34Aceptada.e_ncf, '34', '1', 'ACEPTADO', e34Aceptada.total])
  assert.equal(typeof notas[0].id, 'string') // PDO manda el id como texto
  assert.equal(cuerpo(detalleFactura(t, e34Aceptada.id)).data[0].modifica.e_ncf, original.e_ncf)
  const e34Rechazada = t.facturas.find((f) => f.tipo_ecf === '34' && f.estado_dgii === 'RECHAZADO')!
  const otro = t.facturas.find((f) => f.e_ncf === e34Rechazada.ncf_modificado)!
  assert.notEqual(otro.id, original.id)
  assert.deepEqual(cuerpo(detalleFactura(t, otro.id)).data[0].notas, [])
  assert.equal(cuerpo(detalleFactura(t, e34Rechazada.id)).data[0].modifica.e_ncf, otro.e_ncf)
  // la lista también las trae (de ahí salen "Anulada por ..." y "Modifica ...")
  const enLista = (id: number): any => cuerpo(listarFacturas(t, q('pageSize=100&lean=1'))).data.find((f: any) => f.id === id)
  assert.equal(enLista(original.id).notas.length, 1)
  assert.equal(enLista(e34Aceptada.id).modifica.e_ncf, original.e_ncf)

  // --- el motivo de un rechazo viaja en respuesta_dgii.mensajes
  const rechazada = t.facturas.find((f) => f.estado_dgii === 'RECHAZADO' && f.tipo_ecf === '45')!
  assert.deepEqual(JSON.parse(rechazada.respuesta_dgii!).mensajes, [{ valor: 'Fecha de vencimiento de la secuencia vencida', codigo: 145 }])

  // --- avanzarEstado: una llamada a /estado mueve un paso y se detiene en ACEPTADO
  const enviada = t.facturas.find((f) => f.estado_dgii === 'ENVIADO')!
  const paso1 = avanzarEstado(enviada)
  const paso2 = avanzarEstado(paso1)
  const paso3 = avanzarEstado(paso2)
  assert.deepEqual([enviada.estado_dgii, paso1.estado_dgii, paso2.estado_dgii, paso3.estado_dgii], ['ENVIADO', 'EN_PROCESO', 'ACEPTADO', 'ACEPTADO'])
  assert.equal(enviada.estado_dgii, 'ENVIADO', 'avanzarEstado no muta su argumento')
  for (const fijo of ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'RECHAZADO_ARCHIVADO']) {
    const f = t.facturas.find((x) => x.estado_dgii === fijo)!
    assert.equal(avanzarEstado(f).estado_dgii, fijo, fijo)
  }
  const rfce0 = { ...enviada, estado_dgii: 'RFCE_ENVIADO' }
  const rfce1 = avanzarEstado(rfce0)
  const rfce2 = avanzarEstado(rfce1)
  assert.deepEqual([rfce0, rfce1, rfce2, avanzarEstado(rfce2)].map((f) => f.estado_dgii), ['RFCE_ENVIADO', 'RFCE_EN_PROCESO', 'RFCE_ACEPTADO', 'RFCE_ACEPTADO'])

  // --- /estado de una fila en vuelo: en_vuelo y nota, sin tocar el estado
  const incierta = t.facturas.find((f) => f.estado_dgii === 'ENVIO_INCIERTO')!
  const enVuelo = cuerpo(estadoFactura(t, incierta.id)).data
  assert.deepEqual([enVuelo.en_vuelo, enVuelo.estado_dgii, enVuelo.factura_id, enVuelo.e_ncf, enVuelo.track_id], [true, 'ENVIO_INCIERTO', incierta.id, incierta.e_ncf, null])
  assert.ok(typeof enVuelo.nota === 'string' && enVuelo.nota.length > 0)
  assert.equal(incierta.estado_dgii, 'ENVIO_INCIERTO')
  assert.equal(cuerpo(estadoFactura(t, incierta.id)).data.estado_dgii, 'ENVIO_INCIERTO')

  // --- /estado de una fila que se confirma: un paso por llamada y el veredicto queda guardado (con una semilla propia: muta el tenant)
  const u = sembrarTenant('admin.e45', AHORA)
  const idEnviada = u.facturas.find((f) => f.estado_dgii === 'ENVIADO')!.id
  const estadoDe = (): string => cuerpo(estadoFactura(u, idEnviada)).data.estado_dgii
  const guardado = (): string => cuerpo(detalleFactura(u, idEnviada)).data[0].estado_dgii
  assert.deepEqual([estadoDe(), guardado(), estadoDe(), guardado(), estadoDe(), guardado()], ['EN_PROCESO', 'EN_PROCESO', 'ACEPTADO', 'ACEPTADO', 'ACEPTADO', 'ACEPTADO'])
  const confirmada = cuerpo(estadoFactura(u, idEnviada)).data
  assert.deepEqual([confirmada.consulta.codigo, confirmada.consulta.estado, confirmada.secuencia_utilizada, confirmada.consulta.encf], ['1', 'Aceptado', true, confirmada.e_ncf])
  assert.equal(JSON.parse(cuerpo(detalleFactura(u, idEnviada)).data[0].respuesta_dgii).estado, 'Aceptado')
  assert.deepEqual([u.facturas.filter((f) => f.estado_dgii === 'ENVIADO').length, t.facturas.filter((f) => f.estado_dgii === 'ENVIADO').length], [0, 1], 'el otro tenant no se movió')
  // un rechazo se consulta sin cambiar y devuelve sus motivos
  const consultaRechazo = cuerpo(estadoFactura(t, rechazada.id)).data
  assert.deepEqual([consultaRechazo.estado_dgii, consultaRechazo.secuencia_utilizada, consultaRechazo.consulta.mensajes[0].codigo], ['RECHAZADO', false, 145])
  // una fila que nunca salió hacia la DGII no tiene nada que consultar
  const conError = estadoFactura(t, t.facturas.find((f) => f.estado_dgii === 'ERROR')!.id)
  assert.equal(conError.http, 422)
  assert.match(cuerpo(conError).error, /^Esta factura no se envió a la DGII/)
  assert.equal(estadoFactura(t, 99999).http, 404)

  // --- estadisticas: por_estado, ventas_por_dia con hoy, ventas_por_mes con el mes, secuencias y resumen.total_ecf
  const stats = cuerpo(estadisticas(t, q(), AHORA)).data
  assert.equal(estadisticas(t, q(), AHORA).http, 200)
  assert.ok(stats.por_estado.every((e: any) => typeof e.estado === 'string' && typeof e.total === 'number' && typeof e.monto_total === 'number'))
  assert.equal(stats.por_estado.reduce((suma: number, e: any) => suma + e.total, 0), t.facturas.length)
  assert.equal(stats.por_estado.find((e: any) => e.estado === 'ENVIO_INCIERTO').monto_total, 4000)
  assert.ok(stats.por_estado.some((e: any) => e.estado === 'RECHAZADO_ARCHIVADO'), 'por_estado cuenta lo archivado con su texto exacto')
  // hoy: la aceptada y la en proceso de 11,800.00 (la rechazada, las sin confirmar y los notas no suman como venta de hoy)
  assert.deepEqual(stats.ventas_por_dia.find((d: any) => d.dia === '2026-10-27'), { dia: '2026-10-27', total: 2, monto_total: 23600 })
  assert.ok(stats.ventas_por_mes.some((m: any) => m.mes === '2026-10'))
  // la nota de crédito resta, y lo rechazado y lo que no salió hacia la DGII no suma (ayer: solo el ENVIADO de RD$ 5,310.00)
  const diaDeVentas = (dia: string): any => stats.ventas_por_dia.find((d: any) => d.dia === dia)
  assert.deepEqual(diaDeVentas('2026-10-26'), { dia: '2026-10-26', total: 1, monto_total: 5310 })
  assert.deepEqual(diaDeVentas('2026-10-21'), { dia: '2026-10-21', total: 1, monto_total: -5630 })
  assert.equal(diaDeVentas('2026-10-25'), undefined, 'el día del RECHAZADO no tiene ventas')
  assert.equal(diaDeVentas('2026-10-23'), undefined, 'el día de la E34 rechazada tampoco')
  const dias = stats.ventas_por_dia.map((d: any) => d.dia as string)
  assert.deepEqual(dias, [...dias].sort())
  assert.ok(dias.every((d: string) => d >= '2026-09-27' && d <= '2026-10-27'), 'ventas_por_dia cubre 31 días')
  assert.deepEqual(stats.secuencias.map((s: any) => s.type), ['E45', 'E34'])
  assert.equal(stats.resumen.total_ecf, t.facturas.length)
  assert.equal(stats.ambiente_activo, 'testecf')
  // la nota de crédito resta y lo rechazado no cuenta en monto_neto
  const neto = t.facturas.filter((f) => !f.estado_dgii.includes('RECHAZADO')).reduce((suma, f) => suma + (f.tipo_ecf === '34' ? -1 : 1) * Math.round(Number(f.total) * 100), 0)
  assert.equal(stats.resumen.monto_neto, (neto / 100).toFixed(2))
  assert.ok(stats.por_tipo.some((x: any) => x.tipo_ecf === '45' && x.nombre === 'Gubernamental') && stats.por_mes.length >= 2)
  // stats=light conserva lo que el cliente lee y suelta lo caro
  const ligera = cuerpo(estadisticas(t, q('stats=light'), AHORA)).data
  assert.deepEqual(Object.keys(ligera).sort(), ['ambiente_activo', 'por_estado', 'resumen', 'secuencias', 'ventas_por_dia', 'ventas_por_mes'])

  // --- avisos: las secuencias con 50 o menos números, con su estado
  assert.deepEqual(cuerpo(avisos(t)).data, {
    certificado_fallo: { ventas_hoy: 0 },
    secuencias: [{ tipo: 'E34', ambiente: 'testecf', restantes: 23, estado: 'pocos' }],
    sin_rango: { ventas: 0 },
  })

  // --- emisor: la identidad por omisión de las pruebas y la que pasa el cableado
  const datosEmisor = cuerpo(emisor(t)).data
  assert.deepEqual([datosEmisor.rnc, datosEmisor.razon_social, datosEmisor.ambiente], ['131256432', 'Constructora Cibao SRL', 'testecf'])
  const conIdentidad = sembrarTenant('admin.e45', AHORA, { nombre: 'Empresa Mock 01', rnc: '131000001', ambiente: 'certecf' })
  assert.deepEqual([cuerpo(emisor(conIdentidad)).data.razon_social, cuerpo(emisor(conIdentidad)).data.rnc, cuerpo(emisor(conIdentidad)).data.ambiente], ['Empresa Mock 01', '131000001', 'certecf'])
  assert.equal(conIdentidad.ambiente, 'certecf')

  // --- pdfFactura: por omisión el binario de un PDF; format=datos exige el formato de tirilla
  const pdf = pdfFactura(t, aceptada.id, q())
  assert.equal(pdf.http, 200)
  assert.equal(pdf.tipo, 'application/pdf')
  assert.deepEqual([...pdf.binario!.slice(0, 5)], [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
  const texto = Buffer.from(pdf.binario!).toString('latin1')
  assert.ok(texto.trimEnd().endsWith('%%EOF'))
  assert.equal(texto.slice(Number(/startxref\n(\d+)/.exec(texto)![1])).slice(0, 4), 'xref', 'startxref apunta a la tabla xref')
  assert.ok(texto.includes(aceptada.e_ncf!))
  const sinFormato = pdfFactura(t, aceptada.id, q('format=datos'))
  assert.deepEqual([sinFormato.http, cuerpo(sinFormato).status, cuerpo(sinFormato).error], [422, false, MENSAJE_RECIBO])
  assert.equal(pdfFactura(t, aceptada.id, q('format=datos&formato=carta')).http, 422)
  const recibo = pdfFactura(t, aceptada.id, q('format=datos&formato=pos'))
  assert.equal(recibo.http, 200)
  const datos = cuerpo(recibo).data
  assert.ok(datos.timbre.qr.startsWith('data:image/'))
  assert.equal(Buffer.from(datos.timbre.qr.split(',')[1], 'base64').toString('utf8').slice(0, 4), '<svg')
  assert.deepEqual([datos.timbre.codigo_seguridad, datos.emisor.rnc, datos.papel.opcion], [aceptada.codigo_seguridad, '131256432', 80])
  assert.match(datos.timbre.fecha_firma, /^27-10-2026 \d{2}:\d{2}:\d{2}$/)
  assert.equal(datos.lineas.length, 2)
  assert.equal(datos.totales[datos.totales.length - 1].valor, '11,800.00')
  assert.equal(cuerpo(pdfFactura(t, aceptada.id, q('format=datos&formato=pos76'))).data.papel.opcion, 76)
  assert.deepEqual(cuerpo(pdfFactura(t, 99999, q())).status, false)
  assert.equal(pdfFactura(t, 99999, q()).http, 404)

  // --- falloDeLectura: lo que dicen las fichas del nombre del cliente
  assert.deepEqual(falloDeLectura('Prueba [500]'), { http: 500 }) // sin cuerpo
  const html = falloDeLectura('Prueba [html502]')!
  assert.equal(html.http, 502)
  assert.match(html.html!, /502/)
  assert.equal(html.cuerpo, undefined)
  const prohibido = falloDeLectura('Prueba [403]')!
  assert.equal(prohibido.http, 403)
  assert.deepEqual(cuerpo(prohibido), { status: false, error: 'Tu plan Express no incluye esta función', codigo: 'EDICION_NO_INCLUYE' })
  assert.equal(falloDeLectura('Prueba [401]')!.http, 401)
  assert.equal(falloDeLectura('Prueba [slow]')!.demoraMs, 15000)
  assert.equal(falloDeLectura('Constructora Cibao'), null)
  assert.equal(falloDeLectura(''), null)
  assert.equal(falloDeLectura(null as any), null)
  assert.equal(falloDeLectura('PRUEBA [HTML502]')!.http, 502, 'sin distinguir mayúsculas')
})

test('falloDeLectura: MOCK_SLOW_MS manda sobre los 15 s y una ficha de error gana a la lenta', () => {
  const previo = process.env.MOCK_SLOW_MS
  try {
    process.env.MOCK_SLOW_MS = '13000'
    assert.equal(falloDeLectura('Prueba [slow]')!.demoraMs, 13000)
    assert.deepEqual(falloDeLectura('x [500] [slow]'), { http: 500, demoraMs: 13000 })
    for (const invalido of ['', '   ', 'abc', '-5']) {
      process.env.MOCK_SLOW_MS = invalido
      assert.equal(falloDeLectura('Prueba [slow]')!.demoraMs, 15000, `valor: ${JSON.stringify(invalido)}`)
    }
    delete process.env.MOCK_SLOW_MS
    assert.equal(falloDeLectura('Prueba [slow]')!.demoraMs, 15000)
  } finally {
    if (previo === undefined) delete process.env.MOCK_SLOW_MS
    else process.env.MOCK_SLOW_MS = previo
  }
})

test('fichas de falla en las lecturas de una fila: el detalle, /estado y /pdf las honran y la lista no', () => {
  const id = (nombre: string): number => t.facturas.find((f) => f.client_name === nombre)!.id
  const lectura = (nombre: string, que: 'detalle' | 'estado' | 'pdf' | 'recibo') => {
    const i = id(nombre)
    if (que === 'detalle') return detalleFactura(t, i)
    if (que === 'estado') return estadoFactura(t, i)
    return pdfFactura(t, i, q(que === 'recibo' ? 'format=datos&formato=pos' : ''))
  }
  for (const que of ['detalle', 'estado', 'pdf', 'recibo'] as const) {
    assert.deepEqual(lectura('Prueba [500]', que), { http: 500 }, que)
    assert.equal(lectura('Prueba [html502]', que).http, 502, que)
    assert.equal(cuerpo(lectura('Prueba [403]', que)).codigo, 'EDICION_NO_INCLUYE', que)
    assert.equal(lectura('Prueba [401]', que).http, 401, que)
    const lenta = lectura('Prueba [slow]', que)
    assert.deepEqual([lenta.http, lenta.demoraMs], [200, 15000], que) // responde de verdad, pero tarde
  }
  assert.equal(cuerpo(lectura('Prueba [slow]', 'detalle')).data[0].client_name, 'Prueba [slow]')
  assert.equal(lectura('Prueba [slow]', 'pdf').tipo, 'application/pdf')
  // buscar «Prueba» tiene que devolver las cinco filas, no fallar
  const encontradas = listarFacturas(t, q('query=Prueba&pageSize=100'))
  assert.equal(encontradas.http, 200)
  assert.deepEqual(cuerpo(encontradas).data.map((f: any) => f.client_name).sort(), ['[401]', '[403]', '[500]', '[html502]', '[slow]'].map((ficha) => `Prueba ${ficha}`).sort())
  assert.equal(encontradas.demoraMs, undefined)
  // las cinco son aceptadas
  assert.ok(cuerpo(encontradas).data.every((f: any) => f.estado_dgii === 'ACEPTADO'))
  // y una fila sin ficha no se ve afectada
  assert.equal(detalleFactura(t, id('Min. de Obras Públicas')).demoraMs, undefined)
})

test('personas', () => {
  const sembrar = (persona: string) => sembrarTenant(persona, AHORA)

  // admin.e32: solo tipo 32, todo por RFCE y por debajo de RD$ 250,000, con filas sin cliente
  const e32 = sembrar('admin.e32')
  assert.deepEqual(e32.tiposVenta, ['32'])
  assert.ok(e32.facturas.length >= 16, 'dos páginas de 15')
  assert.ok(e32.facturas.every((f) => f.tipo_ecf === '32' && f.estado_dgii.startsWith('RFCE_') && Number(f.total) < 250000))
  assert.ok(e32.facturas.some((f) => f.client_id === null && f.client_name === null))
  assert.ok(e32.facturas.every((f) => f.track_id === null), 'el resumen de consumo no tiene número de seguimiento')
  assert.deepEqual(e32.secuencias.map((s) => s.type), ['E32', 'E34'])
  assert.deepEqual(cuerpo(listarFacturas(e32, q('estado=pendiente&pageSize=100'))).data.map((f: any) => f.estado_dgii).sort(), ['RFCE_ENVIADO', 'RFCE_EN_PROCESO'])
  assert.deepEqual(cuerpo(listarFacturas(e32, q('estado=accion&pageSize=100'))).data.map((f: any) => f.estado_dgii), ['RFCE_RECHAZADO'])
  // el estado RFCE avanza igual que el normal
  const rfceEnviada = e32.facturas.find((f) => f.estado_dgii === 'RFCE_ENVIADO')!
  assert.equal(cuerpo(estadoFactura(e32, rfceEnviada.id)).data.estado_dgii, 'RFCE_EN_PROCESO')
  assert.equal(cuerpo(estadoFactura(e32, rfceEnviada.id)).data.estado_dgii, 'RFCE_ACEPTADO')

  // admin.multi: 31, 32 y 45; E32 sin números pero con emitidos; E31 vence en 5 días; hay una nota de crédito
  const multi = sembrar('admin.multi')
  assert.deepEqual([...multi.tiposVenta].sort(), ['31', '32', '45'])
  for (const tipo of ['31', '32', '45', '34']) assert.ok(multi.facturas.some((f) => f.tipo_ecf === tipo), tipo)
  const e32Multi = multi.secuencias.find((s) => s.type === 'E32')!
  assert.equal(Number(e32Multi.restantes), 0)
  assert.ok(e32Multi.total_emitidos > 0)
  assert.equal(e32Multi.total_emitidos, multi.facturas.filter((f) => f.tipo_ecf === '32').length)
  assert.equal(multi.secuencias.find((s) => s.type === 'E31')!.vencimiento, '2026-11-01')
  assert.deepEqual(cuerpo(avisos(multi)).data.secuencias, [{ tipo: 'E32', ambiente: 'testecf', restantes: 0, estado: 'agotada' }])
  assert.ok(multi.facturas.some((f) => f.tipo_ecf === '32' && f.estado_dgii === 'ACEPTADO' && Number(f.total) >= 250000), 'un E32 de 250,000 o más va directo a la DGII')
  assert.ok(multi.facturas.filter((f) => f.tipo_ecf === '31').every((f) => f.client_id !== null && cuerpo(detalleFactura(multi, f.id)).data[0].cliente.rnc), 'un E31 exige el RNC del comprador')

  // el E45 de admin.e45 y user.e45: dos secuencias y una E34 que vence en 19 días
  assert.deepEqual(t.tiposVenta, ['45'])
  assert.deepEqual(t.secuencias.map((s) => [s.type, s.restantes, s.vencimiento]), [['E45', 312, '2027-12-31'], ['E34', 23, '2026-11-15']])
  assert.ok(t.secuencias.every((s) => s.secuencia_actual === s.total_emitidos && s.total_emitidos === t.facturas.filter((f) => f.tipo_ecf === s.type.slice(1) && f.e_ncf !== null).length))
  assert.equal(t.facturas.filter((f) => f.tipo_ecf === '45').length - 1, t.secuencias[0].secuencia_actual, 'la archivada no gasta número: lo reusa su reemplazo')
  assert.deepEqual(t.facturas.map((f) => f.id), t.facturas.map((_, i) => i + 1))
  assert.ok(t.facturas.filter((f) => f.e_ncf).every((f) => /^E\d{2}\d{10}$/.test(f.e_ncf!) && f.e_ncf!.startsWith(`E${f.tipo_ecf}`)))
  assert.equal(new Set(t.facturas.filter((f) => f.e_ncf).map((f) => f.e_ncf)).size, t.facturas.filter((f) => f.e_ncf).length, 'ningún e-NCF repetido')
  // cada estado del brief existe y la fila de hoy es la de la RD$ 11,800.00
  const porEstado = (e: string) => t.facturas.filter((f) => f.estado_dgii === e)
  for (const e of ['ACEPTADO', 'EN_PROCESO', 'ENVIADO', 'ENVIO_INCIERTO', 'PENDIENTE_ENVIO', 'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'RECHAZADO_ARCHIVADO']) assert.ok(porEstado(e).length >= 1, e)
  assert.equal(porEstado('ENVIO_INCIERTO')[0].total, '4000.00')
  assert.deepEqual([porEstado('ACEPTADO').filter((f) => f.date.startsWith('2026-10-27')).length, porEstado('EN_PROCESO')[0].date.slice(0, 10)], [1, '2026-10-27'])
  assert.ok(t.facturas.filter((f) => f.tipo_ecf === '45' && f.estado_dgii === 'ACEPTADO').length >= 24 + 5, '24 de relleno y las cinco de prueba')
  assert.ok(t.facturas.some((f) => f.date.slice(0, 10) === '2026-09-17'), 'el relleno llega a 40 días atrás')
  assert.equal(t.facturas.filter((f) => f.estado_dgii === 'ACEPTADO' && f.client_name?.startsWith('Prueba [')).length, 5)

  // admin.completa y admin.sinbloque (y las demás sin semilla propia) reutilizan la semilla E45
  const e45 = sembrar('admin.e45')
  for (const persona of ['user.e45', 'admin.completa', 'admin.sinbloque', 'admin.sinproductos', 'flaky', 'slow', 'offline']) assert.deepEqual(sembrar(persona), e45, persona)
  // la semilla es determinista y cada llamada devuelve un tenant propio
  assert.deepEqual(sembrar('admin.multi'), sembrar('admin.multi'))
  assert.notEqual(sembrar('admin.e45').facturas, sembrar('admin.e45').facturas)
  assert.notDeepEqual(sembrar('admin.multi').facturas.length, e45.facturas.length)
  assert.equal(Object.keys(PERSONAS).length, 10)
})

test('los trece tokens de falla de 4.4 existen en el analizador del esqueleto', () => {
  const TRECE = ['drop', 'slow', '500', 'html502', '403', '401', 'rechazo', 'incierto', 'nosaved', 'validacion', 'enCurso', 'norange', 'e34rechazo']
  const escrito = (n: string): string => (/^(drop|slow|\d+|html502)$/.test(n) ? `[${n}]` : n)
  assert.equal(TRECE.length, 13)
  assert.deepEqual([...parseFaultTokens(TRECE.map(escrito).join(' '))].sort(), [...TRECE].sort())
  for (const n of TRECE) assert.deepEqual([...parseFaultTokens(`Cliente ${escrito(n)}`)], [n], n)
})

test('las fechas sembradas son del calendario local, no del UTC', () => {
  // Un proceso aparte por zona: con TZ puesta (en Linux; Windows la ignora y usa la del equipo) a las 23:30 locales de un
  // lugar al oeste de Greenwich el día UTC ya es el siguiente, y a las 00:30 de uno al este todavía es el anterior.
  const datos = new URL('../dev/mock/datos.mjs', import.meta.url).href
  const lecturas = new URL('../dev/mock/lecturas.mjs', import.meta.url).href
  const guion = (hora: number, minuto: number): string => `
    import { sembrarTenant } from ${JSON.stringify(datos)}
    import { estadisticas } from ${JSON.stringify(lecturas)}
    const ahora = new Date(2026, 9, 27, ${hora}, ${minuto})
    const t = sembrarTenant('admin.e45', ahora)
    const s = estadisticas(t, new URLSearchParams(), ahora).cuerpo.data
    console.log(JSON.stringify({
      hoy: t.facturas.filter((f) => f.date.startsWith('2026-10-27')).length,
      otroDia: t.facturas.filter((f) => f.date.startsWith('2026-10-26') && f.estado_dgii === 'EN_PROCESO').length,
      enStats: s.ventas_por_dia.some((d) => d.dia === '2026-10-27'),
      venceE34: t.secuencias.find((x) => x.type === 'E34').vencimiento,
    }))`
  for (const [zona, hora, minuto] of [['America/Santo_Domingo', 23, 30], ['Pacific/Kiritimati', 0, 30], ['UTC', 12, 0]] as const) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', guion(hora, minuto)], { env: { ...process.env, TZ: zona }, encoding: 'utf8', windowsHide: true })
    assert.equal(r.status, 0, `${zona}: ${r.stderr}`)
    assert.deepEqual(JSON.parse(r.stdout), { hoy: 2, otroDia: 0, enStats: true, venceE34: '2026-11-15' }, zona)
  }
})

// --- El cableado en mock-api.mjs, por HTTP contra un servidor en 127.0.0.1 ---------------------------------------------------------

async function conServidor(ctx: TestContext): Promise<{ base: string; entrar(persona: string): Promise<{ token: string; user: any }>; leer(token: string, ruta: string): Promise<Response> }> {
  const srv = crearServidor()
  await new Promise<void>((listo) => srv.listen(0, '127.0.0.1', listo))
  // Se cierra siempre, también si una aserción falla: con el servidor abierto el proceso no termina.
  ctx.after(() => {
    srv.closeAllConnections()
    srv.close()
  })
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return {
    base,
    async entrar(persona) {
      const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailOrUsername: persona, password: `mock-${persona}` }) })
      const j: any = await r.json()
      assert.equal(r.status, 200, persona)
      return { token: j.data.token as string, user: j.data.user }
    },
    leer: (token, ruta) => fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } }),
  }
}

test('cableado: las seis rutas leen un tenant por empresa, con la identidad de la persona', async (ctx) => {
  const { entrar, leer } = await conServidor(ctx)
  const json = async (token: string, ruta: string): Promise<{ http: number; cuerpo: any; tipo: string | null }> => {
    const r = await leer(token, ruta)
    return { http: r.status, tipo: r.headers.get('content-type'), cuerpo: await r.json() }
  }
  const admin = await entrar('admin.e45')

  // me, /api/emisor y la cabecera de Más dicen lo mismo: un nombre y un RNC
  const emisorHttp = (await json(admin.token, '/api/emisor')).cuerpo.data
  assert.deepEqual([emisorHttp.razon_social, emisorHttp.rnc, emisorHttp.ambiente], [admin.user.entitlements.tenant.nombre, admin.user.entitlements.tenant.rnc, admin.user.entitlements.tenant.ambiente])
  assert.deepEqual([emisorHttp.razon_social, emisorHttp.rnc], ['Empresa Mock 01', '131000001'])

  // lista: 15 por página con paginación; stats y avisos con el sobre {status, data}
  const lista = (await json(admin.token, '/api/facturas?page=1&pageSize=15&lean=1&archivadas=0')).cuerpo
  assert.deepEqual([lista.status, lista.data.length, lista.pagination.page, lista.pagination.pageSize], [true, 15, 1, 15])
  assert.ok(lista.pagination.total > 15 && !lista.data.some((f: any) => String(f.estado_dgii).endsWith('ARCHIVADO')))
  const stats = (await json(admin.token, '/api/facturas/stats?stats=light')).cuerpo.data
  assert.ok(Array.isArray(stats.ventas_por_dia) && !('por_tipo' in stats))
  assert.equal((await json(admin.token, '/api/facturas/avisos')).cuerpo.data.secuencias[0].tipo, 'E34')

  // el tenant se comparte por empresa: admin.e45 y user.e45 son la empresa 1, y lo que mueve uno lo ve el otro
  const usuario = await entrar('user.e45')
  const pendientes = (await json(admin.token, '/api/facturas?estado=pendiente&pageSize=100')).cuerpo.data
  const idEnviada = pendientes.find((f: any) => f.estado_dgii === 'ENVIADO').id
  assert.equal((await json(admin.token, `/api/facturas/${idEnviada}/estado`)).cuerpo.data.estado_dgii, 'EN_PROCESO')
  assert.equal((await json(usuario.token, `/api/facturas?id=${idEnviada}`)).cuerpo.data[0].estado_dgii, 'EN_PROCESO')
  assert.equal((await json(usuario.token, `/api/facturas/${idEnviada}/estado`)).cuerpo.data.estado_dgii, 'ACEPTADO')
  assert.equal((await json(admin.token, `/api/facturas?id=${idEnviada}`)).cuerpo.data[0].estado_dgii, 'ACEPTADO')

  // otra empresa, otros datos
  const multi = await entrar('admin.multi')
  const deMulti = (await json(multi.token, '/api/facturas?pageSize=100')).cuerpo.data
  assert.ok(deMulti.some((f: any) => f.tipo_ecf === '31') && !deMulti.some((f: any) => String(f.client_name).startsWith('Prueba [')))
  assert.equal((await json(admin.token, '/api/facturas?tipo_ecf=31')).cuerpo.data.length, 0)
  assert.equal((await json(multi.token, '/api/emisor')).cuerpo.data.razon_social, 'Empresa Mock 02')
  const e32 = await entrar('admin.e32')
  assert.ok((await json(e32.token, '/api/facturas?pageSize=100')).cuerpo.data.every((f: any) => f.tipo_ecf === '32'))

  // el detalle por id con el RNC del cliente, un id que no existe, y el PDF como binario
  const idAceptada = lista.data.find((f: any) => f.estado_dgii === 'ACEPTADO' && f.client_name === 'Min. de Obras Públicas').id
  const detalle = (await json(admin.token, `/api/facturas?id=${idAceptada}`)).cuerpo.data
  assert.deepEqual([detalle.length, detalle[0].cliente.rnc, detalle[0].emisor.rnc], [1, '401123456', '131000001'])
  assert.deepEqual((await json(admin.token, '/api/facturas?id=99999')).cuerpo.data, [])
  const pdf = await leer(admin.token, `/api/facturas/${idAceptada}/pdf`)
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-')
  const recibo422 = await json(admin.token, `/api/facturas/${idAceptada}/pdf?format=datos`)
  assert.deepEqual([recibo422.http, recibo422.cuerpo.error], [422, MENSAJE_RECIBO])
  const recibo = await json(admin.token, `/api/facturas/${idAceptada}/pdf?format=datos&formato=pos`)
  assert.ok(recibo.http === 200 && recibo.cuerpo.data.timbre.qr.startsWith('data:image/'))
  assert.equal((await json(admin.token, '/api/facturas/99999/estado')).http, 404)

  // la lista blanca sigue mandando: el módulo `facturacion` abre estas rutas, y lo que no existe sigue siendo 404 del mock
  assert.equal((await json(admin.token, '/api/gastos')).cuerpo.codigo, 'EDICION_NO_INCLUYE')
  assert.equal((await leer(admin.token, `/api/facturas/${idAceptada}/xml`)).status, 404) // permitida por la lista blanca y de nadie todavía

  // sin bloque (completa, sinbloque) la lista blanca no corre y la identidad es la de la semilla
  for (const persona of ['admin.completa', 'admin.sinbloque']) {
    const p = await entrar(persona)
    assert.equal((await json(p.token, '/api/emisor')).cuerpo.data.razon_social, 'Constructora Cibao SRL', persona)
    assert.equal((await json(p.token, '/api/facturas?pageSize=15')).cuerpo.data.length, 15, persona)
  }
})

test('cableado: las fichas del cliente fallan por HTTP y MOCK_SLOW_MS y MOCK_SIN_ACCION se leen en cada petición', async (ctx) => {
  const { entrar, leer } = await conServidor(ctx)
  const admin = await entrar('admin.e45')
  const ids = new Map<string, number>()
  for (const f of ((await (await leer(admin.token, '/api/facturas?query=Prueba&pageSize=100')).json()) as any).data) ids.set(f.client_name, f.id)
  assert.equal(ids.size, 5)

  const detalle = (nombre: string): Promise<Response> => leer(admin.token, `/api/facturas?id=${ids.get(nombre)}`)
  const r500 = await detalle('Prueba [500]')
  assert.deepEqual([r500.status, await r500.text()], [500, ''])
  const r502 = await detalle('Prueba [html502]')
  assert.deepEqual([r502.status, r502.headers.get('content-type')], [502, 'text/html; charset=utf-8'])
  assert.match(await r502.text(), /502/)
  const r403 = await detalle('Prueba [403]')
  assert.deepEqual([r403.status, ((await r403.json()) as any).codigo], [403, 'EDICION_NO_INCLUYE'])
  assert.equal((await detalle('Prueba [401]')).status, 401)
  assert.equal((await leer(admin.token, `/api/facturas/${ids.get('Prueba [401]')}/estado`)).status, 401, 'esa fila contesta 401 en toda lectura')
  assert.equal((await leer(admin.token, '/api/auth/me')).status, 200, 'y la sesión sigue buena')

  const previo = process.env.MOCK_SLOW_MS
  try {
    process.env.MOCK_SLOW_MS = '60'
    const antes = Date.now()
    const lenta = await detalle('Prueba [slow]')
    assert.equal(lenta.status, 200)
    assert.ok(Date.now() - antes >= 50, 'la ficha [slow] retrasa la respuesta')
    assert.equal(((await lenta.json()) as any).data[0].client_name, 'Prueba [slow]')
  } finally {
    if (previo === undefined) delete process.env.MOCK_SLOW_MS
    else process.env.MOCK_SLOW_MS = previo
  }

  const previoAccion = process.env.MOCK_SIN_ACCION
  try {
    delete process.env.MOCK_SIN_ACCION
    assert.equal((await leer(admin.token, '/api/facturas?estado=accion')).status, 200)
    process.env.MOCK_SIN_ACCION = '1'
    const sin = await leer(admin.token, '/api/facturas?estado=accion')
    assert.deepEqual([sin.status, ((await sin.json()) as any).error], [422, 'Ese filtro de estado no es válido. Elige otro en la lista.'])
    assert.equal((await leer(admin.token, '/api/facturas?estado=rechazado')).status, 200)
  } finally {
    if (previoAccion === undefined) delete process.env.MOCK_SIN_ACCION
    else process.env.MOCK_SIN_ACCION = previoAccion
  }
})

// --- mock-humo.mjs como programa ---------------------------------------------------------------------------------------------------

test('mock-humo: sale 0 contra un mock sano, 1 si no hay mock y se niega a hablar con otro servidor', async (ctx) => {
  const HUMO = fileURLToPath(new URL('../dev/mock-humo.mjs', import.meta.url))
  // Asíncrono a propósito: el mock vive en este mismo proceso, y un spawnSync no lo dejaría contestar.
  const correr = (args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((resolver) => {
      const hijo = spawn(process.execPath, [HUMO, ...args], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      hijo.stdout.on('data', (d) => (stdout += d))
      hijo.stderr.on('data', (d) => (stderr += d))
      hijo.on('close', (status) => resolver({ status, stdout, stderr }))
    })
  const srv = crearServidor()
  await new Promise<void>((listo) => srv.listen(0, '127.0.0.1', listo))
  const puerto = (srv.address() as AddressInfo).port
  ctx.after(() => {
    srv.closeAllConnections()
    srv.close()
  })

  const sano = await correr([`--port=${puerto}`])
  assert.equal(sano.status, 0, sano.stdout + sano.stderr)
  const lineas = sano.stdout.trim().split('\n')
  for (const persona of Object.keys(PERSONAS)) assert.equal(lineas.filter((l) => l.startsWith(persona.padEnd(18))).length, 1, persona)
  assert.match(lineas.find((l) => l.startsWith('admin.e32'))!, /login 200 +bloque sí +tipos 32,34$/)
  assert.match(lineas.find((l) => l.startsWith('admin.sinbloque'))!, /login 200 +bloque no/)
  assert.match(lineas.find((l) => l.startsWith('admin.completa'))!, /login 200 +bloque no/)
  assert.doesNotMatch(sano.stdout + sano.stderr, /mock-admin|[0-9a-f]{48}/, 'no imprime contraseñas ni tokens')

  for (const host of ['localhost', '0.0.0.0', '192.168.1.5', 'express.fiscalpoint.com.do']) {
    const ajeno = await correr([`--host=${host}`, `--port=${puerto}`])
    assert.equal(ajeno.status, 2, host)
    assert.match(ajeno.stderr, /127\.0\.0\.1/, host)
    assert.equal(ajeno.stdout, '', host)
  }
  const desconocido = await correr(['--zzz'])
  assert.equal(desconocido.status, 2)

  // sin nadie escuchando: sale 1 con un texto que dice cómo arrancar el mock
  srv.closeAllConnections()
  await new Promise<void>((listo) => srv.close(() => listo()))
  const caido = await correr([`--port=${puerto}`])
  assert.equal(caido.status, 1)
  assert.match(caido.stderr, /mock-api\.mjs/)
})
