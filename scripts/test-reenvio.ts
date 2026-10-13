// «Reenviar a la DGII» en el detalle de una factura (src/features/invoices/reenvio.ts):
// qué tarjeta lleva la acción y cuándo está el botón. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-reenvio.ts
import {
  TEXTO_NO_ENCONTRADO, TITULO_NO_ENCONTRADO, puedeReenviarFactura, tarjetaReenvio,
} from '../src/features/invoices/reenvio.ts'
import { ESTADOS_EN_VUELO, dgiiLabel } from '../src/api/estadosDgii.ts'

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

console.log('Tarjeta que lleva la acción')
igual('RECHAZADO y RFCE_RECHAZADO: la tarjeta roja de rechazo',
  ['RECHAZADO', 'RFCE_RECHAZADO'].map(tarjetaReenvio), ['rechazado', 'rechazado'])
igual('NO_ENCONTRADO: tarjeta propia, ya no queda sin botón', tarjetaReenvio('NO_ENCONTRADO'), 'no_encontrado')
igual('un archivado se muestra como rechazado pero no se reenvía otra vez: tarjeta roja sin botón',
  [tarjetaReenvio('RECHAZADO_ARCHIVADO'), puedeReenviarFactura('RECHAZADO_ARCHIVADO', false)], ['rechazado', false])
igual('aceptados, sin confirmar, en vuelo, error y sin estado: ninguna tarjeta',
  [
    'ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO', 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO',
    'PENDIENTE_ENVIO', 'ENVIO_INCIERTO', 'ERROR', 'NO_ENCONTRADO_ARCHIVADO', null, undefined, '',
  ].map(tarjetaReenvio),
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null])

console.log('Botón')
igual('RECHAZADO, RFCE_RECHAZADO y NO_ENCONTRADO con la secuencia sin consumir: botón',
  ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'].map((e) => puedeReenviarFactura(e, false)), [true, true, true])
igual('sin la bandera (null o ausente) se trata como sin consumir',
  [puedeReenviarFactura('NO_ENCONTRADO', null), puedeReenviarFactura('RECHAZADO', undefined)], [true, true])
igual('con la secuencia consumida no hay botón (el API contestaría 409)',
  ['RECHAZADO', 'RFCE_RECHAZADO', 'NO_ENCONTRADO'].map((e) => puedeReenviarFactura(e, true)), [false, false, false])
chk('nada sin confirmar se reenvía desde la app',
  [...ESTADOS_EN_VUELO, 'ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO'].every((e) => !puedeReenviarFactura(e, false)))
chk('toda tarjeta "no_encontrado" tiene botón (con la secuencia sin consumir)',
  ['NO_ENCONTRADO'].every((e) => tarjetaReenvio(e) === 'no_encontrado' && puedeReenviarFactura(e, null)))

console.log('Textos')
chk('la tarjeta de NO_ENCONTRADO no llama rechazo a lo que no lo es',
  !/rechaz/i.test(TITULO_NO_ENCONTRADO) && !/rechaz/i.test(TEXTO_NO_ENCONTRADO))
chk('y su estado se ve "Pendiente" en el listado, como hasta ahora', dgiiLabel('NO_ENCONTRADO') === 'Pendiente')

console.log(`\n${total - fallos} de ${total} pruebas OK`)
process.exit(fallos === 0 ? 0 : 1)
