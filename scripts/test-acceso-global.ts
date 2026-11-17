// Acceso global (src/features/auth/accesoGlobal.ts): lo que el selector de empresa
// de un usuario de soporte decide sin React. Sin servidor ni base.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-acceso-global.ts
import type { EmpresaAcceso } from '../src/api/auth.ts'
import type { SessionUser } from '../src/stores/auth.ts'
import {
  enEmpresaDeCliente, etiquetaAmbiente, filtrarEmpresas, iniciales, normalizar, tieneAccesoGlobal,
} from '../src/features/auth/accesoGlobal.ts'

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

const base: SessionUser = { id: 10, email: 's@x.test', username: 'soporte', name: 'Soporte', role: 'admin', permissions: ['*'] }

console.log('Quién ve el selector')
chk('usuario normal (sin la clave): no', !tieneAccesoGlobal(base))
chk('acceso_global false: no', !tieneAccesoGlobal({ ...base, acceso_global: false }))
chk('acceso_global true: sí', tieneAccesoGlobal({ ...base, acceso_global: true }))
chk('sin sesión: no', !tieneAccesoGlobal(null) && !tieneAccesoGlobal(undefined))

console.log('Aviso de "estás en la empresa de un cliente"')
const empresa = { id: 2, nombre: 'Ferre SRL', rnc: '132615123', ambiente: 'ecf' }
chk('soporte en la empresa de un cliente (propia false): sí',
  enEmpresaDeCliente({ ...base, acceso_global: true, empresa: { ...empresa, propia: false } }))
chk('soporte en su propia empresa: no',
  !enEmpresaDeCliente({ ...base, acceso_global: true, empresa: { ...empresa, id: 1, propia: true } }))
chk('soporte sin el dato propia (backend viejo): no se marca',
  !enEmpresaDeCliente({ ...base, acceso_global: true, empresa }))
chk('usuario normal con una empresa cualquiera: no',
  !enEmpresaDeCliente({ ...base, empresa: { ...empresa, propia: false } }))

console.log('Búsqueda')
const lista: EmpresaAcceso[] = [
  { id: 6, nombre: 'Ambas SRL', rnc: '131333333', ambiente: 'testecf', propia: false },
  { id: 2, nombre: 'FERREHERRAMIENTAS VENTURA EIRL', rnc: '132615123', ambiente: 'ecf', propia: false },
  { id: 1, nombre: 'Gratex EIRL', rnc: '131256432', ambiente: 'ecf', propia: true },
  { id: 9, nombre: 'Nuevas Ideas Noticias RD', rnc: '00104315429', ambiente: 'ecf', propia: false },
  { id: 17, nombre: 'Q & F Variedades SRL', rnc: '133454394', ambiente: 'ecf', propia: false },
]
const ids = (l: EmpresaAcceso[]) => l.map((e) => e.id)
igual('sin texto: todas, en el mismo orden', ids(filtrarEmpresas(lista, '')), [6, 2, 1, 9, 17])
igual('solo espacios: todas', ids(filtrarEmpresas(lista, '   ')), [6, 2, 1, 9, 17])
igual('por nombre, sin mayúsculas: "ferre"', ids(filtrarEmpresas(lista, 'ferre')), [2])
igual('por nombre, varias: "srl"', ids(filtrarEmpresas(lista, 'srl')), [6, 17])
igual('con acentos en lo escrito: "notícias"', ids(filtrarEmpresas(lista, 'notícias')), [9])
igual('con espacios de más: "  q  &  f "', ids(filtrarEmpresas(lista, '  q  &  f ')), [17])
igual('por RNC: "1326"', ids(filtrarEmpresas(lista, '1326')), [2])
igual('por RNC con guiones: "131-25643-2"', ids(filtrarEmpresas(lista, '131-25643-2')), [1])
igual('por cédula: "001043"', ids(filtrarEmpresas(lista, '001043')), [9])
igual('un número que no es de nadie: nada', ids(filtrarEmpresas(lista, '999')), [])
igual('nombre con un número: "ferre 2" no trae empresas por su RNC', ids(filtrarEmpresas(lista, 'ferre 2')), [])
igual('nombre con un número: "gratex 1" tampoco', ids(filtrarEmpresas(lista, 'gratex 1')), [])
const conNumero: EmpresaAcceso[] = [...lista, { id: 30, nombre: 'Farmacia La 27', rnc: '101000001', ambiente: 'ecf', propia: false }]
igual('solo números también busca en el nombre: "27"', ids(filtrarEmpresas(conNumero, '27')), [30])
igual('nombre y número juntos: "la 27"', ids(filtrarEmpresas(conNumero, 'la 27')), [30])
igual('un texto que no es de nadie: nada', ids(filtrarEmpresas(lista, 'zzz')), [])
igual('normalizar quita acentos, mayúsculas y espacios', normalizar('  ÁRBOL   Ñandú '), 'arbol nandu')

console.log('Ambiente')
igual('ecf (producción): sin rótulo', etiquetaAmbiente('ecf'), null)
igual('vacío: sin rótulo', etiquetaAmbiente(''), null)
igual('certecf: Certificación', etiquetaAmbiente('certecf'), 'Certificación')
igual('testecf: Pruebas', etiquetaAmbiente('testecf'), 'Pruebas')
igual('otro valor: tal cual', etiquetaAmbiente('raro'), 'raro')

console.log('Iniciales')
igual('dos palabras', iniciales('Gratex EIRL'), 'GE')
igual('una palabra', iniciales('Ferre'), 'F')
igual('con espacios de más', iniciales('  Q  &  F '), 'Q&')
igual('vacío', iniciales(''), '…')

console.log(`\n${total - fallos}/${total} OK`)
process.exit(fallos === 0 ? 0 : 1)
