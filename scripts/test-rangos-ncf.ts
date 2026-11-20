// Rangos e-NCF (src/features/ecf/rangosNcf.ts): la regla que revisa el formulario de Rangos
// antes de enviar, igual que ncfModel::registerRange en la API. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-rangos-ncf.ts
import type { NcfRango } from '../src/api/types.ts'
import { cambiosDelFormulario, problemaConEdicion, problemaConExistentes } from '../src/features/ecf/rangosNcf.ts'
import type { FormularioEdicion } from '../src/features/ecf/rangosNcf.ts'

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

const rango = (r: Partial<NcfRango> & Pick<NcfRango, 'id' | 'type' | 'current_value' | 'numero_desde'>): NcfRango => r

console.log('Ventas sin rango: el contador pasó del Hasta')
// E32 1-100 agotado y 3 ventas del POS sin rango: 101, 102 y 103 (current_value 103).
const agotado103: NcfRango[] = [rango({ id: 1, type: 'E32', current_value: 103, numero_desde: 1, numero_hasta: 100 })]
igual('Desde 101 se acepta: el rango nuevo cubre los 3 números usados', problemaConExistentes(agotado103, 'E32', 101, 200), null)
igual('Desde 100 no: es el último número autorizado',
  problemaConExistentes(agotado103, 'E32', 100, 200),
  'El número «Desde» tiene que ser mayor que 100, que es el último ya usado o autorizado para E32.')
igual('Desde 1 no: el tope sigue siendo el Hasta autorizado',
  problemaConExistentes(agotado103, 'E32', 1, 200),
  'El número «Desde» tiene que ser mayor que 100, que es el último ya usado o autorizado para E32.')
igual('con strings, como llegan algunos campos de la API', problemaConExistentes(
  [rango({ id: 1, type: 'E32', current_value: '103', numero_desde: '1', numero_hasta: '100' })], 'E32', 101, 200), null)

console.log('Rango legado sin Hasta (NULL)')
const legado: NcfRango[] = [rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 1, numero_hasta: null })]
igual('Desde 58 (después de lo usado) se acepta, sin convertir: no empieza donde la fila legada',
  problemaConExistentes([rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 5, numero_hasta: null })], 'E31', 58, 100), null)
igual('lo usado por un rango legado sigue siendo tope: Desde 57 no',
  problemaConExistentes([rango({ id: 2, type: 'E31', current_value: 57, numero_desde: 5, numero_hasta: null })], 'E31', 57, 100),
  'El número «Desde» tiene que ser mayor que 57, que es el último ya usado o autorizado para E31.')
igual('si el rango nuevo empieza donde la fila legada, la convierte: su consumo no es tope', problemaConExistentes(legado, 'E31', 1, 100), null)
igual('... pero el Hasta no puede quedar por debajo de lo ya usado',
  problemaConExistentes(legado, 'E31', 1, 40),
  'Ya se usaron números de E31 hasta el 57: el número «Hasta» tiene que ser 57 o más.')

console.log('Otros tipos y rangos')
igual('los rangos de otro tipo no cuentan', problemaConExistentes(agotado103, 'E31', 1, 100), null)
igual('con varios rangos manda el Hasta más alto',
  problemaConExistentes([
    rango({ id: 1, type: 'E32', current_value: 100, numero_desde: 1, numero_hasta: 100 }),
    rango({ id: 3, type: 'E32', current_value: 230, numero_desde: 101, numero_hasta: 200 }),
  ], 'E32', 150, 300),
  'El número «Desde» tiene que ser mayor que 200, que es el último ya usado o autorizado para E32.')
igual('sin rangos cargados: se acepta', problemaConExistentes([], 'E31', 1, 100), null)

console.log('Editar un rango: problemaConEdicion')
// E31 1–10 sin usar y su rango siguiente 11–20, también sin usar (su contador está en Desde − 1).
const r1 = rango({ id: 15, type: 'E31', current_value: 0, numero_desde: 1, numero_hasta: 10, usados: 0, fecha_vencimiento: '2027-12-31' })
const r2 = rango({ id: 16, type: 'E31', current_value: 10, numero_desde: 11, numero_hasta: 20, usados: 0 })
const nombra = (desc: string, problema: string | null, trozo: string) =>
  chk(`${desc}: ${problema === null ? 'sin problema' : `«${problema}»`}`, typeof problema === 'string' && problema.includes(trozo))
igual('Hasta 100 sin rango siguiente: sin problema', problemaConEdicion([r1], r1, { numero_hasta: 100 }), null)
nombra('Hasta 11 invade el rango 11–20 y lo nombra', problemaConEdicion([r1, r2], r1, { numero_hasta: 11 }), '11')
nombra('Desde 10 pisa el rango anterior (1–10) y lo nombra', problemaConEdicion([r1, r2], r2, { numero_desde: 10 }), '10')
nombra('Hasta 3 queda bajo el contador (5) y lo nombra', problemaConEdicion([r1], { ...r1, current_value: 5 }, { numero_hasta: 3 }), '5')
chk('Desde con usados (3): no se puede', typeof problemaConEdicion([r1], { ...r1, current_value: 3, usados: 3 }, { numero_desde: 2 }) === 'string')
chk('Hasta 10.5 no es entero', typeof problemaConEdicion([r1], r1, { numero_hasta: 10.5 }) === 'string')
chk('Hasta 0 no es de 1 o más', typeof problemaConEdicion([r1], r1, { numero_hasta: 0 }) === 'string')
chk('Desde 11 es mayor que Hasta 10', typeof problemaConEdicion([r1], r1, { numero_desde: 11 }) === 'string')

console.log('Editar un rango: cambiosDelFormulario')
const igualAlGuardado = (r: NcfRango): FormularioEdicion => ({
  fecha_vencimiento: r.fecha_vencimiento ?? '', numero_desde: String(r.numero_desde), numero_hasta: String(r.numero_hasta ?? ''),
  no_solicitud: r.no_solicitud ?? '', no_autorizacion: r.no_autorizacion ?? '',
})
igual('formulario igual a lo guardado (la fecha es la cadena cruda del API): nada que enviar', cambiosDelFormulario(r1, igualAlGuardado(r1)), {})
igual('solo cambia la fecha: solo la fecha va', cambiosDelFormulario(r1, { ...igualAlGuardado(r1), fecha_vencimiento: '2027-12-21' }), { fecha_vencimiento: '2027-12-21' })
igual('sin usados, Desde y Hasta cambiados van como números', cambiosDelFormulario(r1, { ...igualAlGuardado(r1), numero_desde: '5', numero_hasta: '100' }), { numero_desde: 5, numero_hasta: 100 })
const r3 = rango({ id: 17, type: 'E31', current_value: 3, numero_desde: 1, numero_hasta: 10, usados: 3 })
igual('con usados, un Desde distinto no va', cambiosDelFormulario(r3, { ...igualAlGuardado(r3), numero_desde: '2' }), {})
const r4 = rango({ id: 18, type: 'E31', current_value: 0, numero_desde: 1, numero_hasta: 10, usados: 0, no_autorizacion: '6005308087' })
igual('una autorización vaciada va como cadena vacía', cambiosDelFormulario(r4, { ...igualAlGuardado(r4), no_autorizacion: '  ' }), { no_autorizacion: '' })
igual('espacios alrededor de lo guardado no son un cambio', cambiosDelFormulario(r4, { ...igualAlGuardado(r4), no_autorizacion: ' 6005308087 ' }), {})

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
