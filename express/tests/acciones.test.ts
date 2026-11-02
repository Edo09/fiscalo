// lib/acciones: qué ofrece el detalle de una factura según su estado DGII y su tipo (anexo 6.3, «Actions by state»). Es una tabla pura: dibujar los botones y lo que
// hace cada uno son de la pantalla (Detalle, tarea 21). Review Focus 1: lo que la DGII no ha aceptado (en vuelo, desconocido, heredado, rechazado, archivado o sin
// estado) nunca ofrece Compartir, «Copiar e-NCF», el PDF ni la tarjeta de datos, y lo incierto (el bucket «sin confirmar», donde caen también el estado que no se
// conoce, el null y el vacío) tampoco ofrece una emisión nueva: ni Duplicar, ni Corregir, ni Anular, ni Reenviar.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { accionesDe, esSondeable } from '~/lib/acciones'
import type { AccionId } from '~/lib/acciones'
import { bucketDe } from '~/lib/etiquetas'
import type { Bucket } from '~/lib/etiquetas'
import type { FacturaVista } from '~/lib/filas'

const leer = (ruta: string): string => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8') // ruta desde fiscalo/

/**
 * Las claves de `DGII_LABEL` (src/api/estadosDgii.ts), sacadas de su archivo porque la tabla no se exporta: esta prueba no puede quedarse con una lista propia que no
 * se entere de que la app completa agregó un estado.
 */
const CLAVES_DGII = [...leer('src/api/estadosDgii.ts').split('const DGII_LABEL: Record<string, string> = {')[1].split('\n}')[0].matchAll(/^\s{2}([A-Z_]+):/gm)].map(
  (m) => m[1],
)

/** Una factura del detalle: por omisión, una venta E45 aceptada (id 1, e-NCF E450000000013, sin notas, sin track id y sin dato de la secuencia). */
const BASE: FacturaVista = {
  id: 1,
  numero: 'E450000000013',
  eNcf: 'E450000000013',
  tipo: '45',
  cliente: 'Min. de Obras Públicas',
  clienteId: 9,
  rnc: '401123456',
  fecha: '2026-10-26 09:41:00',
  total: 11800,
  totalConSigno: 11800,
  estado: 'ACEPTADO',
  trackId: null,
  codigoSeguridad: null,
  fechaEmisionDgii: '2026-10-26 09:41:12',
  secuenciaUtilizada: null,
  tipoPago: 1,
  items: [],
  notas: [],
  modifica: null,
  codigoModificacion: null,
  respuestaDgii: null,
  montoGravado: null,
  montoExento: null,
  totalItbis: null,
}
const factura = (o: Record<string, unknown> = {}): FacturaVista => ({ ...BASE, ...o }) as FacturaVista

type Acciones = ReturnType<typeof accionesDe>
const todas = (a: Acciones): (AccionId | null)[] => [a.primaria, a.secundaria, ...a.mas]

// --- Review Focus 1 (la prueba que fija el plan) ---------------------------------------------------------------------------------------------

const compartible = (a: ReturnType<typeof accionesDe>) => [a.primaria, a.secundaria, ...a.mas].filter((x) => x === 'compartir' || x === 'copiarNcf' || x === 'abrirPdf')
const NUEVA_EMISION = ['duplicar', 'corregir', 'anular', 'reenviar', 'reintentarAnulacion']

test('no ofrece nada compartible fuera de aceptada', () => {
  // Review Focus 1
  assert.equal(CLAVES_DGII.length, 25) // la lista sale del archivo de la app completa: con otra cuenta el recorrido de abajo no probaría nada
  for (const estado of [...CLAVES_DGII, null, '', 'INVENTADO']) {
    for (const tipo of ['45', '34']) {
      const a = accionesDe(factura({ estado, tipo }))
      const ok = bucketDe(estado as any) === 'aceptada'
      assert.equal(compartible(a).length > 0, ok, `${estado}/${tipo}`)
      assert.equal(a.mostrarDatosDgii, ok, `${estado}/${tipo}`)
      if (bucketDe(estado as any) === 'sinConfirmar') {
        for (const x of [a.primaria, a.secundaria, ...a.mas]) assert.ok(!NUEVA_EMISION.includes(x as string), `${estado}/${tipo}: ${x}`) // nunca una emisión nueva con lo incierto
      }
    }
  }
})

// --- La tabla del anexo ----------------------------------------------------------------------------------------------------------------------

const fila = (a: ReturnType<typeof accionesDe>) => [a.primaria, a.secundaria, a.mas]
const V = (estado: string | null, o: object = {}) => fila(accionesDe(factura({ estado, tipo: '45', ...o })))
const N = (estado: string | null, o: object = {}) => fila(accionesDe(factura({ estado, tipo: '34', ...o })))
const ANULA = [{ tipo: '34', ncf: 'E340000000001', estadoDgii: 'ACEPTADO', codigoModificacion: '1' }] as any

test('tabla de acciones: ventas', () => {
  assert.deepEqual(V('ACEPTADO'), ['compartir', 'duplicar', ['anular', 'abrirPdf', 'copiarNcf']])
  assert.deepEqual(V('ACEPTADO', { notas: ANULA }), ['compartir', null, ['abrirPdf', 'copiarNcf']])
  assert.equal(accionesDe(factura({ estado: 'ACEPTADO', tipo: '45', notas: ANULA })).anuladaPor, 'E340000000001')
  for (const e of ['ENVIADO', 'EN_PROCESO']) assert.deepEqual(V(e), ['verificar', null, ['duplicar']], e)
  for (const e of ['PENDIENTE_ENVIO', 'ENVIO_INCIERTO']) assert.deepEqual(V(e), ['verificar', 'soporte', []], e)
  assert.equal(accionesDe(factura({ estado: 'ENVIO_INCIERTO', tipo: '45' })).aviso, 'sinConfirmar')
  assert.deepEqual(V('RECHAZADO', { secuenciaUtilizada: false }), ['reenviar', 'corregir', ['duplicar']])
  assert.deepEqual(V('RECHAZADO', { secuenciaUtilizada: true }), ['corregir', null, ['duplicar']])
  assert.deepEqual(V('NO_ENCONTRADO'), ['reenviar', 'verificar', ['duplicar']])
  assert.deepEqual(V('RFCE_NO_ENCONTRADO'), ['verificar', null, ['duplicar']])
  assert.deepEqual(V('ERROR', { trackId: 'T1' }), ['verificar', null, []])
  assert.deepEqual(V('ERROR', { trackId: null }), ['soporte', null, []])
  assert.deepEqual(V('RECHAZADO_ARCHIVADO'), ['buscarReemplazo', null, []])
})

test('tabla de acciones: notas E34', () => {
  assert.deepEqual(N('ACEPTADO'), ['compartir', 'verOriginal', ['abrirPdf', 'copiarNcf']])
  assert.deepEqual(N('RECHAZADO', { secuenciaUtilizada: false }), ['reenviar', 'verOriginal', []])
  assert.deepEqual(N('RECHAZADO', { secuenciaUtilizada: true }), ['reintentarAnulacion', 'verOriginal', []])
  for (const e of ['ENVIO_INCIERTO', 'ENVIADO']) assert.deepEqual(N(e), ['verificar', 'soporte', []], e)
})

test('esSondeable', () => {
  assert.deepEqual(
    ['aceptada', 'enProceso', 'sinConfirmar', 'rechazada', 'noEncontrada', 'error', 'reemplazada'].map((b) => esSondeable(b as Bucket)),
    [false, true, true, false, false, false, false],
  )
})

// --- Cada una de las 25 claves ---------------------------------------------------------------------------------------------------------------

const ACEPTADAS = ['ACEPTADO', 'RFCE_ACEPTADO', 'ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDICIONAL', 'RFCE_ACEPTADO_CONDIC']
const EN_PROCESO = ['ENVIADO', 'EN_PROCESO', 'RFCE_ENVIADO', 'RFCE_EN_PROCESO']
const SIN_CONFIRMAR = ['PENDIENTE', 'PENDIENTE_ENVIO', 'ENVIO_INCIERTO']
const RECHAZADAS = ['RECHAZADO', 'RFCE_RECHAZADO']
const NO_ENCONTRADAS = ['NO_ENCONTRADO', 'RFCE_NO_ENCONTRADO']
const CON_ERROR = ['ERROR', 'RFCE_ERROR']
const REEMPLAZADAS = [
  'RECHAZADO_ARCHIVADO',
  'NO_ENCONTRADO_ARCHIVADO',
  'RFCE_RECHAZADO_ARCHIVADO',
  'RFCE_NO_ENCONTRADO_ARCHIVADO',
  'RFCE_RECHAZADO_ARCHI', // los tres cortados a 20 caracteres (VARCHAR(20) antes de la migración 028)
  'NO_ENCONTRADO_ARCHIV',
  'RFCE_NO_ENCONTRADO_A',
]
/** Lo que no se conoce, el null y el vacío son «sin confirmar»: ante la duda se verifica o se avisa, y no se ofrece nada más. */
const INCIERTOS = [null, '', 'INVENTADO', 'aceptado', 'constructor']

test('los grupos de esta prueba cubren las 25 claves de DGII_LABEL, cada una una vez', () => {
  const grupos = [ACEPTADAS, EN_PROCESO, SIN_CONFIRMAR, RECHAZADAS, NO_ENCONTRADAS, CON_ERROR, REEMPLAZADAS].flat()
  assert.equal(grupos.length, 25)
  assert.deepEqual([...grupos].sort(), [...CLAVES_DGII].sort())
})

test('ventas: la fila de cada estado, por sus 25 claves y por los estados que no se conocen', () => {
  for (const e of ACEPTADAS) assert.deepEqual(V(e), ['compartir', 'duplicar', ['anular', 'abrirPdf', 'copiarNcf']], e)
  for (const e of EN_PROCESO) assert.deepEqual(V(e), ['verificar', null, ['duplicar']], e)
  for (const e of [...SIN_CONFIRMAR, ...INCIERTOS]) assert.deepEqual(V(e), ['verificar', 'soporte', []], String(e))
  for (const e of RECHAZADAS) {
    assert.deepEqual(V(e), ['reenviar', 'corregir', ['duplicar']], e) // sin el dato de la secuencia se trata como sin consumir (reenvio.ts)
    assert.deepEqual(V(e, { secuenciaUtilizada: false }), ['reenviar', 'corregir', ['duplicar']], e)
    assert.deepEqual(V(e, { secuenciaUtilizada: true }), ['corregir', null, ['duplicar']], e) // el número ya se consumió: no se reenvía
  }
  assert.deepEqual(V('NO_ENCONTRADO'), ['reenviar', 'verificar', ['duplicar']])
  assert.deepEqual(V('NO_ENCONTRADO', { secuenciaUtilizada: true }), ['verificar', null, ['duplicar']])
  assert.deepEqual(V('RFCE_NO_ENCONTRADO'), ['verificar', null, ['duplicar']]) // el anexo reenvía solo NO_ENCONTRADO
  assert.deepEqual(V('RFCE_NO_ENCONTRADO', { secuenciaUtilizada: false }), ['verificar', null, ['duplicar']])
  for (const e of CON_ERROR) {
    assert.deepEqual(V(e, { trackId: 'T1' }), ['verificar', null, []], e)
    assert.deepEqual(V(e), ['soporte', null, []], e)
  }
  for (const e of REEMPLAZADAS) assert.deepEqual(V(e), ['buscarReemplazo', null, []], e)
})

test('notas: la fila de cada estado, por sus 25 claves y por los estados que no se conocen', () => {
  for (const e of ACEPTADAS) assert.deepEqual(N(e), ['compartir', 'verOriginal', ['abrirPdf', 'copiarNcf']], e)
  for (const e of [...EN_PROCESO, ...SIN_CONFIRMAR, ...INCIERTOS]) assert.deepEqual(N(e), ['verificar', 'soporte', []], String(e))
  for (const e of RECHAZADAS) {
    assert.deepEqual(N(e), ['reenviar', 'verOriginal', []], e)
    assert.deepEqual(N(e, { secuenciaUtilizada: true }), ['reintentarAnulacion', 'verOriginal', []], e)
  }
  // Lo que el anexo no escribe para una nota sigue la misma regla que la venta, sin ninguna emisión nueva: se reenvía el mismo número si se puede, y si no se verifica.
  assert.deepEqual(N('NO_ENCONTRADO'), ['reenviar', 'verificar', []])
  assert.deepEqual(N('NO_ENCONTRADO', { secuenciaUtilizada: true }), ['verificar', null, []])
  assert.deepEqual(N('RFCE_NO_ENCONTRADO'), ['verificar', null, []])
  for (const e of CON_ERROR) {
    assert.deepEqual(N(e, { trackId: 'T1' }), ['verificar', null, []], e)
    assert.deepEqual(N(e), ['soporte', null, []], e)
  }
  for (const e of REEMPLAZADAS) assert.deepEqual(N(e), ['buscarReemplazo', null, []], e)
})

test('E31, E32 y E45 son ventas y E33 y E34 son notas: el tipo se lee igual en todos los de su clase', () => {
  const todosLosEstados = [...CLAVES_DGII, ...INCIERTOS]
  for (const estado of todosLosEstados) {
    const venta = fila(accionesDe(factura({ estado, tipo: '45' })))
    for (const tipo of ['31', '32']) assert.deepEqual(fila(accionesDe(factura({ estado, tipo }))), venta, `${estado}/${tipo}`)
    const nota = fila(accionesDe(factura({ estado, tipo: '34' })))
    assert.deepEqual(fila(accionesDe(factura({ estado, tipo: '33' }))), nota, `${estado}/33`)
  }
})

// --- Lo que ninguna fila ofrece ------------------------------------------------------------------------------------------------------------------

/** Los tipos de venta, las dos notas y los códigos que Express no vende ni son notas (E41 compras, un código que no se conoce y el vacío de una fila sin tipo). */
const TIPOS = ['31', '32', '45', '33', '34', '41', '99', '']
const ESTADOS = [...CLAVES_DGII, ...INCIERTOS] as (string | null)[]

test('en cualquier tipo, solo lo aceptado ofrece compartir, copiar el e-NCF o abrir el PDF, y solo ahí hay tarjeta de datos', () => {
  for (const tipo of TIPOS) {
    for (const estado of ESTADOS) {
      const a = accionesDe(factura({ estado, tipo }))
      const aceptada = bucketDe(estado as any) === 'aceptada'
      assert.equal(compartible(a).length, aceptada ? 3 : 0, `${estado}/${tipo}`) // compartir, abrirPdf y copiarNcf juntos, o ninguno
      assert.equal(a.mostrarDatosDgii, aceptada, `${estado}/${tipo}`)
    }
  }
})

test('lo incierto no ofrece ninguna emisión nueva, ni lo que dio error: en ningún tipo', () => {
  for (const tipo of TIPOS) {
    for (const estado of [...SIN_CONFIRMAR, ...INCIERTOS, ...CON_ERROR]) {
      const a = accionesDe(factura({ estado, tipo }))
      assert.deepEqual(
        todas(a).filter((x) => NUEVA_EMISION.includes(x as string)),
        [],
        `${estado}/${tipo}`,
      )
    }
  }
})

test('solo una venta de Express ofrece duplicar, corregir o anular; una nota solo ofrece reintentar la anulación tras un rechazo', () => {
  for (const tipo of TIPOS) {
    const esVenta = ['31', '32', '45'].includes(tipo)
    for (const estado of ESTADOS) {
      const ids = todas(accionesDe(factura({ estado, tipo, secuenciaUtilizada: true }))) // con el número consumido: un rechazo no se reenvía
      if (!esVenta) for (const id of ['duplicar', 'corregir', 'anular'] as const) assert.ok(!ids.includes(id), `${estado}/${tipo}: ${id}`)
      // reintentarAnulacion: de una nota E33 o E34 rechazada con el número consumido, y de ninguna otra fila
      const esperaReintento = ['33', '34'].includes(tipo) && RECHAZADAS.includes(estado as string)
      assert.equal(ids.includes('reintentarAnulacion'), esperaReintento, `${estado}/${tipo}`)
    }
  }
})

test('un código que Express no vende ni es una nota: nada de emisión nueva, y reenviar el mismo número solo con un rechazo o un no encontrado reenviable', () => {
  for (const tipo of ['41', '99', '']) {
    assert.deepEqual(fila(accionesDe(factura({ estado: 'ACEPTADO', tipo }))), ['compartir', null, ['abrirPdf', 'copiarNcf']], tipo)
    assert.deepEqual(fila(accionesDe(factura({ estado: 'ENVIADO', tipo }))), ['verificar', null, []], tipo)
    assert.deepEqual(fila(accionesDe(factura({ estado: 'ENVIO_INCIERTO', tipo }))), ['verificar', 'soporte', []], tipo)
    assert.deepEqual(fila(accionesDe(factura({ estado: 'RECHAZADO', tipo }))), ['reenviar', null, []], tipo)
    assert.deepEqual(fila(accionesDe(factura({ estado: 'RECHAZADO', tipo, secuenciaUtilizada: true }))), [null, null, []], tipo) // sin qué ofrecer, y sin un hueco
    assert.deepEqual(fila(accionesDe(factura({ estado: 'NO_ENCONTRADO', tipo }))), ['reenviar', 'verificar', []], tipo)
  }
})

test('la fila no tiene huecos ni repeticiones: sin principal no hay secundaria y ninguna acción sale dos veces', () => {
  for (const notas of [[], ANULA]) {
    for (const tipo of TIPOS) {
      for (const estado of ESTADOS) {
        for (const secuenciaUtilizada of [null, false, true]) {
          for (const trackId of [null, 'T1']) {
            const a = accionesDe(factura({ estado, tipo, secuenciaUtilizada, trackId, notas }))
            const clave = `${estado}/${tipo}/${String(secuenciaUtilizada)}/${trackId}/${notas.length === 0 ? 'sin nota' : 'anulada'}`
            if (a.primaria === null) assert.equal(a.secundaria, null, clave)
            const ids = todas(a).filter((x) => x !== null)
            assert.equal(new Set(ids).size, ids.length, clave)
          }
        }
      }
    }
  }
})

// --- Una factura anulada -----------------------------------------------------------------------------------------------------------------

test('anulada por una E34 aceptada: no se anula, no se reenvía ni se duplica, y dice por cuál', () => {
  for (const tipo of ['31', '32', '45']) {
    for (const estado of ESTADOS) {
      const a = accionesDe(factura({ estado, tipo, notas: ANULA, secuenciaUtilizada: false }))
      assert.equal(a.anuladaPor, 'E340000000001', `${estado}/${tipo}`)
      for (const id of ['anular', 'reenviar', 'duplicar'] as const) assert.ok(!todas(a).includes(id), `${estado}/${tipo}: ${id}`)
      // Con lo que queda de la fila sigue valiendo lo de siempre: compartir y copiar solo si la DGII aceptó, y nada nuevo con lo incierto.
      assert.equal(a.mostrarDatosDgii, bucketDe(estado as any) === 'aceptada', `${estado}/${tipo}`)
    }
  }
  // La principal que se va la reemplaza la secundaria: una fila nunca queda con secundaria y sin principal.
  assert.deepEqual(V('RECHAZADO', { notas: ANULA, secuenciaUtilizada: false }), ['corregir', null, []])
  assert.deepEqual(V('NO_ENCONTRADO', { notas: ANULA }), ['verificar', null, []])
  assert.deepEqual(V('ENVIADO', { notas: ANULA }), ['verificar', null, []])
  assert.deepEqual(V('ACEPTADO', { notas: ANULA }), ['compartir', null, ['abrirPdf', 'copiarNcf']])
})

test('anuladaPor: la E34 de código 1 que la DGII aceptó; ninguna otra nota anula', () => {
  const nota = (o: object) => ({ id: 2, ncf: 'E340000000002', tipo: '34', codigoModificacion: '1', total: 100, estadoDgii: 'ACEPTADO', fecha: null, ...o })
  const anuladaPor = (notas: object[]) => accionesDe(factura({ notas })).anuladaPor
  assert.equal(anuladaPor([]), null)
  assert.equal(anuladaPor([nota({})]), 'E340000000002')
  assert.equal(anuladaPor([nota({ estadoDgii: 'ACEPTADO_CONDICIONAL' })]), 'E340000000002')
  for (const estadoDgii of ['ENVIADO', 'EN_PROCESO', 'ENVIO_INCIERTO', 'RECHAZADO', '']) assert.equal(anuladaPor([nota({ estadoDgii })]), null, estadoDgii) // todavía no anula nada
  assert.equal(anuladaPor([nota({ codigoModificacion: '2' })]), null) // corrige texto: no anula
  assert.equal(anuladaPor([nota({ tipo: '33' })]), null) // una nota de débito no anula
  assert.equal(anuladaPor([nota({ estadoDgii: 'ENVIADO' }), nota({ ncf: 'E340000000003' })]), 'E340000000003') // la aceptada, aunque no sea la primera
  assert.equal(accionesDe(factura({ notas: [] })).anuladaPor, null)
  assert.equal(accionesDe(factura({ notas: undefined })).anuladaPor, null) // una fila sin la columna no lanza
})

test('una anulación que no trae su e-NCF sigue anulando: anuladaPor es el texto vacío y no null', () => {
  // La pantalla decide con `!== null`: con un e-NCF vacío una comprobación de verdad lo daría por no anulada y volvería a ofrecer Anular y Duplicar.
  const a = accionesDe(factura({ estado: 'ACEPTADO', notas: [{ ...ANULA[0], ncf: '' }] }))
  assert.equal(a.anuladaPor, '')
  assert.deepEqual(fila(a), ['compartir', null, ['abrirPdf', 'copiarNcf']])
})

// --- aviso y mostrarDatosDgii ----------------------------------------------------------------------------------------------------------------

test('aviso: la tarjeta de estado de cada bucket, igual en ventas y en notas', () => {
  for (const tipo of ['45', '34']) {
    for (const e of [...SIN_CONFIRMAR, ...INCIERTOS]) assert.equal(accionesDe(factura({ estado: e, tipo })).aviso, 'sinConfirmar', `${e}/${tipo}`)
    for (const e of RECHAZADAS) assert.equal(accionesDe(factura({ estado: e, tipo })).aviso, 'rechazada', `${e}/${tipo}`)
    assert.equal(accionesDe(factura({ estado: 'NO_ENCONTRADO', tipo })).aviso, 'noEncontrada')
    assert.equal(accionesDe(factura({ estado: 'RFCE_NO_ENCONTRADO', tipo })).aviso, 'noEncontrada')
    // Aceptada y archivada no llevan tarjeta; en proceso y con error, tampoco (su estado se lee en el chip y en la línea de tiempo).
    for (const e of [...ACEPTADAS, ...REEMPLAZADAS, ...EN_PROCESO, ...CON_ERROR]) assert.equal(accionesDe(factura({ estado: e, tipo })).aviso, null, `${e}/${tipo}`)
  }
})

test('accionesDe da arreglos nuevos cada vez: quien cambie `mas` no cambia la fila siguiente', () => {
  const a = accionesDe(factura())
  a.mas.push('reenviar')
  a.mas.length = 0
  assert.deepEqual(accionesDe(factura()).mas, ['anular', 'abrirPdf', 'copiarNcf'])
  assert.notEqual(accionesDe(factura()).mas, accionesDe(factura()).mas)
})

// --- esSondeable -------------------------------------------------------------------------------------------------------------------------

test('esSondeable: solo lo que está en el aire (en proceso y sin confirmar) se vuelve a preguntar; lo final no', () => {
  const sondeables = CLAVES_DGII.filter((e) => esSondeable(bucketDe(e)))
  assert.deepEqual([...sondeables].sort(), [...EN_PROCESO, ...SIN_CONFIRMAR].sort())
  for (const e of INCIERTOS) assert.equal(esSondeable(bucketDe(e as any)), true, String(e)) // lo que no se conoce es sin confirmar: se pregunta
  for (const e of [...ACEPTADAS, ...RECHAZADAS, ...REEMPLAZADAS]) assert.equal(esSondeable(bucketDe(e)), false, e) // aceptada, rechazada y archivada son finales
})

test('lo que se sondea tiene «Verificar estado» como acción principal, en ventas y en notas', () => {
  for (const tipo of ['45', '34']) {
    for (const estado of ESTADOS) {
      const a = accionesDe(factura({ estado, tipo }))
      if (esSondeable(bucketDe(estado as any))) assert.equal(a.primaria, 'verificar', `${estado}/${tipo}`)
    }
  }
})
