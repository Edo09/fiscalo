// La cuenta que está en la app: su usuario y lo que Express le permite (entitlements). Con la sesión vencida el store queda vacío y la hoja de sesión se abre sobre la pantalla, que sigue con
// la cuenta que tenía (la retenida), como App y Facturas.
import { useMemo } from 'react'
import { useSession } from '@/stores/auth'
import { leerEntitlements } from '~/entitlements'
import type { Entitlements, UsuarioExpress } from '~/entitlements'
import { snapshot } from '~/lib/sesion'

export function useCuenta(): { usuario: UsuarioExpress | null; entitlements: Entitlements | null } {
  const { token, user } = useSession()
  const usuario: UsuarioExpress | null = token !== null && user !== null ? user : (snapshot()?.user ?? null)
  const entitlements = useMemo(() => leerEntitlements(usuario), [usuario])
  return { usuario, entitlements }
}
