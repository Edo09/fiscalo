// Rangos e-NCF (src/features/ecf/rangosNcf.ts): la regla que revisa el formulario de Rangos
// antes de enviar, igual que ncfModel::registerRange en la API. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-rangos-ncf.ts
import type { NcfRango } from '../src/api/types.ts'
import { problemaConExistentes } from '../src/features/ecf/rangosNcf.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  chk(ok ? desc : `${desc}: dio ${JSON.stringify(obtenido)}, se esperaba ${JSON.stringify(esperado)}`, ok)
}

const rango = (r: Partial<NcfRango> & Pick<NcfRango, 'id' | 'type' | 'current_value' | 'numero_desde'>): NcfRango => r

console.log('Ventas sin rango: el contador pasó del Hasta')
// E32 1-100 agotado y 3 ventas del POS sin rango: 101, 102 y 103 (current_value 103).
const agotado103: NcfRango[] = [rango({ id: 1, type: 'E32', current_value: 103, numero_desde: 1, numero_hasta: 100 })]
igual('Desde 101 se acepta: el rango nuevo cubre los 3 números usados', problemaConExistentes(agotado103, 'E32', 101, 200), null)
igual('Desde 100 no: es el último número autorizado',
  problemaConExistentes(agotado103, 'E32', 100, 200),
  'El número «Desde» tiene que ser mayor que 100, que es el último ya usado o autorizado para E32.')
igual('Desde 1 no: el tope sigue siendo el Hasta autorizado',
  problemaConExistentes(agotado103, 'E32', 1, 200),
  'El número «Desde» tiene que ser mayor que 100, que es el último ya usado o autorizado para E32.')
igual('con strings, como llegan algunos campos de la API', problemaConExistentes(
  [rango({ id: 1, type: 'E32', current_value: '103', numero_desde: '1', numero_hasta: '100' })], 'E32', 101, 200), null)

console.log('Rango legado sin Hasta (NULL)')
const legado: NcfRango[] = [rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 1, numero_hasta: null })]
igual('Desde 58 (después de lo usado) se acepta, sin convertir: no empieza donde la fila legada',
  problemaConExistentes([rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 5, numero_hasta: null })], 'E31', 58, 100), null)
igual('lo usado por un rango legado sigue siendo tope: Desde 57 no',
  problemaConExistentes([rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 5, numero_hasta: null })], 'E31', 57, 100),
  'El número «Desde» tiene que ser mayor que 57, que es el último ya usado o autorizado para E31.')
igual('si el rango nuevo empieza donde la fila legada, la convierte: su consumo no es tope', problemaConExistentes(legado, 'E31', 1, 100), null)
igual('... pero el Hasta no puede quedar por debajo de lo ya usado',
  problemaConExistentes(legado, 'E31', 1, 40),
  'Ya se usaron números de E31 hasta el 57: el número «Hasta» tiene que ser 57 o más.')

console.log('Otros tipos y rangos')
igual('los rangos de otro tipo no cuentan', problemaConExistentes(agotado103, 'E31', 1, 100), null)
igual('con varios rangos manda el Hasta más alto',
  problemaConExistentes([
    rango({ id: 1, type: 'E32', current_value: 100, numero_desde: 1, numero_hasta: 100 }),
    rango({ id: 3, type: 'E32', current_value: 230, numero_desde: 101, numero_hasta: 200 }),
  ], 'E32', 150, 300),
  'El número «Desde» tiene que ser mayor que 200, que es el último ya usado o autorizado para E32.')
igual('sin rangos cargados: se acepta', problemaConExistentes([], 'E31', 1, 100), null)

console.log(`\n${total - fallos} de ${total} pruebas OK`)
process.exit(fallos === 0 ? 0 : 1)
