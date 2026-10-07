// Textos que ve el cajero alrededor de la emisión de un e-CF: las etiquetas de
// los estados DGII (src/api/estadosDgii.ts) y, en las secciones siguientes, los
// textos del servidor y del front que errores.ts debe dejar pasar o elegir.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/check-errores.ts
import { dgiiLabel, isEnVuelo, isRechazo } from '../src/api/estadosDgii.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves.
const ordenar = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordenar)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
      : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

// --- Etiquetas de los estados DGII ------------------------------------------
console.log('dgiiLabel / isEnVuelo / isRechazo (src/api/estadosDgii.ts)')
// Todos los estados de facturas.estado_dgii (spec 4.3) y los literales que un
// VARCHAR(20) sin modo estricto cortó antes de la migración 028 (spec 9.1).
const ESTADOS = [
  'PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', 'EN_PROCESO', 'ACEPTADO', 'ACEPTADO_CONDICIONAL',
  'RECHAZADO', 'NO_ENCONTRADO', 'ERROR', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO', 'RFCE_ACEPTADO',
  'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_RECHAZADO', 'RFCE_NO_ENCONTRADO', 'RFCE_ERROR', 'RECHAZADO_ARCHIVADO',
  'NO_ENCONTRADO_ARCHIVADO', 'RFCE_RECHAZADO_ARCHIVADO', 'RFCE_NO_ENCONTRADO_ARCHIVADO',
  'RFCE_ACEPTADO_CONDIC', 'RFCE_RECHAZADO_ARCHI', 'NO_ENCONTRADO_ARCHIV', 'RFCE_NO_ENCONTRADO_A',
]
for (const e of ESTADOS) {
  const l = dgiiLabel(e)
  chk(`${e} -> "${l}" (una etiqueta, no el código)`, l !== e && l !== '—')
}
igual('en vuelo: Por enviar / Sin confirmar',
  [dgiiLabel('PENDIENTE_ENVIO'), dgiiLabel('ENVIO_INCIERTO')], ['Por enviar', 'Sin confirmar'])
igual('vacío o nulo -> "—"; desconocido -> el código tal cual',
  [dgiiLabel(null), dgiiLabel(undefined), dgiiLabel(''), dgiiLabel('OTRO_ESTADO')], ['—', '—', '—', 'OTRO_ESTADO'])
igual('isEnVuelo: solo PENDIENTE_ENVIO y ENVIO_INCIERTO',
  ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ENVIADO', null, ''].map(isEnVuelo), [true, true, false, false, false])
igual('isRechazo no cambia: RECHAZADO, RECHAZADO_ARCHIVADO y RFCE_RECHAZADO',
  ['RECHAZADO', 'RECHAZADO_ARCHIVADO', 'RFCE_RECHAZADO', 'ENVIO_INCIERTO', 'NO_ENCONTRADO_ARCHIVADO'].map(isRechazo),
  [true, true, true, false, false])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
