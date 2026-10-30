// screens/facturas/verificar: qué facturas consulta «Verificar» en Pendientes (anexo 6.2): las primeras tres ENVIADO o EN_PROCESO de las que se ven, en el orden de la lista, y
// ninguna otra (tampoco las gemelas RFCE_ del chip «En proceso»). Es una regla pura; el botón y el recorrido con `getEstado` son de la pantalla (Facturas.tsx).
import assert from 'node:assert/strict'
import test from 'node:test'
import { PORCLAVE } from '~/lib/etiquetas'
import { normalizarFactura } from '~/lib/filas'
import type { FacturaVista } from '~/lib/filas'
import { filasPorVerificar, MAX_VERIFICAR } from '~/screens/facturas/verificar'

/** Una fila del listado en ese `estado_dgii`, ya leída por `normalizarFactura` como las de la pantalla. */
function fila(id: number, estado: string | null): FacturaVista {
  return normalizarFactura({ id, e_ncf: `E45${String(id).padStart(10, '0')}`, tipo_ecf: '45', client_name: 'Cliente', date: '2026-10-27 10:00:00', total: '100.00', estado_dgii: estado })
}

const ids = (filas: FacturaVista[]): number[] => filas.map((f) => f.id)

test('MAX_VERIFICAR es tres (anexo 6.2)', () => {
  assert.equal(MAX_VERIFICAR, 3)
})

test('solo ENVIADO y EN_PROCESO se verifican: de los estados que conoce lib/etiquetas ningun otro entra, tampoco las gemelas RFCE_', () => {
  const verificables = Object.keys(PORCLAVE).filter((estado) => filasPorVerificar([fila(1, estado)]).length === 1)
  assert.deepEqual(verificables.sort(), ['ENVIADO', 'EN_PROCESO'])
  // Las dos gemelas RFCE_ comparten el chip «En proceso», pero el anexo no las nombra: quedan fuera a proposito.
  assert.equal(PORCLAVE.RFCE_ENVIADO, 'enProceso')
  assert.equal(PORCLAVE.RFCE_EN_PROCESO, 'enProceso')
  assert.deepEqual(filasPorVerificar([fila(1, 'RFCE_ENVIADO'), fila(2, 'RFCE_EN_PROCESO')]), [])
})

test('un estado que Express no conoce, el vacio y el null no se verifican', () => {
  assert.deepEqual(filasPorVerificar([fila(1, 'ALGO_NUEVO'), fila(2, ''), fila(3, null), fila(4, 'enviado'), fila(5, ' ENVIADO')]), [])
})

test('las primeras tres en el orden de la lista, saltando las que no se verifican', () => {
  const lista = [
    fila(10, 'ACEPTADO'),
    fila(11, 'ENVIADO'),
    fila(12, 'EN_PROCESO'),
    fila(13, 'PENDIENTE_ENVIO'),
    fila(14, 'ENVIADO'),
    fila(15, 'EN_PROCESO'),
    fila(16, 'ENVIADO'),
  ]
  assert.deepEqual(ids(filasPorVerificar(lista)), [11, 12, 14])
})

test('con menos de tres se consultan las que hay, y sin ninguna no hay nada que verificar', () => {
  assert.deepEqual(ids(filasPorVerificar([fila(1, 'RECHAZADO'), fila(2, 'EN_PROCESO')])), [2])
  assert.deepEqual(filasPorVerificar([]), [])
  assert.deepEqual(filasPorVerificar([fila(1, 'ACEPTADO'), fila(2, 'NO_ENCONTRADO')]), [])
})

test('devuelve un arreglo nuevo y no toca la lista de la pantalla', () => {
  const lista = [fila(1, 'ENVIADO'), fila(2, 'ACEPTADO')]
  const copia = [...lista]
  const resultado = filasPorVerificar(lista)
  assert.notEqual(resultado, lista)
  assert.deepEqual(lista, copia)
  assert.deepEqual(ids(resultado), [1])
})
