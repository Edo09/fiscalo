import { GastosListado } from '@/features/expenses/GastosListado'

/* FISCALO — Compras: facturas de proveedores del endpoint /api/gastos
   (categoria=facturas_proveedores): E41/E47 auto-emitidos y E31/B01/E33/E34 recibidos. */
export function PurchasesView({ autoNew = false }: { autoNew?: boolean }) {
  return (
    <GastosListado
      categoria="facturas_proveedores"
      title="Compras"
      sub="Facturas de proveedores: comprobantes de compra (E41/E47) y recibidos (E31, B01, E33, E34)"
      ctaLabel="Registrar compra"
      icon="shopping-cart"
      autoNew={autoNew}
    />
  )
}
