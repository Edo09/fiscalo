// Acceso global (usuarios de soporte que entran a todas las empresas; api-gratex
// docs/modules/acceso-global.md): lo que el selector de empresa decide sin React.
// scripts/test-acceso-global.ts lo prueba con Node.
//
// Imports de valor SOLO por ruta relativa con .ts (Node los carga tal cual);
// lo de '@/…' va solo como `import type`, que Node borra.
import type { EmpresaAcceso } from '@/api/auth'
import type { SessionUser } from '@/stores/auth'

/** ¿El usuario puede pasar su sesión a otra empresa? Solo si el backend lo dice. */
export function tieneAccesoGlobal(user: SessionUser | null | undefined): boolean {
  return user?.acceso_global === true
}

/**
 * ¿La sesión está en la empresa de un cliente (no en la del usuario)? Solo con
 * acceso global y si el backend lo dijo: sin el dato no se marca nada.
 */
export function enEmpresaDeCliente(user: SessionUser | null | undefined): boolean {
  return tieneAccesoGlobal(user) && user?.empresa?.propia === false
}

/** Texto para comparar: sin mayúsculas, acentos ni espacios de más. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Empresas que coinciden con lo escrito. Si son solo números (con espacios o
 * guiones, "131-25643-2"), por RNC o por un nombre que los lleve ("27" encuentra
 * "Farmacia La 27"); si hay letras, solo por nombre, sin acentos ni mayúsculas
 * ("ferre 2" no trae empresas por tener un 2 en el RNC). Vacío = todas, en el orden
 * en que llegaron (el backend las ordena por nombre).
 */
export function filtrarEmpresas(empresas: EmpresaAcceso[], q: string): EmpresaAcceso[] {
  const t = normalizar(q)
  if (!t) return empresas
  const soloDigitos = /^[\d\s-]+$/.test(t)
  if (!soloDigitos) return empresas.filter((e) => normalizar(e.nombre).includes(t))
  const digitos = t.replace(/\D/g, '')
  return empresas.filter((e) => e.rnc.replace(/\D/g, '').includes(digitos) || normalizar(e.nombre).includes(t))
}

/**
 * Rótulo del ambiente DGII de una empresa. Producción (ecf) no se marca: es lo
 * normal. Las demás sí, para no confundir una empresa de pruebas con una real.
 */
export function etiquetaAmbiente(ambiente: string): string | null {
  switch (ambiente) {
    case 'ecf':
    case '':
      return null
    case 'certecf':
      return 'Certificación'
    case 'testecf':
      return 'Pruebas'
    default:
      return ambiente
  }
}

/** Iniciales de una empresa para su logo (dos palabras), como la barra superior. */
export function iniciales(nombre: string): string {
  const s = nombre.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return s || '…'
}
