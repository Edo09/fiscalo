// formatApiDate (src/api/fechas.ts): una fecha sin hora ('2027-12-31', como llega el vencimiento de un
// rango e-NCF) se muestra con su mismo día en cualquier zona horaria del equipo. Antes se leía como UTC y en
// RD (UTC−4) salía «30 dic» para un vencimiento guardado el 31. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-fechas-api.ts
import { execFileSync } from 'node:child_process'
import { formatApiDate } from '../src/api/fechas.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}
/** El primer número del texto: el día en «31 dic de 2027». */
const dia = (s: string) => Number(/\d+/.exec(s)?.[0])

console.log('Fechas sin hora')
chk("'2027-12-31' muestra el día 31", dia(formatApiDate('2027-12-31')) === 31)
chk("'2027-12-31' muestra el mes dic", formatApiDate('2027-12-31').includes('dic'))
chk("'2027-01-01' muestra el día 1 (un corrimiento lo mandaría al 31 de dic)", dia(formatApiDate('2027-01-01')) === 1)
chk("'2027-02-30' (un día que no existe) se devuelve tal cual, no se corre a marzo", formatApiDate('2027-02-30') === '2027-02-30')

console.log('Lo que ya funcionaba')
chk("'2026-11-20 14:31:22' muestra el día 20", dia(formatApiDate('2026-11-20 14:31:22')) === 20)
chk("'31-12-2027' (dd-mm-yyyy) muestra el día 31", dia(formatApiDate('31-12-2027')) === 31)
chk("'abc' se devuelve tal cual", formatApiDate('abc') === 'abc')
chk("null, undefined y '' dan —", formatApiDate(null) === '—' && formatApiDate(undefined) === '—' && formatApiDate('') === '—')

console.log('Mismo día con la zona del equipo en -4 h, UTC y +13 h')
const modulo = new URL('../src/api/fechas.ts', import.meta.url).href
for (const tz of ['America/Santo_Domingo', 'UTC', 'Pacific/Auckland']) {
  const salida = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import(${JSON.stringify(modulo)}).then((m) => console.log(m.formatApiDate('2027-12-31')))`],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  ).trim()
  chk(`TZ=${tz}: '2027-12-31' sale con el día 31 («${salida}»)`, dia(salida) === 31)
}

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
