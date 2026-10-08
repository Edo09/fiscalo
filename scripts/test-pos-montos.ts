// Cuentas del carrito del POS (src/pos/montos.ts): importes, ITBIS incluido,
// búsqueda, semáforo de existencia y cantidades. Los casos de dinero son los
// de la fase 0 en producción (api-gratex docs/specs/pos.md §11).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-montos.ts
import {
  coincide, formatoCentavos, importeLinea, iniciales, itbisIncluido, leerCantidad, normalizar, semaforo,
} from '../src/pos/montos.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

console.log('Importe de la línea (centavos)')
chk('25.00 × 7 = 175.00', importeLinea(2500, 7) === 17500, importeLinea(2500, 7))
chk('10.00 × 3 = 30.00', importeLinea(1000, 3) === 3000)
chk('150.00 × 1.25 kg = 187.50', importeLinea(15000, 1.25) === 18750)
chk('9.99 × 0.5 = 4.995 → 5.00 (mitad hacia arriba)', importeLinea(999, 0.5) === 500, importeLinea(999, 0.5))
chk('33.33 × 0.33 = 10.9989 → 11.00', importeLinea(3333, 0.33) === 1100, importeLinea(3333, 0.33))
chk('cantidad con ruido binario (0.1 + 0.2) se lee como 0.30', importeLinea(1000, 0.1 + 0.2) === 300)
chk('precio grande sin perder centavos: 99,999.99 × 999', importeLinea(9999999, 999) === 999 * 9999999)

console.log('ITBIS incluido (regla de la DGII con IndicadorMontoGravado = 1)')
chk('E320000000001: 175.00 al 18% → ITBIS 26.69 (base 148.31)', itbisIncluido([{ importe: 17500, tasa: 18 }]) === 2669,
  itbisIncluido([{ importe: 17500, tasa: 18 }]))
chk('E340000000007: 50.00 → 7.63', itbisIncluido([{ importe: 5000, tasa: 18 }]) === 763)
chk('E340000000008: 125.00 → 19.07', itbisIncluido([{ importe: 12500, tasa: 18 }]) === 1907)
chk('se suma por tasa, no línea por línea: 7 × 25.00 en líneas sueltas = 26.69',
  itbisIncluido(Array.from({ length: 7 }, () => ({ importe: 2500, tasa: 18 }))) === 2669)
chk('exento no aporta ITBIS', itbisIncluido([{ importe: 15000, tasa: 0 }]) === 0)
chk('18% y 16% juntos: 116.00 al 16% = 16.00 más 25.00 al 18% = 3.81',
  itbisIncluido([{ importe: 11600, tasa: 16 }, { importe: 2500, tasa: 18 }]) === 1600 + 381,
  itbisIncluido([{ importe: 11600, tasa: 16 }, { importe: 2500, tasa: 18 }]))
chk('carrito vacío: 0', itbisIncluido([]) === 0)

console.log('Formato')
chk('1234.5 → "1,234.50"', formatoCentavos(123450) === '1,234.50', formatoCentavos(123450))
chk('0 → "0.00"', formatoCentavos(0) === '0.00')

console.log('Búsqueda "contiene" (C3)')
const agua = { nombre: 'Agua Planeta Azul 500 ml', sku: 'AG-500' }
chk('sin acentos ni mayúsculas: "AZÚL" encuentra "Azul"', coincide(agua, 'AZÚL'))
chk('palabras en cualquier orden: "500 agua"', coincide(agua, '500 agua'))
chk('por sku: "ag-5"', coincide(agua, 'ag-5'))
chk('todas las palabras: "agua 1 litro" no', !coincide(agua, 'agua litro'))
chk('vacío coincide con todo', coincide(agua, '   '))
chk('sku null no rompe', coincide({ nombre: 'Café Santo Domingo', sku: null }, 'cafe'))
chk('normalizar: "  Jamón   Serrano " → "jamon serrano"', normalizar('  Jamón   Serrano ') === 'jamon serrano')

console.log('Semáforo de existencia (C4)')
chk('null → servicio', semaforo(null, 5) === 'servicio')
chk('0 y negativo → agotado', semaforo(0, 5) === 'agotado' && semaforo(-2, null) === 'agotado')
chk('igual o menor que el mínimo → bajo', semaforo(3, 3) === 'bajo' && semaforo(2, 3) === 'bajo')
chk('sin mínimo no hay bajo', semaforo(1, null) === 'disponible')
chk('sobre el mínimo → disponible', semaforo(10, 3) === 'disponible')

console.log('Cantidad escrita en el teclado')
chk('entera: "3" sí, "3.5" no, "0" no, "" no', leerCantidad('3', false) === 3 && leerCantidad('3.5', false) === null
  && leerCantidad('0', false) === null && leerCantidad('', false) === null)
chk('con decimales: "1.25" sí, "1.255" no, "0.5" sí, "0.00" no', leerCantidad('1.25', true) === 1.25
  && leerCantidad('1.255', true) === null && leerCantidad('0.5', true) === 0.5 && leerCantidad('0.00', true) === null)
chk('nada raro: "1e3", "-1", "1,5", "." no', ['1e3', '-1', '1,5', '.'].every((t) => leerCantidad(t, true) === null))
chk('tope de 5 cifras: "99999" sí, "100000" no', leerCantidad('99999', false) === 99999 && leerCantidad('100000', false) === null)

console.log('Iniciales')
chk('"Agua 500 ml" → "A5"', iniciales('Agua 500 ml') === 'A5')
chk('"pan" → "PA"', iniciales('pan') === 'PA')
chk('vacío → "?"', iniciales('  ') === '?')
chk('sin signos: "Huevos (unidad)" → "HU", "Papel higiénico (4 rollos)" → "PH"', iniciales('Huevos (unidad)') === 'HU'
  && iniciales('Papel higiénico (4 rollos)') === 'PH', [iniciales('Huevos (unidad)'), iniciales('Papel higiénico (4 rollos)')])
chk('solo signos → "?"', iniciales('(--)') === '?')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
