// Ventas del día del cajero en esta caja (K9 ampliado): todas las de hoy, también
// las de turnos ya cerrados, con el resumen por forma de pago y reimpresión.
// Solo lectura: no cambia nada del turno ni del cierre.
import { useEffect, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { printHtml } from '@/lib/printHtml'
import { reciboHtml, SELECTOR_RECIBO } from '@/features/invoices/reciboHtml'
import { useImpresoraStore } from '@/stores/impresora'
import { posApi, type VentasDia } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { formatoCentavos } from './montos'
import { Overlay } from './PosModales'
import { diaLargo, estadoDgii, horaDe } from './estados'

export function VentasDiaModal({ equipo, sesion, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const [datos, setDatos] = useState<VentasDia | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    posApi.ventasDia(equipo.token, sesion.token)
      .then((r) => { if (vivo) setDatos(r) })
      .catch((e) => { if (vivo && !errorDeSesion(e)) setError(e instanceof Error ? e.message : 'No se pudieron cargar las ventas del día.') })
    return () => { vivo = false }
  }, [equipo.token, sesion.token, errorDeSesion])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCerrar() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  const reimprimir = async (facturaId: number) => {
    setImprimiendo(facturaId)
    try {
      const { recibo } = await posApi.recibo(equipo.token, sesion.token, facturaId, ancho)
      await printHtml(reciboHtml(recibo), { anchoMm: recibo.papel.ancho_mm, selector: SELECTOR_RECIBO })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reimprimir.')
    } finally {
      window.focus()
      setImprimiendo(null)
    }
  }

  return (
    <Overlay ancho={640}>
      <div className="pos-modal-cab">
        <div>
          <small>{equipo.caja.nombre} · {sesion.empleado.nombre}</small>
          <b>Ventas del día</b>
          {datos && <div className="pos-sub" style={{ margin: '2px 0 0', fontSize: 13 }}>{diaLargo(datos.fecha)}</div>}
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>

      {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}

      {datos === null ? (
        !error && <div className="pos-grilla-vacia" style={{ padding: 24 }}><div className="spinner" /></div>
      ) : (
        <>
          <div className="pos-dia-resumen">
            <div className="pos-dia-total">
              <small>{datos.resumen.cantidad === 1 ? '1 venta' : `${datos.resumen.cantidad} ventas`}</small>
              <b>RD$ {formatoCentavos(datos.resumen.total_centavos)}</b>
            </div>
            {datos.resumen.por_forma.map((f) => (
              <div key={f.forma_pago} className="pos-dia-forma">
                <small>{f.nombre} · {f.cantidad}</small>
                <b>RD$ {formatoCentavos(f.total_centavos)}</b>
              </div>
            ))}
          </div>

          <div className="pos-ventas-turno">
            {datos.ventas.length === 0 ? (
              <p className="pos-sub" style={{ margin: 0, padding: '16px 0', textAlign: 'center' }}>Todavía no tienes ventas hoy en esta caja.</p>
            ) : datos.ventas.map((v) => (
              <div key={v.factura_id} className="pos-venta-fila">
                <div>
                  <b>{v.e_ncf}{v.tipo_ecf === '31' && <span className="pos-etiqueta-cf">Crédito fiscal</span>}</b>
                  {v.cliente && <small className="pos-venta-cliente">{v.cliente}</small>}
                  <small>{horaDe(v.fecha)} · {v.forma_pago_nombre} · {estadoDgii(v.estado_dgii)}</small>
                </div>
                <b className="pos-linea-importe">RD$ {formatoCentavos(v.total_centavos)}</b>
                <Btn size="sm" icon="printer" disabled={imprimiendo !== null} onClick={() => void reimprimir(v.factura_id)} aria-label={`Reimprimir ${v.e_ncf}`}>
                  {imprimiendo === v.factura_id ? '…' : 'Reimprimir'}
                </Btn>
              </div>
            ))}
          </div>
          <p className="pos-sub" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
            Tus ventas de hoy en {equipo.caja.nombre}, también las de turnos ya cerrados.
          </p>
        </>
      )}

      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Volver</Btn>
      </div>
    </Overlay>
  )
}
