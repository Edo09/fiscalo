// Validación, cuerpo y textos del conduce de mercancía (spec conduces 5.5):
// lo que el formulario deja pasar, lo que manda a /api/conduces y lo que dice
// en pantalla. Las reglas de la unidad se inyectan como en el formulario, aquí
// con un catálogo de prueba (43 = Unidad, entera; 47 = Metro, admite
// fracciones; 99 no existe), igual que test-schema-cotizacion-ferreteria.ts.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-schema-conduce.ts
import {
  MSG_CLIENTE_BORRADO, MSG_CONDUCE_NO_EXISTE, MSG_COTIZACION_NO_EXISTE, MSG_FECHA, MSG_SIN_CLIENTE, MSG_SIN_LINEAS,
  MSG_SOLO_FERRETERIA, avisoCargosConduce, conduceFormSchema, confirmacionEliminar, cuerpoConduce, lineaVacia,
  mapearErroresConduce, sinErroresConduce,
} from '../src/features/conduces/schema.ts'
import type { FormConduce } from '../src/features/conduces/schema.ts'
import { avisosCargos } from '../src/features/cotizaciones/formatos/ferreteria/conversion.ts'
import type { LineaFerreteriaForm } from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import type { CotizacionRow } from '../src/api/types.ts'
import type { Cliente } from '../src/types/domain.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const esquema = conduceFormSchema({
  problemaCantidad: (cantidad, unidad) => {
    if (!(cantidad > 0)) return 'La cantidad debe ser mayor que 0.'
    if (unidad === 43 && !Number.isInteger(cantidad)) return 'La unidad «Unidad» no admite fracciones: usa una cantidad entera o cambia la unidad.'
    if (Math.round(cantidad * 100) !== cantidad * 100) return 'La cantidad admite hasta 2 decimales.'
    return null
  },
  problemaUnidad: (unidad) => ([43, 47].includes(unidad) ? null : 'Elige la unidad de medida de esta línea.'),
})

const cliente: Cliente = {
  id: '7', nombre: 'HOSPITAL DOCENTE', contacto: '', empresa: '', tipo: 'RNC', doc: '401515131', email: '', tel: '',
  ciudad: '', balance: 0, facturas: 0, estado: '', desde: '', descuento: 0, permiteCredito: false,
}
const linea = (id: number, cambio: Partial<LineaFerreteriaForm> = {}): LineaFerreteriaForm => ({
  id, prodId: '', descripcion: `ARTICULO ${id}`, cantidad: 1, precio: 100, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
  ...cambio,
})
const form = (cambio: Partial<FormConduce> = {}): FormConduce => ({
  cliente, clienteEscrito: { buscador: '', libre: '' }, fecha: '2026-10-05', lineas: [linea(1)],
  ...cambio,
})
/** Errores ya mapeados, o null si el formulario pasa. */
const errores = (f: FormConduce) => {
  const r = esquema.safeParse(f)
  return r.success ? null : mapearErroresConduce(r.error, f.lineas)
}

console.log('Lo que pasa y el cuerpo que viaja')
chk('un formulario completo pasa', errores(form()) === null)
chk('una línea libre con precio 0 pasa (el precio no se ve ni se pide)',
  errores(form({ lineas: [linea(1, { precio: 0, descripcion: 'ENTREGA DE ARENA' })] })) === null)

const alCrear = cuerpoConduce({
  clienteId: 7,
  cotizacionId: 12,
  lineas: [
    linea(1, { prodId: '55', descripcion: '  FUNDAS CEMENTO GRIS ', cantidad: 2, precio: 935 }),
    linea(2, { descripcion: 'CORTE DE TUBO', cantidad: 1.5, precio: 84.74583, unidadMedida: 47, indFact: 4, tipoItem: 'Servicio' }),
    linea(3, { descripcion: 'ARENA', precio: 0 }),
  ],
  date: '2026-10-05 10:15:00',
})
chk('cuerpo al crear: cotización, cliente, fecha y líneas como los espera el API', JSON.stringify(alCrear) === JSON.stringify({
  cotizacion_id: 12,
  client_id: 7,
  date: '2026-10-05 10:15:00',
  items: [
    { product_id: 55, description: 'FUNDAS CEMENTO GRIS', quantity: 2, unidad_medida: '43', amount: 935, indicador_facturacion: 1, indicador_bien_servicio: 1 },
    { product_id: null, description: 'CORTE DE TUBO', quantity: 1.5, unidad_medida: '47', amount: 84.7458, indicador_facturacion: 4, indicador_bien_servicio: 2 },
    { product_id: null, description: 'ARENA', quantity: 1, unidad_medida: '43', amount: 0, indicador_facturacion: 1, indicador_bien_servicio: 1 },
  ],
}))
chk('cuerpo: nunca lleva ajustes ni formato (el backend rechaza los ajustes)', !('ajustes' in alCrear) && !('formato' in alCrear))
const alEditar = cuerpoConduce({ clienteId: 7, lineas: [linea(1)], cotizacionId: null })
chk('cuerpo al editar: sin cotizacion_id ni date (el PUT conserva la fecha guardada)',
  !('cotizacion_id' in alEditar) && !('date' in alEditar) && alEditar.client_id === 7)
// Un conduce nuevo SIN cotización ("Nuevo conduce", decisión del 2026-10-08): ConduceForm manda cotizacionId null
// y el POST no lleva la clave cotizacion_id (ni siquiera null): el backend entiende su ausencia como "sin cotización".
const lineasSinCot = [linea(1, { prodId: '55', descripcion: 'FUNDAS CEMENTO GRIS', cantidad: 2, precio: 935 }), linea(2, { descripcion: 'ARENA', precio: 0 })]
const sinCotizacion = cuerpoConduce({ clienteId: 7, lineas: lineasSinCot, cotizacionId: null, date: '2026-10-08 09:00:00' })
chk('cuerpo al crear sin cotización: ni la clave cotizacion_id (ni null), con cliente, fecha y líneas como siempre',
  !('cotizacion_id' in sinCotizacion) && !JSON.stringify(sinCotizacion).includes('cotizacion_id')
  && JSON.stringify(sinCotizacion) === JSON.stringify({
    client_id: 7,
    date: '2026-10-08 09:00:00',
    items: [
      { product_id: 55, description: 'FUNDAS CEMENTO GRIS', quantity: 2, unidad_medida: '43', amount: 935, indicador_facturacion: 1, indicador_bien_servicio: 1 },
      { product_id: null, description: 'ARENA', quantity: 1, unidad_medida: '43', amount: 0, indicador_facturacion: 1, indicador_bien_servicio: 1 },
    ],
  }))
chk('cuerpo sin cotización: cotizacionId ausente da lo mismo que null',
  JSON.stringify(cuerpoConduce({ clienteId: 7, lineas: lineasSinCot, date: '2026-10-08 09:00:00' })) === JSON.stringify(sinCotizacion))
chk('cuerpo con cotización: sigue llevando cotizacion_id, como primera clave',
  Object.keys(cuerpoConduce({ clienteId: 7, lineas: lineasSinCot, cotizacionId: 12 }))[0] === 'cotizacion_id')
chk('cuerpo: la cantidad viaja con 2 decimales', cuerpoConduce({ clienteId: 7, lineas: [linea(1, { cantidad: 2.005, unidadMedida: 47 })] })
  .items[0].quantity === 2.01)

console.log('Cliente')
chk('sin cliente: el mensaje del backend', errores(form({ cliente: null }))?.cliente === MSG_SIN_CLIENTE)
chk('texto en el buscador sin elegir', errores(form({ cliente: null, clienteEscrito: { buscador: 'Juan', libre: '' } }))?.cliente
  === '«Juan» no está elegido: elígelo de la lista o créalo con el botón +.')
chk('nombre libre sin guardar', (errores(form({ cliente: null, clienteEscrito: { buscador: '', libre: 'Pedro Pérez' } }))?.cliente ?? '')
  .startsWith('«Pedro Pérez» todavía no es un cliente'))

console.log('Fecha')
chk('fecha vacía', errores(form({ fecha: '' }))?.fecha === 'Pon la fecha del conduce.')
chk('fecha que no existe (30 de febrero)', errores(form({ fecha: '2026-02-30' }))?.fecha === MSG_FECHA)

console.log('Líneas')
chk('sin líneas: error del formulario con el texto del backend', errores(form({ lineas: [] }))?.form === MSG_SIN_LINEAS)
chk('lineaVacia: sin producto ni descripción sí, aunque tenga precio',
  lineaVacia(linea(1, { descripcion: ' ', precio: 935 })) && lineaVacia(linea(1, { descripcion: '', precio: 0 })))
chk('lineaVacia: con descripción no, con producto no',
  !lineaVacia(linea(1, { descripcion: 'X', precio: 0 })) && !lineaVacia(linea(1, { descripcion: '', prodId: '9' })))
const malas = errores(form({
  cliente: null,
  lineas: [
    linea(10),
    linea(20, { prodId: '9', descripcion: '  ' }),
    linea(30, { descripcion: 'X'.repeat(1001), cantidad: 1.5 }),
    linea(40, { unidadMedida: 99, cantidad: 0 }),
  ],
}))
chk('producto sin descripción: el error va a su id (20)', malas?.lineas[20]?.descripcion === 'Escribe la descripción.')
chk('descripción de 1001 caracteres', malas?.lineas[30]?.descripcion === 'La descripción admite hasta 1000 caracteres.')
chk('fracción en una unidad entera', (malas?.lineas[30]?.cantidad ?? '').includes('no admite fracciones'))
chk('unidad fuera del catálogo', malas?.lineas[40]?.unidadMedida === 'Elige la unidad de medida de esta línea.')
chk('cantidad 0', malas?.lineas[40]?.cantidad === 'La cantidad debe ser mayor que 0.')
chk('la línea correcta (10) no lleva errores', malas?.lineas[10] === undefined)
chk('el cliente se marca a la vez que las líneas', malas?.cliente === MSG_SIN_CLIENTE)
chk('ninguna línea lleva error de precio', Object.values(malas?.lineas ?? {}).every((e) => !('precio' in e)))
chk('1.5 metros sí se acepta', errores(form({ lineas: [linea(1, { unidadMedida: 47, cantidad: 1.5 })] })) === null)
chk('sinErroresConduce: vacío y sin grupo de ajustes', JSON.stringify(sinErroresConduce()) === '{"lineas":{}}')
chk('mapearErroresConduce no trae ajustes', malas !== null && !('ajustes' in malas))

console.log('Aviso de cargos de la cotización')
const cot = (ajustes: Record<string, string | number>, code: string | null = 'COT-000012'): CotizacionRow => ({
  id: 12, code, formato: 'ferreteria', ajustes, items: [],
})
const conCargos = cot({ cargos_bancarios: '100.0000', manejo_bancario: '0.00', mano_obra: '1500.00', abono: '200.00', retencion_isr: '50.00' })
chk('con cargos: el texto con la lista, en el orden del PDF', avisoCargosConduce(conCargos)
  === 'La cotización COT-000012 tenía cargos adicionales (Cargos bancarios RD$ 100.00, Costo mano de obra RD$ 1,500.00): no pasan al conduce ni a la factura que salga de él.')
chk('solo abono y retención: no son cargos, no hay aviso', avisoCargosConduce(cot({ abono: '200.00', retencion_isr: '50.00' })) === null)
chk('sin ajustes (o {} como en Gratex): no hay aviso', avisoCargosConduce(cot({})) === null && avisoCargosConduce({ id: 3 }) === null)
chk('sin código: la nombra por su id', (avisoCargosConduce(cot({ mano_obra: 10 }, null)) ?? '').startsWith('La cotización #12 tenía cargos adicionales (Costo mano de obra RD$ 10.00)'))
const casos = [conCargos, cot({}), cot({ abono: 5 }), cot({ manejo_bancario: '0.01' }), cot({ cargos_bancarios: -3 })]
chk('mismo criterio que avisosCargos() al facturar la cotización',
  casos.every((c) => (avisoCargosConduce(c) !== null) === (avisosCargos(c).length > 0)))

console.log('Textos de la pantalla')
chk('cotización que ya no existe', MSG_COTIZACION_NO_EXISTE === 'Esta cotización ya no existe')
chk('cotización que no es de Ferretería', MSG_SOLO_FERRETERIA === 'Solo las cotizaciones de Ferretería generan conduces.')
chk('conduce que ya no existe', MSG_CONDUCE_NO_EXISTE === 'Este conduce ya no existe')
chk('cliente borrado', MSG_CLIENTE_BORRADO === 'El cliente ya no existe: elige otro.')
chk('confirmación de Eliminar', confirmacionEliminar('CON-000007')
  === 'El conduce dejará de verse en la lista. Su número CON-000007 no se vuelve a usar.')

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
