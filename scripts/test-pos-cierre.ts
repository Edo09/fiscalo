// Cierre de turno del POS: suma del conteo, teclado de unidades y el reporte
// en tirilla (src/pos/montos.ts y src/pos/reporteCierre.ts). Los montos son los
// de tools/test_pos_cierre.php en api-gratex, para que front y back cuadren igual.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-cierre.ts
import type { ReporteCierre } from '../src/pos/api.ts'
import { contadoCentavos, DENOMINACIONES, teclearEntero } from '../src/pos/montos.ts'
import { fechaHora, reporteCierreHtml, textoDiferencia } from '../src/pos/reporteCierre.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

console.log('Conteo')
chk('denominaciones dominicanas, del billete mayor a la moneda menor',
  DENOMINACIONES.join() === '2000,1000,500,200,100,50,20,25,10,5,1')
const cuenta = { 1000: 1, 500: 1, 200: 1, 20: 1, 5: 1, 1: 4, otros_centavos: 25 }
chk('1000 + 500 + 200 + 20 + 5 + 4×1 + 0.25 = 1,729.25', contadoCentavos(cuenta) === 172925, contadoCentavos(cuenta))
chk('vacío = 0', contadoCentavos({}) === 0)
chk('3 de 2000 y 7 de 25 = 6,175.00', contadoCentavos({ 2000: 3, 25: 7 }) === 617500)

console.log('Teclado de unidades')
const escribir = (teclas: string[]) => teclas.reduce((t, k) => teclearEntero(t, k), '')
chk('1,2 → "12"; sin punto: 1,.,2 → "12"', escribir(['1', '2']) === '12' && escribir(['1', '.', '2']) === '12')
chk('cero a la izquierda no se repite, tope de 5 cifras', escribir(['0', '0', '3']) === '3' && escribir(['9', '9', '9', '9', '9', '9']) === '99999')
chk('borrar y limpiar', escribir(['4', '5', '⌫']) === '4' && escribir(['4', '5', 'C']) === '')

console.log('Textos')
chk('fecha sin zonas horarias: 2026-10-08 18:10:05 → 08/10/2026 6:10 p. m.', fechaHora('2026-10-08 18:10:05') === '08/10/2026 6:10 p. m.',
  fechaHora('2026-10-08 18:10:05'))
chk('medianoche y mediodía: 12:05 a. m. / 12:30 p. m.', fechaHora('2026-10-08 00:05:00').endsWith('12:05 a. m.')
  && fechaHora('2026-10-08 12:30:00').endsWith('12:30 p. m.'))
chk('diferencia: faltan / sobran / cuadra', textoDiferencia(-25) === 'Faltan RD$ 0.25' && textoDiferencia(500) === 'Sobran RD$ 5.00'
  && textoDiferencia(0) === 'Cuadra')

console.log('Reporte en tirilla')
const reporte: ReporteCierre = {
  version: 1, turno_id: 7,
  caja: { id: 1, nombre: 'Caja 1' },
  empleado: { id: 3, nombre: 'Ana <script>' },
  cerrado_por: { id: 5, nombre: 'Luis', rol: 'supervisor' },
  abierto_at: '2026-10-08 08:05:00', cerrado_at: '2026-10-08 18:10:00',
  fondo_centavos: 150000,
  ventas: { cantidad: 4, total_centavos: 29250, por_forma: [
    { forma_pago: 1, nombre: 'Efectivo', cantidad: 2, monto_centavos: 22950 },
    { forma_pago: 2, nombre: 'Transferencia / depósito', cantidad: 1, monto_centavos: 3800 },
    { forma_pago: 3, nombre: 'Tarjeta', cantidad: 1, monto_centavos: 2500 },
  ] },
  devoluciones: { cantidad: 0, total_centavos: 0, por_forma: [] },
  comprobantes: { E32: 4 },
  canceladas: { cantidad: 1, monto_centavos: 4500 },
  lineas_quitadas: { cantidad: 2, monto_centavos: 5000 },
  pendientes: [{ e_ncf: 'E320000000020', total_centavos: 5000 }],
  rechazadas: [],
  conteo: { 2000: 0, 1000: 1, 500: 1, 200: 1, 100: 0, 50: 0, 20: 1, 25: 0, 10: 0, 5: 1, 1: 4, otros_centavos: 25 },
  efectivo_ventas_centavos: 22950, efectivo_devoluciones_centavos: 0,
  esperado_centavos: 172950, contado_centavos: 172925, diferencia_centavos: -25,
  nota: 'Faltan 25 centavos',
}
const html = reporteCierreHtml(reporte, { empresa: 'Gratex', anchoMm: 72 })
chk('título, empresa, caja y las fechas', html.includes('CIERRE DE TURNO') && html.includes('Gratex') && html.includes('Caja 1')
  && html.includes('08/10/2026 8:05 a. m.'))
chk('ventas por forma y comprobantes', html.includes('VENTAS (4)') && html.includes('292.50') && html.includes('Efectivo (2)')
  && html.includes('229.50') && html.includes('E32: 4'))
chk('canceladas, líneas quitadas y la pendiente', html.includes('Ventas canceladas (1)') && html.includes('45.00')
  && html.includes('Líneas quitadas (2)') && html.includes('E320000000020'))
chk('efectivo: fondo, esperado, conteo solo de lo que hay, contado y diferencia', html.includes('1,500.00') && html.includes('1,729.50')
  && html.includes('1,000 × 1') && !html.includes('2,000 × 0') && html.includes('1,729.25') && html.includes('Faltan RD$ 0.25'))
chk('cerró un supervisor: aparece con su firma; y la nota', html.includes('Luis (supervisor)') && html.includes('Firma de Luis')
  && html.includes('Faltan 25 centavos'))
chk('los nombres se escapan (nada de HTML inyectado)', !html.includes('<script>') && html.includes('Ana &lt;script&gt;'))
chk('sin devoluciones no hay renglón de devoluciones', !html.includes('Devoluciones ('))
chk('margen a los lados dentro del ancho del papel (border-box, 2 mm)', html.includes('box-sizing: border-box')
  && html.includes('padding: 1mm 2mm 3mm') && html.includes('width: 72mm'))
const propio = reporteCierreHtml({ ...reporte, cerrado_por: { id: 3, nombre: 'Ana', rol: 'cajero' } }, { anchoMm: 72 })
chk('cierre propio: sin "Cerró" ni segunda firma', !propio.includes('Cerró') && (propio.match(/class="firma"/g) ?? []).length === 1)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
