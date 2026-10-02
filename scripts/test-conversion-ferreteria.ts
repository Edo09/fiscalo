// Conversión de una cotización de Ferretería en factura (spec 8.3): los
// borradores con que se abren la factura e-CF y la factura simple, y el aviso
// de los cargos que no se copian. Las filas son como las de
// GET /api/cotizaciones: los DECIMAL llegan como texto y las columnas INT
// como número.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-conversion-ferreteria.ts
import type { CotizacionRow } from '../src/api/types.ts'
import { r2 } from '../src/features/invoices/montosLinea.ts'
import {
  avisosCargos, ferreteriaAFacturaPrefill, ferreteriaAFacturaSimplePrefill,
} from '../src/features/cotizaciones/formatos/ferreteria/conversion.ts'

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
const fila: CotizacionRow = {
  id: 12,
  code: 'COT-000012',
  date: '2026-09-02 10:15:00',
  client_id: 7,
  client_name: CLIENTE,
  formato: 'ferreteria',
  numero: 12,
  subtotal: '15064.25',
  itbis: '2686.17',
  // 15,064.25 + 2,686.17 + cargos 100.00 + mano de obra 1,500.00 (the same row as Task 16's mock COT-000012).
  total: '19350.42',
  // Retención y abono no son cargos: no pasan a la factura ni generan aviso.
  ajustes: { cargos_bancarios: '100.00', mano_obra: '1500.00', abono: '1000.00', retencion_isr: '753.21' },
  items: [
    { id: 1, cotizacion_id: 12, description: 'GALONES DE PINTURA BLNACA SEMIGLOSS', quantity: '7.000', amount: '2000.0000',
      subtotal: '14000.00', product_id: 55, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1,
      itbis_amount: '2520.00' },
    { id: 2, cotizacion_id: 12, description: 'INSTALACION DE LAVAMANOS', quantity: '1.000', amount: '1000.0000',
      subtotal: '1000.00', product_id: 56, unidad_medida: '43', indicador_facturacion: 2, indicador_bien_servicio: 2,
      itbis_amount: '160.00' },
    // Línea libre (sin producto), con otra unidad y espacios alrededor del texto.
    { id: 3, cotizacion_id: 12, description: '  CORTE DE TUBO ', quantity: '2.500', amount: '13.7000',
      subtotal: '34.25', product_id: null, unidad_medida: '47', indicador_facturacion: 1, indicador_bien_servicio: 1,
      itbis_amount: '6.17' },
    { id: 4, cotizacion_id: 12, description: 'TODO EXENTO', quantity: '3.000', amount: '10.0000',
      subtotal: '30.00', product_id: 57, unidad_medida: '43', indicador_facturacion: 4, indicador_bien_servicio: 1,
      itbis_amount: '0.00' },
    // Sin descripción no hay qué facturar: se descarta, como en la conversión de Gratex.
    { id: 5, cotizacion_id: 12, description: '   ', quantity: '1.000', amount: '5.0000' },
  ],
}
const AVISO = 'La cotización COT-000012 tenía cargos adicionales: Cargos bancarios RD$ 100.00, '
  + 'Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.'

// --- Factura e-CF ----------------------------------------------------------
const ecf = ferreteriaAFacturaPrefill(fila)
igual('e-CF: kind factura-prefill', ecf.kind, 'factura-prefill')
igual('e-CF: cliente de la cotización', [ecf.clienteId, ecf.clienteNombre], ['7', CLIENTE])
igual('e-CF: origen = code', ecf.origen, 'COT-000012')
igual('e-CF: precioConItbis false (los precios de Ferretería no traen ITBIS)', ecf.precioConItbis, false)
igual('e-CF: aviso de los cargos (no de retención ni abono)', ecf.avisos, [AVISO])
igual('e-CF: 4 líneas (la de descripción en blanco se descarta)', ecf.lineas.length, 4)
igual('e-CF: producto al 18%, ligado al catálogo', ecf.lineas[0], {
  nombre: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2000, prodId: '55', unidadMedida: 43, indFact: 1,
  tipoItem: 'Bien',
})
igual('e-CF: servicio al 16%', ecf.lineas[1], {
  nombre: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1000, prodId: '56', unidadMedida: 43, indFact: 2,
  tipoItem: 'Servicio',
})
igual('e-CF: línea libre sin prodId, con su unidad y el texto recortado', ecf.lineas[2], {
  nombre: 'CORTE DE TUBO', cantidad: 2.5, precio: 13.7, unidadMedida: 47, indFact: 1, tipoItem: 'Bien',
})
igual('e-CF: exento', ecf.lineas[3], {
  nombre: 'TODO EXENTO', cantidad: 3, precio: 10, prodId: '57', unidadMedida: 43, indFact: 4, tipoItem: 'Bien',
})

// --- Factura simple --------------------------------------------------------
const simple = ferreteriaAFacturaSimplePrefill(fila)
igual('simple: kind factura-simple-prefill', simple.kind, 'factura-simple-prefill')
igual('simple: cliente y origen', [simple.clienteId, simple.clienteNombre, simple.origen], ['7', CLIENTE, 'COT-000012'])
igual('simple: el mismo aviso de cargos', simple.avisos, [AVISO])
igual('simple: 4 líneas', simple.lineas.length, 4)
igual('simple: 2,000 al 18% → 2,360 con ITBIS', simple.lineas[0], {
  prodId: '55', descripcion: 'GALONES DE PINTURA BLNACA SEMIGLOSS', cantidad: 7, precio: 2360, unidadMedida: 43,
})
igual('simple: 1,000 al 16% → 1,160', simple.lineas[1], {
  prodId: '56', descripcion: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1160, unidadMedida: 43,
})
igual('simple: 13.70 al 18% → 16.166 (r4, sin el ruido binario de 16.165999…)', simple.lineas[2], {
  descripcion: 'CORTE DE TUBO', cantidad: 2.5, precio: 16.166, unidadMedida: 47,
})
igual('simple: exento, el precio no cambia', simple.lineas[3], {
  prodId: '57', descripcion: 'TODO EXENTO', cantidad: 3, precio: 10, unidadMedida: 43,
})
igual('simple: 7 × 2,360.0000 = 16,520.00 (ejemplo del spec)', r2(simple.lineas[0].cantidad * simple.lineas[0].precio), 16520)

// --- avisosCargos ----------------------------------------------------------
igual('avisos: fila de Gratex (ajustes {}) → ninguno', avisosCargos({ id: 1, ajustes: {} }), [])
igual('avisos: sin ajustes → ninguno', avisosCargos({ id: 1 }), [])
igual('avisos: solo retención y abono → ninguno',
  avisosCargos({ ...fila, ajustes: { abono: '1000.00', retencion_isr: '753.21' } }), [])
igual('avisos: un cargo, el texto del spec', avisosCargos({ ...fila, ajustes: { mano_obra: '1500.00' } }), [
  'La cotización COT-000012 tenía cargos adicionales: Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.',
])
igual('avisos: los tres cargos, en el orden del PDF',
  avisosCargos({ ...fila, ajustes: { mano_obra: '1500.00', manejo_bancario: '50.00', cargos_bancarios: '100.00' } }), [
    'La cotización COT-000012 tenía cargos adicionales: Cargos bancarios RD$ 100.00, Manejos de operaciones bancarias '
    + 'RD$ 50.00, Costo mano de obra RD$ 1,500.00 — agrégalos como línea si corresponde.',
  ])
igual('avisos: un cargo en 0.00 no cuenta', avisosCargos({ ...fila, ajustes: { mano_obra: '0.00' } }), [])

// --- Fila sin code, sin cliente y sin las columnas de la 026 ----------------
const vieja: CotizacionRow = {
  id: 12,
  client_id: null,
  client_name: null,
  items: [{ description: 'SIN DATOS DEL CATALOGO', quantity: '1.000', amount: '100.0000' }],
}
const ecfVieja = ferreteriaAFacturaPrefill(vieja)
igual('sin code: el origen es #id', ecfVieja.origen, '#12')
igual('sin cliente: clienteId y nombre vacíos', [ecfVieja.clienteId, ecfVieja.clienteNombre], ['', ''])
igual('e-CF sin columnas de la 026: los defaults de una línea libre', ecfVieja.lineas, [
  { nombre: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 100, unidadMedida: 43, indFact: 1, tipoItem: 'Bien' },
])
igual('simple sin columnas de la 026: 18% por defecto y sin unidad', ferreteriaAFacturaSimplePrefill(vieja).lineas, [
  { descripcion: 'SIN DATOS DEL CATALOGO', cantidad: 1, precio: 118, unidadMedida: null },
])
igual('sin code: el aviso nombra #id', avisosCargos({ ...vieja, ajustes: { cargos_bancarios: '25.50' } }), [
  'La cotización #12 tenía cargos adicionales: Cargos bancarios RD$ 25.50 — agrégalos como línea si corresponde.',
])

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
