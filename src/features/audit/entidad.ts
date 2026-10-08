// "Abrir la entidad" desde un registro de la bitácora.
//
// Donde la app tiene pantalla de detalle (factura e-CF, factura simple,
// cotización, conduce) se abre ese documento; para el resto se va al
// módulo, porque esos listados no se abren por id. Una eliminación no
// ofrece nada: el documento ya no existe.
import { ApiError, getFactura, listFacturas, mapFacturaRow } from '@/api'
import type { AuditLogRow } from '@/api'
import { TITLES, type Nav, type ViewId } from '@/config/navigation'

export interface Destino {
  etiqueta: string
  abrir: (nav: Nav) => Promise<void>
}

/** Entidades sin detalle por id: se abre la vista del módulo. */
const VISTA_DEL_MODULO: Record<string, ViewId> = {
  client: 'clientes',
  product: 'productos',
  proveedor: 'proveedores',
  category: 'categorias',
  warehouse: 'almacenes',
  gasto: 'gastos',
  inventory_adjustment: 'ajustes',
  user: 'usuarios',
  user_role: 'usuarios',
  role: 'usuarios',
  ecf_recibido: 'aprobar-ecf',
  aprobacion_comercial: 'aprobar-ecf',
  ncf_rango: 'configuracion',
  ncf_sequence: 'configuracion',
  factura_ncf: 'configuracion',
  tenant_branding: 'configuracion',
}

const soloDigitos = (v: string) => /^\d+$/.test(v)

/**
 * La emisión guarda el e-NCF como entity_id (no el id numérico), así que se
 * busca por e-NCF; los cambios de estado viejos pueden traer el id.
 */
async function abrirFacturaEcf(nav: Nav, id: string): Promise<void> {
  if (soloDigitos(id)) {
    const f = await getFactura(Number(id))
    if (f) { nav('factura-ver', mapFacturaRow(f)); return }
  }
  const res = await listFacturas({ query: id, pageSize: 5 })
  const fila = res.items.find((r) => r.e_ncf === id)
  // ApiError (y no Error): la bitácora solo muestra textos de ese tipo; un
  // error de JavaScript cae en su mensaje genérico. El id puede ser el interno,
  // que no le dice nada a nadie, así que no se repite.
  if (!fila) throw new ApiError('No encontramos esa factura. Puede que se haya eliminado.', 404)
  nav('factura-ver', mapFacturaRow(fila))
}

export function destinoEntidad(r: AuditLogRow): Destino | null {
  if (r.action === 'DELETE' || !r.entity_type) return null
  const id = r.entity_id ?? ''

  if (r.entity_type === 'factura' && id !== '') {
    return { etiqueta: 'Abrir factura', abrir: (nav) => abrirFacturaEcf(nav, id) }
  }
  if (r.entity_type === 'factura_simple' && soloDigitos(id)) {
    return {
      etiqueta: 'Abrir factura simple',
      abrir: async (nav) => nav('factura-simple-editar', { kind: 'factura-simple', id: Number(id) }),
    }
  }
  if (r.entity_type === 'cotizacion' && soloDigitos(id)) {
    return {
      etiqueta: 'Abrir cotización',
      abrir: async (nav) => nav('cotizacion-nueva', { kind: 'cotizacion', id: Number(id) }),
    }
  }
  // Su CREATE o UPDATE abre el formulario del conduce. Si después lo
  // eliminaron (activo = 0), el formulario dice "Este conduce ya no existe".
  if (r.entity_type === 'conduce' && soloDigitos(id)) {
    return {
      etiqueta: 'Abrir conduce',
      abrir: async (nav) => nav('conduce-editar', { kind: 'conduce', id: Number(id) }),
    }
  }

  const vista = VISTA_DEL_MODULO[r.entity_type]
  if (!vista) return null
  return { etiqueta: `Ir a ${TITLES[vista]}`, abrir: async (nav) => nav(vista) }
}
