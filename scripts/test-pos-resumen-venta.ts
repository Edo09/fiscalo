// Resumen de compra de la pantalla "Venta cobrada" del POS (src/pos/resumenVenta.ts):
// una fila por producto, subtotal, ITBIS y total con las MISMAS cuentas del
// carrito (totalesCarrito), y la línea del pago. Los montos del ejemplo son los
// de una venta real: total 2,643.20, recibido 3,558.00, devuelta 914.80.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-resumen-venta.ts
import { totalesCarrito } from '../src/pos/montos.ts'
import { pagoVenta, resumenVenta, textoPago } from '../src/pos/resumenVenta.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

const entrega = { nombre: 'Servicio de Entrega a Domicilio', precioCentavos: 41300, cantidad: 1, tasa: 18 }
const bomba = { nombre: 'Bomba de agua 1/2 HP', precioCentavos: 111510, cantidad: 2, tasa: 18 }
const venta = [entrega, bomba]

console.log('Una fila por producto, con el importe que muestra el carrito')
const r = resumenVenta(venta)
const t = totalesCarrito(venta)
chk('dos productos → dos filas, en el orden del carrito', r.lineas.length === 2 && r.lineas[0].nombre === entrega.nombre && r.lineas[1].nombre === bomba.nombre,
  r.lineas)
chk('cantidad como en el carrito: "1" y "2"', r.lineas[0].cantidad === '1' && r.lineas[1].cantidad === '2', r.lineas.map((l) => l.cantidad))
chk('importes: 413.00 y 2 × 1,115.10 = 2,230.20', r.lineas[0].importeCentavos === 41300 && r.lineas[1].importeCentavos === 223020,
  r.lineas.map((l) => l.importeCentavos))
chk('cada importe es el de totalesCarrito (el del carrito)', r.lineas.every((l, i) => l.importeCentavos === t.lineas[i].bruto))
chk('cantidad con decimales: 1.25 kg → "1.25"; 0.5 → "0.5"',
  resumenVenta([{ ...entrega, cantidad: 1.25 }, { ...entrega, cantidad: 0.5 }]).lineas.map((l) => l.cantidad).join('|') === '1.25|0.5')
chk('cantidad grande con miles: 1,500 unidades → "1,500"', resumenVenta([{ ...entrega, cantidad: 1500 }]).lineas[0].cantidad === '1,500',
  resumenVenta([{ ...entrega, cantidad: 1500 }]).lineas[0].cantidad)

console.log('Subtotal, ITBIS y total: los mismos números del carrito y del recibo')
chk('total 2,643.20; subtotal 2,240.00; ITBIS 403.20', r.totalCentavos === 264320 && r.subtotalCentavos === 224000 && r.itbisCentavos === 40320,
  [r.subtotalCentavos, r.itbisCentavos, r.totalCentavos])
chk('idénticos a totalesCarrito', r.totalCentavos === t.total && r.subtotalCentavos === t.subtotal && r.itbisCentavos === t.itbis)
chk('subtotal + ITBIS = total', r.subtotalCentavos + r.itbisCentavos === r.totalCentavos)
const mixta = [{ ...entrega, precioCentavos: 11800, tasa: 18 }, { nombre: 'Arroz 5 lb', precioCentavos: 3800, cantidad: 2, tasa: 0 }]
chk('con un producto exento: el ITBIS sale solo del gravado (18.00 de 118.00)',
  resumenVenta(mixta).itbisCentavos === 1800 && resumenVenta(mixta).totalCentavos === 19400, resumenVenta(mixta))
chk('sin cliente no hay descuento', r.descuentoCentavos === 0 && r.descuentoPct === 0)

console.log('Cliente con descuento (crédito fiscal)')
const conDesc = resumenVenta([{ nombre: 'Agua 500 ml', precioCentavos: 2500, cantidad: 3, tasa: 18 }, { nombre: 'Arroz', precioCentavos: 3800, cantidad: 1, tasa: 0 }], 10)
chk('las filas muestran el importe sin descuento, como el carrito (75.00 y 38.00)',
  conDesc.lineas[0].importeCentavos === 7500 && conDesc.lineas[1].importeCentavos === 3800, conDesc.lineas)
chk('el total ya trae el descuento: 101.70, con descuento 11.30 (10%) e ITBIS 10.30',
  conDesc.totalCentavos === 10170 && conDesc.descuentoCentavos === 1130 && conDesc.descuentoPct === 10 && conDesc.itbisCentavos === 1030, conDesc)

console.log('Foto de la venta: no cambia si el carrito cambia después')
const lineasVivas = venta.map((l) => ({ ...l }))
const foto = resumenVenta(lineasVivas)
const antes = JSON.stringify(foto)
lineasVivas[0].cantidad = 9
lineasVivas[0].precioCentavos = 1
lineasVivas[0].nombre = 'Otro'
lineasVivas.pop()
chk('cambiar o vaciar las líneas originales no toca el resumen', JSON.stringify(foto) === antes, foto)
chk('carrito vacío: sin filas y todo en 0', JSON.stringify(resumenVenta([])) === JSON.stringify({
  lineas: [], subtotalCentavos: 0, itbisCentavos: 0, descuentoCentavos: 0, descuentoPct: 0, totalCentavos: 0,
}), resumenVenta([]))

console.log('Pago')
const efectivo = pagoVenta({ forma_pago_nombre: 'Efectivo', total_centavos: 264320, recibido_centavos: 355800, devuelta_centavos: 91480 })
chk('efectivo con devuelta: «Efectivo · Recibido RD$ 3,558.00» y devuelta 914.80',
  textoPago(efectivo) === 'Efectivo · Recibido RD$ 3,558.00' && efectivo.devueltaCentavos === 91480, [textoPago(efectivo), efectivo.devueltaCentavos])
const exacto = pagoVenta({ forma_pago_nombre: 'Efectivo', total_centavos: 264320, recibido_centavos: 264320, devuelta_centavos: 0 })
chk('pago exacto: «Efectivo · Recibido RD$ 2,643.20» y devuelta 0 (el cuadro dice "Pago exacto")',
  textoPago(exacto) === 'Efectivo · Recibido RD$ 2,643.20' && exacto.devueltaCentavos === 0, [textoPago(exacto), exacto.devueltaCentavos])
const tarjeta = pagoVenta({ forma_pago_nombre: 'Tarjeta', total_centavos: 264320, recibido_centavos: null, devuelta_centavos: null })
chk('tarjeta: solo la forma de pago con el total «Tarjeta · RD$ 2,643.20», sin devuelta',
  textoPago(tarjeta) === 'Tarjeta · RD$ 2,643.20' && tarjeta.devueltaCentavos === null, [textoPago(tarjeta), tarjeta.devueltaCentavos])
const transferencia = pagoVenta({ forma_pago_nombre: 'Transferencia', total_centavos: 264320, recibido_centavos: null, devuelta_centavos: null })
chk('transferencia: «Transferencia · RD$ 2,643.20»', textoPago(transferencia) === 'Transferencia · RD$ 2,643.20', textoPago(transferencia))
const sinRecibido = pagoVenta({ forma_pago_nombre: 'Efectivo', total_centavos: 264320, recibido_centavos: null, devuelta_centavos: 0 })
chk('efectivo sin el recibido en la respuesta: solo «Efectivo», nunca "null"',
  textoPago(sinRecibido) === 'Efectivo' && !textoPago(sinRecibido).includes('null'), textoPago(sinRecibido))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
