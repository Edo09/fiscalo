// Cobro de la venta (api-gratex docs/specs/pos.md P1-P4, F5, F6): forma de
// pago, efectivo con devuelta, emisión e impresión del recibo.
//
// La clave de idempotencia nace al pulsar Cobrar y se guarda en el carrito
// ANTES de mandar la petición. Si no llega respuesta (red caída), el carrito
// queda congelado con esa clave y el único camino es reintentar: el servidor
// devuelve la venta que ya hubiera emitido, nunca otra.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { printHtml } from '@/lib/printHtml'
import { reciboHtml, SELECTOR_RECIBO } from '@/features/invoices/reciboHtml'
import { useImpresoraStore } from '@/stores/impresora'
import { posApi, PosApiError, type FormaPago, type VentaCuerpo, type VentaRespuesta } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { nuevaClave, useCarritoStore } from './carrito'
import { centavosATexto, formatoCentavos, importeLinea, montoACentavos } from './montos'
import { Overlay } from './PosModales'
import { TecladoMonto } from './TecladoMonto'

/** Códigos con los que el servidor NO emitió nada: se puede corregir y cobrar con otra clave. */
const SIN_VENTA = new Set([
  'CLAVE_INVALIDA', 'VENTA_VACIA', 'LINEA_INVALIDA', 'PRODUCTO_NO_DISPONIBLE', 'CANTIDAD_INVALIDA', 'PRECIO_CERO',
  'TOTAL_DISTINTO', 'COMPRADOR_REQUERIDO', 'FORMA_PAGO_INVALIDA', 'RECIBIDO_INSUFICIENTE', 'TURNO_REQUERIDO',
  'TURNO_AJENO', 'EQUIPO_SIN_RESPONSABLE', 'DESCUADRE', 'EMISION_FALLIDA', 'DGII_RECHAZO', 'CUERPO_INVALIDO',
  'CAJA_INACTIVA', 'POS_INACTIVO', 'SESION_REQUERIDA', 'EQUIPO_NO_HABILITADO',
])
/** Errores del catálogo: hay que refrescarlo para que el carrito tome los precios nuevos. */
const REFRESCAR_CATALOGO = new Set(['TOTAL_DISTINTO', 'PRODUCTO_NO_DISPONIBLE', 'PRECIO_CERO'])

const FORMAS: { forma: FormaPago; nombre: string; tecla: string; icono: 'banknote' | 'wallet' | 'landmark' }[] = [
  { forma: 1, nombre: 'Efectivo', tecla: 'F9', icono: 'banknote' },
  { forma: 3, nombre: 'Tarjeta', tecla: 'F2', icono: 'wallet' },
  { forma: 2, nombre: 'Transferencia', tecla: 'F3', icono: 'landmark' },
]
/**
 * Billetes de atajo para el efectivo recibido (en pesos). Se SUMAN: el cliente
 * paga 2,342.30 con 2,000 + 500 → se tocan los dos. Antes cada botón ponía un
 * solo billete y, si no alcanzaba, quedaba desactivado: con un total mayor de
 * 2,000 no servía ninguno.
 */
const BILLETES = [2000, 1000, 500, 200, 100, 50]

type Fase =
  | { tipo: 'eligiendo' }
  | { tipo: 'enviando' }
  | { tipo: 'hecha'; r: VentaRespuesta; impresion: 'imprimiendo' | 'ok' | 'error' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'duda'; mensaje: string }

interface Props {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  formaInicial: FormaPago
  onCerrar: () => void
  /** La venta terminó: carrito nuevo. */
  onNuevaVenta: () => void
  /** Errores que cambian de pantalla (sesión, equipo); true si ya se atendió. */
  errorDeSesion: (e: unknown) => boolean
  onRefrescarCatalogo: () => void
  onRefrescarEstado: () => void
}

export function CobroModal({
  equipo, sesion, formaInicial, onCerrar, onNuevaVenta, errorDeSesion, onRefrescarCatalogo, onRefrescarEstado,
}: Props) {
  const lineas = useCarritoStore((s) => s.lineas)
  const enDuda = useCarritoStore((s) => s.cobroEnDuda)
  const marcarCobroEnDuda = useCarritoStore((s) => s.marcarCobroEnDuda)
  const ancho = useImpresoraStore((s) => s.anchoTirilla)

  const total = lineas.reduce((t, l) => t + importeLinea(l.precioCentavos, l.cantidad), 0)
  const [forma, setForma] = useState<FormaPago>(enDuda?.forma_pago ?? formaInicial)
  const [recibido, setRecibido] = useState('')
  const [fase, setFase] = useState<Fase>(() => (enDuda
    ? { tipo: 'duda', mensaje: 'El último cobro no se confirmó. Reinténtalo: si ya se había emitido, se recupera esa misma venta.' }
    : { tipo: 'eligiendo' }))
  const enviandoRef = useRef(false)
  const nuevaVentaRef = useRef<HTMLButtonElement>(null)

  // Vacío = exacto. Si no alcanza, no se cobra.
  const recibidoCentavos = forma === 1 ? (recibido === '' ? total : montoACentavos(recibido)) : null
  const alcanza = forma !== 1 || (recibidoCentavos !== null && recibidoCentavos >= total)
  const devuelta = forma === 1 && recibidoCentavos !== null ? recibidoCentavos - total : null

  const imprimir = useCallback(async (r: VentaRespuesta) => {
    setFase({ tipo: 'hecha', r, impresion: 'imprimiendo' })
    try {
      const recibo = r.recibo ?? (await posApi.recibo(equipo.token, sesion.token, r.venta.factura_id, ancho)).recibo
      await printHtml(reciboHtml(recibo), { anchoMm: recibo.papel.ancho_mm, selector: SELECTOR_RECIBO })
      setFase({ tipo: 'hecha', r, impresion: 'ok' })
    } catch {
      setFase({ tipo: 'hecha', r, impresion: 'error' })
    }
  }, [equipo.token, sesion.token, ancho])

  // Al imprimir, el foco queda dentro del iframe del recibo y las teclas (Enter
  // = Nueva venta) ya no llegan a esta ventana: se devuelve aquí.
  const listaParaSeguir = fase.tipo === 'hecha' && fase.impresion !== 'imprimiendo'
  useEffect(() => {
    if (!listaParaSeguir) return
    window.focus()
    nuevaVentaRef.current?.focus()
  }, [listaParaSeguir])

  const cobrar = useCallback(async () => {
    if (enviandoRef.current) return
    const estado = useCarritoStore.getState()
    // Reintento: el MISMO cuerpo (misma clave) que quedó en duda.
    const cuerpo: VentaCuerpo = estado.cobroEnDuda ?? {
      clave: nuevaClave(),
      lineas: estado.lineas.map((l) => ({ product_id: l.productoId, cantidad: l.cantidad })),
      total_centavos: total,
      forma_pago: forma,
      recibido_centavos: forma === 1 ? recibidoCentavos : null,
      ancho,
      iniciada_ms: estado.iniciadaMs,
    }
    if (!estado.cobroEnDuda && (cuerpo.lineas.length === 0 || !alcanza)) return
    enviandoRef.current = true
    // Antes de mandar: si la respuesta no llega, el carrito ya está congelado.
    marcarCobroEnDuda(cuerpo)
    setFase({ tipo: 'enviando' })
    try {
      const r = await posApi.vender(equipo.token, sesion.token, cuerpo)
      marcarCobroEnDuda(null)
      void imprimir(r)
    } catch (e) {
      const codigo = e instanceof PosApiError ? e.codigo : 'ERROR'
      const mensaje = e instanceof Error ? e.message : 'No se pudo cobrar.'
      if (SIN_VENTA.has(codigo)) {
        marcarCobroEnDuda(null)
        if (errorDeSesion(e)) return
        if (REFRESCAR_CATALOGO.has(codigo)) onRefrescarCatalogo()
        if (codigo.startsWith('TURNO_')) onRefrescarEstado()
        setFase({ tipo: 'error', mensaje })
      } else if (codigo === 'GUARDADO_FALLIDO') {
        // La DGII la recibió pero no quedó en el sistema: no se reintenta (saldría
        // otro e-NCF). El texto del servidor dice qué hacer.
        marcarCobroEnDuda(null)
        setFase({ tipo: 'error', mensaje })
      } else {
        // Sin respuesta, o una que no dice si se emitió: se queda en duda.
        setFase({
          tipo: 'duda',
          mensaje: codigo === 'VENTA_EN_PROCESO'
            ? 'La venta todavía se está procesando. Espera unos segundos y reintenta.'
            : `No se pudo confirmar si la venta se emitió (${mensaje.replace(/\.$/, '')}). Reintenta: no se duplica.`,
        })
      }
    } finally {
      enviandoRef.current = false
    }
  }, [total, forma, recibidoCentavos, ancho, alcanza, marcarCobroEnDuda, equipo.token, sesion.token, imprimir,
    errorDeSesion, onRefrescarCatalogo, onRefrescarEstado])

  // Teclado: Enter confirma lo que toque; F9/F2/F3 cambian la forma; Esc cierra si se puede.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (fase.tipo === 'eligiendo' || fase.tipo === 'duda') void cobrar()
        else if (fase.tipo === 'hecha') onNuevaVenta()
        else if (fase.tipo === 'error') setFase({ tipo: 'eligiendo' })
      } else if (fase.tipo === 'eligiendo' && (e.key === 'F9' || e.key === 'F2' || e.key === 'F3')) {
        e.preventDefault()
        setForma(e.key === 'F9' ? 1 : e.key === 'F2' ? 3 : 2)
      } else if (e.key === 'Escape' && (fase.tipo === 'eligiendo' || fase.tipo === 'error')) {
        e.preventDefault()
        onCerrar()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fase, cobrar, onNuevaVenta, onCerrar])

  const sePuedeCerrar = fase.tipo === 'eligiendo' || fase.tipo === 'error'

  return (
    <Overlay onCerrar={() => { if (sePuedeCerrar) onCerrar() }} ancho={fase.tipo === 'eligiendo' && forma === 1 ? 640 : 460}>
      {fase.tipo === 'eligiendo' && (
        <>
          <div className="pos-modal-cab">
            <div>
              <small>Cobrar</small>
              <b className="pos-cobro-total">RD$ {formatoCentavos(total)}</b>
            </div>
            <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
          </div>
          <div className="pos-formas">
            {FORMAS.map((f) => (
              <button key={f.forma} type="button" className={'pos-forma' + (forma === f.forma ? ' on' : '')} onClick={() => setForma(f.forma)}>
                <Icon name={f.icono} size={22} />
                <span>{f.nombre}</span>
                <small>{f.tecla}</small>
              </button>
            ))}
          </div>
          {forma === 1 ? (
            <div className="pos-efectivo">
              <div>
                <div className="pos-campo-monto">
                  <small>Recibido</small>
                  <b className={recibido === '' ? 'vacio' : ''}>{recibido === '' ? 'Exacto' : `RD$ ${recibido}`}</b>
                </div>
                <div className="pos-billetes">
                  {BILLETES.map((b) => (
                    <button key={b} type="button" className="pos-billete" aria-label={`Sumar un billete de ${b}`}
                      onClick={() => setRecibido((r) => centavosATexto((r === '' ? 0 : montoACentavos(r) ?? 0) + b * 100))}>
                      +{b.toLocaleString('es-DO')}
                    </button>
                  ))}
                  {/* Exacto también sirve para empezar de nuevo: el próximo billete suma desde cero. */}
                  <button type="button" className={'pos-billete' + (recibido === '' ? ' on' : '')} style={{ gridColumn: '1 / -1' }}
                    onClick={() => setRecibido('')}>Exacto</button>
                </div>
                {/* Verde = pago exacto; amarillo = hay que dar devuelta; rojo = falta. */}
                <div className={'pos-devuelta' + (!alcanza ? ' falta' : (devuelta ?? 0) > 0 ? ' cambio' : '')}>
                  <small>{!alcanza ? 'Falta' : (devuelta ?? 0) > 0 ? 'Devuelta' : 'Pago exacto'}</small>
                  <b>RD$ {formatoCentavos(Math.abs(devuelta ?? 0))}</b>
                </div>
              </div>
              <TecladoMonto onCambio={setRecibido} />
            </div>
          ) : (
            <p className="pos-sub" style={{ margin: '4px 0 0' }}>
              Cobra RD$ {formatoCentavos(total)} con {forma === 3 ? 'la tarjeta en el datáfono' : 'la transferencia o el depósito'} y confirma
              cuando el pago esté aprobado.
            </p>
          )}
          <div className="pos-modal-pie">
            <Btn className="pos-boton-grande" onClick={onCerrar}>Volver</Btn>
            <Btn variant="primary" className="pos-boton-grande" icon="check" disabled={!alcanza || lineas.length === 0} onClick={() => void cobrar()}>
              Cobrar RD$ {formatoCentavos(total)}
            </Btn>
          </div>
        </>
      )}

      {fase.tipo === 'enviando' && (
        <div className="pos-cobro-estado">
          <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
          <b>Emitiendo el comprobante…</b>
          <p className="pos-sub">No cierres esta pantalla.</p>
        </div>
      )}

      {fase.tipo === 'hecha' && (
        <div className="pos-cobro-estado">
          <span className="pos-cobro-ok"><Icon name="check" size={30} /></span>
          <b>Venta cobrada</b>
          <p className="pos-sub" style={{ margin: 0 }}>Factura de consumo {fase.r.venta.e_ncf}</p>
          {fase.r.cobro.devuelta_centavos !== null ? (
            <div className={'pos-devuelta grande' + (fase.r.cobro.devuelta_centavos > 0 ? ' cambio' : '')}>
              <small>{fase.r.cobro.devuelta_centavos > 0 ? 'Devuelta' : 'Pago exacto'}</small>
              <b>RD$ {formatoCentavos(fase.r.cobro.devuelta_centavos)}</b>
            </div>
          ) : (
            <div className="pos-devuelta grande"><small>{fase.r.cobro.forma_pago_nombre}</small><b>RD$ {formatoCentavos(fase.r.cobro.total_centavos)}</b></div>
          )}
          {fase.r.repetida && (
            <div className="pos-info" style={{ margin: 0 }}><Icon name="info" size={16} /><span>Esta venta ya se había emitido: es la misma, no se emitió otra.</span></div>
          )}
          {fase.r.venta.envio_pendiente && (
            <div className="pos-aviso" style={{ margin: 0 }}>
              <Icon name="clock" size={16} />
              <span>La DGII no respondió a tiempo. La venta quedó registrada y se reenviará sola.</span>
            </div>
          )}
          {fase.impresion === 'error' && (
            <div className="pos-error" style={{ margin: 0 }}><Icon name="printer" size={16} /><span>No se pudo imprimir el recibo. Revisa la impresora y reimprime.</span></div>
          )}
          <div className="pos-modal-pie" style={{ width: '100%' }}>
            <Btn className="pos-boton-grande" icon="printer" disabled={fase.impresion === 'imprimiendo'} onClick={() => void imprimir(fase.r)}>
              {fase.impresion === 'imprimiendo' ? 'Imprimiendo…' : 'Reimprimir'}
            </Btn>
            {/* Botón nativo (Btn no reenvía ref): recibe el foco al terminar de imprimir. */}
            <button ref={nuevaVentaRef} type="button" className="btn btn-primary pos-boton-grande" onClick={onNuevaVenta}>
              <Icon name="plus" />Nueva venta
            </button>
          </div>
        </div>
      )}

      {fase.tipo === 'error' && (
        <div className="pos-cobro-estado">
          <span className="pos-cobro-mal"><Icon name="alert-circle" size={30} /></span>
          <b>No se cobró</b>
          <p className="pos-sub" style={{ margin: 0 }}>{fase.mensaje}</p>
          <div className="pos-modal-pie" style={{ width: '100%' }}>
            <Btn className="pos-boton-grande" onClick={onCerrar}>Volver a la venta</Btn>
            <Btn variant="primary" className="pos-boton-grande" onClick={() => setFase({ tipo: 'eligiendo' })}>Intentar de nuevo</Btn>
          </div>
        </div>
      )}

      {fase.tipo === 'duda' && (
        <div className="pos-cobro-estado">
          <span className="pos-cobro-duda"><Icon name="wifi-off" size={30} /></span>
          <b>Cobro sin confirmar</b>
          <p className="pos-sub" style={{ margin: 0 }}>{fase.mensaje}</p>
          <p className="pos-sub" style={{ margin: 0, fontSize: 13 }}>
            Mientras tanto la venta no se puede cambiar. Si sigue sin conexión, usa el procedimiento de contingencia.
          </p>
          <div className="pos-modal-pie" style={{ width: '100%' }}>
            <Btn className="pos-boton-grande" onClick={onCerrar}>Cerrar</Btn>
            <Btn variant="primary" className="pos-boton-grande" icon="refresh-cw" onClick={() => void cobrar()}>Reintentar</Btn>
          </div>
        </div>
      )}
    </Overlay>
  )
}
