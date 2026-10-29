// Qué puede hacer esta cuenta en Express y la política de rutas que sale de ello (anexo 5.3 y 5.4). Todo falla cerrado: un bloque `entitlements`
// ausente o que no es el de 4.3(a) no es una cuenta con menos permisos, es una cuenta sin Express (`leerEntitlements` da null y la app muestra
// la pantalla de edición). La política vive solo aquí, en funciones puras, y no reutiliza `puedeVerItem` de la app completa
// (src/config/navigation.ts), que falla abierto. Que un botón o una fila no salga no es un control de seguridad: lo es esta guardia, y detrás de
// ella el API, que niega las mismas rutas.
import type { SessionUser } from '@/stores/auth'
import { formatHash, moduloDeRuta } from '~/router'
import type { Ruta } from '~/router'

export type Modulo = 'facturacion' | 'clientes' | 'productos' | 'usuarios' | 'configuracion'
export type Ambiente = 'ecf' | 'certecf' | 'testecf'

/** El bloque `user.entitlements` de 4.3(a), ya validado: lo que la app puede dar por cierto de la cuenta. */
export interface Entitlements {
  edicion: 'express'
  tenant: { id: number; nombre: string; rnc: string; ambiente: Ambiente }
  modulos: Modulo[]
  tipos_ecf: string[]
  capacidades: { idempotencia: boolean; reconciliador: boolean; certificado: boolean }
}

/** El usuario de la sesión tal como lo devuelve el API: el de la app completa más el bloque, que llega como `unknown` hasta que se lee. */
export type UsuarioExpress = SessionUser & { entitlements?: unknown }

const MODULOS: readonly Modulo[] = ['facturacion', 'clientes', 'productos', 'usuarios', 'configuracion']
const AMBIENTES: readonly Ambiente[] = ['ecf', 'certecf', 'testecf']
/** Los comprobantes que Express conoce: los tres de venta, la nota de crédito que se deriva de ellos (34) y la de débito (33), que solo sale si el tenant la lista. */
const TIPOS_CONOCIDOS: readonly string[] = ['31', '32', '33', '34', '45']
/** Los tipos con los que se factura (anexo 5.3): los que el asistente deja elegir y los que cuentan para tener o no un selector. */
const TIPOS_DE_VENTA: readonly string[] = ['31', '32', '45']

const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null && !Array.isArray(valor)

/** Lo de `lista` que es texto y está en `permitidos`, en su orden y sin repetir. Lo demás (otro tipo de dato, un código que no se conoce) se descarta. */
function filtrar<T extends string>(lista: readonly unknown[], permitidos: readonly T[]): T[] {
  const salida: T[] = []
  for (const x of lista) {
    const conocido = permitidos.find((p) => p === x)
    if (conocido !== undefined && !salida.includes(conocido)) salida.push(conocido)
  }
  return salida
}

/**
 * Lee y valida `user.entitlements`. Devuelve null, y la app muestra la pantalla «Esta cuenta no está habilitada en Express», si el usuario no
 * existe, si no hay bloque o no es un objeto, si `edicion` no es exactamente `express`, si `modulos` no es una lista o si `tenant` no es un
 * objeto con un `id` entero positivo (arma las claves de lo que se guarda en el teléfono) y un `ambiente` conocido. De lo demás es tolerante,
 * y siempre hacia lo que menos permite: los módulos y los tipos que no se conocen se descartan; un `tipos_ecf` ausente es una lista vacía (la
 * cuenta no puede emitir, pero el resto del bloque se lee); una capacidad es verdadera solo si vale `true`; y un `nombre` o `rnc` que no son
 * texto quedan vacíos, porque solo se muestran. Entrega copias: lo que se lea no ata el bloque de la sesión.
 */
export function leerEntitlements(u: UsuarioExpress | null | undefined): Entitlements | null {
  const bloque = u?.entitlements
  if (!esObjeto(bloque) || bloque.edicion !== 'express' || !Array.isArray(bloque.modulos)) return null
  const tenant = bloque.tenant
  if (!esObjeto(tenant)) return null
  const { id, ambiente } = tenant
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null
  const ambienteConocido = AMBIENTES.find((a) => a === ambiente)
  if (ambienteConocido === undefined) return null
  const capacidades: Record<string, unknown> = esObjeto(bloque.capacidades) ? bloque.capacidades : {}
  return {
    edicion: 'express',
    tenant: {
      id,
      nombre: typeof tenant.nombre === 'string' ? tenant.nombre : '',
      rnc: typeof tenant.rnc === 'string' ? tenant.rnc : '',
      ambiente: ambienteConocido,
    },
    modulos: filtrar(bloque.modulos, MODULOS),
    tipos_ecf: filtrar(Array.isArray(bloque.tipos_ecf) ? bloque.tipos_ecf : [], TIPOS_CONOCIDOS),
    capacidades: {
      idempotencia: capacidades.idempotencia === true,
      reconciliador: capacidades.reconciliador === true,
      certificado: capacidades.certificado === true,
    },
  }
}

/** ¿Tiene la cuenta este módulo? Sin entitlements, no. */
export function tieneModulo(e: Entitlements | null, m: Modulo): boolean {
  return e !== null && e.modulos.includes(m)
}

/** Los tipos con los que la cuenta factura (31, 32 y 45), en el orden del bloque. Sin la nota de crédito que se deriva (34) ni la de débito (33). */
export function tiposVenta(e: Entitlements | null): string[] {
  return e === null ? [] : e.tipos_ecf.filter((tipo) => TIPOS_DE_VENTA.includes(tipo))
}

/** ¿Factura con dos o más tipos? Solo entonces hay selector de tipo en el asistente y filtro por tipo en Facturas (anexo 5.3). */
export function esMultiTipo(e: Entitlements | null): boolean {
  return tiposVenta(e).length >= 2
}

/** Los tipos que ofrece el filtro de Facturas de una cuenta con varios tipos de venta: `tipos_ecf` en su orden, con la nota de crédito (34) incluida. */
export function tiposFiltro(e: Entitlements | null): string[] {
  return e === null ? [] : [...e.tipos_ecf]
}

/** ¿Es administrador? Por el nombre del rol, escrito exactamente `admin`: ni `Admin` ni el rol de otro nombre con permisos de administrador. */
export function esAdmin(u: { role?: string } | null | undefined): boolean {
  return u?.role === 'admin'
}

/** Lo que la guardia decide de una ruta: pasa, la cuenta no es de Express (pantalla de edición), o hay que ir a otro hash (con `reemplazar`). */
export type Guardia = { kind: 'ok' } | { kind: 'edicion' } | { kind: 'redirigir'; hash: string }

/** El destino de toda redirección de la guardia: el inicio, que a su vez pasa por la guardia. */
const INICIO = formatHash({ id: 'facturas' })

/** Las rutas del asistente de factura: no se abren si la cuenta no factura con ningún tipo. */
const DEL_ASISTENTE: readonly Ruta['id'][] = ['facturar', 'facturar-productos', 'facturar-revisar', 'facturar-resultado']

/** Qué hacer con una ruta que la cuenta no puede abrir: ir al inicio, salvo que la ruta sea el inicio, que no puede mandar a sí mismo. */
function negada(r: Ruta): Guardia {
  return r.id === 'facturas' ? { kind: 'edicion' } : { kind: 'redirigir', hash: INICIO }
}

/**
 * La política de rutas de Express (anexo 5.4), la única. Falla cerrado y mira en este orden:
 *  1. Sin entitlements: la pantalla de edición, en cualquier ruta (también Más).
 *  2. Si la ruta pide un módulo que la cuenta no tiene, o pide ser administrador y `ctx.admin` es falso: se va al inicio.
 *  3. El tipo. Con un solo tipo de venta no hay filtro, así que un `tipo` en Facturas se quita (queda el resto de la búsqueda); con varios, un `tipo`
 *     que no es de la cuenta se cambia por el primero. Y el asistente no se abre si la cuenta no factura con ningún tipo.
 * Quien llama aplica `redirigir` con `reemplazar` (el hash que no se puede abrir no queda en el historial) y pasa la ruta nueva otra vez por la
 * guardia: seguir las redirecciones siempre termina. El inicio es el destino de todas, así que si lo que se niega es el propio inicio (una cuenta
 * Express sin el módulo `facturacion`) no hay a dónde mandarla: la guardia da la pantalla de edición en vez de mandarlo a sí mismo en bucle.
 */
export function guardia(r: Ruta, ctx: { entitlements: Entitlements | null; admin: boolean }): Guardia {
  const e = ctx.entitlements
  if (e === null) return { kind: 'edicion' }

  const { modulo, admin } = moduloDeRuta(r)
  if ((modulo !== null && !tieneModulo(e, modulo)) || (admin && !ctx.admin)) return negada(r)

  if (r.id === 'facturas' && r.tipo !== undefined) {
    const permitidos = esMultiTipo(e) ? tiposFiltro(e) : []
    if (!permitidos.includes(r.tipo)) {
      const sinElTipo: Extract<Ruta, { id: 'facturas' }> = { id: 'facturas' }
      if (r.q !== undefined) sinElTipo.q = r.q
      if (r.estado !== undefined) sinElTipo.estado = r.estado
      if (permitidos.length > 0) sinElTipo.tipo = permitidos[0]
      return { kind: 'redirigir', hash: formatHash(sinElTipo) }
    }
  }

  if (DEL_ASISTENTE.includes(r.id) && tiposVenta(e).length === 0) return { kind: 'redirigir', hash: INICIO }
  return { kind: 'ok' }
}
