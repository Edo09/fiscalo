// Piezas del papel de Ferretería que comparten la cotización y el conduce
// (formatos/ferreteria/lineas.ts, spec conduces 5.5): las líneas que se leen
// de un documento guardado, la línea libre, la de un producto del catálogo,
// la ficha provisional del cliente y el RNC con guiones. Fija lo que hacían
// dentro de FerreteriaCotizacionForm antes de salir de allí: la cotización
// no cambia. Las filas son como las del API: los DECIMAL llegan como texto, y
// los indicadores como número en cotizacion_items y como texto en conduce_items.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-lineas-ferreteria.ts
import type { ConduceRow, CotizacionRow } from '../src/api/types.ts'
import type { Producto } from '../src/types/domain.ts'
import {
  clienteDeFila, formatearRnc, indicadorDe, lineaDesdeProducto, lineaLibre, lineasDeFila, siguienteId,
} from '../src/features/cotizaciones/formatos/ferreteria/lineas.ts'

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

console.log('Línea libre e ids')
igual('lineaLibre: 18%, unidad 43, Bien, cantidad 1, sin producto ni precio', lineaLibre(4),
  { id: 4, prodId: '', descripcion: '', cantidad: 1, precio: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien' })
igual('siguienteId de una lista vacía: 1', siguienteId([]), 1)
igual('siguienteId: el mayor + 1, no la cantidad de líneas', siguienteId([lineaLibre(3), lineaLibre(7), lineaLibre(5)]), 8)

console.log('Indicador de facturación guardado')
igual('2, 3 y 4 se respetan', [indicadorDe(2), indicadorDe(3), indicadorDe(4)], [2, 3, 4])
igual('como texto (conduce_items) también', [indicadorDe('2'), indicadorDe('4')], [2, 4])
igual('null, ausente, 0, 5 o basura: 1 (18%), como el backend',
  [indicadorDe(null), indicadorDe(undefined), indicadorDe(0), indicadorDe(5), indicadorDe('x')], [1, 1, 1, 1, 1])

console.log('Líneas de una cotización guardada')
const cotizacion: CotizacionRow = {
  id: 12, code: 'COT-000012', client_id: 7, client_name: 'FERRETERIA EL CLAVO', formato: 'ferreteria',
  items: [
    { id: 31, description: 'FUNDAS CEMENTO GRIS', quantity: '2.000', amount: '935.0000', product_id: 55,
      unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1 },
    { id: 32, description: 'INSTALACION DE LAVAMANOS', quantity: '1.000', amount: '1000.0000', product_id: 56,
      unidad_medida: '43', indicador_facturacion: 2, indicador_bien_servicio: 2 },
    // Línea libre, con otra unidad y una fracción.
    { id: 33, description: 'CORTE DE TUBO', quantity: '2.500', amount: '13.7000', product_id: null,
      unidad_medida: '47', indicador_facturacion: 4, indicador_bien_servicio: 1 },
    // Fila sin las columnas de la 026 y con todo vacío: lo de por defecto.
    { id: 34, description: null, quantity: null, amount: null },
  ],
}
igual('cada línea con su producto, cantidad, precio, tasa, unidad y bien/servicio; ids 1..n', lineasDeFila(cotizacion), [
  { id: 1, prodId: '55', descripcion: 'FUNDAS CEMENTO GRIS', cantidad: 2, precio: 935, indFact: 1, unidadMedida: 43, tipoItem: 'Bien' },
  { id: 2, prodId: '56', descripcion: 'INSTALACION DE LAVAMANOS', cantidad: 1, precio: 1000, indFact: 2, unidadMedida: 43, tipoItem: 'Servicio' },
  { id: 3, prodId: '', descripcion: 'CORTE DE TUBO', cantidad: 2.5, precio: 13.7, indFact: 4, unidadMedida: 47, tipoItem: 'Bien' },
  { id: 4, prodId: '', descripcion: '', cantidad: 1, precio: 0, indFact: 1, unidadMedida: 43, tipoItem: 'Bien' },
])
const sinItems: CotizacionRow = { id: 13 }
igual('sin items: ninguna línea', lineasDeFila(sinItems), [])
igual('items null: ninguna línea', lineasDeFila({ items: null }), [])

console.log('Líneas de un conduce guardado (indicadores como texto)')
const conduce: ConduceRow = {
  id: 3, code: 'CON-000003', cotizacion_id: 12, cotizacion_code: 'COT-000012', client_id: null,
  client_name: null, client_name_guardado: 'FERRETERIA EL CLAVO',
  items: [
    { id: 90, conduce_id: 3, description: 'FUNDAS CEMENTO GRIS', quantity: '2.000', amount: '935.0000', product_id: 55,
      unidad_medida: '43', indicador_facturacion: '1', indicador_bien_servicio: '1', activo: '1' },
    // Línea libre del conduce: precio 0, que el conduce sí admite.
    { id: 91, conduce_id: 3, description: 'FLETE A OBRA', quantity: '1.000', amount: '0.0000', product_id: null,
      unidad_medida: '43', indicador_facturacion: '3', indicador_bien_servicio: '2', activo: '1' },
  ],
}
igual('las mismas reglas que la cotización, con los indicadores en texto', lineasDeFila(conduce), [
  { id: 1, prodId: '55', descripcion: 'FUNDAS CEMENTO GRIS', cantidad: 2, precio: 935, indFact: 1, unidadMedida: 43, tipoItem: 'Bien' },
  { id: 2, prodId: '', descripcion: 'FLETE A OBRA', cantidad: 1, precio: 0, indFact: 3, unidadMedida: 43, tipoItem: 'Servicio' },
])

console.log('Ficha provisional del cliente')
igual('sin client_id: null', clienteDeFila({ client_id: null, client_name: 'X' }), null)
igual('client_id 0: null', clienteDeFila({ client_id: 0 }), null)
igual('con id y nombre: una ficha con solo eso', clienteDeFila(cotizacion), {
  id: '7', nombre: 'FERRETERIA EL CLAVO', contacto: '', empresa: '', tipo: '—', doc: '', email: '', tel: '', ciudad: '',
  balance: 0, facturas: 0, estado: '', desde: '', descuento: 0, permiteCredito: false,
})
igual('sin nombre: «Cliente #id»', clienteDeFila({ client_id: 9, client_name: null })?.nombre, 'Cliente #9')

console.log('RNC o cédula con guiones (como el PDF)')
igual('RNC de 9 dígitos', formatearRnc('101234567'), '101-23456-7')
igual('cédula de 11 dígitos', formatearRnc('00112345678'), '001-1234567-8')
igual('con guiones o espacios de más: se rehacen', formatearRnc(' 1-01-23456-7 '), '101-23456-7')
igual('otro largo: tal cual, sin espacios alrededor', formatearRnc('  12345 '), '12345')
igual('null o ausente: vacío', [formatearRnc(null), formatearRnc(undefined)], ['', ''])

console.log('Línea de un producto del catálogo')
const producto = (p: Partial<Producto>): Producto => ({
  id: '55', sku: 'CEM-01', nombre: 'FUNDAS CEMENTO GRIS', cat: 'Construcción', categoryId: 2, warehouseId: 1,
  tipo: 'Bien', precio: 935, costo: 700, stock: 40, min: 5, itbis: 18, unidadMedida: 43, estado: 'activo', ...p,
})
igual('su nombre, su precio SIN ITBIS, 18% → 1, su unidad, Bien, cantidad 1', lineaDesdeProducto(producto({}), 3),
  { id: 3, prodId: '55', descripcion: 'FUNDAS CEMENTO GRIS', cantidad: 1, precio: 935, indFact: 1, unidadMedida: 43, tipoItem: 'Bien' })
igual('16% → 2; 0% → 4 (indFactFromItbis)',
  [lineaDesdeProducto(producto({ itbis: 16 }), 1).indFact, lineaDesdeProducto(producto({ itbis: 0 }), 1).indFact], [2, 4])
igual('un servicio con su unidad', lineaDesdeProducto(producto({ id: '56', tipo: 'Servicio', unidadMedida: 47 }), 2),
  { id: 2, prodId: '56', descripcion: 'FUNDAS CEMENTO GRIS', cantidad: 1, precio: 935, indFact: 1, unidadMedida: 47, tipoItem: 'Servicio' })
igual('sin unidad (0): 43', lineaDesdeProducto(producto({ unidadMedida: 0 }), 1).unidadMedida, 43)
igual('un tipo que no es Servicio: Bien', lineaDesdeProducto(producto({ tipo: 'Producto' }), 1).tipoItem, 'Bien')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
