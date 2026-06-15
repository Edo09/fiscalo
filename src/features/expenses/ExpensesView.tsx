import { GastosListado } from './GastosListado'

/* FISCALO — Gastos: SOLO la categoría gastos_menores (E43, auto-emisión).
   Las facturas de proveedores viven en Compras (PurchasesView). */
export function ExpensesView({ autoNew = false }: { autoNew?: boolean }) {
  return (
    <GastosListado
      categoria="gastos_menores"
      title="Gastos"
      sub="Gastos menores (e-CF 43, auto-emisión a la DGII)"
      ctaLabel="Registrar gasto"
      icon="receipt"
      autoNew={autoNew}
    />
  )
}
