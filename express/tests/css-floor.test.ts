// Piso de CSS de Express (Chrome y WebView 90, Safari e iOS 14.5): ningún .css de express/src ni del build usa lo que ese piso no
// tiene. La regla vive en dev/presupuesto.mjs (`cssNoSoportado`); aquí se aplica a los archivos reales y a lo que deja el minificador.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
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

// --- El minificador del build ------------------------------------------------------------------------------------------------
// Las pruebas de arriba miran el CSS que se escribe (express/src) y el que dejó un build (express/dist, que no se versiona: en una copia
// limpia o en CI solo existe si algo construyó antes). Estas comprueban lo que va en medio: que el minificador de Vite, con las opciones
// de CSS de vite.config.ts, deja intactos los pares vh/dvh y el @media de hover, y que `cssNoSoportado` lee su salida compacta. Corren
// un build real de Vite en una carpeta temporal: valen en cualquier máquina y aunque express/src todavía no tenga CSS.

/** La configuración de vite.config.ts, sea un objeto o una función de `{ command, mode }`. */
async function configDeVite(): Promise<any> {
  const bruto: any = (await import('../vite.config.ts')).default
  return typeof bruto === 'function' ? bruto({ command: 'build', mode: 'production' }) : bruto
}

/** El CSS de un build real de Vite sobre `css`, con las opciones de vite.config.ts que deciden cómo sale (el piso y el minificador). */
async function cssDelBuild(t: TestContext, css: string): Promise<string> {
  const config = await configDeVite()
  const { target, cssTarget, minify, cssMinify, cssCodeSplit } = config.build ?? {}
  const raiz = mkdtempSync(join(tmpdir(), 'express-css-build-'))
  t.after(() => rmSync(raiz, { recursive: true, force: true }))
  mkdirSync(join(raiz, 'src'))
  writeFileSync(join(raiz, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><title>t</title></head><body><script type="module" src="/src/main.ts"></script></body></html>')
  writeFileSync(join(raiz, 'src', 'main.ts'), "import './estilos.css'\ndocument.title = 'x'")
  writeFileSync(join(raiz, 'src', 'estilos.css'), css)
  const { build } = await import('vite')
  const resultado: any = await build({
    root: raiz, // la carpeta temporal: el .env de la raíz del repo nunca se lee
    configFile: false, // los plugins y los alias de Express no hacen falta: solo sus opciones de CSS, que se pasan aquí
    logLevel: 'silent',
    css: config.css,
    esbuild: config.esbuild,
    build: { target, cssTarget, minify, cssMinify, cssCodeSplit, write: false },
  })
  const salidas = resultado.output as Array<{ fileName: string; source?: string | Uint8Array }>
  return salidas.filter((salida) => salida.fileName.endsWith('.css')).map((salida) => String(salida.source)).join('\n')
}

test('vite.config: el piso de navegadores del build es chrome90 y safari14, en JS y en CSS', async () => {
  // Las pruebas de abajo valen lo que valgan estas opciones: si el piso cambiara aquí, el minificador se probaría contra otro.
  const { build } = await configDeVite()
  assert.deepEqual(build.target, ['chrome90', 'safari14'])
  assert.deepEqual(build.cssTarget, ['chrome90', 'safari14'])
})

test('build real: el minificador deja los pares vh/dvh y el @media de hover como estaban, y lo que sale pasa el piso', async (t) => {
  const fuente = [
    '.pantalla{min-height:100vh;min-height:100dvh;padding-bottom:calc(var(--bar-h) + env(safe-area-inset-bottom, 0px))}',
    '.hoja{max-height:85vh;max-height:85dvh}',
    '.panel{height:calc(100vh - 56px);height:calc(100dvh - 56px)}',
    '.boton{color:#2a6fdb}',
    '@media (hover: hover) and (pointer: fine) {',
    '  .boton:hover{color:#1a4fa0}',
    '  .tarjeta:hover{box-shadow:0 1px 2px rgba(0, 0, 0, 0.2)}',
    '}',
  ].join('\n')
  assert.deepEqual(cssNoSoportado(fuente), [], 'el CSS de partida tiene que estar dentro del piso')
  const minificado = await cssDelBuild(t, fuente)
  assert.equal(minificado.trim().includes('\n'), false, `el build minifica el CSS, que sale en una sola linea:\n${minificado}`)
  assert.deepEqual(cssNoSoportado(minificado), [], minificado)
  // Los pares siguen ahí, pegados y con el vh antes del dvh: sin el vh, un navegador que no entiende dvh (Chrome 90, Safari 14) se queda sin
  // esa altura, y sin el dvh la barra de direcciones del móvil tapa el final de la pantalla.
  const compacto = minificado.replace(/\s+/g, '')
  for (const par of ['min-height:100vh;min-height:100dvh', 'max-height:85vh;max-height:85dvh', 'height:calc(100vh-56px);height:calc(100dvh-56px)']) {
    assert.ok(compacto.includes(par), `se perdio ${par}:\n${minificado}`)
  }
  // Los dos selectores :hover siguen (el `{` los distingue de la condición `(hover:hover)`), y el @media que pide hover y puntero fino
  // también; que ninguno quede fuera de él lo dice cssNoSoportado.
  assert.match(compacto, /@media\(hover:hover\)and\(pointer:fine\)\{/)
  assert.equal(minificado.match(/:hover\{/g)?.length, 2, minificado)
})

test('build real: una ofensa de verdad sobrevive al minificador y el piso la encuentra (la prueba de arriba no es vacia)', async (t) => {
  const minificado = await cssDelBuild(t, '.alto{height:100dvh}\n.boton:hover{color:red}\n.cuadro{aspect-ratio:1}')
  const ofensas = cssNoSoportado(minificado)
  assert.equal(ofensas.length, 3, `${ofensas.join(' | ')}\n${minificado}`)
  for (const regla of [/^dvh sin vh/, /^:hover fuera de/, /^aspect-ratio/]) {
    assert.equal(ofensas.filter((ofensa) => regla.test(ofensa)).length, 1, `${regla}: ${ofensas.join(' | ')}`)
  }
})
