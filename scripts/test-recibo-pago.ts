// Pago en el recibo de tirilla (src/features/invoices/reciboHtml.ts): el API puede
// mandar `pago` (forma de pago, recibido, devuelta) ya formateado. Va después de
// los totales y antes del QR, con el estilo de los renglones de totales; si no
// viene (recibos de la app) o viene vacío, el recibo sale igual que siempre.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-recibo-pago.ts
import type { ReciboDatos } from '../src/api/types.ts'
import { reciboHtml } from '../src/features/invoices/reciboHtml.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

const base: ReciboDatos = {
  nombre: 'Factura_E320000000020_POS80',
  papel: { opcion: 80, ancho_mm: 72, margen_mm: 2 },
  fuente: 'Arial',
  logo: null,
  emisor: { razon_social: 'GRATEX EIRL', rnc: '131256432', direccion: 'Calle 1', contacto: '809-000-0000' },
  titulo: 'Factura de Consumo Electrónica',
  identificacion: [['e-NCF', 'E320000000020']],
  receptor: null,
  lineas: [{ descripcion: 'Bomba de agua 1/2 HP', cantidad_precio: '2 x 1,115.10', itbis: '18%', valor: '2,230.20' }],
  motivo: '',
  totales: [
    { etiqueta: 'Subtotal', valor: '2,240.00', total: false },
    { etiqueta: 'ITBIS', valor: '403.20', total: false },
    { etiqueta: 'Total', valor: '2,643.20', total: true },
  ],
  timbre: { qr: null, aviso_preview: '', codigo_seguridad: 'AbC123', fecha_firma: '14-10-2026 10:00:00' },
  leyenda_qr: '',
  gracias: 'Gracias por su compra',
}

const filas = (html: string): string[] => [...html.matchAll(/<div class="tot[^"]*"><span>([^<]*)<\/span><span>([^<]*)<\/span><\/div>/g)]
  .map((m) => `${m[1]} ${m[2]}`)

console.log('Con pago: efectivo con devuelta')
const efectivo = reciboHtml({ ...base, pago: [{ etiqueta: 'Efectivo', valor: '3,558.00' }, { etiqueta: 'Devuelta', valor: '914.80' }] })
chk('imprime «Efectivo» y «Devuelta» con sus valores',
  efectivo.includes('<span>Efectivo:</span><span>3,558.00</span>') && efectivo.includes('<span>Devuelta:</span><span>914.80</span>'))
chk('van en renglones de totales sin negrita (clase "tot", no "tot total")', (efectivo.match(/<div class="tot">/g) ?? []).length === 4
  && (efectivo.match(/<div class="tot total">/g) ?? []).length === 1, filas(efectivo))
chk('orden: totales y después el pago, uno tras otro',
  JSON.stringify(filas(efectivo)) === JSON.stringify(['Subtotal: 2,240.00', 'ITBIS: 403.20', 'Total: 2,643.20', 'Efectivo: 3,558.00', 'Devuelta: 914.80']), filas(efectivo))
chk('el pago va antes del código de seguridad (QR)', efectivo.indexOf('Devuelta:') > 0 && efectivo.indexOf('Devuelta:') < efectivo.indexOf('Código de Seguridad'))
chk('el pago va después del total', efectivo.indexOf('<span>Total:</span>') < efectivo.indexOf('Efectivo:'))

console.log('Con pago: tarjeta')
const tarjeta = reciboHtml({ ...base, pago: [{ etiqueta: 'Tarjeta', valor: '2,643.20' }] })
chk('un solo renglón «Tarjeta»', tarjeta.includes('<span>Tarjeta:</span><span>2,643.20</span>') && !tarjeta.includes('Devuelta'))

console.log('Sin pago: el recibo sale como siempre')
const sinCampo = reciboHtml(base)
const nulo = reciboHtml({ ...base, pago: null })
const vacio = reciboHtml({ ...base, pago: [] })
chk('sin el campo: solo los 3 renglones de totales', filas(sinCampo).length === 3 && !sinCampo.includes('Efectivo'), filas(sinCampo))
chk('pago null: idéntico al de sin el campo', nulo === sinCampo)
chk('pago []: idéntico al de sin el campo (no deja un bloque vacío)', vacio === sinCampo)

console.log('Los valores se escapan y no rompen la vista previa')
const raro = reciboHtml({ ...base, pago: [{ etiqueta: 'Cheque <b>', valor: '1 & 2' }] }, { vistaPrevia: true })
chk('«<b>» y «&» salen escapados', raro.includes('Cheque &lt;b&gt;:') && raro.includes('1 &amp; 2') && !raro.includes('Cheque <b>'))
chk('la vista previa también lleva el pago, dentro del papel',
  reciboHtml({ ...base, pago: [{ etiqueta: 'Efectivo', valor: '3,558.00' }] }, { vistaPrevia: true }).includes('<span>Efectivo:</span>'))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
