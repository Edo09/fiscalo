// Apertura del turno con su fondo (K2) e impresora del equipo (P6).
import { useEffect, useState } from 'react'
import { Btn, Icon } from '@/components/ui'
import { printHtml } from '@/lib/printHtml'
import { ANCHOS_TIRILLA, useImpresoraStore } from '@/stores/impresora'
import type { AnchoTirilla } from '@/api/types'
import { posApi, PosApiError, type TurnoCaja } from './api'
import type { EquipoGuardado } from './store'
import type { Empleado } from './api'
import { formatoCentavos, montoACentavos } from './montos'
import { Overlay } from './PosModales'
import { TecladoMonto } from './TecladoMonto'

export function AperturaTurnoModal({ equipo, sesion, onAbierto, onCerrar, errorDeSesion }: {
  equipo: EquipoGuardado
  sesion: { token: string; empleado: Empleado }
  onAbierto: (t: TurnoCaja) => void
  onCerrar: () => void
  errorDeSesion: (e: unknown) => boolean
}) {
  const [fondo, setFondo] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const centavos = fondo === '' ? 0 : montoACentavos(fondo)

  const abrir = async () => {
    if (centavos === null || abriendo) return
    setAbriendo(true)
    setError(null)
    try {
      const r = await posApi.abrirTurno(equipo.token, sesion.token, centavos)
      onAbierto(r.turno_caja)
    } catch (e) {
      if (errorDeSesion(e)) return
      setError(e instanceof PosApiError ? e.message : 'No se pudo abrir el turno.')
      setAbriendo(false)
    }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); void abrir() } else if (e.key === 'Escape') { e.preventDefault(); onCerrar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>{equipo.caja.nombre}</small>
          <b>Abrir turno</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <p className="pos-sub" style={{ margin: '0 0 12px' }}>
        Cuenta el efectivo con que empieza la gaveta y escríbelo. Sin turno abierto no se puede cobrar.
      </p>
      {error && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>{error}</span></div>}
      <div className="pos-campo-monto" style={{ marginBottom: 12 }}>
        <small>Fondo inicial</small>
        <b className={fondo === '' ? 'vacio' : ''}>RD$ {fondo === '' ? '0.00' : fondo}</b>
      </div>
      <TecladoMonto valor={fondo} onCambio={setFondo} />
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" onClick={onCerrar}>Ahora no</Btn>
        <Btn variant="primary" className="pos-boton-grande" icon="check" disabled={centavos === null || abriendo} onClick={() => void abrir()}>
          {abriendo ? 'Abriendo…' : `Abrir con RD$ ${formatoCentavos(centavos ?? 0)}`}
        </Btn>
      </div>
    </Overlay>
  )
}

/**
 * Ancho imprimible de cada rollo, en mm (ReciboPos::MEDIDAS del backend): lo
 * que de verdad imprime el driver, no lo que mide el papel.
 */
const ANCHO_UTIL_MM: Record<AnchoTirilla, number> = { 80: 72, 76: 63.5, 72: 64 }

function paginaDePrueba(ancho: AnchoTirilla, caja: string): string {
  const fecha = new Date().toLocaleString('es-DO')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba</title><style>
  html, body { margin: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .recibo { padding: 2mm 1mm; font-size: 9pt; text-align: center; line-height: 1.35; }
  .t { font-size: 11pt; font-weight: bold; }
  .sep { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .regla { display: flex; justify-content: space-between; font-size: 8pt; }
  </style></head><body><div class="recibo">
  <div class="t">FiscalPoint POS</div><div>Prueba de impresión</div><hr class="sep">
  <div>Rollo de ${ancho} mm · ${caja}</div><div>${fecha}</div><hr class="sep">
  <div class="regla"><span>|&lt; izquierda</span><span>derecha &gt;|</span></div>
  <div style="margin-top:2mm">Si ves las dos marcas completas y el papel se corta poco después de esta línea, el ancho está bien.</div>
  </div></body></html>`
}

export function ImpresoraModal({ caja, onCerrar }: { caja: string; onCerrar: () => void }) {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const setAncho = useImpresoraStore((s) => s.setAnchoTirilla)
  const [estado, setEstado] = useState<'listo' | 'imprimiendo' | 'error'>('listo')

  const prueba = async () => {
    setEstado('imprimiendo')
    try {
      await printHtml(paginaDePrueba(ancho, caja), { anchoMm: ANCHO_UTIL_MM[ancho], selector: '.recibo' })
      setEstado('listo')
    } catch {
      setEstado('error')
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="pos-modal-cab">
        <div>
          <small>Este equipo</small>
          <b>Impresora de recibos</b>
        </div>
        <Btn variant="ghost" icon="x" onClick={onCerrar} aria-label="Cerrar" />
      </div>
      <p className="pos-sub" style={{ margin: '0 0 12px' }}>
        Ancho del rollo de la impresora térmica de esta caja. El recibo sale con el diálogo de impresión: deja la
        térmica como impresora predeterminada.
      </p>
      <div className="pos-formas" style={{ marginBottom: 16 }}>
        {ANCHOS_TIRILLA.map((a) => (
          <button key={a} type="button" className={'pos-forma' + (ancho === a ? ' on' : '')} onClick={() => setAncho(a)}>
            <span>{a} mm</span>
          </button>
        ))}
      </div>
      {estado === 'error' && <div className="pos-error"><Icon name="alert-circle" size={16} /><span>No se pudo abrir la impresión.</span></div>}
      <div className="pos-modal-pie">
        <Btn className="pos-boton-grande" icon="printer" disabled={estado === 'imprimiendo'} onClick={() => void prueba()}>Imprimir prueba</Btn>
        <Btn variant="primary" className="pos-boton-grande" onClick={onCerrar}>Listo</Btn>
      </div>
    </Overlay>
  )
}
