import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Btn, Icon, Modal } from '@/components/ui'
import { ApiError, CODIGO_CLIENTE_SIN_ELEGIR, createClient, listClients, mapClientRow } from '@/api'
import type { ConsultaRnc, NewClientInput } from '@/api'
import { RncConsultaField } from '@/components/RncConsultaField'
import type { Cliente } from '@/types/domain'
import {
  LARGO, errorCorreo, errorDescuento, errorRnc, errorTelefono, errorTexto, soloDigitos,
} from './validacion'

interface Props {
  onClose: () => void
  /**
   * Se llama con el cliente ya creado (mapeado al dominio) tras guardar. Solo
   * con un cliente de verdad (con id): si el alta se hizo pero no se pudo
   * identificar el recién creado, no se llama y el modal lo dice.
   */
  onCreated?: (cliente: Cliente) => void
  /**
   * Lo que el usuario ya había escrito al facturar. Va al campo que corresponde:
   * un RNC o cédula al RNC, un correo al correo y cualquier otra cosa al nombre.
   */
  nombreInicial?: string
}

type Campos = { client_name: string; company_name: string; email: string; phone_number: string; rnc: string; descuento: string; permitir_credito: boolean }

type CamposTexto = Exclude<keyof Campos, 'permitir_credito'>

const VACIO: Campos = { client_name: '', company_name: '', email: '', phone_number: '', rnc: '', descuento: '0', permitir_credito: false }

/**
 * Campos iniciales a partir de lo buscado. El buscador acepta nombre, RNC o
 * correo, así que copiar siempre al nombre dejaba "40212345678" como nombre del
 * contacto. Un RNC (9 dígitos) o cédula (11), con o sin guiones, va al RNC.
 */
function camposIniciales(texto: string): Campos {
  const t = texto.trim()
  const digitos = t.replace(/-/g, '')
  if (/^\d+$/.test(digitos) && (digitos.length === 9 || digitos.length === 11)) return { ...VACIO, rnc: digitos }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { ...VACIO, email: t }
  return { ...VACIO, client_name: t }
}

/** Cliente propio con este RNC, para avisar antes de crear otro (no bloquea). */
async function clienteConRnc(rnc: string): Promise<string | null> {
  const res = await listClients({ query: rnc, pageSize: 5 })
  const igual = res.items.find((c) => (c.rnc ?? '').replace(/\D/g, '') === rnc)
  return igual ? (igual.company_name || igual.client_name || `Cliente #${igual.id}`) : null
}

/**
 * Alta rápida de cliente (POST /api/clients).
 *
 * Se usa desde la página de Clientes y desde el editor de facturas, por eso
 * vive aquí y no dentro de una vista: el que lo abre decide qué hacer con el
 * cliente creado vía `onCreated`.
 *
 * El RNC va primero: "Consultar" trae los datos de la DGII, así que el alta
 * puede quedar en escribir el RNC y guardar. El backend solo exige nombre y
 * empresa; RNC, teléfono y correo son opcionales (el correo, si se escribe,
 * tiene que ser válido).
 */
export function NewClientModal({ onClose, onCreated, nombreInicial = '' }: Props) {
  const queryClient = useQueryClient()
  const [f, setF] = useState<Campos>(() => camposIniciales(nombreInicial))
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({})
  const [guardando, setGuardando] = useState(false)

  const set = <K extends keyof Campos>(k: K, v: Campos[K]) => {
    setF((prev) => ({ ...prev, [k]: v }))
    if (errores[k]) setErrores((e) => ({ ...e, [k]: undefined }))
  }

  /**
   * Las mismas reglas que el backend, con el largo de cada columna: una razón
   * social larga traída de la DGII, un teléfono con extensión o un RNC con un
   * dígito de más fallaban al guardar con un texto en inglés.
   */
  const validar = (): boolean => {
    const todos: Partial<Record<keyof Campos, string | undefined>> = {
      client_name: errorTexto(f.client_name, LARGO.nombreCliente, 'El nombre de contacto', 'Escribe el nombre de contacto.'),
      company_name: errorTexto(f.company_name, LARGO.empresa, 'La empresa', 'Escribe la empresa o razón social.'),
      rnc: errorRnc(f.rnc),
      phone_number: errorTelefono(f.phone_number),
      email: errorCorreo(f.email),
      descuento: errorDescuento(f.descuento),
    }
    const e = Object.fromEntries(Object.entries(todos).filter(([, v]) => v)) as Partial<Record<keyof Campos, string>>
    setErrores(e)
    return Object.keys(e).length === 0
  }

  /**
   * Datos de la DGII. La razón social va a "Empresa" (el backend la copia a
   * razon_social, que es lo que declara el e-CF) y el nombre comercial al
   * contacto. DGII manda sobre lo que hubiera escrito; teléfono, correo,
   * descuento y crédito no se tocan.
   */
  const rellenarDesdeDgii = (d: ConsultaRnc) => {
    setF((prev) => ({ ...prev, company_name: d.razon_social, client_name: d.nombre_comercial || d.razon_social }))
    setErrores((e) => ({ ...e, client_name: undefined, company_name: undefined, rnc: undefined }))
  }

  const guardar = async () => {
    if (!validar() || guardando) return
    setGuardando(true)
    const enviado: NewClientInput = {
      client_name: f.client_name.trim(),
      company_name: f.company_name.trim(),
      ...(f.phone_number.trim() ? { phone_number: f.phone_number.trim() } : {}),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
      // Solo los dígitos: con guiones, un RNC de 9 no cabe en la columna de 11.
      ...(f.rnc.trim() ? { rnc: soloDigitos(f.rnc) } : {}),
      // Condiciones comerciales: la factura las hereda al elegir este cliente.
      descuento: Number(f.descuento) || 0,
      permitir_credito: f.permitir_credito ? 1 : 0,
    }
    try {
      // createClient devuelve siempre el registro con su id (ver api/clients).
      const row = await createClient(enviado)
      toast.success(`Cliente ${enviado.client_name} creado.`)
      await queryClient.invalidateQueries({ queryKey: ['clients'] })
      onCreated?.(mapClientRow(row))
      onClose()
    } catch (err) {
      // El alta SÍ se hizo, pero no se pudo identificar el cliente para
      // elegirlo: se cierra igual (dejar el modal abierto invitaría a crearlo
      // dos veces) y se dice cómo elegirlo.
      if (err instanceof ApiError && err.codigo === CODIGO_CLIENTE_SIN_ELEGIR) {
        void queryClient.invalidateQueries({ queryKey: ['clients'] })
        toast.warning(err.message)
        onClose()
        return
      }
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el cliente.')
    } finally {
      setGuardando(false)
    }
  }

  // Solo los campos de texto: el RNC y el checkbox de credito se renderizan aparte.
  const campo = (k: Exclude<CamposTexto, 'rnc'>, label: string, extra: Record<string, unknown> = {}, req = true) => (
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
        <RncConsultaField
          value={f.rnc}
          onChange={(v) => set('rnc', v)}
          onEncontrado={rellenarDesdeDgii}
          error={errores.rnc}
          buscarExistente={clienteConRnc}
          avisoExistente="Ya tienes un cliente con este RNC"
          autoFocus
        />
        {campo('client_name', 'Nombre de contacto', { placeholder: 'Juan Pérez', maxLength: LARGO.nombreCliente })}
        {campo('company_name', 'Empresa / razón social', { placeholder: 'Comercial XYZ SRL', maxLength: LARGO.empresa })}
        {campo('phone_number', 'Teléfono', { placeholder: '809-000-0000', type: 'tel', maxLength: LARGO.telefono }, false)}
        {campo('email', 'Correo', { placeholder: 'cliente@correo.com', type: 'email', maxLength: LARGO.correo }, false)}
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
