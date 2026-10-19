// Ajuste de inventario abierto desde el aviso de existencia (spec
// 2026-10-19-control-existencias-ventas, 4.6 y C9/C16): el payload
// `ajuste-prefill` que lleva las cantidades que le faltan a la venta, cómo lo
// reconoce la navegación (isAjustePrefill), cuándo dos de ellos son el mismo
// destino (mismoDestino, para no preguntar "¿salir sin guardar?" de más y para
// el botón "atrás"), la key con que App monta el formulario por borrador, y los
// dos motivos nuevos de la lista de ajustes.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-nav-ajuste.ts
import type { AjustePrefill, NavPayload } from '../src/config/navigation.ts'
import {
  claveFormularioAjuste, isAjustePrefill, isConduceRef, isCotizacionRef, isFacturaPrefill, isFacturaSimplePrefill,
  isFacturaSimpleRef, isNuevoSignal, mismoDestino, navModuleFor, navTopFor, payloadAlVolver,
} from '../src/config/navigation.ts'
import { MOTIVOS, motivoLabel } from '../src/features/inventory/motivos.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

const prefill = (...lineas: [number, number][]): AjustePrefill => ({
  kind: 'ajuste-prefill',
  lineas: lineas.map(([productId, cantidad]) => ({ productId, cantidad })),
})

console.log('isAjustePrefill')
chk('un prefill con líneas se reconoce', isAjustePrefill(prefill([12, 3], [30, 0.5])))
chk('un prefill sin líneas también (un ajuste en blanco con el motivo de entrada)', isAjustePrefill(prefill()))
chk('null y undefined no', !isAjustePrefill(null) && !isAjustePrefill(undefined))
chk('una referencia a otra cosa no (factura simple, cotización, conduce, señal nuevo)',
  !isAjustePrefill({ kind: 'factura-simple', id: 3 }) && !isAjustePrefill({ kind: 'cotizacion', id: 3 })
  && !isAjustePrefill({ kind: 'conduce', id: 3 }) && !isAjustePrefill({ kind: 'nuevo' }))
chk('un texto o un número no', !isAjustePrefill('ajuste-prefill') && !isAjustePrefill(7))
chk('sin `lineas` o con `lineas` que no es una lista, no',
  !isAjustePrefill({ kind: 'ajuste-prefill' }) && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: 'x' })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: null }) && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: {} }))
chk('una línea sin producto o con el producto como texto, no',
  !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ cantidad: 3 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: '12', cantidad: 3 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 1.5, cantidad: 3 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 0, cantidad: 3 }] }))
chk('una línea sin cantidad, en 0, negativa o que no es un número, no (un ajuste de 0 no vale)',
  !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12, cantidad: 0 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12, cantidad: -2 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12, cantidad: Number.NaN }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12, cantidad: '3' }] }))
chk('una sola línea mala invalida el payload entero, y una línea null también',
  !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [{ productId: 12, cantidad: 3 }, { productId: 30 }] })
  && !isAjustePrefill({ kind: 'ajuste-prefill', lineas: [null] }))
chk('el prefill no se confunde con los demás payloads',
  !isFacturaPrefill(prefill([12, 3])) && !isFacturaSimplePrefill(prefill([12, 3])) && !isFacturaSimpleRef(prefill([12, 3]))
  && !isCotizacionRef(prefill([12, 3])) && !isConduceRef(prefill([12, 3])) && !isNuevoSignal(prefill([12, 3])))

console.log('mismoDestino con prefills de ajuste')
{
  const a: NavPayload = prefill([12, 3], [30, 0.5])
  const igualA: NavPayload = prefill([12, 3], [30, 0.5])
  chk('el mismo objeto es el mismo destino (como siempre)', mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', a))
  chk('dos objetos con las mismas líneas son el mismo destino',
    mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', igualA))
  chk('otra cantidad en una línea: otro destino', !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', prefill([12, 4], [30, 0.5])))
  chk('otro producto: otro destino', !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', prefill([12, 3], [31, 0.5])))
  chk('una línea de más o de menos: otro destino',
    !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', prefill([12, 3]))
    && !mismoDestino('ajuste-nuevo', prefill([12, 3]), 'ajuste-nuevo', a)
    && !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', prefill([12, 3], [30, 0.5], [40, 1])))
  chk('las mismas líneas en otro orden se ven en otro orden: otro destino',
    !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', prefill([30, 0.5], [12, 3])))
  chk('el ajuste en blanco (sin payload) no es el prefill, ni al revés',
    !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', null) && !mismoDestino('ajuste-nuevo', null, 'ajuste-nuevo', a))
  chk('sigue siendo el mismo destino el ajuste en blanco consigo mismo', mismoDestino('ajuste-nuevo', null, 'ajuste-nuevo', null))
  chk('en otra vista no cuenta, aunque las líneas sean las mismas',
    !mismoDestino('ajuste-nuevo', a, 'ajustes', igualA) && !mismoDestino('ajustes', a, 'ajuste-nuevo', igualA))
  chk('un prefill no es una señal "nuevo" ni una referencia, aunque comparta vista',
    !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', { kind: 'nuevo' }) && !mismoDestino('ajuste-nuevo', a, 'ajuste-nuevo', { kind: 'factura-simple', id: 12 }))
  chk('lo de siempre no cambió: la misma factura simple sí, otra no',
    mismoDestino('factura-simple-editar', { kind: 'factura-simple', id: 5 }, 'factura-simple-editar', { kind: 'factura-simple', id: 5 })
    && !mismoDestino('factura-simple-editar', { kind: 'factura-simple', id: 5 }, 'factura-simple-editar', { kind: 'factura-simple', id: 6 }))
}

console.log('claveFormularioAjuste (la key con que App monta el formulario)')
{
  chk('sin prefill la key es siempre la misma: abrir Crear ajuste en blanco no borra lo escrito',
    claveFormularioAjuste(null) === claveFormularioAjuste(null))
  chk('un prefill tiene key propia, distinta de la del ajuste en blanco (monta un formulario limpio)',
    claveFormularioAjuste(prefill([12, 3])) !== claveFormularioAjuste(null))
  chk('las mismas líneas dan la misma key; otras líneas, otra',
    claveFormularioAjuste(prefill([12, 3], [30, 0.5])) === claveFormularioAjuste(prefill([12, 3], [30, 0.5]))
    && claveFormularioAjuste(prefill([12, 3], [30, 0.5])) !== claveFormularioAjuste(prefill([12, 4], [30, 0.5]))
    && claveFormularioAjuste(prefill([12, 3])) !== claveFormularioAjuste(prefill([13, 3]))
    && claveFormularioAjuste(prefill([12, 3])) !== claveFormularioAjuste(prefill([12, 3], [13, 3])))
  chk('dos prefills que mismoDestino distingue nunca comparten key',
    claveFormularioAjuste(prefill([1, 23])) !== claveFormularioAjuste(prefill([12, 3]))
    && claveFormularioAjuste(prefill([1, 2], [3, 4])) !== claveFormularioAjuste(prefill([1, 2.3], [4, 0.4])))
}

console.log('Historial: el prefill vuelve tal cual con "atrás" y "adelante"')
chk('payloadAlVolver no lo borra (solo la señal "nuevo" cae a null)',
  payloadAlVolver('ajuste-nuevo', prefill([12, 3])) !== null && isAjustePrefill(payloadAlVolver('ajuste-nuevo', prefill([12, 3]))))
chk('ajuste-nuevo sigue siendo subvista de ajustes y hereda su módulo',
  navTopFor('ajuste-nuevo') === 'ajustes' && navModuleFor('ajuste-nuevo') === navModuleFor('ajustes') && navModuleFor('ajustes') === 'products')

console.log('Motivos de ajuste')
{
  const entrada = MOTIVOS.find((m) => m.value === 'ENTRADA')
  const inicial = MOTIVOS.find((m) => m.value === 'INVENTARIO_INICIAL')
  chk('ENTRADA se ofrece como «Entrada de mercancía»', entrada?.label === 'Entrada de mercancía')
  chk('INVENTARIO_INICIAL se ofrece como «Inventario inicial»', inicial?.label === 'Inventario inicial')
  chk('motivoLabel los traduce (listado, kardex y filtro)',
    motivoLabel('ENTRADA') === 'Entrada de mercancía' && motivoLabel('INVENTARIO_INICIAL') === 'Inventario inicial')
  chk('los de antes siguen, con sus etiquetas',
    ['CONTEO_FISICO', 'MERMA', 'DANO', 'ROBO', 'DEVOLUCION', 'ERROR_CAPTURA', 'OTRO'].every((v) => MOTIVOS.some((m) => m.value === v))
    && motivoLabel('CONTEO_FISICO') === 'Conteo físico' && motivoLabel('DEVOLUCION') === 'Devolución'
    && motivoLabel('ROBO') === 'Robo o pérdida')
  chk('ANULACION sigue sin ofrecerse al crear, pero se traduce', !MOTIVOS.some((m) => m.value === 'ANULACION') && motivoLabel('ANULACION') === 'Anulación')
  chk('no hay valores repetidos y son 9 en total', new Set(MOTIVOS.map((m) => m.value)).size === MOTIVOS.length && MOTIVOS.length === 9)
  chk('un motivo desconocido o vacío se muestra como llega o como —',
    motivoLabel('XYZ') === 'XYZ' && motivoLabel(null) === '—' && motivoLabel(undefined) === '—')
}

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
