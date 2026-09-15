// Aviso de RNC repetido en el directorio de proveedores, para mostrarlo al
// consultar un RNC antes de crear otro proveedor. Solo informa.
import { listProveedores } from '@/api'

/** Nombre de un proveedor propio con este RNC (sin contar `excluirId`), o null. */
export async function proveedorConRnc(rnc: string, excluirId?: string): Promise<string | null> {
  const res = await listProveedores({ query: rnc, pageSize: 5 })
  const igual = res.items.find(
    (p) => (p.rnc ?? '').replace(/\D/g, '') === rnc && String(p.id) !== excluirId,
  )
  return igual ? (igual.nombre || `Proveedor #${igual.id}`) : null
}
