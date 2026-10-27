// Medición del build (scripts/medir-build.ts): qué archivos carga cada página, el nombre sin hash de
// cada uno y la comparación de dos mediciones. Sin build ni Vite: solo las funciones puras.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-medir-build.ts
import { activosDePagina, compararMediciones, sinHash } from './medir-build.ts'
import type { Medicion } from './medir-build.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  chk(ok ? desc : `${desc}: dio ${JSON.stringify(obtenido)}, se esperaba ${JSON.stringify(esperado)}`, ok)
}

// fixture copied from the shape of dist/app.html: the rel="icon" link also lives under /assets/ and is NOT a build asset
const html = '<link rel="icon" type="image/x-icon" href="/assets/favicon.ico" />\n<script type="module" crossorigin src="/assets/main-BMC8sJ3I.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/bold-SQ-v0pu8.js">\n<link rel="stylesheet" crossorigin href="/assets/bold-BMvlKj91.css">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk">'
igual('activos en orden, sin externos y sin el favicon', activosDePagina(html), ['/assets/main-BMC8sJ3I.js', '/assets/bold-SQ-v0pu8.js', '/assets/bold-BMvlKj91.css'])
igual('sin hash', [sinHash('main-BMC8sJ3I.js'), sinHash('bold-BMvlKj91.css')], ['main.js', 'bold.css'])
igual('sin hash cuando el hash trae guion', [sinHash('bold-SQ-v0pu8.js'), sinHash('pos-m2NXpo-P.css')], ['bold.js', 'pos.css'])
const med = (bytes: number): Medicion => ({ version: 1, git_sha: 'x', node: 'v22', perezosos: [], paginas: { app: { entrada: [{ nombre: 'main-AAAA1111.js', bytes, gzip: 1 }], totalBytes: bytes, totalGzip: 1 }, pos: { entrada: [], totalBytes: 0, totalGzip: 0 } } })
igual('iguales: sin diferencias', compararMediciones(med(100), med(100)), [])
igual('un chunk que crece se nombra', compararMediciones(med(100), med(150)), ['app main.js: 100 -> 150 bytes'])
const sinApp = med(100); sinApp.paginas.app.entrada = []
igual('un chunk perdido se nombra', compararMediciones(med(100), sinApp), ['app main.js: falta'])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
