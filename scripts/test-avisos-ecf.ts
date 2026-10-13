// Avisos del e-CF para quien administra (src/features/ecf/avisosEcf.ts): lo que
// dice cada aviso del panel e-CF según GET /api/facturas/avisos. Sin React.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-avisos-ecf.ts
import type { AvisosEcf } from '../src/api/types.ts'
import {
  listarAvisos, TEXTO_AGOTADA, TEXTO_CERTIFICADO, TEXTO_SIN_RANGO,
} from '../src/features/ecf/avisosEcf.ts'

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

const SIN_AVISOS: AvisosEcf = { certificado_fallo: { ventas_hoy: 0 }, secuencias: [], sin_rango: { ventas: 0 } }

console.log('Sin avisos')
igual('todo en cero: ninguno', listarAvisos(SIN_AVISOS), [])
igual('sin datos, o una API anterior que contesta otra cosa (una lista): ninguno',
  [listarAvisos(null), listarAvisos(undefined), listarAvisos([] as unknown as AvisosEcf)], [[], [], []])

console.log('Certificado')
igual('1 venta', listarAvisos({ ...SIN_AVISOS, certificado_fallo: { ventas_hoy: 1 } }), [{
  clave: 'certificado', tono: 'danger', icono: 'alert-triangle',
  titulo: 'El certificado falló: 1 venta del POS salió como factura simple',
  detalle: TEXTO_CERTIFICADO, accionRangos: false,
}])
igual('3 ventas: plural',
  listarAvisos({ ...SIN_AVISOS, certificado_fallo: { ventas_hoy: 3 } })[0]?.titulo,
  'El certificado falló: 3 ventas del POS salieron como factura simple')

console.log('Secuencias')
igual('pocos: E31 con 40', listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E31', ambiente: 'certecf', restantes: 40, estado: 'pocos' }] }), [{
  clave: 'secuencia-E31', tono: 'warning', icono: 'alert-triangle',
  titulo: 'Quedan pocos números de E31 · Factura de Crédito Fiscal',
  detalle: 'Quedan 40 en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.',
  accionRangos: true,
}])
igual('pocos con 1: "Queda 1"',
  listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E31', ambiente: 'certecf', restantes: 1, estado: 'pocos' }] })[0]?.detalle,
  'Queda 1 en el rango vigente. Registra el siguiente rango autorizado antes de que se acaben.')
igual('agotada: E32', listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E32', ambiente: 'certecf', restantes: 0, estado: 'agotada' }] }), [{
  clave: 'secuencia-E32', tono: 'danger', icono: 'alert-circle',
  titulo: 'Secuencia agotada: E32 · Factura de Consumo',
  detalle: TEXTO_AGOTADA, accionRangos: true,
}])
igual('un tipo fuera del catálogo se nombra solo con su código',
  listarAvisos({ ...SIN_AVISOS, secuencias: [{ tipo: 'E99', ambiente: 'certecf', restantes: 0, estado: 'agotada' }] })[0]?.titulo,
  'Secuencia agotada: E99')

console.log('Ventas esperando un rango')
igual('1 venta', listarAvisos({ ...SIN_AVISOS, sin_rango: { ventas: 1 } }), [{
  clave: 'sin-rango', tono: 'warning', icono: 'clock',
  titulo: '1 venta esperando un rango autorizado',
  detalle: TEXTO_SIN_RANGO, accionRangos: true,
}])
igual('4 ventas: plural',
  listarAvisos({ ...SIN_AVISOS, sin_rango: { ventas: 4 } })[0]?.titulo, '4 ventas esperando un rango autorizado')

console.log('Orden')
igual('certificado, luego las secuencias en el orden de la API, luego las ventas sin rango',
  listarAvisos({
    certificado_fallo: { ventas_hoy: 2 },
    secuencias: [
      { tipo: 'E32', ambiente: 'certecf', restantes: 0, estado: 'agotada' },
      { tipo: 'E31', ambiente: 'certecf', restantes: 12, estado: 'pocos' },
    ],
    sin_rango: { ventas: 4 },
  }).map((a) => a.clave),
  ['certificado', 'secuencia-E32', 'secuencia-E31', 'sin-rango'])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
