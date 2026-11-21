// Por qué el POS deja la venta cuando el servidor ya no reconoce la sesión (src/pos/sesionPerdida.ts):
// un bloqueo (al PIN) o un PIN restablecido por un administrador (directo a crear otro con el usuario).
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-sesion-perdida.ts
import { AVISO_PIN_RESTABLECIDO, motivoDeError, motivoDeEstado } from '../src/pos/sesionPerdida.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

console.log('Un error SESION_REQUERIDA (cualquier petición de la venta)')
chk('con pin_restablecido: true → pin-restablecido', motivoDeError({ pin_restablecido: true }) === 'pin-restablecido')
chk('sin el campo (un API anterior o cualquier otra causa) → bloqueo, lo de siempre', motivoDeError({}) === 'bloqueo')
chk('con otros campos del servidor pero sin ese → bloqueo', motivoDeError({ intentos_restantes: 3 }) === 'bloqueo')
chk('pin_restablecido: false → bloqueo', motivoDeError({ pin_restablecido: false }) === 'bloqueo')
for (const raro of ['true', 1, 'si', null, undefined, {}, []]) {
  chk(`pin_restablecido: ${JSON.stringify(raro) ?? 'undefined'} no cuenta (solo true exacto) → bloqueo`, motivoDeError({ pin_restablecido: raro }) === 'bloqueo')
}

console.log('GET /pos/estado que vuelve sin empleado')
chk('pin_restablecido: true → pin-restablecido', motivoDeEstado({ pin_restablecido: true }) === 'pin-restablecido')
chk('pin_restablecido: false → bloqueo', motivoDeEstado({ pin_restablecido: false }) === 'bloqueo')
chk('sin el campo (un API anterior) → bloqueo', motivoDeEstado({}) === 'bloqueo')

console.log('El aviso')
chk('dice que un administrador restableció el PIN', /administrador restableció tu PIN/.test(AVISO_PIN_RESTABLECIDO), AVISO_PIN_RESTABLECIDO)
chk('dice qué hacer: entrar con su usuario para crear uno nuevo', /usuario/.test(AVISO_PIN_RESTABLECIDO) && /crear uno nuevo/.test(AVISO_PIN_RESTABLECIDO), AVISO_PIN_RESTABLECIDO)
chk('no manda a escribir el PIN (ya no existe)', !/escribe tu PIN|con tu PIN/i.test(AVISO_PIN_RESTABLECIDO), AVISO_PIN_RESTABLECIDO)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
