import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, Dropdown, MenuItem } from '@/components/ui'
import { ApiError } from '@/api'
import { presentDocument } from '@/lib/file'
import { imprimirGuardado, type DocumentoGuardado } from './imprimirGuardado'

/* FISCALO — Acciones de la barra de abajo de la cotización de Ferretería y del
   conduce: el flujo de la factura simple (SimpleInvoiceFormView), en hoja carta.

   - Guardado y sin tocar: lo útil es el documento real (Ver, Imprimir); guardar
     queda en gris porque no hay nada que guardar.
   - Nuevo o con cambios: ese PDF ya no refleja la pantalla, así que se ofrece
     la Vista previa de lo editado y "Guardar e imprimir" (con "Solo guardar"
     en el menú del mismo botón). Lo que se imprime sale del documento ya
     guardado, nunca de la pantalla.

   Devuelve los botones sueltos: van dentro del .fx-acciones de cada barra. */
export function AccionesEdicion({
  guardado, editando, onCancelar, vistaPrevia, onGuardar, guardando, bloqueado,
}: {
  /** Documento guardado y sin cambios: lo que abren Ver e Imprimir. null = nuevo o con cambios. */
  guardado: DocumentoGuardado | null
  editando: boolean
  onCancelar: () => void
  vistaPrevia: { onClick: () => void; busy: boolean; disabled?: boolean }
  /** true = guardar y mandar a imprimir lo guardado; false = solo guardar. */
  onGuardar: (imprimir: boolean) => void
  guardando: boolean
  /** Guardar no está disponible por otra razón (cargando, eliminando, modal abierto…). */
  bloqueado: boolean
}) {
  const [busy, setBusy] = useState<'ver' | 'imprimir' | null>(null)

  const ver = async (doc: DocumentoGuardado) => {
    setBusy('ver')
    try {
      presentDocument(await doc.pdf())
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : doc.textos.noAbre)
    } finally {
      setBusy(null)
    }
  }

  const imprimir = async (doc: DocumentoGuardado) => {
    setBusy('imprimir')
    await imprimirGuardado(doc, doc.textos.noImprime)
    setBusy(null)
  }

  if (guardado) {
    return (
      <>
        <Btn variant="secondary" icon="download" onClick={() => void ver(guardado)} disabled={busy != null}>
          {busy === 'ver' ? 'Abriendo…' : guardado.textos.ver}
        </Btn>
        <Btn variant="secondary" icon="printer" onClick={() => void imprimir(guardado)} disabled={busy != null}>
          {busy === 'imprimir' ? 'Imprimiendo…' : 'Imprimir'}
        </Btn>
        <span className="fx-motivo">No hay cambios que guardar.</span>
        <Btn variant="primary" icon="check" disabled title="No hay cambios que guardar.">Guardar cambios</Btn>
      </>
    )
  }

  const sinGuardar = guardando || bloqueado
  return (
    <>
      <Btn variant="ghost" onClick={onCancelar}>Cancelar</Btn>
      <Btn variant="secondary" icon="eye" onClick={vistaPrevia.onClick} disabled={vistaPrevia.busy || vistaPrevia.disabled}>
        {vistaPrevia.busy ? 'Generando…' : 'Vista previa'}
      </Btn>
      {/* Lo de todos los días (guardar e imprimir) va a un clic; solo guardar,
          en el menú del mismo botón. */}
      <div className="fx-split">
        <Btn variant="primary" icon="printer" onClick={() => onGuardar(true)} disabled={sinGuardar}>
          {guardando ? 'Guardando…' : 'Guardar e imprimir'}
        </Btn>
        {/* En gris va sin menú: un botón deshabilitado no lo abre en todos los
            navegadores. El div le da la misma profundidad que dentro del
            Dropdown: como hijo directo de .fx-split perdería las esquinas. */}
        {sinGuardar ? (
          <div><Btn variant="primary" icon="chevron-down" disabled aria-label="Otras formas de guardar" /></div>
        ) : (
          <Dropdown
            align="right"
            width={220}
            trigger={<Btn variant="primary" icon="chevron-down" aria-label="Otras formas de guardar" title="Otras formas de guardar" />}
          >
            <MenuItem icon="check" onClick={() => onGuardar(false)}>
              {editando ? 'Solo guardar los cambios' : 'Solo guardar'}
            </MenuItem>
          </Dropdown>
        )}
      </div>
    </>
  )
}
