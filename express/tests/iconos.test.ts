// ui/iconos: la tabla de iconos que dibuja `ui/Icon`. Se genera con dev/gen-iconos.mjs desde los archivos de lucide-react (la app no trae el paquete:
// solo estos 26 nombres, como datos). Se comprueba que estén exactamente los de `IconName`, que cada uno tenga nodos que `Icon` sepa dibujar, que
// ninguno arrastre la `key` de lucide (React pone la suya en cada elemento: una `key` entre las propiedades que se le pasan por spread sobra), que
// la tabla sea la que sale hoy de lucide (nadie la editó a mano ni una versión nueva del paquete la dejó vieja) y que existan los nombres que
// escriben como texto `nav.ts` y `etiquetas.ts`, que no pasan por el tipo `IconName`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { leerIconos } from '../dev/gen-iconos.mjs'
import type { Entitlements } from '~/entitlements'
import { etiquetaDe, PORCLAVE } from '~/lib/etiquetas'
import { construirBarra, filasMas } from '~/nav'
import { ICONOS } from '~/ui/iconos'

/** Los 26 nombres de `IconName`, tal como los fija el plan (tarea 14). Escritos a mano: lo que se prueba es la tabla, no una lista derivada de ella. */
const NOMBRES = [
  'file-text', 'users', 'plus', 'package', 'ellipsis', 'chevron-left', 'chevron-right', 'chevron-down', 'refresh-cw', 'circle-check', 'clock',
  'triangle-alert', 'circle-x', 'circle-help', 'circle-alert', 'rotate-ccw', 'hash', 'message-circle', 'log-out', 'share-2', 'copy', 'check', 'search',
  'x', 'wifi-off', 'building-2',
]

/** Las etiquetas SVG que `Icon` dibuja con `createElement`: las únicas que usan estos 26 iconos. */
const ETIQUETAS = ['path', 'circle', 'rect', 'line', 'polyline']

/** La tabla como una más de texto a nodos: así se recorre por nombre sin que el tipo cerrado de `IconName` estorbe. */
const tabla: Record<string, ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>> = ICONOS

test('la tabla tiene exactamente los 26 nombres de IconName', () => {
  assert.equal(NOMBRES.length, 26)
  assert.equal(new Set(NOMBRES).size, 26, 'la lista de la prueba repite un nombre')
  assert.deepEqual(Object.keys(ICONOS).sort(), [...NOMBRES].sort())
})

test('cada icono tiene al menos un nodo [etiqueta, atributos] con una etiqueta que Icon dibuja', () => {
  for (const nombre of NOMBRES) {
    const nodos = tabla[nombre]
    assert.ok(Array.isArray(nodos) && nodos.length > 0, `${nombre}: sin nodos`)
    for (const nodo of nodos) {
      assert.ok(Array.isArray(nodo) && nodo.length === 2, `${nombre}: un nodo no es [etiqueta, atributos]`)
      const [etiqueta, atributos] = nodo
      assert.ok(ETIQUETAS.includes(etiqueta), `${nombre}: la etiqueta ${String(etiqueta)} no es de las que Icon dibuja`)
      assert.ok(typeof atributos === 'object' && atributos !== null && !Array.isArray(atributos), `${nombre}: los atributos de ${etiqueta} no son un objeto`)
      const pares = Object.entries(atributos)
      assert.ok(pares.length > 0, `${nombre}: un ${etiqueta} sin atributos no dibuja nada`)
      for (const [atributo, valor] of pares) {
        assert.ok(typeof valor === 'string' && valor !== '', `${nombre}: ${etiqueta}.${atributo} no es un texto con contenido`)
      }
    }
  }
})

test('ningún nodo lleva el atributo key', () => {
  for (const nombre of NOMBRES) {
    for (const [etiqueta, atributos] of tabla[nombre]) {
      assert.equal(Object.prototype.hasOwnProperty.call(atributos, 'key'), false, `${nombre}: el ${etiqueta} conserva la key de lucide`)
    }
  }
})

test('respuestas conocidas: etiquetas y cantidad de nodos de seis iconos, y el trazado exacto de check', () => {
  // Valen contra un extractor que se quedara con el primer nodo, cortara una lista o cambiara un valor: la prueba de la deriva (más abajo) compara
  // el extractor consigo mismo y no las vería. Se miran la estructura y un trazado que no cambia (check), no todos los números de lucide.
  const etiquetas = (nombre: string): string[] => tabla[nombre].map(([etiqueta]) => etiqueta)
  assert.deepEqual(etiquetas('check'), ['path']) // en su archivo de lucide todo va en una sola línea
  assert.deepEqual(etiquetas('clock'), ['circle', 'polyline'])
  assert.deepEqual(etiquetas('copy'), ['rect', 'path'])
  assert.deepEqual(etiquetas('ellipsis'), ['circle', 'circle', 'circle'])
  assert.deepEqual(etiquetas('share-2'), ['circle', 'circle', 'circle', 'line', 'line'])
  assert.deepEqual(etiquetas('file-text'), ['path', 'path', 'path', 'path', 'path'])
  assert.deepEqual(tabla.check, [['path', { d: 'M20 6 9 17l-5-5' }]])
  assert.deepEqual(Object.keys(tabla.copy[0][1]).sort(), ['height', 'rx', 'ry', 'width', 'x', 'y'])
})

test('la tabla es la que sale hoy de los archivos de lucide-react (nadie la editó a mano; si falla, corre dev/gen-iconos.mjs)', () => {
  assert.deepEqual(ICONOS, leerIconos(NOMBRES))
})

// --- Los nombres que otros módulos escriben como texto ---------------------------------------------------------------------------
// `Slot.icono`, `FilaMas.icono` y `Etiqueta.icono` son `string`: el compilador no ve si dicen un icono que la tabla no tiene, y `Icon` dibujaría un
// cuadro vacío sin avisar. Aquí se vigila.

const TODO: Entitlements = {
  edicion: 'express',
  tenant: { id: 1, nombre: 'Constructora X', rnc: '131000001', ambiente: 'ecf' },
  modulos: ['facturacion', 'clientes', 'productos', 'usuarios', 'configuracion'],
  tipos_ecf: ['31', '32', '45', '34'],
  capacidades: { idempotencia: true, reconciliador: false, certificado: true },
}

test('los iconos de la barra inferior y de las filas de Más (nav.ts) existen en la tabla', () => {
  const listas = { empresa: true, numeracion: true, usuarios: true } // todas las filas, también las que aún no tienen pantalla
  const sale = [...construirBarra(TODO), ...filasMas(TODO, { admin: true, soporte: true }, listas)]
  const usados = sale.map((x) => x.icono).filter((icono) => icono !== '') // la fila Tema no lleva icono
  assert.ok(usados.length > 0, 'no salió ningún icono: la prueba no comprobaría nada')
  for (const icono of usados) assert.ok(icono in ICONOS, `nav.ts nombra «${icono}» y la tabla no lo tiene`)
})

test('el icono del chip de cada estado DGII (etiquetas.ts) existe en la tabla, también el de los estados que no se conocen', () => {
  const estados = [...Object.keys(PORCLAVE), null, undefined, '', 'NO_EXISTE']
  for (const estado of estados) {
    const { icono } = etiquetaDe(estado)
    assert.ok(icono in ICONOS, `etiquetas.ts da «${icono}» para ${String(estado)} y la tabla no lo tiene`)
  }
})
