// Facturar un conduce de Ferretería (spec 5.6): los borradores con que se
// abren la factura e-CF y la factura simple, el nombre del cliente que se
// muestra y las líneas que llegan sin precio. Las filas son como las de
// GET /api/conduces: los DECIMAL llegan como texto, las columnas INT como
// número, y un TINYINT puede llegar como texto.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-conversion-conduce.ts
import type { ConduceRow, CotizacionRow } from '../src/api/types.ts'
import {
  MSG_SIN_PRECIO, conduceAFacturaPrefill, conduceAFacturaSimplePrefill, lineasSinPrecio, nombreConduce,
} from '../src/features/conduces/conversion.ts'
import {
  ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill,
} from '../src/features/cotizaciones/formatos/ferreteria/conversion.ts'
import { claveFormularioFactura } from '../src/config/navigation.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves. Una clave con undefined
// cuenta como ausente: JSON.stringify la omite igual.
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

const CLIENTE = 'HOSPITAL DOCENTE DR. FRANCISCO E. MOSCOSO PUELLO'
const fila: ConduceRow = {
  id: 3,
  numero: 3,
  code: 'CON-000003',
  date: '2026-10-06 09:30:00',
  cotizacion_id: 12,
  cotizacion_code: 'COT-000012',
  client_id: 7,
  client_name: CLIENTE,
  company_name: 'HOSPITAL MOSCOSO PUELLO',
  rnc: '401515131',
  // El nombre guardado puede ser viejo: con el cliente vivo manda el actual.
  client_name_guardado: 'HOSPITAL DOCENTE',
  user_id: 5,
  activo: 1,
  items: [
    { id: 10, conduce_id: 3, product_id: 55, description: 'GALONES DE PINTURA BLNACA SEMIGLOSS', quantity: '7.000',
      unidad_medida: '43', amount: '2000.0000', indicador_facturacion: 1, indicador_bien_servicio: 1, activo: 1 },
    // Servicio al 16%, con los indicadores como texto.
    { id: 11, conduce_id: 3, product_id: 56, description: 'INSTALACION DE LAVAMANOS', quantity: '1.000',
      unidad_medida: '43', amount: '1000.0000', indicador_facturacion: '2', indicador_bien_servicio: '2', activo: 1 },
    // "Línea libre" del conduce: sin producto y sin precio, con otra unidad y espacios alrededor del texto.
    { id: 12, conduce_id: 3, product_id: null, description: '  CORTE DE TUBO ', quantity: '2.500',
      unidad_medida: '47', amount: '0.0000', indicador_facturacion: 1, indicador_bien_servicio: 1, activo: 1 },
    { id: 13, conduce_id: 3, product_id: 58, description: 'TORNILLO GALVANIZADO 1/4', quantity: '10.000',
      unidad_medida: '43', amount: '13.7000', indicador_facturacion: 1, indicador_bien_servicio: 1, activo: 1 },
    { id: 14, conduce_id: 3, product_id: 57, description: 'TODO EXENTO', quantity: '3.000',
      unidad_medida: '43', amount: '10.0000', indicador_facturacion: 4, indicador_bien_servicio: 1, activo: 1 },
    // Otra línea libre sin precio, marcada como servicio.
    { id: 15, conduce_id: 3, product_id: null, description: 'FLETE A OBRA', quantity: '1.000',
      unidad_medida: '43', amount: '0.0000', indicador_facturacion: 1, indicador_bien_servicio: 2, activo: 1 },
    // Sin descripción no hay qué facturar: se descarta y no cuenta como línea sin precio.
    { id: 16, conduce_id: 3, product_id: null, description: '   ', quantity: '1.000',
      unidad_medida: '43', amount: '0.0000', indicador_facturacion: 1, indicador_bien_servicio: 1, activo: 1 },
  ],
}
const AVISO_PRECIO = '2 línea(s) del conduce no tienen precio: escríbelo antes de emitir.'
const AVISO_CLIENTE = 'El cliente ya no existe: elige otro.'

// --- Factura e-CF ----------------------------------------------------------
const ecf = conduceAFacturaPrefill(fila)
igual('e-CF: kind factura-prefill', ecf.kind, 'factura-prefill')
igual('e-CF: origenTipo conduce', ecf.origenTipo, 'conduce')
igual('e-CF: cliente del conduce (el nombre actual, no el guardado)', [ecf.clienteId, ecf.clienteNombre], ['7', CLIENTE])
igual('e-CF: origen = code del conduce', ecf.origen, 'CON-000003')
igual('e-CF: precioConItbis false (el precio interno no trae ITBIS)', ecf.precioConItbis, false)
igual('e-CF: aviso de las 2 líneas sin precio (ni cargos ni la línea en blanco)', ecf.avisos, [AVISO_PRECIO])
igual('e-CF: 6 líneas (la de descripción en blanco se descarta)', ecf.lineas.length, 6)
igual('e-CF: producto al 18%, ligado al catálogo', ecf.lineas[0], {
  nombre: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2000, prodId: '55', unidadMedida: 43, indFact: 1,
  tipoItem: 'Bien',
})
igual('e-CF: servicio al 16% (indicadores como texto)', ecf.lineas[1], {
  nombre: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1000, prodId: '56', unidadMedida: 43, indFact: 2,
  tipoItem: 'Servicio',
})
igual('e-CF: línea libre sin precio: precio 0, sin prodId, su unidad y el texto recortado', ecf.lineas[2], {
  nombre: 'CORTE DE TUBO', cantidad: 2.5, precio: 0, unidadMedida: 47, indFact: 1, tipoItem: 'Bien',
})
igual('e-CF: precio con decimales tal cual', ecf.lineas[3], {
  nombre: 'TORNILLO GALVANIZADO 1/4', cantidad: 10, precio: 13.7, prodId: '58', unidadMedida: 43, indFact: 1,
  tipoItem: 'Bien',
})
igual('e-CF: exento', ecf.lineas[4], {
  nombre: 'TODO EXENTO', cantidad: 3, precio: 10, prodId: '57', unidadMedida: 43, indFact: 4, tipoItem: 'Bien',
})
igual('e-CF: línea libre de servicio sin precio', ecf.lineas[5], {
  nombre: 'FLETE A OBRA', cantidad: 1, precio: 0, unidadMedida: 43, indFact: 1, tipoItem: 'Servicio',
})

// --- Factura simple --------------------------------------------------------
const simple = conduceAFacturaSimplePrefill(fila)
igual('simple: kind factura-simple-prefill', simple.kind, 'factura-simple-prefill')
igual('simple: origenTipo conduce', simple.origenTipo, 'conduce')
igual('simple: cliente y origen', [simple.clienteId, simple.clienteNombre, simple.origen], ['7', CLIENTE, 'CON-000003'])
igual('simple: el mismo aviso de las líneas sin precio', simple.avisos, [AVISO_PRECIO])
igual('simple: 6 líneas', simple.lineas.length, 6)
igual('simple: 2,000 al 18% → 2,360 con ITBIS', simple.lineas[0], {
  prodId: '55', descripcion: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2360, unidadMedida: 43,
})
igual('simple: 1,000 al 16% → 1,160', simple.lineas[1], {
  prodId: '56', descripcion: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1160, unidadMedida: 43,
})
igual('simple: sin precio sigue en 0 (0 con ITBIS es 0)', simple.lineas[2], {
  descripcion: 'CORTE DE TUBO', cantidad: 2.5, precio: 0, unidadMedida: 47,
})
igual('simple: 13.70 al 18% → 16.166 (r4, como en la cotización de Ferretería)', simple.lineas[3], {
  prodId: '58', descripcion: 'TORNILLO GALVANIZADO 1/4', cantidad: 10, precio: 16.166, unidadMedida: 43,
})
igual('simple: exento, el precio no cambia', simple.lineas[4], {
  prodId: '57', descripcion: 'TODO EXENTO', cantidad: 3, precio: 10, unidadMedida: 43,
})
igual('simple: línea libre de servicio sin precio', simple.lineas[5], {
  descripcion: 'FLETE A OBRA', cantidad: 1, precio: 0, unidadMedida: 43,
})

// --- nombreConduce ---------------------------------------------------------
igual('nombre: el del cliente actual', nombreConduce(fila), CLIENTE)
igual('nombre: cliente borrado → el guardado', nombreConduce({ ...fila, client_name: null }), 'HOSPITAL DOCENTE')
igual('nombre: texto vacío cuenta como ausente', nombreConduce({ ...fila, client_name: '' }), 'HOSPITAL DOCENTE')
igual('nombre: sin ninguno → vacío', nombreConduce({ id: 1, client_name: null, client_name_guardado: null }), '')

// --- lineasSinPrecio -------------------------------------------------------
igual('sin precio: 2 en la fila (la de descripción en blanco no cuenta)', lineasSinPrecio(fila), 2)
igual('sin precio: sin líneas → 0', lineasSinPrecio({ id: 1 }), 0)
igual('sin precio: amount ausente o null cuenta como sin precio',
  lineasSinPrecio({ id: 1, items: [{ description: 'A' }, { description: 'B', amount: null }, { description: 'C', amount: '1.0000' }] }), 2)

// --- Todas con precio: ningún aviso ----------------------------------------
const conPrecio: ConduceRow = { ...fila, items: (fila.items ?? []).filter((it) => Number(it.amount) > 0) }
igual('todas con precio: e-CF sin avisos', conduceAFacturaPrefill(conPrecio).avisos, [])
igual('todas con precio: simple sin avisos', conduceAFacturaSimplePrefill(conPrecio).avisos, [])

// --- Cliente borrado -------------------------------------------------------
// El LEFT JOIN con clients no encontró la fila: client_name null y client_id
// con el id viejo. La factura abre sin cliente y lo dice: con el id del
// borrado, la e-CF fallaría al emitir y la simple se guardaría sin nombre.
const sinCliente: ConduceRow = {
  ...fila, client_id: 9, client_name: null, company_name: null, rnc: null, client_name_guardado: 'FERRETERIA EL MARTILLO',
}
const ecfSinCliente = conduceAFacturaPrefill(sinCliente)
igual('cliente borrado: e-CF sin clienteId, con el nombre guardado',
  [ecfSinCliente.clienteId, ecfSinCliente.clienteNombre], ['', 'FERRETERIA EL MARTILLO'])
igual('cliente borrado: e-CF avisa primero el cliente y luego los precios', ecfSinCliente.avisos, [AVISO_CLIENTE, AVISO_PRECIO])
const simpleSinCliente = conduceAFacturaSimplePrefill(sinCliente)
igual('cliente borrado: simple igual', [simpleSinCliente.clienteId, simpleSinCliente.clienteNombre, simpleSinCliente.avisos],
  ['', 'FERRETERIA EL MARTILLO', [AVISO_CLIENTE, AVISO_PRECIO]])
igual('client_id null: tampoco hay cliente', conduceAFacturaPrefill({ ...conPrecio, client_id: null }).avisos, [AVISO_CLIENTE])

// --- Fila sin code y sin las columnas de catálogo ---------------------------
const vieja: ConduceRow = {
  id: 3,
  client_id: 7,
  client_name: CLIENTE,
  items: [{ description: 'SIN DATOS DEL CATALOGO', quantity: '1.000', amount: '100.0000', indicador_facturacion: '9' }],
}
igual('sin code: el origen es #id', conduceAFacturaPrefill(vieja).origen, '#3')
igual('e-CF sin columnas de catálogo: los defaults de una línea libre (indicador fuera de rango → 1)',
  conduceAFacturaPrefill(vieja).lineas, [
    { nombre: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 100, unidadMedida: 43, indFact: 1, tipoItem: 'Bien' },
  ])
igual('simple sin columnas de catálogo: 18% por defecto y sin unidad', conduceAFacturaSimplePrefill(vieja).lineas, [
  { descripcion: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 118, unidadMedida: null },
])

// --- El texto del bloqueo por línea (spec 5.6) ------------------------------
igual('texto del error de la línea sin precio', MSG_SIN_PRECIO, 'Escribe el precio: en el conduce esta línea no tenía.')

// --- La cotización de Ferretería no cambia -----------------------------------
// Su borrador no lleva origenTipo: sin él, los dos formularios muestran los
// textos de siempre y no bloquean el precio 0.
const cotizacion: CotizacionRow = {
  id: 12, code: 'COT-000012', client_id: 7, client_name: CLIENTE, formato: 'ferreteria', ajustes: {},
  items: [{ description: 'LINEA EN CERO', quantity: '1.000', amount: '0.0000', product_id: null, unidad_medida: '43',
    indicador_facturacion: 1, indicador_bien_servicio: 1 }],
}
igual('cotización: el borrador e-CF no trae origenTipo ni avisos de precio',
  ['origenTipo' in ferreteriaAFacturaPrefill(cotizacion), ferreteriaAFacturaPrefill(cotizacion).avisos], [false, []])
igual('cotización: el borrador simple tampoco',
  ['origenTipo' in ferreteriaAFacturaSimplePrefill(cotizacion), ferreteriaAFacturaSimplePrefill(cotizacion).avisos], [false, []])

// --- La key del formulario de factura (App, Nueva > Factura) --------------------
// Cada borrador monta su propio formulario; sin borrador, 'nueva' (que no cambia, para que Nueva >
// Factura no borre lo escrito en uno en blanco). El origen se identifica por su tipo y su codigo; `vieja`
// es un conduce sin code (id 3, origen "#3").
const cotizacion2: CotizacionRow = { ...cotizacion, id: 13, code: 'COT-000013' }
const cotizacionSinCodigo: CotizacionRow = { ...cotizacion, id: 3, code: '' }
igual('key: sin borrador es "nueva"', [claveFormularioFactura(null)], ['nueva'])
igual('key: una cotizacion convertida, e-CF y simple con la misma regla',
  [claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacion)), claveFormularioFactura(ferreteriaAFacturaSimplePrefill(cotizacion))],
  ['cotizacion-COT-000012', 'cotizacion-COT-000012'])
igual('key: un conduce convertido, e-CF y simple con la misma regla (antes la simple lo llamaba "cotizacion-CON-...")',
  [claveFormularioFactura(conduceAFacturaPrefill(fila)), claveFormularioFactura(conduceAFacturaSimplePrefill(fila))],
  ['conduce-CON-000003', 'conduce-CON-000003'])
igual('key: el borrador de una cotizacion de Gratex (origen = su codigo, sin origenTipo)',
  [claveFormularioFactura({ origen: 'COT-000007' })], ['cotizacion-COT-000007'])
const claves = [
  claveFormularioFactura(null),
  claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacion)),
  claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacion2)),
  claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacionSinCodigo)),
  claveFormularioFactura(conduceAFacturaPrefill(fila)),
  claveFormularioFactura(conduceAFacturaPrefill(vieja)),
]
chk('key: en blanco, cotizacion A, cotizacion B, cotizacion sin codigo, conduce y conduce sin codigo: seis distintas',
  new Set(claves).size === claves.length)
igual('key: una cotizacion y un conduce sin codigo, los dos con origen "#3", no comparten key',
  [ferreteriaAFacturaPrefill(cotizacionSinCodigo).origen, conduceAFacturaPrefill(vieja).origen,
    claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacionSinCodigo)), claveFormularioFactura(conduceAFacturaPrefill(vieja))],
  ['#3', '#3', 'cotizacion-#3', 'conduce-#3'])
igual('key: el mismo borrador da siempre la misma key (el formulario no se desmonta al volver a renderizar)',
  [claveFormularioFactura(ferreteriaAFacturaPrefill(cotizacion)) === claveFormularioFactura(ferreteriaAFacturaPrefill({ ...cotizacion }))],
  [true])

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
