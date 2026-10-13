// El cajero no ve nada de la DGII (decisión U3 de la spec del POS sobre el
// write-ahead): ni textos, ni el estado de la venta en las listas, ni las
// listas del reporte de cierre que imprime la caja. Esta prueba lee el código
// de src/pos y busca la palabra, y prueba los textos de las ventas que salen
// como factura simple (sin e-NCF).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-sin-dgii.ts
import { readdirSync, readFileSync } from 'node:fs'
import type { ReciboDatos } from '../src/api/types.ts'
import { reciboHtml } from '../src/features/invoices/reciboHtml.ts'
import { numeroVenta, tituloVenta } from '../src/pos/estados.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

/**
 * El código sin comentarios, con las mismas líneas (para citar la línea). Un
 * // pegado a ':' es de una URL, no un comentario.
 */
const sinComentarios = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// El reporte de cierre se comparte con app.* (reimpresión del administrador): ahí
// la DGII sí se nombra. La caja lo imprime con mostrarDgii: false
// (scripts/test-pos-cierre.ts lo prueba).
const COMPARTIDOS_CON_LA_APP = new Set(['reporteCierre.ts'])

const dir = new URL('../src/pos/', import.meta.url)
const archivos = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f))
console.log(`Textos de la caja (${archivos.length} archivos de src/pos)`)
const ofensores: string[] = []
for (const f of archivos) {
  if (COMPARTIDOS_CON_LA_APP.has(f)) continue
  sinComentarios(readFileSync(new URL(f, dir), 'utf8')).split('\n').forEach((linea, i) => {
    if (/\bDGII\b/.test(linea)) ofensores.push(`${f}:${i + 1} ${linea.trim().slice(0, 90)}`)
  })
}
chk('ningún texto de src/pos nombra la DGII (comentarios aparte)', ofensores.length === 0, ofensores)

console.log('Número y título de la venta, también si salió como factura simple')
chk('con e-NCF: el e-NCF', numeroVenta({ e_ncf: 'E320000000020', factura_id: 9 }) === 'E320000000020')
chk('sin e-NCF (factura simple): "Factura 9" y nunca "null"',
  numeroVenta({ e_ncf: null, factura_id: 9 }) === 'Factura 9' && numeroVenta({ e_ncf: '', factura_id: 9 }) === 'Factura 9')
chk('título: crédito fiscal, consumo y factura simple (tipo null o vacío)',
  tituloVenta('31') === 'Factura de crédito fiscal' && tituloVenta('32') === 'Factura de consumo'
  && tituloVenta(null) === 'Factura' && tituloVenta('') === 'Factura')

console.log('Recibo de una factura simple (U4: se imprime como cualquier otra)')
const recibo = (timbre: ReciboDatos['timbre']): ReciboDatos => ({
  nombre: 'Factura_0017-121026_POS80',
  papel: { opcion: 80, ancho_mm: 72, margen_mm: 2 },
  fuente: 'Arial',
  logo: null,
  emisor: { razon_social: 'GRATEX EIRL', rnc: '131256432', direccion: 'Calle 1', contacto: '809-000-0000' },
  titulo: timbre ? 'Factura de Consumo Electrónica' : 'Factura',
  identificacion: [['Número', '0017-121026']],
  receptor: null,
  lineas: [{ descripcion: 'Producto', cantidad_precio: '1 x 118.00', itbis: '18%', valor: '118.00' }],
  motivo: '',
  totales: [{ etiqueta: 'Total', valor: '118.00', total: true }],
  timbre,
  leyenda_qr: '',
  gracias: 'Gracias por su compra',
})
const simple = reciboHtml(recibo(null))
chk('sin timbre: imprime el número, el total y el pie, sin código de seguridad ni QR',
  simple.includes('0017-121026') && simple.includes('118.00') && simple.includes('Gracias por su compra')
  && !simple.includes('Código de Seguridad') && !simple.includes('class="qr"'))
const ecf = reciboHtml(recibo({ qr: null, aviso_preview: '', codigo_seguridad: 'AbC123', fecha_firma: '12-10-2026 10:00:00' }))
chk('con timbre (e-CF, aceptado o sin confirmar): código de seguridad y fecha de firma',
  ecf.includes('Código de Seguridad') && ecf.includes('AbC123') && ecf.includes('12-10-2026 10:00:00'))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
