// Listas de precio 2–4 (src/lib/listasPrecio.ts): qué listas se ofrecen, cuándo se pregunta y cómo
// se leen y se escriben en el formulario de producto.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-listas-precio.ts
import {
  eleccionDePrecio, etiquetaPrecios, opcionesDePrecio, otrosPreciosDeFila, payloadOtrosPrecios, precioOpcional,
  problemaPrecioExtra, SIN_OTROS_PRECIOS, textosDeOtrosPrecios,
} from '../src/lib/listasPrecio.ts'

let fallos = 0
let total = 0
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  total++
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok ? '' : ` → ${JSON.stringify(obtenido)}, se esperaba ${JSON.stringify(esperado)}`}`)
}
const p = (precio: number, otros: [number | null, number | null, number | null]) => ({ precio, otrosPrecios: otros })

console.log('precioOpcional')
igual('DECIMAL de la API → número', [precioOpcional('500.0000'), precioOpcional('84.7458'), precioOpcional(500)], [500, 84.7458, 500])
igual('NULL, vacío, 0, texto, negativo o NaN → null',
  [null, undefined, '', '  ', '0', '0.0000', 0, 'abc', -5, '-5', NaN].map((v) => precioOpcional(v)), Array(11).fill(null))

console.log('otrosPreciosDeFila')
igual('columnas de la API: 500.0000, NULL y 0.0000', otrosPreciosDeFila({ precio_2: '500.0000', precio_3: null, precio_4: '0.0000' }), [500, null, null])
igual('sin las columnas: ninguna', otrosPreciosDeFila({}), [null, null, null])

console.log('opcionesDePrecio y eleccionDePrecio')
igual('precios 1, 2 y 4: tres opciones en orden', opcionesDePrecio(p(535, [500, null, 480])),
  [{ lista: 1, precio: 535 }, { lista: 2, precio: 500 }, { lista: 4, precio: 480 }])
igual('dos o más: se pregunta', eleccionDePrecio(p(535, [500, null, null])).tipo, 'elegir')
igual('solo el precio 1: directo', eleccionDePrecio(p(535, [null, null, null])), { tipo: 'directo', precio: 535 })
igual('precio 1 en 0 y solo la lista 3: directo con la lista 3', eleccionDePrecio(p(0, [null, 480, null])), { tipo: 'directo', precio: 480 })
igual('ninguno mayor que 0: directo con p.precio (0)', eleccionDePrecio(p(0, [null, null, null])), { tipo: 'directo', precio: 0 })

console.log('etiquetaPrecios')
igual('tres → "3 precios"; uno → sin etiqueta', [etiquetaPrecios(p(535, [500, null, 480])), etiquetaPrecios(p(535, [null, null, null]))], ['3 precios', null])

console.log('Formulario de producto')
igual('de números a textos de los campos', textosDeOtrosPrecios([500, null, 84.7458]), ['500', '', '84.7458'])
igual('vacío y 0 → null; un valor → número', payloadOtrosPrecios(['500', '', '0']), { precio_2: 500, precio_3: null, precio_4: null })
igual('editar sin tocar los precios los manda iguales (ida y vuelta)',
  payloadOtrosPrecios(textosDeOtrosPrecios([500, null, 480])), { precio_2: 500, precio_3: null, precio_4: 480 })
igual('negativo: mensaje con el número de la lista', problemaPrecioExtra('-1', 3), 'El precio 3 no puede ser negativo.')
igual('vacío, 0 y un precio válido: sin problema', [problemaPrecioExtra('', 2), problemaPrecioExtra('0', 2), problemaPrecioExtra('12.5', 4)], [null, null, null])
igual('SIN_OTROS_PRECIOS son tres null', SIN_OTROS_PRECIOS, [null, null, null])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
