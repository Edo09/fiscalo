// Instalable: iconos, manifiestos y enlaces de app.* (index.html) y pos.* (pos.html).
// Los dos sitios salen del mismo build; cada uno enlaza su manifiesto y se distinguen
// por nombre e icono (docs/superpowers/specs/2026-11-17-app-instalable-design.md).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-instalable.ts          contra public/ y los HTML de la raíz
//   node scripts/test-instalable.ts --dist   contra dist/ (después de `npm run build`)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const DIST = process.argv.includes('--dist')
const PUBLICO = join(RAIZ, DIST ? 'dist' : 'public')
// El build renombra index.html a app.html (vite.config.ts, appHtmlSinIndex).
const HTML = {
  app: join(RAIZ, DIST ? 'dist/app.html' : 'index.html'),
  pos: join(RAIZ, DIST ? 'dist/pos.html' : 'pos.html'),
}

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

/** Ancho, alto y tipo de color de un PNG (cabecera IHDR); null si no existe o no es PNG. */
function leerPng(ruta: string): { ancho: number; alto: number; tipoColor: number } | null {
  if (!existsSync(ruta)) return null
  const b = readFileSync(ruta)
  if (!b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20), tipoColor: b[25] }
}

console.log('Iconos (/icons/)')
for (const sitio of ['app', 'pos']) {
  for (const [sufijo, lado, opaco] of [['192', 192, false], ['512', 512, false], ['maskable-512', 512, true]] as const) {
    const png = leerPng(join(PUBLICO, 'icons', `${sitio}-${sufijo}.png`))
    chk(`${sitio}-${sufijo}.png es un PNG de ${lado}×${lado}`, png?.ancho === lado && png?.alto === lado, png)
    // Maskable: a sangre completa y sin transparencia (tipo de color 2 = RGB), o Windows pinta una caja.
    if (opaco) chk(`${sitio}-${sufijo}.png es opaco (RGB, sin canal alfa)`, png?.tipoColor === 2, png)
  }
}

type Icono = { src: string; sizes: string; type: string; purpose?: string }
type Manifiesto = {
  id: string; name: string; short_name: string; start_url: string
  display: string; lang: string; icons: Icono[]
}
const NOMBRES = { app: 'FiscalPoint', pos: 'FiscalPoint POS' } as const

console.log('\nManifiestos y enlaces')
for (const sitio of ['app', 'pos'] as const) {
  const m = JSON.parse(readFileSync(join(PUBLICO, `${sitio}.webmanifest`), 'utf8')) as Manifiesto
  const html = readFileSync(HTML[sitio], 'utf8')
  const otro = sitio === 'app' ? 'pos' : 'app'
  chk(`${sitio}: nombre y nombre corto "${NOMBRES[sitio]}"`, m.name === NOMBRES[sitio] && m.short_name === NOMBRES[sitio])
  chk(`${sitio}: start_url e id "/", ventana propia (standalone), es-DO`,
    m.start_url === '/' && m.id === '/' && m.display === 'standalone' && m.lang === 'es-DO')
  chk(`${sitio}: iconos 192, 512 y maskable 512, todos PNG`,
    JSON.stringify(m.icons.map((i) => [i.src, i.sizes, i.type, i.purpose ?? 'any'])) === JSON.stringify([
      [`/icons/${sitio}-192.png`, '192x192', 'image/png', 'any'],
      [`/icons/${sitio}-512.png`, '512x512', 'image/png', 'any'],
      [`/icons/${sitio}-maskable-512.png`, '512x512', 'image/png', 'maskable'],
    ]))
  chk(`${sitio}: cada icono nombrado existe en ${DIST ? 'dist/' : 'public/'}`, m.icons.every((i) => existsSync(join(PUBLICO, i.src))))
  chk(`${sitio}: sin URL absolutas (valen en previews y en localhost)`,
    !JSON.stringify(m).includes('://') && [m.id, m.start_url, ...m.icons.map((i) => i.src)].every((u) => u.startsWith('/')))
  chk(`${sitio}: su HTML enlaza /${sitio}.webmanifest y no el de ${otro}`,
    html.includes(`<link rel="manifest" href="/${sitio}.webmanifest"`) && !html.includes(`${otro}.webmanifest`))
  // Un preview protegido con Vercel Authentication contesta 401 al manifiesto si el navegador no
  // manda las cookies, y el manifiesto se pide sin cookies salvo con crossorigin="use-credentials".
  const enlace = html.match(/<link\b[^>]*\brel="manifest"[^>]*>/)?.[0] ?? ''
  chk(`${sitio}: el enlace al manifiesto lleva crossorigin="use-credentials" (un preview protegido pide cookies)`,
    enlace.includes('crossorigin="use-credentials"'), enlace)
  chk(`${sitio}: su HTML no añade theme-color ni service worker (la web no cambia)`, !/theme-color|serviceWorker/.test(html))
}

console.log('\nGuía para clientes (docs/instalar-en-la-pc.md)')
const rutaGuia = join(RAIZ, 'docs/instalar-en-la-pc.md')
const guia = existsSync(rutaGuia) ? readFileSync(rutaGuia, 'utf8') : ''
chk('la guía existe y nombra las dos direcciones y las dos apps',
  ['https://app.fiscalpoint.com.do', 'https://pos.fiscalpoint.com.do', 'FiscalPoint POS'].every((t) => guia.includes(t)))
chk('la guía son pasos numerados', /^1\. /m.test(guia) && /^2\. /m.test(guia))
chk('la guía es corta (hasta 40 líneas), sin tablas ni bloques de código',
  guia !== '' && guia.split('\n').length <= 40 && !/^\s*\|/m.test(guia) && !guia.includes('```'))

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
