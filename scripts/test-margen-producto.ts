// Margen del formulario de producto (src/lib/margenProducto.ts): el porcentaje que queda sobre el precio
// después de restar el costo, con un decimal, o nada cuando falta alguno de los dos números.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-margen-producto.ts
import { margenDe, textoMargen } from '../src/lib/margenProducto.ts'

let fallos = 0
let total = 0
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  total++
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok ? '' : ` → ${JSON.stringify(obtenido)}, se esperaba ${JSON.stringify(esperado)}`}`)
}

console.log('margenDe')
igual('precio 1,250 y costo 980: 21.6', margenDe('1250', '980'), 21.6)
igual('con decimales: 100.50 y 40.20 dan 60', margenDe('100.50', '40.20'), 60)
igual('redondea a un decimal: 3 y 2 dan 33.3', margenDe('3', '2'), 33.3)
igual('mismo precio y costo: 0', margenDe('100', '100'), 0)
igual('costo mayor que el precio: margen negativo', margenDe('100', '120'), -20)
igual('precio en 0, vacío, texto o negativo: null', ['0', '', 'abc', '-5'].map((p) => margenDe(p, '50')), [null, null, null, null])
igual('costo en 0, vacío, texto o negativo: null', ['0', '', 'x', '-1'].map((c) => margenDe('100', c)), [null, null, null, null])

console.log('textoMargen')
igual('un decimal, punto, espacio y %', textoMargen('1250', '980'), '21.6 %')
igual('un margen negativo conserva su signo', textoMargen('100', '120'), '-20.0 %')
igual('sin datos: guion largo', textoMargen('0', '5'), '—')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
