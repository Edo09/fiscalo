// FISCALO — Datos de empresa (Configuración): lo que el administrador puede cambiar de su propia empresa.
//
// El RNC y la razón social son la identidad fiscal de la empresa: se muestran y no se editan (solo soporte los
// cambia). Todo lo demás se guarda con PUT /api/emisor, que lo vuelve a revisar con las reglas del XSD de la DGII
// (ver emisorValidacion.ts): estos datos viajan dentro de cada e-CF. Otro rol ve los mismos datos sin poder editarlos.
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Btn, Icon } from '@/components/ui'
import { ApiError, updateEmisor } from '@/api'
import type { EmisorData, EmisorInput, Ubicacion } from '@/api'
import { codigoProvincia, opcionesUbicacion } from '@/lib/ubicaciones'
import {
  LARGO_EMISOR, camposCambiados, errorEmisor, formDesdeEmisor, valorEmisor,
  type CampoEmisor, type FormEmisor,
} from './emisorValidacion'

interface Props {
  emisor: EmisorData
  /** Catálogo DGII: provincias y municipios se muestran y se eligen por su descripción, se guardan por su código. */
  ubicaciones: Ubicacion[] | null
  /** true = el administrador puede cambiar los datos; false = se muestran sin editar. */
  puedeEditar: boolean
}

export function EmpresaForm({ emisor, ubicaciones, puedeEditar }: Props) {
  const queryClient = useQueryClient()
  // Foto de lo guardado al abrir: contra ella se ve qué cambió. Si el servidor cambia los datos (al guardar, o desde otra
  // sesión), SettingsView monta el formulario de nuevo con `key` y arranca con los nuevos.
  const [inicial] = useState<FormEmisor>(() => formDesdeEmisor(emisor))
  const [form, setForm] = useState<FormEmisor>(inicial)
  const [errores, setErrores] = useState<Partial<Record<CampoEmisor, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const cambiados = camposCambiados(form, inicial)
  const dirty = cambiados.length > 0

  const set = (k: CampoEmisor) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errores[k]) setErrores((er) => ({ ...er, [k]: undefined }))
  }
  const claseCampo = (k: CampoEmisor, extra = '') => 'field' + extra + (errores[k] ? ' field-error' : '')
  const errorDe = (k: CampoEmisor) =>
    errores[k] && <div className="err-msg" role="alert"><Icon name="alert-circle" size={13} />{errores[k]}</div>

  // Municipio/Provincia se guardan como código DGII; en modo lectura se muestra la descripción.
  const locByCode = useMemo(
    () => Object.fromEntries((ubicaciones ?? []).map((u) => [u.codigo, u.descripcion])),
    [ubicaciones],
  )
  const loc = (code?: string | null) => (code ? (locByCode[code] ?? '—') : '—')

  const descartar = () => {
    setForm(inicial)
    setErrores({})
    setError(null)
  }

  const guardar = async () => {
    // Solo se revisa lo que cambió: un dato heredado que no cumple las reglas de hoy no impide guardar el resto.
    const e: Partial<Record<CampoEmisor, string>> = {}
    for (const k of cambiados) {
      const msg = errorEmisor(k, valorEmisor(k, form[k]))
      if (msg) e[k] = msg
    }
    setErrores(e)
    if (Object.keys(e).length > 0) return
    // El PUT es parcial: solo viaja lo que cambió, ya como lo guardará el servidor.
    const cambios: EmisorInput = {}
    for (const k of cambiados) cambios[k] = valorEmisor(k, form[k])
    setSaving(true)
    setError(null)
    try {
      const nuevo = await updateEmisor(cambios)
      // La respuesta trae los datos ya guardados: se reparten a todo el que lee ['emisor'] (el nombre de la barra, las facturas…).
      queryClient.setQueryData(['emisor'], nuevo)
      toast.success('Datos de la empresa actualizados.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudieron guardar los datos de la empresa.')
    } finally {
      setSaving(false)
    }
  }

  // Provincia antes que municipio: el municipio se elige dentro de la provincia.
  if (!puedeEditar) {
    return (
      <div className="form-grid">
        <div className="field"><label>Razón social</label><input className="input" readOnly value={emisor.razon_social} /></div>
        <div className="field"><label>Nombre comercial</label><input className="input" readOnly value={emisor.nombre_comercial ?? '—'} /></div>
        <div className="field"><label>RNC</label><input className="input mono" readOnly value={emisor.rnc} /></div>
        <div className="field"><label>Sucursal</label><input className="input" readOnly value={emisor.sucursal ?? '—'} /></div>
        <div className="field full"><label>Dirección</label><input className="input" readOnly value={emisor.direccion ?? '—'} /></div>
        <div className="field"><label>Provincia</label><input className="input" readOnly value={loc(emisor.provincia)} /></div>
        <div className="field"><label>Municipio</label><input className="input" readOnly value={loc(emisor.municipio)} /></div>
        <div className="field"><label>Teléfono</label><input className="input" readOnly value={emisor.telefono ?? '—'} /></div>
        <div className="field"><label>Correo</label><input className="input" readOnly value={emisor.correo ?? '—'} /></div>
        <div className="field"><label>Sitio web</label><input className="input" readOnly value={emisor.website ?? '—'} /></div>
        <div className="field"><label>Actividad económica</label><input className="input" readOnly value={emisor.actividad_economica ?? '—'} /></div>
      </div>
    )
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => { ev.preventDefault(); if (dirty && !saving) void guardar() }}
    >
      {error && (
        <div className="card card-pad row gap-sm mb-md" role="alert" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', color: 'var(--danger)' }}>
          <Icon name="alert-circle" size={16} /><span className="fw6 text-sm">{error}</span>
        </div>
      )}
      <div className="form-grid">
        <div className="field"><label htmlFor="emp-razon">Razón social</label><input id="emp-razon" className="input" readOnly value={emisor.razon_social} /></div>
        <div className={claseCampo('nombre_comercial')}>
          <label htmlFor="emp-nombre">Nombre comercial</label>
          <input id="emp-nombre" className="input" value={form.nombre_comercial} onChange={set('nombre_comercial')} maxLength={LARGO_EMISOR.nombre_comercial} />
          {errorDe('nombre_comercial')}
        </div>
        <div className="field"><label htmlFor="emp-rnc">RNC</label><input id="emp-rnc" className="input mono" readOnly value={emisor.rnc} /></div>
        <div className={claseCampo('sucursal')}>
          <label htmlFor="emp-sucursal">Sucursal</label>
          <input id="emp-sucursal" className="input" value={form.sucursal} onChange={set('sucursal')} maxLength={LARGO_EMISOR.sucursal} />
          {errorDe('sucursal')}
        </div>
        <div className={claseCampo('direccion', ' full')}>
          <label htmlFor="emp-direccion">Dirección</label>
          <input id="emp-direccion" className="input" value={form.direccion} onChange={set('direccion')} maxLength={LARGO_EMISOR.direccion} />
          {errorDe('direccion')}
        </div>
        <div className="field">
          <label htmlFor="emp-provincia">Provincia</label>
          <select
            id="emp-provincia"
            className="input"
            value={form.provincia}
            onChange={(ev) => {
              // Cambiar de provincia invalida el municipio: pertenece a la anterior.
              const prov = ev.target.value
              setForm((f) => ({ ...f, provincia: prov, municipio: '' }))
              setErrores((er) => ({ ...er, provincia: undefined, municipio: undefined }))
            }}
          >
            <option value="">— Sin especificar —</option>
            {opcionesUbicacion(ubicaciones, 'PROVINCIA', '', form.provincia).map((u) => (
              <option key={u.codigo} value={u.codigo}>{u.descripcion}</option>
            ))}
          </select>
        </div>
        <div className={claseCampo('municipio')}>
          <label htmlFor="emp-municipio">Municipio</label>
          <select id="emp-municipio" className="input" value={form.municipio} onChange={set('municipio')} disabled={!form.provincia}>
            <option value="">{form.provincia ? '— Sin especificar —' : 'Elige una provincia primero'}</option>
            {opcionesUbicacion(ubicaciones, 'MUNICIPIO', codigoProvincia(ubicaciones, form.provincia), form.municipio).map((u) => (
              <option key={u.codigo} value={u.codigo}>{u.descripcion}</option>
            ))}
          </select>
          {errorDe('municipio')}
        </div>
        <div className={claseCampo('telefono')}>
          <label htmlFor="emp-telefono">Teléfono</label>
          <input id="emp-telefono" className="input" inputMode="tel" value={form.telefono} onChange={set('telefono')} placeholder="809-555-1234" />
          {errorDe('telefono')}
        </div>
        <div className={claseCampo('correo')}>
          <label htmlFor="emp-correo">Correo</label>
          <input id="emp-correo" className="input" type="email" value={form.correo} onChange={set('correo')} maxLength={LARGO_EMISOR.correo} />
          {errorDe('correo')}
        </div>
        <div className={claseCampo('website')}>
          <label htmlFor="emp-web">Sitio web</label>
          <input id="emp-web" className="input" value={form.website} onChange={set('website')} maxLength={LARGO_EMISOR.website} />
          {errorDe('website')}
        </div>
        <div className={claseCampo('actividad_economica')}>
          <label htmlFor="emp-actividad">Actividad económica</label>
          <input id="emp-actividad" className="input" value={form.actividad_economica} onChange={set('actividad_economica')} maxLength={LARGO_EMISOR.actividad_economica} />
          {errorDe('actividad_economica')}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Btn type="button" variant="ghost" onClick={descartar} disabled={!dirty || saving}>Cancelar</Btn>
        <Btn type="submit" variant="primary" icon="check" disabled={!dirty || saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Btn>
      </div>
    </form>
  )
}
