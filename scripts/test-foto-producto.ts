// Foto del producto: la URL que se pinta (solo rutas con la forma del servidor)
// y las medidas al reducir antes de subir (src/lib/fotoProducto.ts).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-foto-producto.ts
import { medidasReducidas, urlFoto } from '../src/lib/fotoProducto.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

const ruta = 'public/uploads/productos/1/0123456789abcdef0123456789abcdef.jpg'
console.log('URL')
chk('desarrollo (base vacía, proxy): /api/<ruta>', urlFoto('', ruta) === `/api/${ruta}`, urlFoto('', ruta))
chk('producción: base + /api/<ruta>', urlFoto('https://gratex.net', ruta) === `https://gratex.net/api/${ruta}`)
chk('base con / al final no duplica la barra', urlFoto('https://gratex.net/', ruta) === `https://gratex.net/api/${ruta}`)
chk('png y webp también', urlFoto('', ruta.replace('.jpg', '.png')) !== null && urlFoto('', ruta.replace('.jpg', '.webp')) !== null)
chk('carpeta "local" (sin multi-tenant)', urlFoto('', ruta.replace('/1/', '/local/')) !== null)
chk('sin foto: null', urlFoto('', null) === null && urlFoto('', '') === null && urlFoto('', undefined) === null)
for (const mala of [
  'public/uploads/productos/1/../../../.env',
  'public/uploads/productos/1/foto.jpg',
  'public/uploads/productos/1/0123456789abcdef0123456789abcdef.svg',
  'public/uploads/productos/1/0123456789abcdef0123456789abcdef.php',
  'javascript:alert(1)',
  'https://otro.sitio/x.jpg',
  '/public/uploads/productos/1/0123456789abcdef0123456789abcdef.jpg',
  'public/uploads/0123456789abcdef0123456789abcdef.jpg',
]) {
  chk(`ruta que no generó el servidor no se pinta: ${mala}`, urlFoto('', mala) === null)
}

console.log('Medidas al reducir')
const m = (a: number, b: number, l?: number) => JSON.stringify(medidasReducidas(a, b, l))
chk('4000 x 3000 → 800 x 600', m(4000, 3000) === '{"ancho":800,"alto":600}', m(4000, 3000))
chk('vertical 3024 x 4032 → 600 x 800', m(3024, 4032) === '{"ancho":600,"alto":800}', m(3024, 4032))
chk('chica (300 x 200) no se agranda', m(300, 200) === '{"ancho":300,"alto":200}')
chk('panorámica 8000 x 100 → 800 x 10', m(8000, 100) === '{"ancho":800,"alto":10}')
chk('nunca 0 px de lado', m(10000, 3) === '{"ancho":800,"alto":1}', m(10000, 3))
chk('otro tope (400)', m(1000, 500, 400) === '{"ancho":400,"alto":200}')

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
