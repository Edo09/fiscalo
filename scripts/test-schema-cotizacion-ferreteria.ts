// Validación y cuerpo de la cotización de Ferretería (spec 6.5 y 8.1): lo que
// el formulario deja pasar y lo que manda al API. Las reglas de la unidad se
// inyectan como en el formulario, aquí con un catálogo de prueba (43 = Unidad,
// entera; 47 = Metro, admite fracciones; 99 no existe).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-schema-cotizacion-ferreteria.ts
import {
  cuerpoFerreteria, ferreteriaFormSchema, lineaEnBlanco, mapearErrores,
} from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import type { FormFerreteria, LineaFerreteriaForm } from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import type { Cliente } from '../src/types/domain.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const esquema = ferreteriaFormSchema({
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
const SIN_AJUSTES = { cargosBancarios: 0, manejoBancario: 0, manoObra: 0, abono: 0, retencion: false }
const form = (cambio: Partial<FormFerreteria> = {}): FormFerreteria => ({
  cliente, clienteEscrito: { buscador: '', libre: '' }, fecha: '2026-09-02', lineas: [linea(1)], ajustes: SIN_AJUSTES,
  ...cambio,
})
/** Errores ya mapeados, o null si el formulario pasa. */
const errores = (f: FormFerreteria) => {
  const r = esquema.safeParse(f)
  return r.success ? null : mapearErrores(r.error, f.lineas)
}

// --- Lo que pasa y el cuerpo que viaja --------------------------------------
chk('un formulario completo pasa', errores(form()) === null)

const cuerpo = cuerpoFerreteria({
  clienteId: 7,
  lineas: [
    linea(1, { prodId: '55', descripcion: '  FUNDAS CEMENTO GRIS ', cantidad: 2, precio: 935 }),
    linea(2, { descripcion: 'CORTE DE TUBO', cantidad: 1.5, precio: 84.74583, unidadMedida: 47, indFact: 4, tipoItem: 'Servicio' }),
  ],
  ajustes: { cargosBancarios: 100.004, manejoBancario: 0, manoObra: 1500, abono: 0, retencion: true },
  date: '2026-09-02 10:15:00',
})
chk('cuerpo: formato, cliente, fecha, líneas y ajustes como los espera el API', JSON.stringify(cuerpo) === JSON.stringify({
  formato: 'ferreteria',
  client_id: 7,
  date: '2026-09-02 10:15:00',
  items: [
    { product_id: 55, description: 'FUNDAS CEMENTO GRIS', quantity: 2, amount: 935, unidad_medida: '43', indicador_facturacion: 1, indicador_bien_servicio: 1 },
    { product_id: null, description: 'CORTE DE TUBO', quantity: 1.5, amount: 84.7458, unidad_medida: '47', indicador_facturacion: 4, indicador_bien_servicio: 2 },
  ],
  ajustes: { cargos_bancarios: 100, manejo_bancario: 0, mano_obra: 1500, abono: 0, retencion_isr: true },
}))
const sinFecha = cuerpoFerreteria({ clienteId: 7, lineas: [linea(1)], ajustes: SIN_AJUSTES })
chk('cuerpo sin fecha: no lleva `date` (el PUT conserva la guardada)', !('date' in sinFecha))
chk('cuerpo: retencion_isr es booleano también sin retención', sinFecha.ajustes.retencion_isr === false)

// --- Cliente -----------------------------------------------------------------
chk('sin cliente', errores(form({ cliente: null }))?.cliente === 'Elige un cliente de la lista o créalo con el botón +.')
chk('texto en el buscador sin elegir', errores(form({ cliente: null, clienteEscrito: { buscador: 'Juan', libre: '' } }))?.cliente
  === '«Juan» no está elegido: elígelo de la lista o créalo con el botón +.')
chk('nombre libre sin guardar', (errores(form({ cliente: null, clienteEscrito: { buscador: '', libre: 'Pedro Pérez' } }))?.cliente ?? '')
  .startsWith('«Pedro Pérez» todavía no es un cliente'))

// --- Fecha -------------------------------------------------------------------
chk('fecha vacía', errores(form({ fecha: '' }))?.fecha === 'Pon la fecha de la cotización.')
chk('fecha que no existe (30 de febrero)', errores(form({ fecha: '2026-02-30' }))?.fecha === 'La fecha no es válida.')

// --- Líneas ------------------------------------------------------------------
chk('sin líneas: error del formulario', (errores(form({ lineas: [] }))?.form ?? '').startsWith('Agrega al menos una línea'))
chk('lineaEnBlanco: fila vacía sí, con precio no, con producto no',
  lineaEnBlanco(linea(1, { descripcion: ' ', precio: 0 }))
  && !lineaEnBlanco(linea(1, { descripcion: '', precio: 5 }))
  && !lineaEnBlanco(linea(1, { descripcion: '', precio: 0, prodId: '9' })))
const malas = errores(form({
  lineas: [
    linea(10),
    linea(20, { descripcion: '  ', precio: 0 }),
    linea(30, { descripcion: 'X'.repeat(1001), precio: 1.23456, cantidad: 1.5 }),
    linea(40, { unidadMedida: 99, cantidad: 0 }),
  ],
}))
chk('línea sin descripción: el error va a su id (20)', malas?.lineas[20]?.descripcion === 'Escribe la descripción.')
chk('precio 0', malas?.lineas[20]?.precio === 'El precio debe ser mayor que 0.')
chk('descripción de 1001 caracteres', malas?.lineas[30]?.descripcion === 'La descripción admite hasta 1000 caracteres.')
chk('precio con 5 decimales', malas?.lineas[30]?.precio === 'El precio admite hasta 4 decimales.')
chk('fracción en una unidad entera', (malas?.lineas[30]?.cantidad ?? '').includes('no admite fracciones'))
chk('unidad fuera del catálogo', malas?.lineas[40]?.unidadMedida === 'Elige la unidad de medida de esta línea.')
chk('cantidad 0', malas?.lineas[40]?.cantidad === 'La cantidad debe ser mayor que 0.')
chk('la línea correcta (10) no lleva errores', malas?.lineas[10] === undefined)
chk('1.5 metros sí se acepta', errores(form({ lineas: [linea(1, { unidadMedida: 47, cantidad: 1.5 })] })) === null)

// --- Cargos y abonos ---------------------------------------------------------
const negativos = errores(form({ ajustes: { ...SIN_AJUSTES, cargosBancarios: -1, manoObra: 10.005 } }))
chk('cargo negativo', negativos?.ajustes.cargosBancarios === 'El monto de «Cargos bancarios» no puede ser negativo.')
chk('mano de obra con 3 decimales', negativos?.ajustes.manoObra === 'El monto de «Costo mano de obra» admite hasta 2 decimales.')
// Hoja "cotizacion pintura" (TOTAL 49,394.80): un abono de 50,000 pasa de lo adeudado.
const pintura: LineaFerreteriaForm[] = [
  [7, 2000], [2, 970], [2, 275], [2, 160], [2, 935], [1, 2380], [2, 10400],
].map(([cantidad, precio], i) => linea(i + 1, { cantidad, precio }))
chk('abono mayor que lo adeudado', errores(form({ lineas: pintura, ajustes: { ...SIN_AJUSTES, abono: 50000 } }))?.ajustes.abono
  === 'El abono (RD$ 50,000.00) no puede ser mayor que lo adeudado (RD$ 49,394.80).')
chk('abono igual a lo adeudado con retención (pintura: 47,301.80)',
  errores(form({ lineas: pintura, ajustes: { ...SIN_AJUSTES, retencion: true, abono: 47301.8 } })) === null)
// Borde de coma flotante (spec 6.2): 13.70 + 2.47 = 16.17, retención 0.69, abono 15.48 justo.
chk('abono justo de 15.48 sobre 13.70 con retención',
  errores(form({ lineas: [linea(1, { precio: 13.7 })], ajustes: { ...SIN_AJUSTES, retencion: true, abono: 15.48 } })) === null)

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
