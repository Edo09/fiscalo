// Paridad de los totales de la cotización de Ferretería: el front
// (totalesFerreteria) contra los casos que prueba el backend en
// api-gratex tools/test_cotizacion_ferreteria.php.
//
// scripts/fixtures/cotizacion_ferreteria.json es copia BYTE A BYTE de
// api-gratex tools/fixtures/cotizacion_ferreteria.json (las 3 hojas del Excel
// de Ferretería y los bordes de redondeo). Si una regla cambia de un lado y no
// del otro, este script o el del backend deja de cuadrar. Al cambiar el
// fixture se cambia allá y se vuelve a copiar.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/parity-cotizacion-ferreteria.ts
import { readFileSync } from 'node:fs'
import { totalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'
import type { TotalesFerreteria } from '../src/features/cotizaciones/formatos/ferreteria/totales.ts'

interface LineaFixture { quantity: number; description: string; amount: number; indicador_facturacion: number }
interface AjustesFixture { cargos_bancarios: number; manejo_bancario: number; mano_obra: number; abono: number; retencion_isr: boolean }
interface CasoFixture { id: string; lineas: LineaFixture[]; ajustes: AjustesFixture; esperado: Record<string, unknown> }

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/cotizacion_ferreteria.json', import.meta.url), 'utf8'),
) as { casos: CasoFixture[] }

// Clave de `esperado` (snake_case, la de FerreteriaFormato::totales) → campo de TotalesFerreteria.
const CAMPOS = new Map<string, keyof TotalesFerreteria>([
  ['lineas', 'lineas'],
  ['subtotal', 'subtotal'],
  ['itbis', 'itbis'],
  ['cargos_bancarios', 'cargosBancarios'],
  ['manejo_bancario', 'manejoBancario'],
  ['mano_obra', 'manoObra'],
  ['total', 'total'],
  ['retencion_isr', 'retencion'],
  ['adeudado', 'adeudado'],
  ['abono', 'abono'],
  ['restante', 'restante'],
  ['etiqueta_itbis', 'etiquetaItbis'],
  ['mostrar_restante', 'mostrarRestante'],
])

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const calcular = (lineas: LineaFixture[], a: AjustesFixture): TotalesFerreteria =>
  totalesFerreteria(
    lineas.map((l) => ({ cantidad: l.quantity, precio: l.amount, indFact: l.indicador_facturacion })),
    {
      cargosBancarios: a.cargos_bancarios,
      manejoBancario: a.manejo_bancario,
      manoObra: a.mano_obra,
      abono: a.abono,
      retencion: a.retencion_isr,
    },
  )

// Los mismos 10 casos que el backend: un fixture vacío o a medias no pasa en silencio.
const ids = fixture.casos.map((c) => c.id).join(',')
chk(`el fixture trae los 10 casos (${ids})`, ids === [
  'pintura', 'pintura_retencion_abono', 'pintura_mano_obra', 'b150000049', 'ceramicas',
  'redondeo_8475', 'flotante', 'mixto', 'exento', 'largo_60',
].join(','))

for (const caso of fixture.casos) {
  const t = calcular(caso.lineas, caso.ajustes)
  for (const [clave, esperado] of Object.entries(caso.esperado)) {
    if (clave === 'error_abono') {
      // Mismo criterio que FerreteriaFormato::errorAbono: null = el abono no pasa de lo adeudado.
      const aceptado = t.abono <= t.adeudado
      chk(`${caso.id}: abono ${t.abono} ${esperado === null ? 'aceptado' : 'rechazado'} (adeudado ${t.adeudado})`,
        aceptado === (esperado === null))
      continue
    }
    const campo = CAMPOS.get(clave)
    if (campo === undefined) {
      chk(`${caso.id}: clave desconocida en esperado: ${clave}`, false)
      continue
    }
    // JSON compara números, textos, booleanos y las líneas {base, itbis} igual que el
    // === del backend: un centavo de diferencia (o 15.254999… contra 15.26) falla.
    const obtenido = JSON.stringify(t[campo])
    chk(`${caso.id}: ${clave} = ${JSON.stringify(esperado)} (dio ${obtenido})`, obtenido === JSON.stringify(esperado))
  }
}

// Abono mayor que lo adeudado (el mismo caso que tools/test_cotizacion_ferreteria.php, fuera del fixture).
const pintura = fixture.casos.find((c) => c.id === 'pintura')
if (pintura) {
  const t = calcular(pintura.lineas, { ...pintura.ajustes, abono: 50000 })
  chk(`pintura + abono 50000: rechazado (adeudado ${t.adeudado})`, t.abono > t.adeudado)
}

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
