// Archivo de resultados de P0 (docs/superpowers/specs/2026-10-27-express-p0-results.md): que la tabla
// de spikes traiga sus siete filas con las siete columnas, un resultado válido, el plan que cada una
// bloquea y su fallback, y que el archivo tenga las respuestas D1 a D8 y la línea de firma del dueño.
// No juzga los resultados (PENDIENTE vale): eso lo cierra el dueño al llenar la tabla y firmar.
// Sin red ni Vite.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-p0-results.ts
import { readFileSync } from 'node:fs'
let fallos = 0, total = 0
const chk = (d: string, ok: boolean) => { total++; if (!ok) fallos++; console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${d}`) }
const md = readFileSync(new URL('../docs/superpowers/specs/2026-10-27-express-p0-results.md', import.meta.url), 'utf8')
const fila = (id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? ''
const gates: Record<string, RegExp> = { S0: /06.*07/, S1: /08/, S2a: /03.*04.*08/, S2b: /03/, S2c: /03.*07/, S3a: /07/, S3b: /07/ }
for (const id of Object.keys(gates)) {
  const celdas = fila(id).split('|').map((c) => c.trim())
  chk(`${id}: siete columnas`, celdas.length === 9)
  chk(`${id}: resultado PENDIENTE, PASA, FALLA o NO EJECUTADA`, /^(PENDIENTE|PASA|FALLA|NO EJECUTADA)/.test(celdas[4] ?? ''))
  chk(`${id}: dice a que plan bloquea`, gates[id].test(celdas[6] ?? ''))
  chk(`${id}: trae su fallback`, (celdas[7] ?? '').length > 20)
}
chk('hay linea de respuesta del dueño para D1 a D8', [1, 2, 3, 4, 5, 6, 7, 8].every((n) => md.includes(`D${n}:`)))
chk('S3a: el fallback conserva el bloqueo del diseño 14', /bloque|block/i.test(fila('S3a').split('|')[7] ?? ''))
chk('hay linea de firma del dueño', /Firma del dueño:/.test(md))
console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
