import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Icon, Btn, Money, Card, Modal, PageHead, LoadingState } from '@/components/ui'
import { ApiError, crearAjuste, listProducts, mapProductRow } from '@/api'
import type { CrearAjusteLinea, MotivoAjuste } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { admiteDecimales, problemaCantidad, useUnidadesMedida } from '@/components/unidadesMedida'
import { r2, redondear } from '@/features/invoices/montosLinea'
import { decimalesDe, fmtCantidad } from '@/lib/format'
import type { Producto } from '@/types/domain'
import type { Nav } from '@/config/navigation'
import { MOTIVOS } from './motivos'

interface Linea {
  id: number
  productId: number
  nombre: string
  sku: string
  /** Unidad de medida del producto (código DGII): decide si la cantidad admite fracciones. */
  unidadMedida: number
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
  /**
   * Líneas cuya cantidad ya se dejó (el campo perdió el foco). Un producto recién
   * agregado empieza en 0 y marcarlo en rojo en ese instante sería regañar antes
   * de que se pueda escribir; el motivo del botón en gris sí se ve desde el inicio.
   */
  const [tocadas, setTocadas] = useState<Set<number>>(() => new Set())
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
      unidadMedida: p.unidadMedida,
      cantidadActual: p.stock ?? 0,
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
  // Mismo cálculo que el backend (inventoryModel: costo a 2 decimales y luego
  // round(cantidad × costo, 2)), con el redondeo de PHP: con cantidades
  // fraccionadas Math.round sobre el binario se desviaba un centavo.
  const totalDe = (l: Linea) => r2(deltaDe(l) * r2(l.costo))
  const total = r2(lineas.reduce((a, l) => a + totalDe(l), 0))

  // Un producto con cantidad 0 no ajusta nada. Antes esas líneas se descartaban
  // sin avisar y, si todas estaban en 0, "Guardar ajuste" quedaba en gris sin
  // explicación. Ahora se marcan y bloquean hasta completarlas o quitarlas.
  const lineasEnCero = lineas.filter((l) => !(l.cantidad > 0))
  const marcarCero = (l: Linea) => !(l.cantidad > 0) && tocadas.has(l.id)
  // Si la cantidad puede llevar decimales lo decide la unidad del producto
  // (kg o metro sí, unidad o caja no), con hasta 3 decimales, igual que el
  // backend. Esto se marca en cuanto se escribe, sin esperar a que el campo
  // pierda el foco: el usuario ya escribió la cantidad, no es un campo recién
  // agregado. El 0 lo sigue cubriendo marcarCero.
  const unidades = useUnidadesMedida()
  // Excepción, igual que el backend (inventoryModel::dejaExistenciaEntera): un
  // producto por «Unidad» puede tener 8,5 en existencia (una línea de factura o
  // de gasto vendida en metros mueve 1,5). La fracción que la deja entera
  // (disminuir 0,5 o aumentar 0,5) es la corrección y no se juzga con la unidad;
  // solo cuenta el tope de 3 decimales. Una fracción nueva sigue rechazada. Se
  // redondea como PHP para decidir lo mismo que el servidor, que es quien manda
  // si la existencia cambió después de agregar la línea.
  const dejaEntera = (l: Linea) => {
    const antes = redondear(l.cantidadActual, 3)
    const delta = redondear(l.cantidad, 3) * (l.tipo === 'DISMINUCION' ? -1 : 1)
    return decimalesDe(antes) > 0 && decimalesDe(redondear(antes + delta, 3)) === 0
  }
  // Admite fracción la línea cuya unidad las admite o cuya existencia ya trae una.
  const fraccionable = (l: Linea) => admiteDecimales(l.unidadMedida, unidades) || decimalesDe(l.cantidadActual) > 0
  const problemaFraccion = (l: Linea) =>
    l.cantidad > 0
      ? problemaCantidad(l.cantidad, {
          // null = sin unidad que juzgar (admiteDecimales da true).
          unidadId: dejaEntera(l) ? null : l.unidadMedida,
          catalogo: unidades,
          maxDecimales: 3,
        })
      : null
  const lineasConFraccionMala = lineas.filter((l) => problemaFraccion(l) != null)
  // Dejar el almacén en negativo casi siempre es un error de captura, pero no lo
  // bloqueamos: el sistema permite saldo negativo y a veces refleja la realidad.
  const negativos = lineas.filter((l) => l.cantidad > 0 && finalDe(l) < 0)
  const motivoBloqueo = lineas.length === 0
    ? 'Agrega al menos un producto para ajustar.'
    : lineasEnCero.length > 0
      ? 'Falta la cantidad en algún producto.'
      : lineasConFraccionMala.length > 0
        ? 'Revisa la cantidad marcada en rojo.'
        : null
  const puedeGuardar = motivoBloqueo == null && !guardando

  // Acción única: un doble clic crearia dos ajustes y moveria el stock el doble.
  const guardar = useAccionUnica(async () => {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      const payload = {
        motivo,
        nota: nota.trim() || undefined,
        lineas: lineas.map<CrearAjusteLinea>((l) => ({
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
      nav('ajustes', null, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo crear el ajuste.')
      setGuardando(false)
    }
  })

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
                    <td style={{ textAlign: 'right' }} className="muted">{fmtCantidad(l.cantidadActual)}</td>
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
                    <td className={marcarCero(l) || problemaFraccion(l) ? 'field-error' : undefined}>
                      {/* Sin Math.round: antes 0.5 kg se convertía en 1 al teclearlo. La
                          cantidad queda como se escribe y problemaFraccion avisa si no va. */}
                      <input
                        className="input" type="number" min={0}
                        step={fraccionable(l) ? 'any' : 1}
                        inputMode={fraccionable(l) ? 'decimal' : 'numeric'}
                        style={{ textAlign: 'right' }}
                        value={l.cantidad}
                        onChange={(e) => updLinea(l.id, { cantidad: Math.max(0, Number(e.target.value) || 0) })}
                        onBlur={() => setTocadas((t) => (t.has(l.id) ? t : new Set(t).add(l.id)))}
                        aria-label={`Cantidad a ajustar de ${l.nombre}`}
                        aria-invalid={marcarCero(l) || problemaFraccion(l) != null || undefined}
                      />
                      {problemaFraccion(l) && <div className="err-msg">{problemaFraccion(l)}</div>}
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
                      {/* fmtCantidad también limpia el ruido binario (10.1 − 0.3 = 9.799999…). */}
                      <span style={{ color: finalDe(l) < 0 ? 'var(--danger)' : undefined }}>{fmtCantidad(finalDe(l))}</span>
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

        {lineasEnCero.some(marcarCero) && (
          <div className="row gap-sm text-sm" style={{ marginTop: 12, color: 'var(--danger)', alignItems: 'center' }} role="alert">
            <Icon name="alert-circle" size={14} />
            <span>
              Escribe una cantidad mayor que 0 en cada producto, o quítalo con la ✕.
            </span>
          </div>
        )}

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

      <div className="row" style={{ justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 18 }}>
        {/* Por qué está en gris: un botón deshabilitado no muestra su title de forma fiable. */}
        {motivoBloqueo && !guardando && <span className="text-xs muted-3" role="status">{motivoBloqueo}</span>}
        <Btn variant="secondary" onClick={() => nav('ajustes')}>Cancelar</Btn>
        <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={!puedeGuardar} title={motivoBloqueo ?? undefined}>
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
                        {fmtCantidad(p.stock ?? 0)} en existencia
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
