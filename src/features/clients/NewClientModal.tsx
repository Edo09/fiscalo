import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Btn, Icon, Modal } from '@/components/ui'
import { ApiError, createClient, mapClientRow } from '@/api'
import type { ClientRow } from '@/api'
import type { Cliente } from '@/types/domain'

interface Props {
  onClose: () => void
  /** Se llama con el cliente ya creado (mapeado al dominio) tras guardar. */
  onCreated?: (cliente: Cliente, row: ClientRow) => void
  /** Prellena el nombre (p. ej. lo que el usuario ya había escrito al facturar). */
  nombreInicial?: string
}

type Campos = { client_name: string; company_name: string; email: string; phone_number: string; rnc: string; descuento: string; permitir_credito: boolean }

type CamposTexto = Exclude<keyof Campos, 'permitir_credito'>

const VACIO: Campos = { client_name: '', company_name: '', email: '', phone_number: '', rnc: '', descuento: '0', permitir_credito: false }

/**
 * Alta rápida de cliente (POST /api/clients).
 *
 * Se usa desde la página de Clientes y desde el editor de facturas, por eso
 * vive aquí y no dentro de una vista: el que lo abre decide qué hacer con el
 * cliente creado vía `onCreated`.
 *
 * El backend exige email válido, nombre, empresa y teléfono; el RNC es
 * opcional (pero es lo que de verdad importa para facturar, por eso va primero
 * entre los opcionales).
 */
export function NewClientModal({ onClose, onCreated, nombreInicial = '' }: Props) {
  const queryClient = useQueryClient()
  const [f, setF] = useState<Campos>({ ...VACIO, client_name: nombreInicial })
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({})
  const [guardando, setGuardando] = useState(false)

  const set = <K extends keyof Campos>(k: K, v: Campos[K]) => {
    setF((prev) => ({ ...prev, [k]: v }))
    if (errores[k]) setErrores((e) => ({ ...e, [k]: undefined }))
  }

  const validar = (): boolean => {
    const e: Partial<Record<keyof Campos, string>> = {}
    if (!f.client_name.trim()) e.client_name = 'Requerido'
    if (!f.company_name.trim()) e.company_name = 'Requerido'
    if (!f.email.trim()) e.email = 'Requerido'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Correo no válido'
    if (!f.phone_number.trim()) e.phone_number = 'Requerido'
    setErrores(e)
    return Object.keys(e).length === 0
  }

  const guardar = async () => {
    if (!validar() || guardando) return
    setGuardando(true)
    try {
      const row = await createClient({
        client_name: f.client_name.trim(),
        company_name: f.company_name.trim(),
        email: f.email.trim(),
        phone_number: f.phone_number.trim(),
        ...(f.rnc.trim() ? { rnc: f.rnc.trim() } : {}),
        // Condiciones comerciales: la factura las hereda al elegir este cliente.
        descuento: Number(f.descuento) || 0,
        permitir_credito: f.permitir_credito ? 1 : 0,
      })
      toast.success(`Cliente ${f.client_name.trim()} creado.`)
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      onCreated?.(mapClientRow(row), row)
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el cliente.')
    } finally {
      setGuardando(false)
    }
  }

  // Solo los campos de texto: el checkbox de credito se renderiza aparte.
  const campo = (k: CamposTexto, label: string, extra: Record<string, unknown> = {}, req = true) => (
    <div className={'field' + (errores[k] ? ' field-error' : '')}>
      <label>{label} {req ? <span className="req">*</span> : <span className="opt">(opcional)</span>}</label>
      <input
        className="input"
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void guardar() }}
        {...extra}
      />
      {errores[k] && <div className="err-msg"><Icon name="alert-circle" size={13} />{errores[k]}</div>}
    </div>
  )

  return (
    <Modal
      title="Nuevo cliente"
      sub="Se guarda en tu lista de clientes"
      icon="user-plus"
      onClose={onClose}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="check" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear cliente'}
          </Btn>
        </>
      }
    >
      <div className="form-grid">
        {campo('client_name', 'Nombre de contacto', { placeholder: 'Juan Pérez', autoFocus: true })}
        {campo('company_name', 'Empresa / razón social', { placeholder: 'Comercial XYZ SRL' })}
        {campo('rnc', 'RNC o cédula', { placeholder: '131000000', inputMode: 'numeric' }, false)}
        {campo('phone_number', 'Teléfono', { placeholder: '809-000-0000', type: 'tel' })}
        {campo('email', 'Correo', { placeholder: 'cliente@correo.com', type: 'email' })}
        {campo('descuento', 'Descuento por defecto (%)', { placeholder: '0', inputMode: 'decimal' }, false)}
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={f.permitir_credito}
              onChange={(e) => set('permitir_credito', e.target.checked)}
            />{' '}
            Permitir facturar a crédito
          </label>
        </div>
      </div>
    </Modal>
  )
}
