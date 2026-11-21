// Crear el PIN en el POS (src/pos/pinNuevo.ts): qué es un PIN obvio (igual que
// PosPin::esObvio en api-gratex) y los dos pasos de escribirlo y confirmarlo.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-pin-nuevo.ts
import { DIGITOS_PIN, ESTADO_INICIAL, pinEsObvio, teclear, volverAEscribir, type EstadoPin, type EventoPin } from '../src/pos/pinNuevo.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}${ok || obtenido === undefined ? '' : ` → ${JSON.stringify(obtenido)}`}`)
}

/** Teclea una cadena de teclas y devuelve el estado final y el último evento que no fue 'nada'. */
function teclas(texto: string, desde: EstadoPin = ESTADO_INICIAL): { estado: EstadoPin; evento: EventoPin } {
  let estado = desde
  let evento: EventoPin = { tipo: 'nada' }
  for (const t of [...texto]) {
    const r = teclear(estado, t)
    estado = r.estado
    if (r.evento.tipo !== 'nada') evento = r.evento
  }
  return { estado, evento }
}

console.log('PIN obvio (el mismo criterio que el servidor)')
for (const pin of ['0000', '1111', '7777', '9999', '1234', '2345', '3456', '4567', '5678', '6789', '0123', '4321', '9876', '3210']) {
  chk(`${pin} es obvio`, pinEsObvio(pin))
}
for (const pin of ['1357', '1212', '2580', '1235', '1243', '9012', '8520', '0001', '1000', '2468', '1122']) {
  chk(`${pin} no es obvio`, !pinEsObvio(pin))
}
chk('4 dígitos', DIGITOS_PIN === 4)

console.log('Escribir y confirmar')
let r = teclas('135')
chk('con 3 dígitos sigue escribiendo el primero', r.estado.fase === 'nuevo' && r.estado.actual === '135' && r.evento.tipo === 'nada', r)
r = teclas('7', r.estado)
chk('el cuarto dígito pasa a confirmar y guarda el primero', r.estado.fase === 'confirmar' && r.estado.primero === '1357' && r.estado.actual === '' && r.evento.tipo === 'nada', r)
r = teclas('135', r.estado)
chk('confirmando, con 3 dígitos todavía no pasa nada', r.estado.fase === 'confirmar' && r.estado.actual === '135' && r.evento.tipo === 'nada', r)
r = teclas('7', r.estado)
chk('los dos iguales: listo con el PIN, y no se puede seguir escribiendo',
  r.evento.tipo === 'listo' && r.evento.pin === '1357' && teclear(r.estado, '9').estado.actual === '1357', r)
chk('de principio a fin en una sola tecleada', teclas('13571357').evento.tipo === 'listo' && (teclas('13571357').evento as { pin?: string }).pin === '1357')

console.log('Los dos distintos y los obvios')
r = teclas('13571358')
chk('confirmación distinta: no coinciden y se vuelve a empezar', r.evento.tipo === 'no-coinciden' && r.estado.fase === 'nuevo' && r.estado.primero === '' && r.estado.actual === '', r)
r = teclas('1234')
chk('un PIN obvio se rechaza en el acto y se vuelve a empezar', r.evento.tipo === 'obvio' && r.estado.fase === 'nuevo' && r.estado.actual === '', r)
r = teclas('0000')
chk('0000 también', r.evento.tipo === 'obvio')
chk('el obvio no llega a la confirmación', teclas('12341234').evento.tipo === 'listo' === false)
chk('tras un obvio se puede escribir uno bueno', teclas('1234' + '2580' + '2580').evento.tipo === 'listo')

console.log('Borrar')
r = teclas('13⌫')
chk('⌫ borra el último dígito', r.estado.actual === '1', r)
r = teclas('⌫⌫⌫')
chk('⌫ con nada escrito no rompe', r.estado.actual === '' && r.estado.fase === 'nuevo', r)
r = teclas('1357' + '13⌫⌫⌫')
chk('en la confirmación ⌫ no toca el primero', r.estado.fase === 'confirmar' && r.estado.primero === '1357' && r.estado.actual === '', r)
r = teclas('1357' + '135C')
chk('C borra lo escrito en esta fase, no el primero', r.estado.fase === 'confirmar' && r.estado.primero === '1357' && r.estado.actual === '', r)
r = teclas('135C')
chk('C en la primera fase deja todo vacío', r.estado.actual === '' && r.estado.fase === 'nuevo', r)
chk('"Cambiar" vuelve a la primera fase y borra el primero', JSON.stringify(volverAEscribir()) === JSON.stringify(ESTADO_INICIAL))

console.log('Teclas que no son dígitos')
r = teclas('1a.-x 3')
chk('letras, punto y espacios se ignoran', r.estado.actual === '13', r)
chk('un "12" (dos dígitos en una tecla) no cuenta', teclas('12').estado.actual === '12' && teclear(ESTADO_INICIAL, '12').estado.actual === '')
r = teclas('13579')
chk('un quinto dígito en la fase "nuevo" no existe: el cuarto ya pasó a confirmar', r.estado.fase === 'confirmar' && r.estado.actual === '9')

console.log('No muta lo que recibe')
const base: EstadoPin = { fase: 'confirmar', primero: '1357', actual: '13' }
const copia = JSON.stringify(base)
teclear(base, '5')
teclear(base, '⌫')
chk('el estado de entrada queda igual', JSON.stringify(base) === copia)

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
