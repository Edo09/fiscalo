// Listas de precio 2–4 (src/lib/listasPrecio.ts): qué listas se ofrecen, cuándo se pregunta y cómo
// se leen y se escriben en el formulario de producto.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-listas-precio.ts
import {
  clienteVigente, eleccionDePrecio, etiquetaPrecios, listaDeCliente, opcionesDePrecio, otrosPreciosDeFila,
  payloadOtrosPrecios, precioOpcional, precioParaMostrar, problemaPrecioExtra, SIN_OTROS_PRECIOS, textosDeOtrosPrecios,
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

console.log('listaDeCliente')
igual('1 a 4, como número o como texto de MySQL', [listaDeCliente(1), listaDeCliente('2'), listaDeCliente(3), listaDeCliente('4')], [1, 2, 3, 4])
igual('NULL, vacío, 0, 5, texto, decimal o booleano → null',
  [null, undefined, '', 0, 5, 'x', 2.5, true].map((v) => listaDeCliente(v)), Array(8).fill(null))

console.log('Con la lista del cliente')
const cem = p(535, [500, 480, null])        // listas 1, 2 y 3
igual('el cliente tiene la 2 y el producto la ofrece: directo, aunque tenga tres precios', eleccionDePrecio(cem, 2),
  { tipo: 'directo', precio: 500, lista: 2, delCliente: true })
igual('el cliente tiene la 1: directo al precio 1', eleccionDePrecio(cem, 1), { tipo: 'directo', precio: 535, lista: 1, delCliente: true })
igual('el producto no ofrece la lista del cliente (la 4): se pregunta, no cae al precio 1', eleccionDePrecio(cem, 4).tipo, 'elegir')
igual('producto de un solo precio y cliente con la 2: la regla de siempre (directo, sin marca de cliente)',
  eleccionDePrecio(p(535, [null, null, null]), 2), { tipo: 'directo', precio: 535 })
igual('sin lista de cliente: igual que antes', [eleccionDePrecio(cem, null).tipo, eleccionDePrecio(cem).tipo], ['elegir', 'elegir'])
igual('fila con la lista del cliente: su precio y "Precio 2 · cliente"', precioParaMostrar(cem, 2), { precio: 500, etiqueta: 'Precio 2 · cliente' })
igual('fila sin esa lista: el precio 1 y "3 precios"', precioParaMostrar(cem, 4), { precio: 535, etiqueta: '3 precios' })
igual('fila de un solo precio: sin etiqueta', precioParaMostrar(p(535, [null, null, null]), 2), { precio: 535, etiqueta: null })
// Una fila muestra el precio que usaría un toque sin más (ver precioParaMostrar).
igual('precio 1 en 0 y solo la lista 3, sin cliente: la fila muestra ese precio y no dice "N precios"', precioParaMostrar(p(0, [null, 480, null])), { precio: 480, etiqueta: null })
igual('precio 1 en 0 y solo la lista 3, con un cliente que tiene la 2: tampoco la ofrece, igual', precioParaMostrar(p(0, [null, 480, null]), 2), { precio: 480, etiqueta: null })

// El cliente cuya lista rige al agregar productos a una factura simple: el elegido o, al editar una
// guardada sin haberlo cambiado, el de esa factura (clienteGuardado).
console.log('clienteVigente')
const diaz = { nombre: 'Díaz', listaPrecio: 2 }
const perez = { nombre: 'Pérez', listaPrecio: 4 }
igual('el elegido gana sobre el de la factura guardada', clienteVigente(perez, diaz, true, ''), perez)
igual('el elegido gana aunque haya un nombre libre escrito antes', clienteVigente(perez, diaz, true, 'Cliente de mostrador'), perez)
igual('editando sin elegir ni escribir nada: el cliente de la factura guardada', clienteVigente(null, diaz, true, ''), diaz)
igual('un nombre libre en blanco no cuenta: sigue el de la factura guardada', clienteVigente(null, diaz, true, '   '), diaz)
igual('editando con un nombre libre escrito: ninguno (la lista del guardado no rige)', clienteVigente(null, diaz, true, 'Cliente de mostrador'), null)
igual('sin editar solo cuenta el elegido: el guardado no se mira', [clienteVigente(perez, diaz, false, ''), clienteVigente(null, diaz, false, '')], [perez, null])
igual('nada en ningún lado: ninguno', [clienteVigente(null, null, true, ''), clienteVigente(null, null, false, '')], [null, null])
igual('la lista que rige: la del guardado, la del elegido, o ninguna con nombre libre', [
  clienteVigente(null, diaz, true, '')?.listaPrecio ?? null,
  clienteVigente(perez, diaz, true, '')?.listaPrecio ?? null,
  clienteVigente(null, diaz, true, 'Mostrador')?.listaPrecio ?? null,
], [2, 4, null])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
