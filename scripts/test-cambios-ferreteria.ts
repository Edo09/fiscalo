// Qué cuenta como cambio en las líneas de la cotización de Ferretería y del
// conduce (formatos/ferreteria/cambios.ts): las marcas campo por campo y de
// línea nueva, como en la factura simple, y el hayCambios de la barra y del
// aviso de salida. Las filas en blanco no cuentan; vaciar una guardada es
// quitarla; un id nuevo nunca reutiliza el de una línea guardada.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-cambios-ferreteria.ts
import {
  cambiosLineas, fotoLineas, idNuevo, idParaFilaEnBlanco,
} from '../src/features/cotizaciones/formatos/ferreteria/cambios.ts'
import { lineaLibre } from '../src/features/cotizaciones/formatos/ferreteria/lineas.ts'
import { lineaEnBlanco, type LineaFerreteriaForm } from '../src/features/cotizaciones/formatos/ferreteria/schema.ts'
import { lineaVacia } from '../src/features/conduces/schema.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const linea = (id: number, cambio: Partial<LineaFerreteriaForm> = {}): LineaFerreteriaForm => ({
  id, prodId: '55', descripcion: `ARTICULO ${id}`, cantidad: 2, precio: 935, indFact: 1, unidadMedida: 43, tipoItem: 'Bien',
  ...cambio,
})
const guardadas = [linea(1), linea(2), linea(3, { prodId: '', descripcion: 'CORTE DE TUBO', precio: 13.7 })]
const foto = fotoLineas(guardadas, lineaEnBlanco)
const copia = () => guardadas.map((l) => ({ ...l }))

console.log('Sin foto (documento nuevo)')
{
  const c = cambiosLineas(null, [linea(1), lineaLibre(2)], lineaEnBlanco)
  chk('nada cambió', !c.hayCambios)
  chk('nada es nuevo', !c.esNueva(linea(1)))
  chk('ningún campo marcado', !c.campoCambiado(linea(1), 'cantidad'))
}

console.log('Foto')
{
  const conBlanco = fotoLineas([...guardadas, lineaLibre(4)], lineaEnBlanco)
  chk('fotoLineas deja fuera las filas en blanco', conBlanco.length === 3 && !conBlanco.some((l) => l.id === 4))
  const ls = copia()
  const f = fotoLineas(ls, lineaEnBlanco)
  ls[0].cantidad = 99
  chk('fotoLineas copia: cambiar la línea después no cambia la foto', f[0].cantidad === 2)
}

console.log('Sin tocar')
{
  const c = cambiosLineas(foto, copia(), lineaEnBlanco)
  chk('las mismas líneas: sin cambios', !c.hayCambios)
  chk('ninguna es nueva', !guardadas.some(c.esNueva))
}

console.log('Un campo')
{
  const ls = copia()
  ls[1].cantidad = 5
  const c = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('cambiar la cantidad cuenta', c.hayCambios)
  chk('se marca la cantidad de esa línea', c.campoCambiado(ls[1], 'cantidad'))
  chk('no se marca su descripción', !c.campoCambiado(ls[1], 'descripcion'))
  chk('no se marca la cantidad de otra línea', !c.campoCambiado(ls[0], 'cantidad'))
  chk('una línea editada no es nueva', !c.esNueva(ls[1]))
  ls[1].cantidad = 2
  chk('devolverla a su valor: sin cambios', !cambiosLineas(foto, ls, lineaEnBlanco).hayCambios)
}
{
  const ls = copia()
  ls[2].tipoItem = 'Servicio'
  const c = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('bien/servicio de una línea libre cuenta y se marca', c.hayCambios && c.campoCambiado(ls[2], 'tipoItem'))
}
{
  const ls = copia()
  ls[0].precio = 1000
  chk('un campo que el conduce no muestra (precio) también cuenta', cambiosLineas(foto, ls, lineaVacia).hayCambios)
}

console.log('Líneas nuevas')
{
  const ls = [...copia(), lineaLibre(idNuevo(guardadas, foto))]
  const c = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('agregar una fila en blanco no es un cambio', !c.hayCambios)
  chk('la fila en blanco no sale como nueva', !c.esNueva(ls[3]))
  chk('ni con sus campos marcados', !c.campoCambiado(ls[3], 'cantidad'))
  ls[3] = { ...ls[3], descripcion: 'ARENA' }
  const d = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('al escribirle algo, sí: cuenta', d.hayCambios)
  chk('y sale como nueva', d.esNueva(ls[3]))
  chk('con todos sus campos marcados', d.campoCambiado(ls[3], 'cantidad') && d.campoCambiado(ls[3], 'precio'))
}

console.log('Líneas quitadas')
{
  const ls = copia().slice(0, 2)
  chk('quitar una guardada cuenta', cambiosLineas(foto, ls, lineaEnBlanco).hayCambios)
}
{
  const ls = copia()
  ls[2] = { ...ls[2], descripcion: '', precio: 0 }
  const c = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('vaciar una guardada (se descartaría al guardar) cuenta', c.hayCambios)
  chk('y su descripción sale marcada', c.campoCambiado(ls[2], 'descripcion'))
}
{
  // En el conduce el precio no cuenta para "vacía": sin producto ni descripción ya lo es.
  const ls = copia()
  ls[2] = { ...ls[2], descripcion: '' }
  chk('conduce: sin descripción ni producto ya es quitarla', cambiosLineas(foto, ls, lineaVacia).hayCambios)
  chk('cotización: con precio todavía no está en blanco (no se quita)', !lineaEnBlanco(ls[2]))
}

console.log('Ids de líneas nuevas')
{
  // Quitar la última guardada (id 3) y agregar otra: con max + 1 sobre lo que
  // queda tomaría el 3 y pasaría por esa línea, editada.
  const sinLaUltima = copia().slice(0, 2)
  const id = idNuevo(sinLaUltima, foto)
  chk(`no reutiliza el id de una guardada quitada (dio ${id})`, id === 4)
  const ls = [...sinLaUltima, linea(id, { descripcion: 'OTRA COSA' })]
  const c = cambiosLineas(foto, ls, lineaEnBlanco)
  chk('la agregada sale como nueva', c.esNueva(ls[2]))
  chk('sin foto: el mayor + 1', idNuevo([linea(2), linea(7)], null) === 8)
  chk('lista y foto vacías: 1', idNuevo([], []) === 1)
}
{
  // Un artículo del catálogo ocupa la última fila en blanco (addProducto).
  const vaciada = { ...guardadas[2], descripcion: '', precio: 0 }
  const ls = [...copia().slice(0, 2), vaciada]
  const id = idParaFilaEnBlanco(vaciada, ls, foto)
  chk(`una guardada que se vació no presta su id (dio ${id})`, id === 4)
  const conArticulo = [...ls.slice(0, 2), linea(id, { descripcion: 'CEMENTO' })]
  const c = cambiosLineas(foto, conArticulo, lineaEnBlanco)
  chk('el artículo sale como nuevo y la vaciada, quitada', c.esNueva(conArticulo[2]) && c.hayCambios)
  const enBlancoNueva = lineaLibre(9)
  chk('una fila nueva en blanco conserva su id', idParaFilaEnBlanco(enBlancoNueva, [...copia(), enBlancoNueva], foto) === 9)
  chk('sin foto (documento nuevo), también', idParaFilaEnBlanco(lineaLibre(1), [lineaLibre(1)], null) === 1)
}

console.log(`\n${total - fallos}/${total} ${fallos === 0 ? 'OK' : 'CON FALLAS'}`)
if (fallos > 0) process.exit(1)
