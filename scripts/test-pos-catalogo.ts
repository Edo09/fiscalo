// Vista del catálogo del POS: orden, cuántos se pintan y las preferencias del
// equipo (src/pos/catalogoVista.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-catalogo.ts
import type { ProductoPos } from '../src/pos/api.ts'
import { leerPreferencias, limitar, ordenar, PREFERENCIAS_POR_DEFECTO } from '../src/pos/catalogoVista.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

const p = (id: number, nombre: string, precio: number, sku: string | null, stock: number | null): ProductoPos => ({
  id, nombre, sku, category_id: null, precio_centavos: precio, tasa: 18, indicador_facturacion: 1,
  stock, stock_minimo: null, unidad_medida: '43', decimales: false,
})
const productos = [
  p(1, 'Arroz Selecto 25 lb', 125000, 'ALM-0892', 18),
  p(2, 'agua Purificada 5 Gal', 11210, 'BEB-0310', 4),
  p(3, 'Mantenimiento de Equipos', 295000, 'SRV-2014', null),
  p(4, 'Ácido muriático', 11210, null, 0),
  p(5, 'Producto 10', 50000, 'X-10', 240),
  p(6, 'Producto 9', 50000, 'X-9', 76),
]
const ids = (l: ProductoPos[]) => l.map((x) => x.id).join()

console.log('Orden')
chk('nombre: sin distinguir acentos ni mayúsculas, números en orden natural (9 antes que 10)',
  ids(ordenar(productos, 'nombre')) === '4,2,1,3,6,5', ids(ordenar(productos, 'nombre')))
chk('precio menor primero; empate por nombre (Ácido antes que agua)',
  ids(ordenar(productos, 'precio_asc')) === '4,2,6,5,1,3', ids(ordenar(productos, 'precio_asc')))
chk('precio mayor primero; empate por nombre',
  ids(ordenar(productos, 'precio_desc')) === '3,1,6,5,4,2', ids(ordenar(productos, 'precio_desc')))
chk('código natural (X-9 antes que X-10); sin código al final',
  ids(ordenar(productos, 'codigo')) === '1,2,3,6,5,4', ids(ordenar(productos, 'codigo')))
chk('existencia menor primero (agotado arriba); servicios al final',
  ids(ordenar(productos, 'existencia')) === '4,2,1,6,5,3', ids(ordenar(productos, 'existencia')))
chk('no cambia la lista original', ids(productos) === '1,2,3,4,5,6')

console.log('Cuántos se pintan')
const mil = Array.from({ length: 1000 }, (_, i) => i)
chk('200 de 1000: 800 fuera', limitar(mil, 200).visibles.length === 200 && limitar(mil, 200).ocultos === 800)
chk('500 de 1000', limitar(mil, 500).visibles.length === 500 && limitar(mil, 500).ocultos === 500)
chk('Todos (0): los 1000', limitar(mil, 0).visibles.length === 1000 && limitar(mil, 0).ocultos === 0)
chk('menos que el límite: todos, nada fuera', limitar(mil.slice(0, 150), 200).ocultos === 0 && limitar(mil.slice(0, 150), 200).visibles.length === 150)
chk('justo el límite: nada fuera', limitar(mil.slice(0, 300), 300).ocultos === 0)

console.log('Preferencias del equipo')
chk('sin nada guardado: tarjetas, por nombre, 200', JSON.stringify(leerPreferencias(null)) === JSON.stringify(PREFERENCIAS_POR_DEFECTO)
  && PREFERENCIAS_POR_DEFECTO.limite === 200)
chk('lo guardado se respeta', JSON.stringify(leerPreferencias('{"vista":"lista","orden":"precio_desc","limite":0}'))
  === '{"vista":"lista","orden":"precio_desc","limite":0}')
chk('valores desconocidos vuelven al defecto, campo por campo',
  JSON.stringify(leerPreferencias('{"vista":"mosaico","orden":"precio_asc","limite":1000}')) === '{"vista":"tarjetas","orden":"precio_asc","limite":200}')
chk('límite como texto ("500") no vale', leerPreferencias('{"limite":"500"}').limite === 200)
chk('JSON dañado: valores por defecto', JSON.stringify(leerPreferencias('{vista:')) === JSON.stringify(PREFERENCIAS_POR_DEFECTO))
chk('un array o un número no rompen', leerPreferencias('[1,2]').vista === 'tarjetas' && leerPreferencias('7').orden === 'nombre')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
