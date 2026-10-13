// Cuentas del carrito del POS (src/pos/montos.ts): importes, ITBIS incluido,
// búsqueda, semáforo de existencia y cantidades. Los casos de dinero son los
// de la fase 0 en producción (api-gratex docs/specs/pos.md §11).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-montos.ts
import {
  coincide, formatoCentavos, importeLinea, iniciales, itbisIncluido, leerCantidad, montoACentavos, normalizar, semaforo,
  teclearMonto, centavosATexto, descuentoLinea, totalesCarrito, formatoRnc, pegarMonto, pegarEntero, soloDigitos,
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

console.log('Descuento del cliente (V5), los montos de tools/test_pos_e31.php')
chk('10% de 75.00 = 7.50; de 38.00 = 3.80', descuentoLinea(7500, 10) === 750 && descuentoLinea(3800, 10) === 380)
chk('mitad hacia arriba: 5.5% de 9.00 = 0.495 → 0.50', descuentoLinea(900, 5.5) === 50, descuentoLinea(900, 5.5))
chk('sin descuento: 0', descuentoLinea(7500, 0) === 0)
const conDesc = totalesCarrito([{ precioCentavos: 2500, cantidad: 3, tasa: 18 }, { precioCentavos: 3800, cantidad: 1, tasa: 0 }], 10)
chk('agua 3 × 25 + arroz 38 con 10%: total 101.70, descuento 11.30, ITBIS 10.30 (como el e-CF)',
  conDesc.total === 10170 && conDesc.descuento === 1130 && conDesc.bruto === 11300 && conDesc.itbis === 1030, conDesc)
const sinDesc = totalesCarrito([{ precioCentavos: 2500, cantidad: 7, tasa: 18 }])
chk('sin cliente: 7 × 25 = 175.00 con ITBIS 26.69', sinDesc.total === 17500 && sinDesc.descuento === 0 && sinDesc.itbis === 2669, sinDesc)
chk('subtotal sin ITBIS (el del recibo): 148.31 + 26.69 = 175.00', sinDesc.subtotal === 14831 && sinDesc.subtotal + sinDesc.itbis === sinDesc.total, sinDesc)
chk('con el 10%: subtotal 91.40 (agua 57.20 + arroz exento 34.20, como el e-CF) + ITBIS 10.30 = 101.70',
  conDesc.subtotal === 9140 && conDesc.subtotal + conDesc.itbis === conDesc.total, conDesc)
const soloExento = totalesCarrito([{ precioCentavos: 3800, cantidad: 2, tasa: 0 }])
chk('solo exento: subtotal = total, ITBIS 0', soloExento.subtotal === 7600 && soloExento.itbis === 0 && soloExento.total === 7600, soloExento)
chk('carrito vacío: todo en 0', JSON.stringify(totalesCarrito([])) === JSON.stringify({ lineas: [], bruto: 0, descuento: 0, total: 0, itbis: 0, subtotal: 0 }))

console.log('Formato')
chk('RNC 131000001 → 1-31-00000-1; cédula 00112345678 → 001-1234567-8; incompleto tal cual',
  formatoRnc('131000001') === '1-31-00000-1' && formatoRnc('00112345678') === '001-1234567-8' && formatoRnc('1310') === '1310')
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

console.log('Montos escritos (efectivo recibido, fondo)')
chk('"1500" → 150000, "245.5" → 24550, "0.05" → 5', montoACentavos('1500') === 150000 && montoACentavos('245.5') === 24550
  && montoACentavos('0.05') === 5)
chk('vacío, "1.234", "abc" → null', montoACentavos('') === null && montoACentavos('1.234') === null && montoACentavos('abc') === null)
chk('"0.29" → 29 sin ruido binario', montoACentavos('0.29') === 29, montoACentavos('0.29'))
const escribir = (teclas: string[]) => teclas.reduce((t, k) => teclearMonto(t, k), '')
chk('teclear 2,4,5,.,5 → "245.5"', escribir(['2', '4', '5', '.', '5']) === '245.5')
chk('un solo punto y 2 decimales: 1,.,.,2,3,4 → "1.23"', escribir(['1', '.', '.', '2', '3', '4']) === '1.23')
chk('punto primero → "0.", cero a la izquierda no se repite', escribir(['.']) === '0.' && escribir(['0', '0', '7']) === '7')
chk('borrar y limpiar', escribir(['1', '2', '⌫']) === '1' && escribir(['1', '2', 'C']) === '')
chk('tope de 7 cifras', escribir(['1', '2', '3', '4', '5', '6', '7', '8']) === '1234567')
chk('centavos a texto: 250000 → "2500", 234230 → "2342.30", 5 → "0.05"', centavosATexto(250000) === '2500'
  && centavosATexto(234230) === '2342.30' && centavosATexto(5) === '0.05')
// Billetes que se suman (CobroModal): 2,000 + 500 para un total de 2,342.30.
const sumar = (texto: string, billete: number) => centavosATexto((texto === '' ? 0 : montoACentavos(texto) ?? 0) + billete * 100)
const recibido = [2000, 500].reduce(sumar, '')
chk('billetes 2,000 + 500 → recibido "2500", devuelta 157.70', recibido === '2500' && (montoACentavos(recibido) ?? 0) - 234230 === 15770)
chk('se puede seguir tecleando sobre lo sumado: "2500" + ".5" → 2500.5', montoACentavos(teclearMonto(teclearMonto(recibido, '.'), '5')) === 250050)

console.log('Pegar en los teclados (Ctrl+V)')
chk('monto con símbolo y miles: "RD$ 1,250.50" → "1250.50"', pegarMonto('RD$ 1,250.50') === '1250.50', pegarMonto('RD$ 1,250.50'))
chk('monto con espacios y salto de línea: " 9,263.00\\n" → "9263.00"', pegarMonto(' 9,263.00\n') === '9263.00', pegarMonto(' 9,263.00\n'))
chk('mismos topes que el teclado: 3 decimales → 2, 8 cifras → 7', pegarMonto('12.345') === '12.34' && pegarMonto('12345678') === '1234567',
  [pegarMonto('12.345'), pegarMonto('12345678')])
chk('dos puntos: cuenta el primero', pegarMonto('1.2.3') === '1.23', pegarMonto('1.2.3'))
chk('sin cifras → vacío', pegarMonto('hola') === '')
chk('unidades del conteo: "1,500" → "1500", tope de 5 cifras', pegarEntero('1,500') === '1500' && pegarEntero('1234567') === '12345')
chk('RNC con guiones: "1-31-25643-2" → "131256432"; cédula "001-1234567-8" → 11 dígitos',
  soloDigitos('1-31-25643-2') === '131256432' && soloDigitos('001-1234567-8') === '00112345678')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
