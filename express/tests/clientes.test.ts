// lib/clientes: el RNC (limpiar, validar 9 u 11 dígitos, formatear, qué dijo la DGII), la búsqueda, el alta (sin descuento ni crédito), la edición parcial, el contacto
// y «Facturar a este cliente». Todo lo que se prueba es lógica pura; las filas son de mentira, como las manda MySQL (todo en texto).
import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, CODIGO_CLIENTE_SIN_ELEGIR } from '@/api/errores'
import type { ConsultaRnc } from '@/api/rnc'
import type { ClientRow } from '@/api/types'
import {
  accionFacturar,
  chipsCliente,
  clienteYaCreado,
  coincidenciasRnc,
  consultaDeBusqueda,
  construirAltaCliente,
  contadorTurno,
  datosFacturarA,
  duplicadoDelServidor,
  errorFormCliente,
  esFalloAmbiguo,
  esRncOCedula,
  fichaCliente,
  fijarPrecarga,
  formDesdeFicha,
  formatearRnc,
  formInicial,
  hayCambiosCliente,
  leerPrecarga,
  limpiarPrecarga,
  modoBusqueda,
  normalizarRnc,
  payloadEdicionCliente,
  resultadoConsultaRnc,
  telefonoParaGuardar,
  urlContacto,
  validarEdicionCliente,
  validarRnc,
} from '~/lib/clientes'

const MSG_RNC = 'El RNC debe tener 9 dígitos (empresa) u 11 (cédula).'

/** Una fila de clients como la manda el API: las columnas numéricas y los flags, en texto. */
const fila = (o: object = {}): ClientRow =>
  ({ id: '1', client_name: 'Juan Perez', company_name: 'Juan Perez', razon_social: 'Juan Perez', rnc: null, phone_number: '', email: '', direccion: null, descuento: '0.00', permitir_credito: '0', ...o }) as unknown as ClientRow
const OBRAS = (): ClientRow =>
  fila({ id: '2', client_name: 'Maria Lopez', company_name: 'Min. de Obras', razon_social: 'Min. de Obras', rnc: '401123456', phone_number: '809-555-0100', email: 'a@b.com', permitir_credito: '1' })

// --- El RNC ---------------------------------------------------------------------------------------------------------------------------

test('RNC: se quitan los separadores, solo 9 u 11 dígitos valen y se formatea como se escribe', () => {
  assert.equal(normalizarRnc('1-31-25643-2'), '131256432')
  assert.equal(normalizarRnc(' 001 1234567 8 '), '00112345678')
  assert.deepEqual(['131256432', '00112345678', '1234567890', '12345678', ''].map(esRncOCedula), [true, true, false, false, false])
  assert.equal(validarRnc(''), undefined)
  assert.equal(validarRnc('1-31-25643-2'), undefined)
  assert.equal(validarRnc('00112345678'), undefined)
  assert.equal(validarRnc('12345'), MSG_RNC)
  assert.equal(validarRnc('1234567890'), MSG_RNC)
  assert.equal(formatearRnc('131256432'), '1-31-25643-2')
  assert.equal(formatearRnc('00112345678'), '001-1234567-8')
  assert.equal(formatearRnc('1234'), '1234')
})

test('contadorTurno: una respuesta tardía deja de valer en cuanto sale otra consulta', () => {
  const t = contadorTurno()
  const primero = t.siguiente()
  assert.equal(t.vigente(primero), true)
  const segundo = t.siguiente()
  assert.equal(t.vigente(primero), false)
  assert.equal(t.vigente(segundo), true)
})

test('resultadoConsultaRnc: los cuatro desenlaces, y nunca bloquea', () => {
  const dgii = (o: Partial<ConsultaRnc> = {}): ConsultaRnc => ({ rnc: '131256432', tipo: 'RNC', razon_social: ' CONSTRUCTORA CIBAO SRL ', nombre_comercial: '', estado: 'ACTIVO', facturador_electronico: true, actividad_economica: '', regimen_pagos: '', ...o })
  assert.deepEqual(resultadoConsultaRnc({ ok: dgii() }), { kind: 'encontrado', rnc: '131256432', razonSocial: 'CONSTRUCTORA CIBAO SRL', estado: 'ACTIVO', activo: true })
  const suspendido = resultadoConsultaRnc({ ok: dgii({ estado: 'SUSPENDIDO' }) })
  assert.equal(suspendido.kind === 'encontrado' && suspendido.activo, false) // un aviso, no un bloqueo
  const sinRazon = resultadoConsultaRnc({ ok: dgii({ razon_social: '', nombre_comercial: 'CIBAO' }) })
  assert.equal(sinRazon.kind === 'encontrado' && sinRazon.razonSocial, 'CIBAO')
  assert.deepEqual(resultadoConsultaRnc({ error: new ApiError('No está inscrito.', 404, { delServidor: true }) }), { kind: 'noInscrito', mensaje: 'No está inscrito.' })
  assert.deepEqual(resultadoConsultaRnc({ error: new ApiError('No encontramos lo que buscas.', 404, { delServidor: false }) }), { kind: 'noDisponible' })
  assert.deepEqual(resultadoConsultaRnc({ error: new ApiError('El RNC lleva 9 dígitos.', 422, { delServidor: true }) }), { kind: 'invalido', mensaje: 'El RNC lleva 9 dígitos.' })
  for (const e of [new ApiError('x', 502), new ApiError('x', 0), new ApiError('x', 500), new TypeError('x')]) assert.deepEqual(resultadoConsultaRnc({ error: e }), { kind: 'noDisponible' })
})

test('coincidenciasRnc ignora los guiones de un RNC viejo y no confunde otro número', () => {
  const filas = [fila({ id: '1', rnc: '1-31-25643-2' }), fila({ id: '2', rnc: '131256432' }), fila({ id: '3', rnc: '401123456' }), fila({ id: '4', rnc: null })]
  assert.deepEqual(coincidenciasRnc(filas, '131256432').map((f) => f.id), ['1', '2'])
  assert.deepEqual(coincidenciasRnc(filas, '13125'), []) // lo que no es de 9 u 11 dígitos no busca
})

// --- La búsqueda ----------------------------------------------------------------------------------------------------------------------

test('modoBusqueda: 9 u 11 dígitos son un RNC (con separadores o sin ellos), menos de 2 caracteres no busca y lo demás es texto', () => {
  assert.deepEqual(modoBusqueda('1-31-25643-2'), { kind: 'rnc', digitos: '131256432' })
  assert.deepEqual(modoBusqueda('131 256 432'), { kind: 'rnc', digitos: '131256432' })
  assert.deepEqual(modoBusqueda('401123456 '), { kind: 'rnc', digitos: '401123456' })
  assert.deepEqual(modoBusqueda('12345678901'), { kind: 'rnc', digitos: '12345678901' })
  assert.deepEqual(modoBusqueda('1234567890'), { kind: 'texto', query: '1234567890' }) // 10 dígitos: un teléfono
  assert.deepEqual(modoBusqueda('1-31-25643'), { kind: 'texto', query: '1-31-25643' })
  assert.deepEqual(modoBusqueda('  constr '), { kind: 'texto', query: 'constr' })
  assert.deepEqual(modoBusqueda('a'), { kind: 'vacio' })
  assert.deepEqual(modoBusqueda(''), { kind: 'vacio' })
  assert.deepEqual(['1-31-25643-2', 'constr', 'a', ' '].map(consultaDeBusqueda), ['131256432', 'constr', '', ''])
})

// --- El alta --------------------------------------------------------------------------------------------------------------------------

test('construirAltaCliente: el nombre va como empresa y contacto, el RNC con dígitos y NUNCA descuento, crédito, razón social ni correo de bienvenida', () => {
  const rapido = construirAltaCliente({ rnc: '1-31-25643-2', nombre: '  CONSTRUCTORA CIBAO SRL ' })
  assert.deepEqual(rapido, { client_name: 'CONSTRUCTORA CIBAO SRL', company_name: 'CONSTRUCTORA CIBAO SRL', rnc: '131256432' })
  const completo = construirAltaCliente({ rnc: '', nombre: 'Min. de Obras', contacto: ' Maria Lopez ', telefono: '(809) 555-0199', correo: ' a@b.com ', direccion: ' Calle 1 ' })
  assert.deepEqual(completo, { client_name: 'Maria Lopez', company_name: 'Min. de Obras', phone_number: '8095550199', email: 'a@b.com', direccion: 'Calle 1' })
  for (const prohibida of ['descuento', 'permitir_credito', 'razon_social', 'sent_mail']) {
    assert.equal(prohibida in rapido, false, prohibida)
    assert.equal(prohibida in completo, false, prohibida)
  }
})

test('telefonoParaGuardar: dígitos, salvo que el texto lleve letras', () => {
  assert.equal(telefonoParaGuardar('(809) 555-0199'), '8095550199')
  assert.equal(telefonoParaGuardar(' 809-555-0100 ext 2 '), '809-555-0100 ext 2')
  assert.equal(telefonoParaGuardar(' '), '')
})

test('errorFormCliente: nombre obligatorio y de 100 como máximo (sin cortar), RNC de 9 u 11 y obligatorio donde el comprobante lo pide', () => {
  assert.deepEqual(errorFormCliente({ rnc: '', nombre: 'Juan' }), {})
  assert.equal(errorFormCliente({ rnc: '', nombre: '  ' }).nombre, 'Escribe el nombre o la razón social.')
  assert.equal(errorFormCliente({ rnc: '', nombre: 'N'.repeat(101) }).nombre, 'El nombre no puede pasar de 100 caracteres.')
  assert.deepEqual(errorFormCliente({ rnc: '', nombre: 'N'.repeat(100) }), {})
  assert.equal(errorFormCliente({ rnc: '12345', nombre: 'Juan' }).rnc, MSG_RNC)
  assert.equal(errorFormCliente({ rnc: '', nombre: 'Juan' }, { exigeRnc: true }).rnc, 'Escribe el RNC o la cédula del cliente: este comprobante lo necesita.')
  assert.equal(errorFormCliente({ rnc: '131256432', nombre: 'Juan' }, { exigeRnc: true }).rnc, undefined)
  assert.equal(errorFormCliente({ rnc: '', nombre: 'Juan', correo: 'no-es-correo' }).correo !== undefined, true)
  assert.equal(errorFormCliente({ rnc: '', nombre: 'Juan', telefono: '1'.repeat(21) }).telefono, 'El teléfono no puede pasar de 20 caracteres.')
})

test('formInicial: un texto es el nombre y el RNC pasa a dígitos', () => {
  assert.equal(formInicial('constr').nombre, 'constr')
  assert.deepEqual(formInicial({ rnc: '1-31-25643-2', nombre: 'X' }), { rnc: '131256432', nombre: 'X', contacto: '', telefono: '', correo: '', direccion: '' })
  assert.equal(formInicial(undefined).rnc, '')
})

test('un fallo ambiguo es la respuesta que no llegó; un rechazo del servidor no', () => {
  assert.equal(esFalloAmbiguo(new ApiError('sin red', 0)), true)
  assert.equal(esFalloAmbiguo(new ApiError('se cayó', 502)), true)
  assert.equal(esFalloAmbiguo(new ApiError('creado', 200, { codigo: CODIGO_CLIENTE_SIN_ELEGIR })), true)
  assert.equal(esFalloAmbiguo(new TypeError('x')), true)
  assert.equal(esFalloAmbiguo(new ApiError('El correo no es válido.', 200, { delServidor: true })), false)
  assert.equal(esFalloAmbiguo(new ApiError('no', 422)), false)
})

test('tras un fallo ambiguo el cliente ya guardado se reconoce por lo que se mandó, y se toma el más nuevo', () => {
  const alta = construirAltaCliente({ rnc: '131256432', nombre: 'Constructora Cibao' })
  const guardada = fila({ id: '9', client_name: 'CONSTRUCTORA CIBAO', company_name: 'constructora cibao', rnc: '131256432' })
  const otroRnc = fila({ id: '12', client_name: 'Constructora Cibao', company_name: 'Constructora Cibao', rnc: '401123456' })
  assert.equal(clienteYaCreado([otroRnc, guardada], alta)?.id, '9')
  assert.equal(clienteYaCreado([otroRnc], alta), null)
  assert.equal(clienteYaCreado([guardada, fila({ id: '15', client_name: 'Constructora Cibao', company_name: 'Constructora Cibao', rnc: '1-31-25643-2' })], alta)?.id, '15')
})

test('un rechazo por «el mismo cliente» se reconoce solo con correo o teléfono y por contacto, correo y teléfono', () => {
  const alta = construirAltaCliente({ rnc: '', nombre: 'Maria Lopez', telefono: '809-555-0100', correo: 'a@b.com' })
  const existente = fila({ id: '5', client_name: 'maria lopez', company_name: 'Otra empresa', email: 'A@B.COM', phone_number: '8095550100' })
  assert.equal(duplicadoDelServidor([existente], alta)?.id, '5')
  assert.equal(duplicadoDelServidor([fila({ id: '6', client_name: 'Maria Lopez', email: 'a@b.com', phone_number: '8095550199' })], alta), null)
  // sin correo ni teléfono el servidor no rechaza por esto, así que no hay «mismo cliente» que ofrecer
  assert.equal(duplicadoDelServidor([fila({ id: '7', client_name: 'Juan' })], construirAltaCliente({ rnc: '', nombre: 'Juan' })), null)
})

test('la precarga vale unos segundos y leerla no la gasta', () => {
  fijarPrecarga({ nombre: 'constr' }, 1000)
  assert.deepEqual(leerPrecarga(1000), { nombre: 'constr' })
  assert.deepEqual(leerPrecarga(1500), { nombre: 'constr' }) // el segundo dibujo del modo estricto la sigue viendo
  assert.deepEqual(leerPrecarga(1000 + 10_001), {}) // la de un paso que nadie terminó ya no se aplica
  limpiarPrecarga()
  assert.deepEqual(leerPrecarga(1000), {})
})

// --- Leer y editar --------------------------------------------------------------------------------------------------------------------

test('fichaCliente: el texto de MySQL «0» es solo contado y «0.00» no es descuento; el RNC son dígitos', () => {
  const sin = fichaCliente(fila())
  assert.deepEqual([sin.permiteCredito, sin.descuento, sin.rnc, sin.nombre, sin.id], [false, 0, '', 'Juan Perez', 1])
  const con = fichaCliente(OBRAS())
  assert.deepEqual([con.permiteCredito, con.rnc, con.telefono, con.contacto, con.empresa], [true, '401123456', '809-555-0100', 'Maria Lopez', 'Min. de Obras'])
  assert.equal(fichaCliente(fila({ rnc: '1-30-00001-9' })).rnc, '130000019')
  assert.equal(fichaCliente(null).nombre, 'Consumidor final')
})

test('chipsCliente: «Sin RNC» avisa solo si se vende E31 o E45, «Solo contado» no es un texto verdadero y el descuento 0 no sale', () => {
  const v = (o: object) => {
    const c = fichaCliente(fila(o))
    return { rnc: c.rnc === '' ? null : c.rnc, permiteCredito: c.permiteCredito, descuento: c.descuento }
  }
  assert.deepEqual(chipsCliente(v({}), ['45']), [{ texto: 'Sin RNC', tono: 'warn' }, { texto: 'Solo contado', tono: 'neutral' }])
  assert.deepEqual(chipsCliente(v({}), ['32']).map((c) => c.tono), ['neutral', 'neutral'])
  assert.deepEqual(chipsCliente(v({ rnc: '131256432', permitir_credito: '1', descuento: '10.00' }), ['45']), [{ texto: '10% desc.', tono: 'neutral' }])
  assert.deepEqual(chipsCliente(v({ rnc: '131256432', permitir_credito: '1' }), ['45']), [])
})

test('urlContacto: llamar, WhatsApp y correo solo con dato que sirve', () => {
  assert.deepEqual(urlContacto({ telefono: '809-555-0100', email: 'a@b.com' }), { tel: 'tel:8095550100', wa: 'https://wa.me/18095550100', mailto: 'mailto:a@b.com' })
  assert.equal(urlContacto({ telefono: '18095550100', email: null }).wa, 'https://wa.me/18095550100')
  assert.equal(urlContacto({ telefono: '809-555-0100 ext 2', email: null }).tel, 'tel:8095550100')
  assert.deepEqual(urlContacto({ telefono: '555-0100', email: 'no-es-correo' }), { tel: 'tel:5550100', wa: null, mailto: null })
  assert.deepEqual(urlContacto({ telefono: '', email: '' }), { tel: null, wa: null, mailto: null })
})

test('edición parcial: solo viaja lo que cambió, vaciar limpia y un RNC no se puede quitar', () => {
  const c = fichaCliente(OBRAS())
  const f = formDesdeFicha(c)
  assert.equal(hayCambiosCliente(c, f), false)
  assert.deepEqual(payloadEdicionCliente(c, { ...f, rnc: '4-01-12345-6' }), { id: 2 }) // el RNC con guiones es el mismo
  assert.deepEqual(payloadEdicionCliente(c, { ...f, telefono: '809-555-0199' }), { id: 2, phone_number: '8095550199' }) // Express guarda dígitos
  assert.deepEqual(payloadEdicionCliente(c, { ...f, nombre: 'Min. de Obras Publicas' }), { id: 2, company_name: 'Min. de Obras Publicas' }) // el contacto distinto se conserva
  const p = fichaCliente(fila())
  assert.deepEqual(payloadEdicionCliente(p, { ...formDesdeFicha(p), nombre: 'Pedro' }), { id: 1, company_name: 'Pedro', client_name: 'Pedro' }) // contacto igual a la empresa sigue al nombre
  assert.deepEqual(payloadEdicionCliente(c, { ...f, correo: '', telefono: '', direccion: '' }), { id: 2, email: '', phone_number: '' }) // la dirección no cambió: era vacía
  assert.deepEqual(payloadEdicionCliente(c, { ...f, descuento: '10.5', permiteCredito: false }), { id: 2, descuento: 10.5, permitir_credito: 0 })
  assert.deepEqual(payloadEdicionCliente(c, { ...f, rnc: '1-31-25643-2' }), { id: 2, rnc: '131256432' })
  assert.equal(validarEdicionCliente(c, { ...f, rnc: '' }).rnc, 'El RNC se puede cambiar, no quitar.')
  assert.equal('rnc' in payloadEdicionCliente(c, { ...f, rnc: '' }), false)
  assert.equal(validarEdicionCliente(c, { ...f, nombre: '' }).nombre, 'Escribe el nombre o la razón social.')
  assert.equal(validarEdicionCliente(c, { ...f, descuento: '120' }).descuento, 'El descuento debe ser un número entre 0 y 100.')
})

test('edición: un dato viejo inválido no impide corregir otro campo, pero sí se juzga lo que se cambia', () => {
  const viejo = fichaCliente(fila({ rnc: '1234567890', company_name: 'N'.repeat(120), razon_social: 'N'.repeat(120), client_name: 'N'.repeat(120), phone_number: '809' }))
  const f = { ...formDesdeFicha(viejo), telefono: '809-555-0199' }
  assert.deepEqual(validarEdicionCliente(viejo, f), {})
  assert.deepEqual(payloadEdicionCliente(viejo, f), { id: 1, phone_number: '8095550199' })
  assert.equal(validarEdicionCliente(viejo, { ...f, nombre: 'N'.repeat(101) }).nombre, 'El nombre no puede pasar de 100 caracteres.')
  assert.equal(validarEdicionCliente(viejo, { ...f, rnc: '12345' }).rnc, MSG_RNC)
})

// --- Facturar a este cliente ----------------------------------------------------------------------------------------------------------

test('accionFacturar: agrega el RNC solo si todos los tipos que se venden lo exigen, y no factura al RNC de la propia empresa', () => {
  const sin = fichaCliente(fila())
  const con = fichaCliente(OBRAS())
  const suyo = fichaCliente(fila({ rnc: '1-31-25643-2' }))
  assert.deepEqual(accionFacturar(sin, ['45', '34'], '131256432'), { accion: 'agregarRnc' })
  assert.deepEqual(accionFacturar(sin, ['32', '45'], '131256432'), { accion: 'facturar' }) // el consumo no exige comprador
  assert.deepEqual(accionFacturar(con, ['31', '32', '45'], '131256432'), { accion: 'facturar' })
  assert.deepEqual(accionFacturar(suyo, ['45'], '131256432'), { accion: 'esMiEmpresa' })
  assert.equal(accionFacturar(con, ['34'], '131256432'), null) // sin un tipo de venta no hay nada que ofrecer
  assert.equal(accionFacturar(con, [], ''), null)
})

test('datosFacturarA: lo que se le deja al asistente, con el RNC en dígitos o null', () => {
  assert.deepEqual(datosFacturarA(fichaCliente(OBRAS())), { id: 2, nombre: 'Min. de Obras', rnc: '401123456', permiteCredito: true, descuento: 0 })
  assert.deepEqual(datosFacturarA(fichaCliente(fila({ descuento: '10.00' }))), { id: 1, nombre: 'Juan Perez', rnc: null, permiteCredito: false, descuento: 10 })
})
