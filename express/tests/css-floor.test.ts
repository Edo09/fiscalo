// Piso de CSS de Express (Chrome y WebView 90, Safari e iOS 14.5): ningún .css de express/src ni del build usa lo que ese piso no
// tiene. La regla vive en dev/presupuesto.mjs (`cssNoSoportado`); aquí se aplica a los archivos reales.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { cssNoSoportado } from '../dev/presupuesto.mjs'

const EXPRESS = fileURLToPath(new URL('../', import.meta.url)) // express/, con separador final

/** Todos los .css de `carpeta` y de sus subcarpetas, en orden alfabético; vacío si la carpeta no existe. */
function archivosCss(carpeta: string): string[] {
  if (!existsSync(carpeta)) return []
  const entradas = readdirSync(carpeta, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  return entradas.flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name)
    if (entrada.isDirectory()) return archivosCss(ruta)
    return entrada.name.endsWith('.css') ? [ruta] : []
  })
}

/** `archivo: ofensa` por cada cosa fuera del piso que haya en esos archivos (rutas relativas a `raiz`). */
const ofensas = (archivos: string[], raiz: string = EXPRESS): string[] =>
  archivos.flatMap((ruta) => cssNoSoportado(readFileSync(ruta, 'utf8')).map((ofensa) => `${relative(raiz, ruta).replace(/\\/g, '/')}: ${ofensa}`))

test('express/src: ningun .css usa algo fuera del piso (color-mix, :has, @container, aspect-ratio, :hover suelto, dvh sin vh)', () => {
  assert.deepEqual(ofensas(archivosCss(join(EXPRESS, 'src'))), [])
})

test('express/dist/assets: el CSS compilado tampoco, cuando hay build', (t) => {
  if (!existsSync(join(EXPRESS, 'dist'))) return t.skip('no hay express/dist: se comprueba despues de `vite build`')
  assert.deepEqual(ofensas(archivosCss(join(EXPRESS, 'dist', 'assets'))), [])
})

test('el recorrido encuentra los .css de las subcarpetas e ignora lo demas, y la ofensa nombra al archivo', (t) => {
  // Mientras express/src no tenga CSS las dos pruebas de arriba no comprueban nada: esta demuestra que el recorrido y la regla funcionan.
  const base = mkdtempSync(join(tmpdir(), 'express-css-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  mkdirSync(join(base, 'ui', 'hondo'), { recursive: true })
  writeFileSync(join(base, 'base.css'), '.a{color:red}')
  writeFileSync(join(base, 'ui', 'boton.css'), '.b:hover{color:red}')
  writeFileSync(join(base, 'ui', 'hondo', 'otro.css'), '.c{aspect-ratio:1}')
  writeFileSync(join(base, 'ui', 'nota.txt'), 'a:has(b){}') // no es .css: no se mira

  const archivos = archivosCss(base)
  assert.deepEqual(archivos.map((ruta) => relative(base, ruta).replace(/\\/g, '/')), ['base.css', 'ui/boton.css', 'ui/hondo/otro.css'])
  const malas = ofensas(archivos, base)
  assert.equal(malas.length, 2)
  assert.match(malas[0], /^ui\/boton\.css: :hover fuera de/)
  assert.match(malas[1], /^ui\/hondo\/otro\.css: aspect-ratio/)
  assert.deepEqual(archivosCss(join(base, 'no-existe')), [])
})
