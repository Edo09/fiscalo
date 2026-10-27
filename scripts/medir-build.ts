// Medición del build de la app y del POS: cuánto pesa lo que carga cada página al abrirla (los
// archivos de <script>, modulepreload y stylesheet de app.html y pos.html) y cuánto los chunks
// perezosos, para que las fases de Express demuestren que no engordaron el bundle.
//
// El build corre en una carpeta temporal y con las cuatro VITE_* vacías, así el .env del
// desarrollador nunca cambia los números. Se comparan los bytes crudos; el gzip (nivel 9) es solo
// informativo. Los nombres se comparan sin el hash del build (main-BMC8sJ3I.js -> main.js).
//
// Solo se compara en esta máquina: los finales de línea CRLF de un checkout de Windows cambian los
// bytes, por eso ningún CI corre --comparar.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/medir-build.ts --guardar    mide y escribe docs/superpowers/baselines/express-bundle-baseline.json
//   node scripts/medir-build.ts --comparar   mide y lo compara con esa línea base
// Salida: 0 sin diferencias (o guardado), 1 hay diferencias, 2 no se puede (fuentes sin commit,
// línea base vieja o ausente, argumento inválido), 3 el build falló.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export interface Archivo { nombre: string; bytes: number; gzip: number }
export interface PaginaMedida { entrada: Archivo[]; totalBytes: number; totalGzip: number }
export interface Medicion {
  version: 1
  git_sha: string
  node: string
  paginas: { app: PaginaMedida; pos: PaginaMedida }
  perezosos: Archivo[]
}

// Lo que comparten las dos páginas y por lo tanto fija el build: si cambia, la línea base es vieja.
const FUENTES = ['src', 'package.json', 'package-lock.json', 'vite.config.ts', 'index.html', 'pos.html']
const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const RUTA_BASE = join(RAIZ, 'docs', 'superpowers', 'baselines', 'express-bundle-baseline.json')
const PAGINAS = ['app', 'pos'] as const

/** Todas las URL /assets/... que la página pide con <script src>, modulepreload o stylesheet, en orden y sin repetir. */
export function activosDePagina(html: string): string[] {
  const urls: string[] = []
  for (const etiqueta of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const atributos: Record<string, string> = {}
    for (const m of etiqueta.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      atributos[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
    }
    const esScript = /^<script/i.test(etiqueta)
    const rel = (atributos.rel ?? '').toLowerCase().split(/\s+/)
    const url = esScript ? atributos.src : rel.includes('modulepreload') || rel.includes('stylesheet') ? atributos.href : undefined
    // El rel="icon" también vive bajo /assets/ y no es un activo del build; los externos (https://...) no empiezan por /assets/.
    if (url?.startsWith('/assets/') && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/** Quita el hash del build: son los 8 últimos caracteres antes de la extensión y pueden traer "-" o "_". */
export function sinHash(nombre: string): string {
  return nombre.replace(/-[A-Za-z0-9_-]{8}(\.[^.]+)$/, '$1')
}

// Tamaños por nombre sin hash; varios chunks pueden compartir nombre (p. ej. dos index-*.js).
function porNombre(archivos: Archivo[]): Map<string, number[]> {
  const mapa = new Map<string, number[]>()
  for (const a of archivos) {
    const clave = sinHash(a.nombre)
    mapa.set(clave, [...(mapa.get(clave) ?? []), a.bytes])
  }
  for (const tamanos of mapa.values()) tamanos.sort((x, y) => x - y)
  return mapa
}

// Diferencias de un grupo de archivos. Con varios chunks de un mismo nombre se comparan las listas
// de tamaños ordenadas: los tamaños que están en las dos se descartan y lo que sobra de cada lado
// se empareja en orden, así un chunk nuevo se nombra como "sobra" y no desplaza a los demás.
function diferenciasDe(grupo: string, base: Archivo[], nueva: Archivo[]): string[] {
  const antes = porNombre(base)
  const despues = porNombre(nueva)
  const salida: string[] = []
  for (const nombre of [...antes.keys(), ...[...despues.keys()].filter((n) => !antes.has(n))]) {
    const restoBase = [...(antes.get(nombre) ?? [])]
    const restoNueva: number[] = []
    for (const b of despues.get(nombre) ?? []) {
      const i = restoBase.indexOf(b)
      if (i >= 0) restoBase.splice(i, 1)
      else restoNueva.push(b)
    }
    const pares = Math.min(restoBase.length, restoNueva.length)
    for (let i = 0; i < pares; i++) salida.push(`${grupo} ${nombre}: ${restoBase[i]} -> ${restoNueva[i]} bytes`)
    salida.push(...restoBase.slice(pares).map(() => `${grupo} ${nombre}: falta`))
    salida.push(...restoNueva.slice(pares).map(() => `${grupo} ${nombre}: sobra`))
  }
  return salida
}

/** Diferencias entre dos mediciones, una línea por cada una; vacío si todo coincide en nombres sin hash y bytes crudos. */
export function compararMediciones(base: Medicion, nueva: Medicion): string[] {
  return [
    ...PAGINAS.flatMap((p) => diferenciasDe(p, base.paginas[p].entrada, nueva.paginas[p].entrada)),
    ...diferenciasDe('perezosos', base.perezosos, nueva.perezosos),
  ]
}

function leer(salida: string, url: string): Archivo {
  const ruta = join(salida, ...url.split('/'))
  if (!existsSync(ruta)) throw new Error(`El build no emitió ${url}`)
  const contenido = readFileSync(ruta)
  return { nombre: url.slice(url.lastIndexOf('/') + 1), bytes: contenido.length, gzip: gzipSync(contenido, { level: 9 }).length }
}

function git(args: string[]) {
  return spawnSync('git', args, { cwd: RAIZ, encoding: 'utf8' })
}

/** Corre vite build en una carpeta temporal y mide lo que cada página carga y los chunks que no carga ninguna. */
function medir(): Medicion {
  const sha = git(['rev-parse', 'HEAD'])
  if (sha.status !== 0) throw new Error('No se pudo leer el commit actual con git rev-parse HEAD.')
  const salida = mkdtempSync(join(tmpdir(), 'medir-build-'))
  try {
    // Vite lee primero las variables del proceso: vacías, el .env del desarrollador no pesa en el bundle.
    const env = { ...process.env, VITE_API_BASE_URL: '', VITE_TENANT_ID: '', VITE_DEFAULT_USER_ID: '', VITE_API_KEY: '' }
    const build = spawnSync(`npx vite build --outDir "${salida}" --emptyOutDir`, { cwd: RAIZ, shell: true, env, encoding: 'utf8', maxBuffer: 1 << 26 })
    if (build.status !== 0) {
      console.error(`${build.stdout}${build.stderr}`)
      throw Object.assign(new Error('vite build falló.'), { codigoSalida: 3 })
    }
    const paginas = {} as Medicion['paginas']
    const cargados = new Set<string>()
    for (const pagina of PAGINAS) {
      const entrada = activosDePagina(readFileSync(join(salida, `${pagina}.html`), 'utf8')).map((url) => leer(salida, url))
      for (const a of entrada) cargados.add(a.nombre)
      paginas[pagina] = {
        entrada,
        totalBytes: entrada.reduce((s, a) => s + a.bytes, 0),
        totalGzip: entrada.reduce((s, a) => s + a.gzip, 0),
      }
    }
    // Perezoso: chunk .js o .css del build que ninguna de las dos páginas pide al abrir.
    const perezosos = readdirSync(join(salida, 'assets'))
      .filter((n) => /\.(?:js|css)$/.test(n) && !cargados.has(n))
      .sort()
      .map((n) => leer(salida, `/assets/${n}`))
    return { version: 1, git_sha: sha.stdout.trim(), node: process.version, paginas, perezosos }
  } finally {
    rmSync(salida, { recursive: true, force: true })
  }
}

function imprimir(m: Medicion): void {
  for (const pagina of PAGINAS) {
    const { entrada, totalBytes, totalGzip } = m.paginas[pagina]
    console.log(`${pagina}: ${entrada.length} archivos de entrada, ${totalBytes} bytes (${totalGzip} gzip)`)
    for (const a of entrada) console.log(`  ${a.nombre}: ${a.bytes} bytes (${a.gzip} gzip)`)
  }
  console.log(`perezosos: ${m.perezosos.length} chunks`)
}

function salir(mensaje: string, codigo: number): never {
  console.error(mensaje)
  process.exit(codigo)
}

function guardar(): void {
  // Con fuentes sin commit el git_sha guardado no describiría el build medido.
  const sucio = git(['status', '--porcelain', '--', ...FUENTES])
  if (sucio.status !== 0) salir('git status falló.', 2)
  if (sucio.stdout.trim() !== '') salir(`Hay cambios sin commit en las fuentes del build; haz commit antes de guardar:\n${sucio.stdout}`, 2)
  const medicion = medir()
  imprimir(medicion)
  mkdirSync(dirname(RUTA_BASE), { recursive: true })
  writeFileSync(RUTA_BASE, `${JSON.stringify(medicion, null, 2)}\n`)
  console.log(`\nGuardado en ${RUTA_BASE}`)
}

function comparar(): void {
  if (!existsSync(RUTA_BASE)) salir('No hay línea base: corre primero node scripts/medir-build.ts --guardar', 2)
  const base = JSON.parse(readFileSync(RUTA_BASE, 'utf8')) as Medicion
  // Si las fuentes compartidas se movieron desde el commit de la línea base, los números ya no son comparables.
  const cambio = git(['diff', '--quiet', base.git_sha, '--', ...FUENTES])
  if (cambio.status === 1) salir(`línea base vieja: las fuentes del build cambiaron desde ${base.git_sha}. Vuelve a medir con --guardar.`, 2)
  if (cambio.status !== 0) salir(`git no pudo comparar con ${base.git_sha}: ${cambio.stderr.trim()}`, 2)
  const nueva = medir()
  imprimir(nueva)
  const diferencias = compararMediciones(base, nueva)
  if (diferencias.length === 0) {
    console.log('\nsin diferencias')
    return
  }
  console.log(`\n${diferencias.length} diferencias con la línea base:`)
  for (const d of diferencias) console.log(`  ${d}`)
  process.exit(1)
}

// Solo corre al invocarlo como script, para que la prueba pueda importar las funciones puras.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const modo = process.argv[2]
  if (modo !== '--guardar' && modo !== '--comparar') salir('Uso: node scripts/medir-build.ts --guardar|--comparar', 2)
  try {
    if (modo === '--guardar') guardar()
    else comparar()
  } catch (e) {
    salir(e instanceof Error ? e.message : String(e), (e as { codigoSalida?: number }).codigoSalida ?? 3)
  }
}
