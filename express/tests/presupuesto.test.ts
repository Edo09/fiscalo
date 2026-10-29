// Comprobaciones del build de Express: el presupuesto de peso (anexo 15.4), el piso de CSS y el identificador de la compilación.
// Lo puro vive en dev/presupuesto.mjs; los plugins de Vite que lo usan (budget y versionJson), en dev/plugins.mjs.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { budget, compilacionActual, FALLAR_PRESUPUESTO, shaDeCompilacion, versionJson } from '../dev/plugins.mjs'
import { cssNoSoportado, evaluarPresupuesto, idCompilacion, PRESUPUESTO, tablaPresupuesto } from '../dev/presupuesto.mjs'

type Tipo = 'html' | 'themeInit' | 'css' | 'entryJs' | 'rutaJs' | 'zodJs' | 'fuente' | 'otro'

/** Un archivo del build de `kb` KB gzip (1 KB = 1024 bytes, como en el anexo). */
const pesa = (tipo: Tipo, kb: number, nombre: string = tipo) => ({ nombre, tipo, gzip: kb * 1024 })

// --- Las cuatro pruebas del plan ----------------------------------------------------------------------------------------

test('entryJs: 110 KB + 1 byte es exceso, 96 KB solo aviso', () => {
  assert.equal(evaluarPresupuesto([{ nombre: 'i.js', tipo: 'entryJs', gzip: 110 * 1024 + 1 }]).excesos.length, 1)
  const r = evaluarPresupuesto([{ nombre: 'i.js', tipo: 'entryJs', gzip: 96 * 1024 }])
  assert.deepEqual([r.avisos.length, r.excesos.length], [1, 0])
})

test('css: 15360 pasa y 15361 es exceso; el total de carga fria se informa', () => {
  assert.equal(evaluarPresupuesto([{ nombre: 'a.css', tipo: 'css', gzip: 15360 }]).excesos.length, 0)
  assert.equal(evaluarPresupuesto([{ nombre: 'a.css', tipo: 'css', gzip: 15361 }]).excesos.length, 1)
  const f = (tipo: 'html' | 'css' | 'entryJs' | 'fuente', kb: number) => ({ nombre: tipo, tipo, gzip: kb * 1024 })
  assert.equal(evaluarPresupuesto([f('html', 2), f('css', 15), f('entryJs', 110), f('fuente', 30)]).excesos.length, 0) // 157 KB, dentro de 160
})

test('cssNoSoportado', () => {
  for (const css of ['a{color:color-mix(in srgb,red,blue)}', 'a:has(b){}', '@container x{}', 'div{aspect-ratio:1}', '.x:hover{}', '.p{height:100dvh}']) {
    assert.equal(cssNoSoportado(css).length, 1, css)
  }
  assert.deepEqual(cssNoSoportado('@media (hover: hover) and (pointer: fine){.x:hover{}} .p{height:100vh;height:100dvh}'), [])
})

test('idCompilacion', () => assert.equal(idCompilacion(new Date('2026-10-26T12:00:00Z'), 'a1b2c3d4e5'), '26.10.26-a1b2c3d'))

// --- Presupuesto: lo que el plan deja abierto ----------------------------------------------------------------------------

test('PRESUPUESTO: los limites del anexo 15.4 en bytes gzip, con el objetivo del JS de arranque aparte', () => {
  assert.deepEqual(
    { ...PRESUPUESTO },
    { html: 2048, themeInit: 410, css: 15360, entryJs: 112640, entryJsObjetivo: 97280, rutaJs: 46080, zodJs: 25600, fuente: 30720, cargaFria: 163840 },
  )
})

test('cada limite: el valor exacto pasa y un byte mas es exceso', () => {
  const limites: Array<[Tipo, number]> = [['html', 2048], ['themeInit', 410], ['css', 15360], ['entryJs', 112640], ['rutaJs', 46080], ['zodJs', 25600], ['fuente', 30720]]
  for (const [tipo, limite] of limites) {
    assert.equal(evaluarPresupuesto([{ nombre: 'x', tipo, gzip: limite }]).excesos.length, 0, `${tipo} en el limite`)
    assert.equal(evaluarPresupuesto([{ nombre: 'x', tipo, gzip: limite + 1 }]).excesos.length, 1, `${tipo} un byte mas`)
  }
})

test('pasar el limite es un exceso y no ademas un aviso; entre el objetivo y el limite solo hay aviso', () => {
  const dentro = evaluarPresupuesto([pesa('entryJs', 100)])
  assert.deepEqual([dentro.avisos.length, dentro.excesos.length], [1, 0])
  assert.match(dentro.avisos[0], /^JS de arranque \(entryJs\): 100\.00 KB gzip pasa el objetivo de 95\.00 KB \(límite 110\.00 KB\)$/)
  const fuera = evaluarPresupuesto([pesa('entryJs', 120)])
  assert.deepEqual([fuera.avisos.length, fuera.excesos.length], [0, 1])
  assert.match(fuera.excesos[0], /^JS de arranque \(entryJs\): 120\.00 KB gzip pasa el límite de 110\.00 KB$/)
  // Solo el JS de arranque tiene objetivo: lo demás tiene un unico limite.
  const enElLimite = [pesa('css', 15), pesa('rutaJs', 45), pesa('zodJs', 25), pesa('fuente', 30), pesa('html', 2), { nombre: 'theme-init.js', tipo: 'themeInit' as const, gzip: 410 }]
  assert.deepEqual(evaluarPresupuesto(enElLimite), { avisos: [], excesos: [] })
})

test('el JS de arranque y el CSS se miden en total; el JS de ruta, el de zod y la fuente, archivo por archivo', () => {
  // La entrada y su chunk compartido: 60 + 60 KB pasan el limite aunque cada uno cabria solo.
  const arranque = evaluarPresupuesto([pesa('entryJs', 60, 'index.js'), pesa('entryJs', 60, 'compartido.js')])
  assert.equal(arranque.excesos.length, 1)
  assert.match(arranque.excesos[0], /index\.js, compartido\.js/)
  assert.equal(evaluarPresupuesto([pesa('css', 8, 'a.css'), pesa('css', 8, 'b.css')]).excesos.length, 1) // 16 KB de CSS en total
  // Cada chunk de ruta tiene sus 45 KB: dos de 45 no suman 90 contra un solo limite.
  assert.deepEqual(evaluarPresupuesto([pesa('rutaJs', 45, 'a.js'), pesa('rutaJs', 45, 'b.js')]), { avisos: [], excesos: [] })
  const unoGrande = evaluarPresupuesto([pesa('rutaJs', 45, 'a.js'), pesa('rutaJs', 46, 'b.js')])
  assert.equal(unoGrande.excesos.length, 1)
  assert.match(unoGrande.excesos[0], /\(b\.js\)/)
})

test('carga fria: suma html, css, JS de arranque y fuente; lo perezoso y lo que no tiene presupuesto no cuentan', () => {
  // Cada pieza cabe en su limite, pero dos fuentes llevan la carga fria a 187 KB.
  const fria = [pesa('html', 2), pesa('css', 15), pesa('entryJs', 110), pesa('fuente', 30)]
  const dosFuentes = evaluarPresupuesto([...fria, pesa('fuente', 30)])
  assert.equal(dosFuentes.excesos.length, 1)
  assert.match(dosFuentes.excesos[0], /^Carga en frío \(HTML \+ CSS \+ JS de arranque \+ fuente\): 187\.00 KB gzip pasa el límite de 160\.00 KB$/)
  const perezoso = [...fria, pesa('rutaJs', 45), pesa('zodJs', 25), pesa('otro', 500, 'logo.png')]
  assert.deepEqual(evaluarPresupuesto(perezoso).excesos, [])
})

test('lo que pesa menos de 1 KB se dice en bytes: el limite de theme-init.js son 410 bytes y no "0.40 KB"', () => {
  const { excesos } = evaluarPresupuesto([{ nombre: 'theme-init.js', tipo: 'themeInit', gzip: 411 }])
  assert.deepEqual(excesos, ['theme-init.js (theme-init.js): 411 B gzip pasa el límite de 410 B'])
  assert.match(tablaPresupuesto([{ nombre: 'theme-init.js', tipo: 'themeInit', gzip: 262 }]), / {2}theme-init\.js {2}theme-init\.js {2}262 B {2}de 410 B {2}ok$/m)
})

test('tablaPresupuesto: una fila por cosa medida, con peso, limite y estado; lo que no tiene presupuesto no sale', () => {
  const tabla = tablaPresupuesto([
    pesa('html', 0.5, 'index.html'),
    pesa('css', 3, 'assets/index-a.css'),
    pesa('entryJs', 50, 'assets/index-b.js'),
    pesa('entryJs', 51, 'assets/vendor-c.js'),
    pesa('rutaJs', 30, 'assets/Facturar-d.js'),
    pesa('rutaJs', 46, 'assets/Detalle-e.js'),
    pesa('zodJs', 20, 'assets/zod-f.js'),
    pesa('fuente', 28, 'fonts/titulos.woff2'),
    pesa('otro', 1, 'icons/mark.svg'),
  ])
  const lineas = tabla.split('\n')
  assert.equal(lineas[0], 'Presupuesto de bundle (gzip, 1 KB = 1024 bytes)')
  assert.equal(lineas.length, 9) // el titulo, siete cosas medidas (los dos JS de arranque cuentan como una) y la carga fria
  const fila = (patron: RegExp): string => lineas.find((l) => patron.test(l)) ?? assert.fail(`sin fila ${patron}`)
  assert.match(fila(/HTML/), /index\.html +512 B +de 2\.00 KB +ok$/)
  assert.match(fila(/JS de arranque/), /assets\/index-b\.js, assets\/vendor-c\.js +101\.00 KB +de 110\.00 KB \(objetivo 95\.00 KB\) +AVISO$/)
  assert.match(fila(/Facturar/), /JS de ruta +assets\/Facturar-d\.js +30\.00 KB +de 45\.00 KB +ok$/)
  assert.match(fila(/Detalle/), /JS de ruta +assets\/Detalle-e\.js +46\.00 KB +de 45\.00 KB +EXCESO$/)
  assert.match(fila(/Carga en frío/), /HTML \+ CSS \+ JS de arranque \+ fuente +132\.50 KB +de 160\.00 KB +ok$/)
  assert.doesNotMatch(tabla, /mark\.svg/)
  // Las columnas quedan alineadas: el estado empieza en la misma columna en todas las filas.
  assert.equal(new Set(lineas.slice(1).map((l) => l.search(/ (ok|AVISO|EXCESO)$/))).size, 1)
})

test('un tipo que el presupuesto no conoce es un error, no se ignora en silencio', () => {
  assert.throws(() => evaluarPresupuesto([{ nombre: 'x.js', tipo: 'entryjs' as any, gzip: 1 }]), /entryjs.*x\.js/)
  assert.deepEqual(evaluarPresupuesto([]), { avisos: [], excesos: [] })
  assert.deepEqual(evaluarPresupuesto([pesa('otro', 999)]), { avisos: [], excesos: [] })
})

// --- Piso de CSS: lo que el plan deja abierto ----------------------------------------------------------------------------

test('cssNoSoportado: dice que regla rompe cada cosa, y cuenta cada ocurrencia', () => {
  const r = cssNoSoportado('a:has(b){aspect-ratio:1} .x:hover{} .y{color:color-mix(in srgb,red,blue)} @container c{} .p{height:100dvh}')
  assert.equal(r.length, 6)
  // El orden entre reglas distintas no es parte del contrato: cada una sale una vez.
  for (const regla of [/^:has\(\)/, /^aspect-ratio/, /^:hover fuera de \(hover:hover\) and \(pointer:fine\)/, /^color-mix\(\)/, /^@container/, /^dvh sin vh/]) {
    assert.equal(r.filter((o) => regla.test(o)).length, 1, `${regla}: ${r.join(' | ')}`)
  }
  assert.equal(cssNoSoportado('.a:hover{} .b:hover{}').length, 2) // dos reglas, dos ofensas
  assert.equal(cssNoSoportado('a:has(b){} c:has(d){}').length, 2)
  assert.match(cssNoSoportado('.boton:hover{}')[0], /\.boton:hover/) // el fragmento permite encontrarlo
})

test('cssNoSoportado: los comentarios y las cadenas no cuentan', () => {
  const css = '/* color-mix() :has(x) @container aspect-ratio:1 .a:hover{} height:100dvh */ a::after{content:":has(x) aspect-ratio:1 100dvh"} b::after{content:\'.a:hover{}\'}'
  assert.deepEqual(cssNoSoportado(css), [])
  assert.equal(cssNoSoportado('a/**/:has(b){}').length, 1) // un comentario entre dos piezas no las esconde
})

test('cssNoSoportado: :hover solo se admite dentro de un @media con (hover:hover) y (pointer:fine) a la vez', () => {
  const dentro = (consulta: string) => `@media ${consulta}{.x:hover{color:red}}`
  // Con las dos condiciones, escritas como sea: con espacios, sin ellos, en mayusculas, con mas condiciones, o anidado en otro bloque.
  for (const css of [
    dentro('(hover: hover) and (pointer: fine)'),
    dentro('(hover:hover) and (pointer:fine)'),
    dentro('(HOVER: HOVER) AND (POINTER: FINE)'),
    dentro('screen and (min-width: 600px) and (hover: hover) and (pointer: fine)'),
    '@media(hover:hover)and (pointer:fine){.x:hover{color:red}.y:hover{color:#00f}}', // como lo deja el minificador del build
    '@supports (display:grid){@media (hover:hover) and (pointer:fine){.x:hover{color:red}}}',
    '.a{color:red;@media (hover:hover) and (pointer:fine){&:hover{color:blue}}}',
  ]) assert.deepEqual(cssNoSoportado(css), [], css)
  // Una sola condicion, la otra, una alternativa sin ellas (la coma es un O) o la negacion: el :hover vuelve a ser un problema.
  for (const css of [
    dentro('(hover: hover)'),
    dentro('(pointer: fine)'),
    dentro('(any-hover: hover) and (pointer: fine)'),
    dentro('(hover: hover) and (pointer: fine), print'),
    dentro('not all and (hover: hover) and (pointer: fine)'),
    '@media (min-width:600px){.x:hover{color:red}}',
    '.x:not(:hover){color:red}',
    '.a:hover,.b:hover{color:red}', // una regla con dos selectores es una ofensa
  ]) assert.equal(cssNoSoportado(css).length, 1, css)
})

test('cssNoSoportado: nombres parecidos a :hover o a las condiciones no son :hover', () => {
  assert.deepEqual(cssNoSoportado('.hover{color:red} .a-hover:focus{color:red} .x:hovered{color:red} @media (hover: hover){.y{color:red}}'), [])
})

test('cssNoSoportado: cada dvh necesita un vh antes, de la misma propiedad y en el mismo bloque', () => {
  for (const css of [
    '.p{height:100vh;height:100dvh}',
    '.p{min-height:100vh;min-height:100dvh}', // como lo deja el minificador del build
    '.p{max-height:calc(100vh - 56px);max-height:calc(100dvh - 56px)}',
    '.p{height:85vh!important;height:85dvh!important}',
    '.p{max-height:85VH;max-height:85DVH}',
    '.p{width:100vw;height:50vh;height:50dvh}',
    '.p{height:100vh;height:100dvh} .q{height:100vh;height:100dvh}',
    '@media (min-width:600px){.p{height:100vh;height:100dvh}}',
  ]) assert.deepEqual(cssNoSoportado(css), [], css)
  for (const css of [
    '.p{height:100dvh}',
    '.p{height:100dvh;height:100vh}', // el vh va despues: ningun navegador viejo ve el dvh, pero el nuevo se queda con el vh
    '.p{height:100vh} .q{height:100dvh}', // el vh es de otro bloque
    '.p{min-height:100vh;height:100dvh}', // el vh es de otra propiedad
    '.p{height:calc(100dvh - 56px)}',
    '.p{height:.5dvh}',
    '@media (min-width:600px){.p{height:100dvh}}',
  ]) assert.equal(cssNoSoportado(css).length, 1, css)
  assert.match(cssNoSoportado('.p{min-height:100dvh}')[0], /^dvh sin vh: min-height:100dvh$/)
})

test('cssNoSoportado: aspect-ratio es la propiedad; (aspect-ratio) como condicion de @media y los nombres con guion no cuentan', () => {
  assert.equal(cssNoSoportado('.a{ASPECT-RATIO: 16 / 9}').length, 1)
  assert.equal(cssNoSoportado('.a{aspect-ratio:auto 4/3}').length, 1)
  assert.deepEqual(cssNoSoportado('@media (aspect-ratio: 16/9){.a{color:red}} @media (min-aspect-ratio: 1/1){.a{color:red}} .b{--aspect-ratio:1;color:red}'), [])
})

test('cssNoSoportado: el contenido de un url() no cuenta (un data: trae ; y texto cualquiera) pero lo de alrededor si', () => {
  assert.deepEqual(cssNoSoportado('.z{background:url(data:image/svg+xml;base64,AAAA);height:100vh;height:100dvh}'), [])
  assert.deepEqual(cssNoSoportado('.z{background:url(data:text/plain;x:100dvh) no-repeat;height:100vh}'), [])
  assert.deepEqual(cssNoSoportado('.z{background:url("a:hover{}.png")}'), [])
  assert.equal(cssNoSoportado('.z{background:url(data:image/png;base64,AAAA);height:100dvh}').length, 1)
})

// --- idCompilacion ---------------------------------------------------------------------------------------------------------

test('idCompilacion: la fecha es UTC (la misma en cualquier maquina), con ceros a la izquierda, y el sha va recortado a 7', () => {
  assert.equal(idCompilacion(new Date('2026-12-31T23:59:59Z'), 'abcdef0123456789'), '26.12.31-abcdef0')
  assert.equal(idCompilacion(new Date('2027-01-01T00:00:00Z'), 'abcdef0'), '27.01.01-abcdef0')
  assert.equal(idCompilacion(new Date('2030-03-05T04:05:06Z'), 'a'.repeat(40)), '30.03.05-aaaaaaa')
  assert.equal(idCompilacion(new Date('2026-10-29T12:00:00Z'), 'local'), '26.10.29-local') // sin sha: lo que pone plugins.mjs
  assert.equal(idCompilacion(new Date('2026-10-29T12:00:00Z'), 'abc'), '26.10.29-abc') // un sha corto se deja como esta
})

// --- Plugin budget -------------------------------------------------------------------------------------------------------
// Se llama a sus ganchos con un contexto falso (`this.warn` anota, `this.error` lanza, como en Rollup) y un bundle armado a mano, con
// el peso medido por longitud: así `bytes` es el peso gzip exacto y los límites se prueban al byte.

const KB = 1024
type Salida = { fileName: string }

/** Un chunk como llega a generateBundle. Por omisión trae un solo módulo, de la app. */
const chunk = (fileName: string, bytes: number, opciones: { entrada?: boolean; imports?: string[]; modulos?: string[] } = {}) => ({
  type: 'chunk',
  fileName,
  isEntry: opciones.entrada === true,
  imports: opciones.imports ?? [],
  dynamicImports: [],
  modules: Object.fromEntries((opciones.modulos ?? [`/proyecto/express/src/${fileName}.ts`]).map((id) => [id, {}])),
  code: 'x'.repeat(bytes),
})
const recurso = (fileName: string, bytes: number) => ({ type: 'asset', fileName, source: 'x'.repeat(bytes) })
const bundleDe = (...salidas: Salida[]) => Object.fromEntries(salidas.map((salida) => [salida.fileName, salida]))

/** Una carpeta temporal que se borra al terminar la prueba. */
function temporal(t: TestContext): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'express-presupuesto-'))
  t.after(() => rmSync(carpeta, { recursive: true, force: true }))
  return carpeta
}

/** El plugin con su configuración resuelta falsa; `ejecutar()` corre generateBundle. `tabla` es lo que imprime y `avisos` lo que pasa por this.warn. */
function correr(bundle: Record<string, unknown>, opciones: { fallar?: boolean; publicDir?: string | false } = {}) {
  const plugin: any = budget({ fallar: opciones.fallar, medir: (contenido: string | Uint8Array) => contenido.length })
  const tabla: string[] = []
  const avisos: string[] = []
  plugin.configResolved({ logger: { info: (mensaje: string) => tabla.push(mensaje) }, publicDir: opciones.publicDir ?? false })
  const contexto = {
    warn: (mensaje: string) => avisos.push(mensaje),
    error(mensaje: string): never {
      throw new Error(mensaje)
    },
  }
  return { plugin, tabla, avisos, ejecutar: () => plugin.generateBundle.call(contexto, {}, bundle) }
}

test('budget: solo en el build, y después de los plugins de Vite que escriben el HTML y el CSS finales', () => {
  const plugin: any = budget()
  assert.deepEqual([plugin.name, plugin.apply, plugin.enforce], ['express:budget', 'build', 'post'])
})

test('budget: la entrada y lo que importa sin import() es JS de arranque; el resto de los chunks, de ruta; el que trae zod, de zod', () => {
  const { tabla, ejecutar } = correr(
    bundleDe(
      chunk('assets/index-a.js', 40 * KB, { entrada: true, imports: ['assets/comun-b.js'] }),
      chunk('assets/comun-b.js', 10 * KB),
      chunk('assets/Facturar-c.js', 30 * KB, { imports: ['assets/comun-b.js', 'assets/zod-d.js'] }),
      chunk('assets/Detalle-e.js', 20 * KB, { imports: ['assets/comun-b.js'] }),
      chunk('assets/rutas-f.js', 5 * KB), // lo comparten dos rutas y la entrada no lo importa: se carga con una ruta
      chunk('assets/zod-d.js', 20 * KB, { modulos: ['/proyecto/node_modules/zod/v4/core/index.js', '/proyecto/node_modules/zod/v4/classic/schemas.js'] }),
      recurso('index.html', 400),
      recurso('assets/index-g.css', 3 * KB),
      recurso('assets/titulos-h.woff2', 20 * KB),
      recurso('assets/logo-i.svg', 900),
    ),
  )
  ejecutar()
  assert.equal(tabla.length, 1)
  const filas = tabla[0]
  assert.match(filas, /^ {2}JS de arranque +assets\/index-a\.js, assets\/comun-b\.js +50\.00 KB +de 110\.00 KB \(objetivo 95\.00 KB\) +ok$/m)
  for (const ruta of ['Facturar-c', 'Detalle-e', 'rutas-f']) assert.match(filas, new RegExp(`^ {2}JS de ruta +assets/${ruta}\\.js +`, 'm'), ruta)
  assert.match(filas, /^ {2}JS de zod +assets\/zod-d\.js +20\.00 KB +de 25\.00 KB +ok$/m)
  assert.match(filas, /^ {2}CSS +assets\/index-g\.css +3\.00 KB +de 15\.00 KB +ok$/m)
  assert.match(filas, /^ {2}HTML +index\.html +400 B +de 2\.00 KB +ok$/m)
  assert.match(filas, /^ {2}Fuente +assets\/titulos-h\.woff2 +20\.00 KB +de 30\.00 KB +ok$/m)
  assert.match(filas, /^ {2}Carga en frío +.+ +73\.39 KB +de 160\.00 KB +ok$/m) // 0.39 (HTML) + 3 (CSS) + 50 (arranque) + 20 (fuente)
  assert.doesNotMatch(filas, /logo-i/) // un SVG no tiene presupuesto
  assert.doesNotMatch(filas, /JS de ruta +assets\/(index-a|comun-b|zod-d)\.js/)
})

test('budget en modo aviso: un aviso y un exceso salen como advertencias y el build sigue', () => {
  const { tabla, avisos, ejecutar } = correr(bundleDe(chunk('assets/index-a.js', 100 * KB, { entrada: true }), chunk('assets/Detalle-b.js', 46 * KB)), { fallar: false })
  assert.doesNotThrow(ejecutar)
  assert.equal(avisos.length, 2)
  assert.match(avisos[0], /^JS de arranque \(assets\/index-a\.js\): 100\.00 KB gzip pasa el objetivo de 95\.00 KB/)
  assert.match(avisos[1], /^JS de ruta \(assets\/Detalle-b\.js\): 46\.00 KB gzip pasa el límite de 45\.00 KB$/)
  assert.match(tabla[0], /AVISO/)
  assert.match(tabla[0], /EXCESO/)
})

test('budget en modo falla: un exceso rompe el build y dice cuál; un aviso solo avisa', () => {
  const roto = correr(bundleDe(chunk('assets/index-a.js', 40 * KB, { entrada: true }), chunk('assets/Detalle-b.js', 46 * KB)), { fallar: true })
  assert.throws(roto.ejecutar, /^Error: El bundle pasa el presupuesto:\n {2}JS de ruta \(assets\/Detalle-b\.js\): 46\.00 KB gzip pasa el límite de 45\.00 KB$/)
  assert.match(roto.tabla[0], /EXCESO/) // la tabla sale aunque el build falle
  const soloAviso = correr(bundleDe(chunk('assets/index-a.js', 100 * KB, { entrada: true })), { fallar: true })
  assert.doesNotThrow(soloAviso.ejecutar)
  assert.equal(soloAviso.avisos.length, 1)
})

test('budget(): sin opciones sigue a FALLAR_PRESUPUESTO (hoy false; el plan 07 lo cambia a true y esta prueba vale con los dos)', () => {
  const { avisos, ejecutar } = correr(bundleDe(chunk('assets/index-a.js', 40 * KB, { entrada: true }), chunk('assets/Detalle-b.js', 46 * KB)))
  assert.equal(typeof FALLAR_PRESUPUESTO, 'boolean')
  if (FALLAR_PRESUPUESTO) {
    assert.throws(ejecutar, /El bundle pasa el presupuesto/)
  } else {
    assert.doesNotThrow(ejecutar)
    assert.equal(avisos.length, 1)
  }
})

test('budget: zod en la entrada o en lo que esta importa sin import() rompe el build, también en modo aviso', () => {
  const zod = '/proyecto/node_modules/zod/v4/core/index.js'
  const casos: Record<string, Record<string, unknown>> = {
    'dentro de la entrada': bundleDe(chunk('assets/index-a.js', KB, { entrada: true, modulos: ['/proyecto/express/src/main.tsx', zod] })),
    'en un chunk que la entrada importa': bundleDe(
      chunk('assets/index-a.js', KB, { entrada: true, imports: ['assets/comun-b.js'] }),
      chunk('assets/comun-b.js', KB, { modulos: [zod] }),
    ),
    'a dos saltos de la entrada': bundleDe(
      chunk('assets/index-a.js', KB, { entrada: true, imports: ['assets/b.js'] }),
      chunk('assets/b.js', KB, { imports: ['assets/c.js'] }),
      chunk('assets/c.js', KB, { modulos: [zod] }),
    ),
    'con la ruta de Windows': bundleDe(chunk('assets/index-a.js', KB, { entrada: true, modulos: ['C:\\proyecto\\node_modules\\zod\\v4\\core\\index.js'] })),
  }
  for (const [caso, bundle] of Object.entries(casos)) {
    for (const fallar of [false, true]) {
      assert.throws(correr(bundle, { fallar }).ejecutar, /zod.*import\(\)/s, `${caso} (fallar=${fallar})`)
    }
  }
  // El mensaje dice qué chunk lo trae y qué módulo es.
  assert.throws(correr(casos['en un chunk que la entrada importa']).ejecutar, /assets\/comun-b\.js.*node_modules\/zod\/v4\/core\/index\.js/s)
})

test('budget: lo que se parece a zod no cuenta, ni zod tras un import() aunque ese chunk importe al de zod', () => {
  const sano = bundleDe(
    chunk('assets/index-a.js', KB, {
      entrada: true,
      modulos: ['/proyecto/node_modules/zod-to-json-schema/index.js', '/proyecto/node_modules/zodiac/x.js', '/proyecto/express/src/zod/util.ts'],
    }),
    chunk('assets/Facturar-b.js', KB, { imports: ['assets/zod-c.js'] }),
    chunk('assets/zod-c.js', KB, { modulos: ['/proyecto/node_modules/zod/v4/core/index.js'] }),
  )
  assert.doesNotThrow(correr(sano).ejecutar)
})

test('budget: mide también theme-init.js y las fuentes de public/, que Vite copia al build sin pasarlas por el bundle', (t) => {
  const publico = temporal(t)
  mkdirSync(join(publico, 'fonts'))
  writeFileSync(join(publico, 'theme-init.js'), 'x'.repeat(411)) // un byte sobre el límite de 410
  writeFileSync(join(publico, 'fonts', 'titulos.woff2'), 'x'.repeat(20 * KB))
  writeFileSync(join(publico, 'fonts', 'LEEME.txt'), 'x'.repeat(99 * KB)) // no es una fuente
  writeFileSync(join(publico, 'manifest.webmanifest'), 'x'.repeat(99 * KB)) // ni esto tiene presupuesto
  const { tabla, avisos, ejecutar } = correr(bundleDe(chunk('assets/index-a.js', KB, { entrada: true }), recurso('index.html', 500)), { publicDir: publico })
  ejecutar()
  assert.match(tabla[0], /^ {2}theme-init\.js +theme-init\.js +411 B +de 410 B +EXCESO$/m)
  assert.match(tabla[0], /^ {2}Fuente +fonts\/titulos\.woff2 +20\.00 KB +de 30\.00 KB +ok$/m)
  assert.match(tabla[0], /^ {2}Carga en frío +.+ +21\.49 KB /m) // la fuente de public/ cuenta en la carga fría: 1 (arranque) + 0.49 (HTML) + 20
  assert.doesNotMatch(tabla[0], /LEEME|manifest/)
  assert.deepEqual(avisos, ['theme-init.js (theme-init.js): 411 B gzip pasa el límite de 410 B'])
  // Sin carpeta public (publicDir: false, o una que no tiene nada de esto) no hay nada que medir ahí.
  const vacia = correr(bundleDe(chunk('assets/index-a.js', KB, { entrada: true })), { publicDir: temporal(t) })
  vacia.ejecutar()
  assert.doesNotMatch(vacia.tabla[0], /theme-init|Fuente/)
})

// --- Con el Vite de verdad ---------------------------------------------------------------------------------------------------
// Los bundles armados a mano de arriba dependen de que Rollup entregue los chunks como se supone (`isEntry`, `imports`, `modules`). Aquí
// corre un build real de Vite, en una carpeta temporal, con los plugins de Express: una entrada con CSS, dos rutas perezosas que comparten
// zod (un paquete de mentira con ese nombre), un theme-init.js y una fuente en public/.

const COMPILACION = { version: '26.10.29-abc1234', construido: '2026-10-29T16:00:00.000Z' }

async function construirDeVerdad(t: TestContext, zodEnLaEntrada: boolean) {
  const raiz = temporal(t)
  const archivos: Record<string, string> = {
    'index.html': '<!doctype html><html><head><meta charset="UTF-8"><title>t</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>',
    'src/main.ts': [
      "import './estilos.css'",
      "import { saludo } from './comun'",
      zodEnLaEntrada ? "import { esquema } from 'zod'\nconsole.log(esquema('x'))" : '',
      'document.title = saludo',
      "document.body.onclick = () => { import('./rutaA'); import('./rutaB') }", // si nada los usa, Rollup descarta los import()
    ].join('\n'),
    'src/comun.ts': "export const saludo = 'hola'",
    'src/estilos.css': '.a{color:red}',
    'src/rutaA.ts': "import { esquema } from 'zod'\nexport default () => esquema('a')",
    'src/rutaB.ts': "import { esquema } from 'zod'\nexport default () => esquema('b')",
    'node_modules/zod/package.json': '{"name":"zod","version":"0.0.0","type":"module","main":"index.js"}',
    'node_modules/zod/index.js': 'export const esquema = (x) => ({ parse: () => x })',
    'public/theme-init.js': 'try{}catch(e){}',
    'public/fonts/titulos.woff2': 'x'.repeat(2000),
  }
  for (const [ruta, contenido] of Object.entries(archivos)) {
    mkdirSync(dirname(join(raiz, ruta)), { recursive: true })
    writeFileSync(join(raiz, ruta), contenido)
  }
  const info: string[] = []
  const avisos: string[] = []
  const registro = {
    info: (mensaje: string) => info.push(mensaje),
    warn: (mensaje: string) => avisos.push(mensaje),
    warnOnce: (mensaje: string) => avisos.push(mensaje),
    error: (mensaje: string) => info.push(mensaje),
    clearScreen: () => {},
    hasErrorLogged: () => false,
    hasWarned: false,
  }
  const { build } = await import('vite')
  const resultado: any = await build({
    root: raiz,
    configFile: false,
    customLogger: registro,
    plugins: [budget(), versionJson(COMPILACION)],
    build: { write: false },
  })
  return { salida: info.join('\n'), avisos: avisos.join('\n'), emitidos: resultado.output as any[] }
}

const comoExpresion = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('build real: la entrada, las rutas, el chunk de zod, el CSS, el HTML y public/ caen en su fila, y se escribe version.json', async (t) => {
  const { salida, avisos, emitidos } = await construirDeVerdad(t, false)
  const chunks = emitidos.filter((emitido) => emitido.type === 'chunk')
  const entrada = chunks.find((c) => c.isEntry)
  const rutas = chunks.filter((c) => c.isDynamicEntry)
  const zod = chunks.find((c) => Object.keys(c.modules).some((id) => id.includes('/node_modules/zod/')))
  assert.ok(entrada && zod, 'el build no dejó una entrada y un chunk de zod')
  assert.equal(rutas.length, 2)
  assert.notEqual(zod.fileName, entrada.fileName) // el zod de las rutas no se junta con la entrada
  const fila = (etiqueta: string, archivo: string) => assert.match(salida, new RegExp(`^ {2}${etiqueta} +${comoExpresion(archivo)} `, 'm'), `${etiqueta}: ${archivo}\n${salida}`)
  fila('JS de arranque', entrada.fileName)
  for (const ruta of rutas) fila('JS de ruta', ruta.fileName)
  fila('JS de zod', zod.fileName)
  fila('CSS', emitidos.find((e) => e.fileName.endsWith('.css')).fileName)
  fila('HTML', 'index.html')
  fila('theme-init.js', 'theme-init.js')
  fila('Fuente', 'fonts/titulos.woff2')
  assert.match(salida, /^ {2}Carga en frío +/m)
  assert.doesNotMatch(avisos, /gzip pasa/) // todo cabe: ni avisos ni excesos
  const version = emitidos.find((e) => e.fileName === 'version.json')
  assert.deepEqual(JSON.parse(version.source), COMPILACION)
})

test('build real: zod importado desde la entrada rompe el build, aunque el presupuesto solo avise', async (t) => {
  await assert.rejects(construirDeVerdad(t, true), /zod está en el JS de arranque: assets\/index-\S+\.js trae node_modules\/zod\/index\.js/)
})

// --- version.json y BUILD_ID -----------------------------------------------------------------------------------------------

test('versionJson: emite version.json con { version, construido }, solo en el build', () => {
  const compilacion = { version: '26.10.29-abc1234', construido: '2026-10-29T16:00:00.000Z' }
  const plugin: any = versionJson(compilacion)
  assert.deepEqual([plugin.name, plugin.apply], ['express:version-json', 'build'])
  const emitidos: any[] = []
  plugin.generateBundle.call({ emitFile: (archivo: unknown) => emitidos.push(archivo) }, {}, {})
  assert.equal(emitidos.length, 1)
  assert.deepEqual([emitidos[0].type, emitidos[0].fileName], ['asset', 'version.json'])
  assert.deepEqual(JSON.parse(emitidos[0].source), compilacion)
})

test('compilacionActual: version con idCompilacion y construido en ISO (UTC)', () => {
  assert.deepEqual(compilacionActual(new Date('2026-10-29T16:00:00Z'), 'abcdef0123'), { version: '26.10.29-abcdef0', construido: '2026-10-29T16:00:00.000Z' })
  const ahora = compilacionActual() // con los valores por omisión: hoy y el sha de este repo, o `local`
  assert.match(ahora.version, /^\d{2}\.\d{2}\.\d{2}-\S+$/)
  assert.equal(new Date(ahora.construido).toISOString(), ahora.construido)
})

test('shaDeCompilacion: el sha de Vercel, si no el de git, si no local', () => {
  const sinGit = (): string => {
    throw new Error('git no está')
  }
  assert.equal(shaDeCompilacion({ VERCEL_GIT_COMMIT_SHA: 'abcdef0123456789' }, sinGit), 'abcdef0123456789') // el de Vercel gana y no se llama a git
  assert.equal(shaDeCompilacion({ VERCEL_GIT_COMMIT_SHA: ' abcdef0123456789\n' }, sinGit), 'abcdef0123456789')
  assert.equal(shaDeCompilacion({}, () => 'f00ba12\n'), 'f00ba12')
  assert.equal(shaDeCompilacion({ VERCEL_GIT_COMMIT_SHA: '  ' }, () => 'f00ba12\n'), 'f00ba12') // una variable vacía no cuenta
  assert.equal(shaDeCompilacion({}, sinGit), 'local')
  assert.equal(shaDeCompilacion({}, () => ' \n'), 'local')
})

test('vite.config: BUILD_ID de la app y version de version.json salen del mismo valor, y los plugins están puestos', async () => {
  // Si no fueran el mismo, la app compararía su BUILD_ID con el version.json de otra compilación y avisaría de una versión nueva siempre (o nunca).
  const modulo = await import('../vite.config.ts')
  const bruto: any = modulo.default
  const config: any = typeof bruto === 'function' ? bruto({ command: 'build', mode: 'production' }) : bruto
  const plugins: any[] = (config.plugins as any[]).flat(Infinity)
  const version = plugins.find((plugin) => plugin?.name === 'express:version-json')
  assert.ok(version, 'versionJson() no está en los plugins de vite.config.ts')
  assert.ok(plugins.some((plugin) => plugin?.name === 'express:budget'), 'budget() no está en los plugins de vite.config.ts')
  const emitidos: any[] = []
  version.generateBundle.call({ emitFile: (archivo: unknown) => emitidos.push(archivo) }, {}, {})
  const emitida = JSON.parse(emitidos[0].source).version
  assert.equal(config.define.__BUILD_ID__, JSON.stringify(emitida))
  assert.match(emitida, /^\d{2}\.\d{2}\.\d{2}-\S+$/)
})
