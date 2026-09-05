import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Modal, PageHead, LoadingState } from '@/components/ui'
import { ApiError, crearAjuste, listProducts, mapProductRow } from '@/api'
import type { CrearAjusteLinea, MotivoAjuste } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { Producto } from '@/types/domain'
import type { Nav } from '@/config/navigation'
import { MOTIVOS } from './motivos'

interface Linea {
  id: number
  productId: number
  nombre: string
  sku: string
  /** Existencia al momento de agregar la línea (foto, no se recalcula sola). */
  cantidadActual: number
  tipo: 'INCREMENTO' | 'DISMINUCION'
  cantidad: number
  costo: number
}

/* FISCALO — Crear ajuste de inventario (POST /api/inventario/ajustes).
   Cada línea se convierte en un movimiento del libro: queda el saldo antes, el
   ajuste y el saldo después. No se puede editar luego; se anula con el inverso. */
export function AdjustmentFormView({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient()
  const [motivo, setMotivo] = useState<MotivoAjuste>('CONTEO_FISICO')
  const [nota, setNota] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [guardando, setGuardando] = useState(false)
  const [picker, setPicker] = useState(false)
  const [busca, setBusca] = useState('')

  // La busqueda va al servidor: el catalogo tiene cientos de articulos y filtrar
  // solo la primera pagina dejaria fuera la mayoria. Con el buscador vacio se
  // reusa la misma clave de cache que el resto de la app.
  const [buscaDebounced, setBuscaDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  const productos = useApiQuery(
    buscaDebounced ? ['products', 'list', buscaDebounced] : ['products', 'list'],
    () => listProducts({ pageSize: 100, query: buscaDebounced || undefined }),
    { keepPrevious: true },
  )
  const filtrados: Producto[] = (productos.data?.items ?? []).map(mapProductRow)

  const addProducto = (p: Producto) => {
    // Un producto por ajuste: dos líneas del mismo articulo se pisarian entre
    // ellas al calcular la cantidad final.
    if (lineas.some((l) => String(l.productId) === String(p.id))) {
      toast.error(`${p.nombre} ya está en el ajuste.`)
      return
    }
    setLineas((ls) => [...ls, {
      id: Date.now(),
      productId: Number(p.id),
      nombre: p.nombre,
      sku: p.sku ?? '',
      cantidadActual: Number(p.stock ?? 0),
      tipo: 'INCREMENTO',
      cantidad: 0,
      costo: Number(p.costo ?? 0),
    }])
    setPicker(false)
    setBusca('')
  }

  const updLinea = (id: number, cambios: Partial<Linea>) =>
    setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios } : l)))
  const delLinea = (id: number) => setLineas((ls) => ls.filter((l) => l.id !== id))

  const deltaDe = (l: Linea) => (l.tipo === 'DISMINUCION' ? -l.cantidad : l.cantidad)
  const finalDe = (l: Linea) => l.cantidadActual + deltaDe(l)
  const totalDe = (l: Linea) => Math.round(deltaDe(l) * l.costo * 100) / 100
  const total = lineas.reduce((a, l) => a + totalDe(l), 0)

  const lineasValidas = lineas.filter((l) => l.cantidad > 0)
  // Dejar el almacén en negativo casi siempre es un error de captura, pero no lo
  // bloqueamos: el sistema permite saldo negativo y a veces refleja la realidad.
  const negativos = lineasValidas.filter((l) => finalDe(l) < 0)
  const puedeGuardar = lineasValidas.length > 0 && !guardando

  const guardar = async () => {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      const payload = {
        motivo,
        nota: nota.trim() || undefined,
        lineas: lineasValidas.map<CrearAjusteLinea>((l) => ({
          product_id: l.productId,
          tipo: l.tipo,
          cantidad: l.cantidad,
          costo_unitario: l.costo,
        })),
      }
      const creado = await crearAjuste(payload)
      // El stock de los productos cambió: los listados que lo muestran quedaron viejos.
      void queryClient.invalidateQueries({ queryKey: ['inventario'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Ajuste ${creado.codigo} registrado.`)
      nav('ajustes')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo crear el ajuste.')
      setGuardando(false)
    }
  }

  return (
    <div className="page page-wide">
      <PageHead
        title="Crear ajuste de inventario"
        sub="Registra aumentos o disminuciones de existencias"
        actions={<Btn variant="ghost" onClick={() => nav('ajustes')}>Cancelar</Btn>}
      />

      <Card>
        <div className="form-grid">
          <div className="field">
            <label className="label">Motivo <span className="req">*</span></label>
            <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoAjuste)}>
              {MOTIVOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="field full">
            <label className="label">Nota</label>
            <input
              className="input"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Ej.: conteo del 03/09, pasillo 4"
              maxLength={500}
            />
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
      <Card>
        <p className="text-sm muted" style={{ marginTop: 0 }}>Selecciona los productos que vas a ajustar</p>

        {lineas.length === 0 ? (
          <p className="text-sm muted-3">Sin productos todavía.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Cantidad actual</th>
                  <th>Tipo de ajuste</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Costo promedio</th>
                  <th style={{ textAlign: 'right' }}>Cantidad final</th>
                  <th style={{ textAlign: 'right' }}>Total ajustado</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="cell-main">{l.nombre}</span>
                      {l.sku && <div className="cell-sub mono">{l.sku}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="muted">{l.cantidadActual}</td>
                    <td>
                      <select
                        className="input"
                        value={l.tipo}
                        onChange={(e) => updLinea(l.id, { tipo: e.target.value as Linea['tipo'] })}
                        aria-label={`Tipo de ajuste de ${l.nombre}`}
                      >
                        <option value="INCREMENTO">Incremento</option>
                        <option value="DISMINUCION">Disminución</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="input" type="number" min={0} step={1} inputMode="numeric"
                        style={{ textAlign: 'right' }}
                        value={l.cantidad}
                        onChange={(e) => updLinea(l.id, { cantidad: Math.max(0, Math.round(Number(e.target.value))) })}
                        aria-label={`Cantidad a ajustar de ${l.nombre}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input" type="number" min={0} step="any" inputMode="decimal"
                        style={{ textAlign: 'right' }}
                        value={l.costo}
                        onChange={(e) => updLinea(l.id, { costo: Math.max(0, Number(e.target.value)) })}
                        aria-label={`Costo promedio de ${l.nombre}`}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }} className="fw6">
                      <span style={{ color: finalDe(l) < 0 ? 'var(--danger)' : undefined }}>{finalDe(l)}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}><Money value={totalDe(l)} /></td>
                    <td>
                      <button type="button" className="icon-btn" onClick={() => delLinea(l.id)} aria-label={`Quitar ${l.nombre}`}>
                        <Icon name="x" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <Btn variant="secondary" icon="plus" onClick={() => setPicker(true)}>Agregar producto</Btn>
          <span className="row gap-sm">
            <span className="text-sm muted">Total</span>
            <span className="fw6" style={{ fontSize: 16 }}><Money value={total} /></span>
          </span>
        </div>

        {negativos.length > 0 && (
          <div className="card card-pad row gap-sm" style={{ marginTop: 12, background: 'var(--warning-soft)', borderColor: 'transparent' }}>
            <Icon name="alert-triangle" size={16} />
            <span className="text-sm">
              {negativos.length === 1
                ? `${negativos[0].nombre} quedaría en existencia negativa.`
                : `${negativos.length} productos quedarían en existencia negativa.`}
              {' '}Se puede guardar, pero revisa que la cantidad sea la correcta.
            </span>
          </div>
        )}
      </Card>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <Btn variant="secondary" onClick={() => nav('ajustes')}>Cancelar</Btn>
        <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={!puedeGuardar}>
          {guardando ? 'Guardando…' : 'Guardar ajuste'}
        </Btn>
      </div>

      <p className="text-xs muted-3" style={{ marginTop: 10 }}>
        Un ajuste guardado no se edita: si te equivocas, se anula y el sistema crea el ajuste inverso.
      </p>

      {picker && (
        <Modal title="Agregar producto" sub="Del catálogo" icon="package" onClose={() => setPicker(false)}>
          <div className="search-input mb-md" style={{ width: '100%' }}>
            <Icon name="search" />
            <input placeholder="Buscar por nombre o SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
            {productos.fetching && !productos.loading && <Icon name="loader" className="spin" />}
          </div>
          {productos.loading ? (
            <LoadingState rows={4} />
          ) : filtrados.length === 0 ? (
            <p className="text-sm muted">
              {buscaDebounced ? `Ningún producto coincide con «${buscaDebounced}».` : 'El catálogo está vacío.'}
            </p>
          ) : (
            <div className="tbl-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
              <table className="tbl">
                <tbody>
                  {filtrados.slice(0, 50).map((p) => (
                    <tr key={p.id} onClick={() => addProducto(p)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span className="cell-main">{p.nombre}</span>
                        {p.sku && <div className="cell-sub mono">{p.sku}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }} className="muted text-sm">
                        {p.stock ?? 0} en existencia
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
