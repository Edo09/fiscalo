// Los botones del detalle de una factura (anexo 6.3): la acción principal (52 px, ancha, anclada abajo al alcance del pulgar), la secundaria y «Más», que abre una hoja con el resto. Qué se ofrece lo decide
// `accionesDe` (lib/acciones) según el estado de la factura; qué hace cada una, el registro (./acciones-registro): una acción sin manejador, o «Avisar a soporte» mientras no haya número de soporte, no se dibuja
// (si la principal se va, la secundaria sube: nunca hay secundaria sin principal). Cada toque corre por `useAccionUnica` (no se dispara dos veces) y un manejador que falla dice su texto en un aviso.
// Sin conexión, lo que necesita la red (Verificar, Reenviar) no corre y dice por qué.
import { useState } from 'react'
import { ApiError } from '@/api/errores'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { SOPORTE_WHATSAPP } from '~/config'
import type { AccionId, Acciones as AccionesDe } from '~/lib/acciones'
import type { FacturaVista } from '~/lib/filas'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { Icon } from '~/ui/Icon'
import type { IconName } from '~/ui/Icon'
import { StickyActionBar } from '~/ui/StickyActionBar'
import { mostrarToast } from '~/ui/Toast'
import { manejadorDe } from './acciones-registro'
import { puedeCompartirArchivos } from './pdf'
import type { EstadoPdf } from './pdf'
import './Acciones.css'

/** El rótulo de cada acción (anexo 6.3). `compartir` cambia según lo que el aparato puede hacer: ver `rotuloDe`. */
const ROTULOS: Record<AccionId, string> = {
  compartir: 'Compartir factura (PDF)',
  verificar: 'Verificar estado',
  soporte: 'Avisar a soporte',
  duplicar: 'Duplicar',
  anular: 'Anular',
  abrirPdf: 'Abrir o descargar PDF',
  copiarNcf: 'Copiar e-NCF',
  reenviar: 'Reenviar mismo número',
  corregir: 'Corregir y emitir de nuevo',
  reintentarAnulacion: 'Reintentar anulación',
  verOriginal: 'Ver factura original',
  buscarReemplazo: 'Buscar en Facturas',
}

const ICONOS: Partial<Record<AccionId, IconName>> = {
  compartir: 'share-2',
  verificar: 'refresh-cw',
  soporte: 'message-circle',
  abrirPdf: 'file-text',
  copiarNcf: 'copy',
  reenviar: 'rotate-ccw',
  buscarReemplazo: 'search',
}

/** Lo que necesita la red para correr: sin conexión no se ofrecen como botón activo. */
const NECESITAN_RED: ReadonlySet<AccionId> = new Set<AccionId>(['verificar', 'reenviar'])

/**
 * El rótulo: «Compartir factura (PDF)» solo si el toque va a abrir la hoja de compartir (el aparato comparte archivos y el PDF está listo o llegando); con un aparato que no los comparte, o sin el PDF
 * (fallo o ahorro de datos), el toque descarga el archivo y el botón lo dice: «Descargar PDF».
 */
function rotuloDe(id: AccionId, pdf: EstadoPdf): string {
  if (id !== 'compartir') return ROTULOS[id]
  return puedeCompartirArchivos() && (pdf === 'listo' || pdf === 'cargando') ? ROTULOS.compartir : 'Descargar PDF'
}

const textoDelError = (e: unknown): string => {
  if (e instanceof ApiError) return e.message
  console.error('[acción]', e)
  return 'No se pudo completar la acción. Inténtalo de nuevo.'
}

/** ¿Se dibuja esta acción? Con manejador registrado y, la de soporte, con número de soporte. */
const sePuedeOfrecer = (id: AccionId): boolean => manejadorDe(id) !== undefined && !(id === 'soporte' && SOPORTE_WHATSAPP === '')

export function Acciones(p: { f: FacturaVista; acciones: AccionesDe; pdf: EstadoPdf; verificando: boolean; sinConexion: boolean }): JSX.Element | null {
  const { f, acciones, pdf, verificando, sinConexion } = p
  const [masAbierto, setMasAbierto] = useState(false)
  const [enCurso, setEnCurso] = useState<AccionId | null>(null)

  const ejecutar = useAccionUnica(async (id: AccionId) => {
    const manejador = manejadorDe(id)
    if (manejador === undefined) return
    setEnCurso(id)
    try {
      await manejador(f)
    } catch (e) {
      mostrarToast(textoDelError(e), { tipo: 'error' })
    } finally {
      setEnCurso(null)
    }
  })

  const principales = [acciones.primaria, acciones.secundaria].filter((id): id is AccionId => id !== null && sePuedeOfrecer(id))
  const primaria = principales[0] ?? null
  const secundaria = principales[1] ?? null
  const mas = acciones.mas.filter(sePuedeOfrecer)
  if (primaria === null && mas.length === 0) return null

  /** Un botón de acción. `razon` solo en la principal: debajo de ella cabe, y en la fila de la secundaria no. */
  const boton = (id: AccionId, variante: 'primario' | 'secundario', conRazon: boolean): JSX.Element => {
    const sinRed = sinConexion && NECESITAN_RED.has(id)
    const cargando = enCurso === id || (id === 'verificar' && verificando) || (id === 'compartir' && pdf === 'cargando')
    return (
      <Button
        variante={variante}
        icono={ICONOS[id]}
        bloque={variante === 'primario'}
        cargando={cargando}
        disabled={conRazon && sinRed}
        razon={conRazon && sinRed ? 'Sin conexión.' : undefined}
        onClick={() => void ejecutar(id)}
      >
        {rotuloDe(id, pdf)}
      </Button>
    )
  }

  return (
    <>
      <StickyActionBar>
        {primaria !== null && boton(primaria, 'primario', true)}
        {(secundaria !== null || mas.length > 0) && (
          <div className="acciones__fila">
            {secundaria !== null && boton(secundaria, 'secundario', false)}
            {mas.length > 0 && (
              <Button variante="secundario" icono="ellipsis" onClick={() => setMasAbierto(true)}>
                Más
              </Button>
            )}
          </div>
        )}
      </StickyActionBar>
      <BottomSheet abierto={masAbierto} onCerrar={() => setMasAbierto(false)} titulo="Más acciones" cerrarConFondo>
        <ul className="mas">
          {mas.map((id) => (
            <li key={id}>
              <button
                type="button"
                className="mas__fila"
                onClick={() => {
                  setMasAbierto(false)
                  void ejecutar(id)
                }}
              >
                {ICONOS[id] !== undefined && <Icon name={ICONOS[id] as IconName} />}
                <span>{rotuloDe(id, pdf)}</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  )
}
