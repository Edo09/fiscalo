// Vista del catálogo del POS: orden, cuántos se pintan, favoritos y las
// preferencias del equipo (src/pos/catalogoVista.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-catalogo.ts
import type { ProductoPos } from '../src/pos/api.ts'
import {
  alternarFavorito, favoritosPrimero, leerFavoritos, leerPreferencias, limitar, ordenar, PREFERENCIAS_POR_DEFECTO,
} from '../src/pos/catalogoVista.ts'

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

console.log('Favoritos')
const porNombre = ordenar(productos, 'nombre')
chk('sin favoritos: el mismo orden', ids(favoritosPrimero(porNombre, new Set())) === ids(porNombre))
chk('los favoritos van primero; cada grupo conserva el orden elegido (A–Z)',
  ids(favoritosPrimero(porNombre, new Set([6, 1]))) === '1,6,4,2,3,5', ids(favoritosPrimero(porNombre, new Set([6, 1]))))
const porPrecio = ordenar(productos, 'precio_desc')
chk('con otro orden (precio, mayor a menor) igual: favoritos primero, y en su orden',
  ids(favoritosPrimero(porPrecio, new Set([2, 3]))) === '3,2,1,6,5,4', ids(favoritosPrimero(porPrecio, new Set([2, 3]))))
chk('un favorito que no está en la lista (otra categoría, búsqueda) no estorba',
  ids(favoritosPrimero(porNombre, new Set([999, 4]))) === '4,2,1,3,6,5', ids(favoritosPrimero(porNombre, new Set([999, 4]))))
chk('no cambia la lista original', ids(porNombre) === '4,2,1,3,6,5')
const largos = Array.from({ length: 1000 }, (_, i) => p(i + 1, `P ${String(i + 1).padStart(4, '0')}`, 100, null, 1))
const vis = limitar(favoritosPrimero(largos, new Set([1000])), 200).visibles
chk('el favorito nunca queda fuera del límite: el #1000 sale primero de los 200', vis.length === 200 && vis[0].id === 1000, vis[0]?.id)
chk('alternar: marca, desmarca y no repite', alternarFavorito([], 5).join() === '5' && alternarFavorito([3, 5], 5).join() === '3'
  && alternarFavorito([3], 7).join() === '3,7')
chk('leer lo guardado: por empleado', JSON.stringify(leerFavoritos('{"7":[1,2],"8":[3]}')) === '{"7":[1,2],"8":[3]}')
chk('leer lo guardado: nada, JSON dañado o algo que no es objeto → vacío',
  JSON.stringify(leerFavoritos(null)) === '{}' && JSON.stringify(leerFavoritos('{x')) === '{}' && JSON.stringify(leerFavoritos('[1]')) === '{}')
chk('leer lo guardado: descarta ids que no son enteros positivos y repetidos',
  JSON.stringify(leerFavoritos('{"7":[1,"2",-3,1.5,1,4],"8":"x"}')) === '{"7":[1,4]}', leerFavoritos('{"7":[1,"2",-3,1.5,1,4],"8":"x"}'))
const raro = leerFavoritos('{"__proto__":[5],"x":[6],"9":[7]}')
chk('claves que no son ids de empleado ("__proto__", "x") se ignoran', JSON.stringify(raro) === '{"9":[7]}'
  && Object.getPrototypeOf(raro) === Object.prototype, raro)

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
