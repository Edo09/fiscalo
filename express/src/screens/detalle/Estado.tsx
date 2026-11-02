// Lo que dice el detalle de en qué quedó la factura (anexo 6.3): el encabezado (estado, total, cliente, RNC y fecha), la tarjeta que explica lo que la DGII no ha dado por bueno y la línea de tiempo. Nada de
// lo que se puede entregar al comprador sale de aquí: lo que la DGII no aceptó dice «no la emitas de nuevo» y «no la entregues todavía» (el número todavía podría volver al contador). Los motivos de un
// rechazo son de la DGII y se muestran tal cual, uno por línea.
import { lineasVinculo } from '@/features/invoices/notasVinculadas'
import { TEXTO_NO_ENCONTRADO, TITULO_NO_ENCONTRADO } from '@/features/invoices/reenvio'
import { formatoRnc } from '@/pos/montos'
import type { AvisoDeEstado } from '~/lib/acciones'
import { rd } from '~/lib/dinero'
import { fmtFechaISO } from '~/lib/fechas'
import type { FacturaVista } from '~/lib/filas'
import type { PasoTiempo } from '~/lib/lineaTiempo'
import { extraerMotivos } from '~/lib/motivos'
import { Banner } from '~/ui/Banner'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { StatusChip } from '~/ui/StatusChip'
import './Estado.css'

/** El RNC como se lee (`401-12345-6`); null si la factura no lo trae (una E32 sin cliente, o una fila de listado). */
function rncLegible(rnc: string | null): string | null {
  if (rnc === null) return null
  const digitos = rnc.replace(/\D/g, '')
  return digitos === '' ? rnc : formatoRnc(digitos)
}

export function Encabezado(p: { f: FacturaVista; anuladaPor: string | null }): JSX.Element {
  const { f, anuladaPor } = p
  const rnc = rncLegible(f.rnc)
  const datos = [rnc === null ? null : `RNC ${rnc}`, fmtFechaISO(f.fecha)].filter((d): d is string => d !== null && d !== '').join(' · ')
  // «Anulada por ...» va aparte, en su tono; las demás líneas de vínculo (el comprobante que modifica una nota, las notas que la tocan) salen tal cual.
  const vinculos = lineasVinculo(f).filter((v) => v.tono !== 'danger' || anuladaPor === null)
  return (
    <section className="encabezado" aria-label="Resumen de la factura">
      <div className="encabezado__fila">
        <StatusChip estado={f.estado} tipoEcf={f.tipo} />
        <p className="encabezado__total tabular">{rd(f.totalConSigno)}</p>
      </div>
      <p className="encabezado__cliente">{f.cliente}</p>
      {f.tipo === '34' && <p className="encabezado__etiqueta">Nota de crédito</p>}
      {datos !== '' && <p className="encabezado__datos">{datos}</p>}
      {anuladaPor !== null && <p className="encabezado__vinculo encabezado__vinculo--danger">{anuladaPor === '' ? 'Anulada' : `Anulada por ${anuladaPor}`}</p>}
      {vinculos.map((v) => (
        <p key={v.texto} className={`encabezado__vinculo encabezado__vinculo--${v.tono}`}>
          {v.texto}
        </p>
      ))}
    </section>
  )
}

/** La tarjeta de lo que la DGII no ha dado por bueno: sin confirmar, rechazada (con sus motivos) o no encontrada. Sin aviso no hay tarjeta. */
export function TarjetaDeEstado(p: { aviso: AvisoDeEstado | null; f: FacturaVista }): JSX.Element | null {
  const { aviso, f } = p
  if (aviso === null) return null
  if (aviso === 'sinConfirmar') {
    return (
      <Banner tono="warning">
        <p className="aviso__linea">La DGII no ha confirmado.</p>
        <p className="aviso__linea">No la emitas de nuevo.</p>
        <p className="aviso__linea">No la entregues todavía.</p>
      </Banner>
    )
  }
  if (aviso === 'noEncontrada') {
    return (
      <Banner tono="info" titulo={TITULO_NO_ENCONTRADO}>
        {TEXTO_NO_ENCONTRADO}
      </Banner>
    )
  }
  const motivos = extraerMotivos(f.respuestaDgii)
  return (
    <Banner tono="danger" titulo="La DGII rechazó este comprobante">
      {motivos.length > 0 && (
        <ul className="aviso__motivos">
          {motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </Banner>
  )
}

const ICONO_DEL_PASO: Record<PasoTiempo['estado'], IconName> = { hecho: 'circle-check', pendiente: 'clock', alerta: 'triangle-alert' }

/** Los tres pasos: Guardada, Enviada a la DGII y la respuesta, cada uno con su icono, su texto y su hora (el color nunca va solo). */
export function LineaDeTiempo(p: { pasos: PasoTiempo[] }): JSX.Element {
  return (
    <ol className="tiempo" aria-label="Historia de la factura">
      {p.pasos.map((paso) => (
        <li key={paso.clave} className={`tiempo__paso tiempo__paso--${paso.estado}`}>
          <Icon name={ICONO_DEL_PASO[paso.estado]} size={20} />
          <span className="tiempo__texto">{paso.texto}</span>
          {paso.hora !== null && <span className="tiempo__hora tabular">{paso.hora}</span>}
        </li>
      ))}
    </ol>
  )
}
