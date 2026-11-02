// Editar cliente (anexo 6.9): una hoja sobre el detalle. Manda SOLO lo que cambió (el PUT es parcial: lo que no viaja se conserva), así que un cliente de la app completa no pierde nada que aquí no
// se ve. Reglas: el RNC se puede cambiar pero no quitar (el servidor conserva el que tiene cuando llega vacío); un correo, teléfono o dirección vacíos los limpian; un dato viejo que ya no pasaría la
// validación (un RNC de 10 dígitos) no impide corregir otro campo, porque solo se juzga lo que cambió (lib/clientes `validarEdicionCliente`). «Condiciones comerciales» (descuento y crédito) vive
// plegada: es lo único que cambia cómo se le factura. Guardar es idempotente: si falla, el texto del servidor sale en un aviso y se puede volver a tocar.
// «Guardar» solo se habilita con cambios; cerrar con cambios pregunta «¿Descartar?».
import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errores'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { formDesdeFicha, hayCambiosCliente, payloadEdicionCliente, textoDeError, validarEdicionCliente } from '~/lib/clientes'
import type { FichaCliente, FormEdicionCliente } from '~/lib/clientes'
import { useEnLinea } from '~/net/enLinea'
import { claves, editarCliente } from '~/net/clientes'
import { Banner } from '~/ui/Banner'
import { BottomSheet } from '~/ui/BottomSheet'
import { Button } from '~/ui/Button'
import { ConfirmSheet } from '~/ui/ConfirmSheet'
import { Icon } from '~/ui/Icon'
import { NumericField, TextField } from '~/ui/TextField'
import { mostrarToast } from '~/ui/Toast'
import { Interruptor } from './Interruptor'
import './Clientes.css'

export function EditarCliente(p: { ficha: FichaCliente; foco?: 'rnc'; onCerrar(): void }): JSX.Element {
  const { ficha, foco, onCerrar } = p
  const cliente = useQueryClient()
  const enLinea = useEnLinea()
  const [f, setF] = useState<FormEdicionCliente>(() => formDesdeFicha(ficha))
  const [intento, setIntento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [condiciones, setCondiciones] = useState(false)
  const [descartar, setDescartar] = useState(false)
  const idRnc = useId()

  const errores = validarEdicionCliente(ficha, f)
  const hayErrores = Object.keys(errores).length > 0
  const cambios = hayCambiosCliente(ficha, f)
  const poner = <K extends keyof FormEdicionCliente>(campo: K, valor: FormEdicionCliente[K]): void => setF((a) => ({ ...a, [campo]: valor }))
  const ver = (campo: keyof FormEdicionCliente): string | undefined => (intento ? errores[campo] : undefined)

  // «Agregar RNC» abre la hoja con el cursor en el RNC.
  useEffect(() => {
    if (foco === 'rnc') document.getElementById(idRnc)?.focus()
  }, [foco, idRnc])

  // Tras un intento con errores el primer campo malo queda a la vista.
  useEffect(() => {
    if (intento && hayErrores) document.querySelector<HTMLElement>('.cliente-editar [aria-invalid="true"]')?.focus()
  }, [intento, hayErrores])

  const guardar = useAccionUnica(async () => {
    setIntento(true)
    if (hayErrores || !cambios) return
    setError(null)
    setGuardando(true)
    try {
      await editarCliente(payloadEdicionCliente(ficha, f))
      void cliente.invalidateQueries({ queryKey: claves.todos })
      mostrarToast('Cambios guardados', { tipo: 'ok' })
      onCerrar()
    } catch (e) {
      if (!(e instanceof ApiError)) console.error('[clientes] editar', e) // lo que no es del API no se le enseña a nadie, pero queda en la consola
      setError(textoDeError(e, 'No se pudieron guardar los cambios. Inténtalo de nuevo.'))
    } finally {
      setGuardando(false)
    }
  })

  /** Cerrar con algo cambiado pregunta antes: los cambios no se guardan. */
  const cerrar = (): void => (cambios ? setDescartar(true) : onCerrar())

  return (
    <>
      <BottomSheet
        abierto
        titulo="Editar cliente"
        onCerrar={cerrar}
        pie={
          <Button
            bloque
            cargando={guardando}
            disabled={!cambios || !enLinea}
            razon={!enLinea ? 'Sin conexión: no puedes guardar ahora.' : 'No hay cambios que guardar.'}
            onClick={() => void guardar()}
          >
            Guardar
          </Button>
        }
      >
        <div className="cliente-editar">
          <TextField
            etiqueta="Nombre o razón social *"
            valor={f.nombre}
            onCambio={(v) => poner('nombre', v)}
            autoCapitalize="words"
            autoComplete="off"
            enterkeyhint="next"
            error={ver('nombre')}
          />
          <NumericField
            id={idRnc}
            etiqueta="RNC o cédula"
            valor={f.rnc}
            onCambio={(v) => poner('rnc', v)}
            maxLength={11}
            autoComplete="off"
            enterkeyhint="next"
            ayuda="El RNC se puede cambiar, no quitar."
            error={ver('rnc')}
          />
          <TextField etiqueta="Teléfono" valor={f.telefono} onCambio={(v) => poner('telefono', v)} tipo="tel" modoInput="tel" autoComplete="tel" enterkeyhint="next" error={ver('telefono')} />
          <TextField
            etiqueta="Correo"
            valor={f.correo}
            onCambio={(v) => poner('correo', v)}
            tipo="email"
            modoInput="email"
            autoComplete="email"
            autoCapitalize="none"
            enterkeyhint="next"
            error={ver('correo')}
          />
          <TextField etiqueta="Dirección" valor={f.direccion} onCambio={(v) => poner('direccion', v)} autoComplete="street-address" enterkeyhint="done" error={ver('direccion')} />
          <button type="button" className="plegable" aria-expanded={condiciones} onClick={() => setCondiciones((a) => !a)}>
            <Icon name={condiciones ? 'chevron-down' : 'chevron-right'} />
            Condiciones comerciales
          </button>
          {condiciones && (
            <div className="plegable__cuerpo">
              <NumericField etiqueta="Descuento (%)" decimales={2} valor={f.descuento} onCambio={(v) => poner('descuento', v)} autoComplete="off" enterkeyhint="done" error={ver('descuento')} />
              <Interruptor etiqueta="Permitir crédito" ayuda="Si lo apagas, solo se le factura de contado." activo={f.permiteCredito} onCambio={(v) => poner('permiteCredito', v)} />
            </div>
          )}
          {error !== null && <Banner tono="danger">{error}</Banner>}
        </div>
      </BottomSheet>
      <ConfirmSheet
        abierto={descartar}
        pregunta="¿Descartar los cambios?"
        consecuencia="Lo que cambiaste en este cliente no se guarda."
        etiquetaAccion="Descartar"
        peligro
        onConfirmar={onCerrar}
        onCancelar={() => setDescartar(false)}
      />
    </>
  )
}
