// FISCALO — Configuración > Inventario: el interruptor «Bloquear ventas sin
// existencia» de la empresa (GET/PUT /api/inventario/configuracion). Solo lo ve y
// lo cambia el administrador; con el interruptor apagado (lo normal) todo funciona
// como siempre y la existencia puede quedar en negativo.
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge, Btn, Card, ErrorState, LoadingState, Switch } from '@/components/ui'
import { ApiError, getConfiguracionInventario, updateConfiguracionInventario } from '@/api'
import type { ConfiguracionInventario } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'

/** Clave de la consulta (guardar la actualiza al instante y la invalida para traer el contador). */
const CLAVE = ['configuracion-inventario'] as const

export function InventarioSection() {
  // staleTime 0: el contador de productos sin existencia es lo que el admin mira
  // ANTES de activar el bloqueo, y cambia con cada venta y cada ajuste.
  const { data, error, loading, reload } = useApiQuery(CLAVE, getConfiguracionInventario, { staleTime: 0 })
  return (
    <Card title="Inventario" sub="Qué pasa cuando una venta pide más de lo que hay en existencia">
      {loading ? (
        <LoadingState rows={3} />
      ) : error || !data ? (
        <ErrorState title="No se pudo cargar la configuración de inventario" onRetry={reload}>{error}</ErrorState>
      ) : (
        // key: si el servidor trae otro valor (otro administrador, refetch), el
        // borrador se reinicia con el valor guardado.
        <InventarioForm key={String(data.bloquear_sin_existencia)} config={data} />
      )}
    </Card>
  )
}

function InventarioForm({ config }: { config: ConfiguracionInventario }) {
  const queryClient = useQueryClient()
  const [bloquear, setBloquear] = useState(config.bloquear_sin_existencia)
  const [saving, setSaving] = useState(false)
  const dirty = bloquear !== config.bloquear_sin_existencia
  const sinExistencia = config.productos_sin_existencia

  const guardar = async () => {
    setSaving(true)
    try {
      const nueva = await updateConfiguracionInventario(bloquear)
      // Branding trae la bandera que leen las facturas y Productos; la consulta de
      // esta pantalla trae el valor guardado y el contador.
      queryClient.setQueryData(CLAVE, nueva)
      void queryClient.invalidateQueries({ queryKey: ['branding'] })
      void queryClient.invalidateQueries({ queryKey: CLAVE })
      toast.success(nueva.bloquear_sin_existencia
        ? 'Bloqueo activado: las facturas que pidan más de lo que hay se rechazan.'
        : 'Bloqueo desactivado: se puede vender sin existencia, como antes.')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="col gap-lg">
      {/* Un botón con role="switch": el Switch de la app es un span sin teclado. */}
      <button
        type="button" role="switch" aria-checked={bloquear} disabled={saving}
        onClick={() => setBloquear((v) => !v)}
        className="row gap-sm"
        style={{
          alignItems: 'center', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit',
          textAlign: 'left', cursor: saving ? 'default' : 'pointer', alignSelf: 'flex-start',
        }}
      >
        <Switch on={bloquear} />
        <span className="fw6 text-sm">Bloquear ventas sin existencia</span>
      </button>

      <div className="col gap-sm text-sm muted">
        <div>
          Con esta opción activa, una factura (electrónica o simple) que pide más de lo que hay en existencia no se
          guarda: el sistema dice qué producto falta y cuánto, y ofrece ir a «Ajuste de inventario» con las
          cantidades ya puestas. Un producto con la existencia en blanco cuenta como 0.
        </div>
        <div>
          No se revisan los servicios, las líneas sin producto ni las notas de crédito. El punto de venta (POS) no
          cambia: sigue vendiendo aunque no haya existencia, así que un producto puede quedar en 0 o menos y sus
          facturas se rechazan hasta que se le agregue existencia.
        </div>
        <div>
          Con el bloqueo activo, la existencia no se puede escribir al editar un producto: se agrega en
          «Ajuste de inventario» o registrando una compra en «Compras». Un producto nuevo sí puede abrir con una
          cantidad inicial, que queda registrada como un ajuste.
        </div>
      </div>

      <div className="row gap-sm" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge tone={sinExistencia > 0 ? 'warning' : 'success'}>
          {sinExistencia === 1 ? '1 producto sin existencia' : `${sinExistencia} productos sin existencia`}
        </Badge>
        <span className="text-xs muted-3">
          {sinExistencia > 0
            ? 'Bienes activos con la existencia en blanco, en 0 o negativa: no se podrán facturar al activar el bloqueo hasta que tengan existencia.'
            : 'Todos los bienes activos tienen existencia.'}
        </span>
      </div>

      <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
        <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={!dirty || saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Btn>
      </div>
    </div>
  )
}
