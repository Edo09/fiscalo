import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuerpoRango, enteroPositivo, formatoRnc, normalizarEmisor, normalizarRango, tarjetasNumeracion, textoCertificado, validarRango } from '~/lib/empresa'
import type { FormRango } from '~/lib/empresa'

const HOY = '2026-11-02'

test('formatoRnc: RNC de 9 dígitos, cédula de 11 y lo demás tal cual', () => {
  assert.equal(formatoRnc('131256432'), '1-31-25643-2')
  assert.equal(formatoRnc('1-31-25643-2'), '1-31-25643-2')
  assert.equal(formatoRnc('00100000001'), '001-0000000-1')
  assert.equal(formatoRnc('abc'), 'abc')
  assert.equal(formatoRnc(null), '')
})

test('normalizarEmisor: lee los datos y el certificado; sin RNC ni razón social no hay nada que mostrar', () => {
  const e = normalizarEmisor({ rnc: '131256432', razon_social: 'Constructora Cibao SRL', nombre_comercial: '', telefono: ' 809-555-0100 ', certificado: { estado: 'por_vencer', vence: '2026-11-20', dias: 18 } })
  assert.ok(e !== null)
  assert.equal(e.razonSocial, 'Constructora Cibao SRL')
  assert.equal(e.nombreComercial, null)
  assert.equal(e.telefono, '809-555-0100')
  assert.deepEqual(e.certificado, { estado: 'por_vencer', vence: '2026-11-20', dias: 18 })
  assert.equal(normalizarEmisor({ certificado: {} }), null)
  assert.equal(normalizarEmisor(null), null)
  assert.equal(normalizarEmisor({ rnc: '1', razon_social: 'X', certificado: { estado: 'raro' } })?.certificado, null)
})

test('textoCertificado: el tono nunca es de «todo bien» ante la duda', () => {
  assert.equal(textoCertificado({ estado: 'vigente', vence: '2027-05-01', dias: 180 }).tono, 'ok')
  assert.match(textoCertificado({ estado: 'por_vencer', vence: '2026-11-03', dias: 1 }).texto, /Vence mañana/)
  assert.equal(textoCertificado({ estado: 'por_vencer', vence: '2026-11-02', dias: 0 }).tono, 'warning')
  assert.equal(textoCertificado({ estado: 'vencido', vence: '2026-10-01', dias: -32 }).tono, 'danger')
  assert.equal(textoCertificado({ estado: 'no_configurado', vence: null, dias: null }).tono, 'danger')
  assert.equal(textoCertificado({ estado: 'sin_dato', vence: null, dias: null }).tono, 'neutral')
})

test('normalizarRango: los números de MySQL llegan como texto y un rango sin límite no inventa cuántos quedan', () => {
  const r = normalizarRango({ id: '7', type: 'E45', numero_desde: '1', numero_hasta: '500', current_value: '20', usados: '20', fecha_vencimiento: '2027-01-31', estado: 'activo', no_autorizacion: ' 123 ' })
  assert.deepEqual(r, { id: 7, tipo: '45', desde: 1, hasta: 500, actual: 20, usados: 20, restantes: 480, vence: '2027-01-31', estado: 'activo', noAutorizacion: '123' })
  assert.equal(normalizarRango({ id: 1, type: 'E31', numero_desde: 1, numero_hasta: null, current_value: 5 })?.restantes, null)
  assert.equal(normalizarRango({ id: 1, type: 'XX' }), null)
  assert.equal(normalizarRango('no es una fila'), null)
})

test('tarjetasNumeracion: un estado por tipo, con el detalle y sus rangos', () => {
  const secuencias = [
    { type: 'E45', total_emitidos: '12', restantes: '480', vencimiento: '2027-05-30' },
    { type: 'E31', total_emitidos: '5', restantes: '0', vencimiento: '2027-05-30' },
  ]
  const rangos = [
    { id: 2, type: 'E45', numero_desde: 501, numero_hasta: 1000, current_value: 500, fecha_vencimiento: '2027-08-01' },
    { id: 1, type: 'E45', numero_desde: 1, numero_hasta: 500, current_value: 20, fecha_vencimiento: '2027-05-30' },
  ]
  const t = tarjetasNumeracion({ tipos: ['45', '31', '34'], ambiente: 'ecf', secuencias, rangos, hoy: HOY })
  assert.deepEqual(t.map((x) => [x.tipo, x.estado]), [['45', 'vigente'], ['31', 'agotada'], ['34', 'sinRango']])
  assert.match(t[0]!.detalle ?? '', /^Quedan 480 · vence el /)
  assert.deepEqual(t[0]!.rangos.map((r) => r.id), [1, 2], 'el que vence primero va arriba')
  assert.equal(t[2]!.detalle, null)
  assert.equal(tarjetasNumeracion({ tipos: ['34'], ambiente: 'testecf', secuencias: undefined, rangos: undefined, hoy: HOY })[0]!.estado, 'sinLimite')
})

const formOk = (): FormRango => ({ tipo: '45', desde: '1', hasta: '500', vence: '2027-01-31', noSolicitud: '', noAutorizacion: '' })

test('validarRango: lo que se sabe que el API rechazará no se manda', () => {
  const ctx = { hoy: HOY, ambiente: 'testecf' as const, tipos: ['45', '31'] }
  assert.deepEqual(validarRango(formOk(), ctx), {})
  assert.ok(validarRango({ ...formOk(), tipo: '41' }, ctx).tipo !== undefined)
  assert.ok(validarRango({ ...formOk(), desde: '0' }, ctx).desde !== undefined)
  assert.ok(validarRango({ ...formOk(), desde: '600', hasta: '500' }, ctx).hasta !== undefined)
  assert.ok(validarRango({ ...formOk(), vence: '2026-10-31' }, ctx).vence !== undefined)
  assert.equal(validarRango({ ...formOk(), vence: HOY }, ctx).vence, undefined, 'vencer hoy todavía sirve')
  assert.ok(validarRango({ ...formOk(), vence: '' }, ctx).vence !== undefined)
  assert.equal(validarRango(formOk(), { ...ctx, ambiente: 'ecf' }).noAutorizacion, 'Falta el número de autorización de la DGII.')
  assert.deepEqual(validarRango({ ...formOk(), noAutorizacion: '77' }, { ...ctx, ambiente: 'ecf' }), {})
})

test('enteroPositivo y cuerpoRango: separadores de miles fuera, y el cuerpo solo trae lo opcional que se escribió', () => {
  assert.equal(enteroPositivo('1,000'), 1000)
  assert.equal(enteroPositivo('1.5x'), null)
  assert.equal(enteroPositivo('0'), null)
  assert.deepEqual(cuerpoRango(formOk()), { type: 'E45', numero_desde: 1, numero_hasta: 500, fecha_vencimiento: '2027-01-31' })
  assert.deepEqual(cuerpoRango({ ...formOk(), noSolicitud: ' S-9 ', noAutorizacion: ' A-1 ' }), { type: 'E45', numero_desde: 1, numero_hasta: 500, fecha_vencimiento: '2027-01-31', no_solicitud: 'S-9', no_autorizacion: 'A-1' })
})
