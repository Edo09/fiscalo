// FISCALO — Alta/edición/eliminación de una categoría (CRUD contra /api/categories).
// Borrar una categoría deja sus productos sin categoría (category_id → NULL).
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal, Btn, Switch, Icon } from '@/components/ui'
import { ApiError, createCategory, updateCategory, deleteCategory, listCategories } from '@/api'
import type { CategoryRow } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { COLORES_SUGERIDOS, colorDeCategoria, leerHex } from './colores'

interface CategoryFormModalProps {
  /** null => crear; un CategoryRow => editar. */
  category: CategoryRow | null
  onClose: () => void
}

export function CategoryFormModal({ category, onClose }: CategoryFormModalProps) {
  const queryClient = useQueryClient()
  const editing = category !== null
  const [nombre, setNombre] = useState(category?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(category?.descripcion ?? '')
  const [activo, setActivo] = useState(category ? category.estado == null || Boolean(Number(category.estado)) : true)

  // Color en el POS: único por categoría (el backend lo exige). Aquí se avisa
  // antes, con el nombre de la que ya lo tiene. Todas las categorías, no la
  // página del listado: el choque puede estar en cualquiera.
  const todas = useApiQuery(['categories', 'todas'], () => listCategories({ page: 1, pageSize: 500 }))
  const usados = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of todas.data?.items ?? []) {
      if (c.id !== category?.id && c.color) m.set(c.color.toUpperCase(), c.nombre || 'otra categoría')
    }
    return m
  }, [todas.data, category?.id])
  // Una nueva arranca con el primer sugerido libre; una existente, con el suyo
  // (vacío = automático, calculado del nombre).
  const [hex, setHex] = useState(() => category ? (category.color ?? '') : '')
  const [hexTocado, setHexTocado] = useState(editing)
  const sugeridoLibre = COLORES_SUGERIDOS.find((c) => !usados.has(c)) ?? ''
  const hexVisible = hexTocado ? hex : sugeridoLibre
  const color = leerHex(hexVisible)
  const colorEfectivo = colorDeCategoria(nombre, color === 'invalido' ? null : color)
  const conflicto = color && color !== 'invalido' ? usados.get(color) ?? null : null
  const elegirColor = (valor: string) => { setHex(valor); setHexTocado(true) }

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    if (color === 'invalido') { setError('El color tiene que ser un código HEX de 6 dígitos, como #2E7D32.'); return }
    if (conflicto) { setError(`El color ${color} ya lo usa la categoría «${conflicto}». Elige otro.`); return }
    setError(null)
    setSaving(true)
    const payload = { nombre: nombre.trim(), descripcion: descripcion.trim() || undefined, color, estado: activo ? 1 : 0 }
    try {
      if (editing && category) await updateCategory({ id: category.id, ...payload })
      else await createCategory(payload)
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(editing ? `Categoría "${payload.nombre}" actualizada.` : `Categoría "${payload.nombre}" creada.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la categoría.')
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!category) return
    setError(null)
    setDeleting(true)
    try {
      await deleteCategory(category.id)
      void queryClient.invalidateQueries({ queryKey: ['categories'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Categoría "${category.nombre}" eliminada.`)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la categoría.')
      setDeleting(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Editar categoría' : 'Nueva categoría'}
      sub={editing ? category?.nombre ?? undefined : 'Clasifica los productos de tu catálogo'}
      icon="tag"
      width={520}
      onClose={onClose}
      footer={
        <>
          {editing && (confirmDel ? (
            <span className="row gap-sm" style={{ marginRight: 'auto', alignItems: 'center' }}>
              <span className="text-sm muted">¿Eliminar?</span>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>No</Btn>
              <Btn variant="primary" size="sm" style={{ background: 'var(--danger)' }} onClick={remove} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Sí, eliminar'}
              </Btn>
            </span>
          ) : (
            <Btn variant="ghost" icon="trash-2" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => setConfirmDel(true)}>Eliminar</Btn>
          ))}
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" icon="save" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Btn>
        </>
      }
    >
      {error && (
        <div className="row gap-sm" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '9px 12px', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="alert-circle" size={16} /><span>{error}</span>
        </div>
      )}

      {editing && (
        <div className="row gap-sm" style={{ color: 'var(--text-2)', marginBottom: 14, fontSize: 12.5 }}>
          <Icon name="alert-circle" size={15} /><span>Al eliminar, los productos de esta categoría quedan sin categoría (no se borran).</span>
        </div>
      )}

      <div className="form-grid">
        <div className="field full">
          <label className="label">Nombre <span className="req">*</span></label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Bebidas" autoFocus />
        </div>
        <div className="field full">
          <label className="label">Descripción <span className="opt">(opcional)</span></label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Para qué sirve esta categoría" />
        </div>
        <div className="field full">
          <label className="label" htmlFor="cat-color-hex">Color en el POS</label>
          <div className="row gap-sm" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {/* El selector nativo; el campo HEX al lado para escribir o pegar un código. */}
            <input
              type="color"
              value={colorEfectivo.toLowerCase()}
              onChange={(e) => elegirColor(e.target.value.toUpperCase())}
              aria-label="Elegir color"
              style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', cursor: 'pointer' }}
            />
            <input
              id="cat-color-hex"
              className="input mono"
              style={{ width: 130 }}
              value={hexVisible}
              onChange={(e) => elegirColor(e.target.value)}
              placeholder={colorDeCategoria(nombre, null).toUpperCase()}
              maxLength={7}
              spellCheck={false}
              aria-invalid={color === 'invalido' || conflicto != null}
            />
            {color ? (
              <Btn variant="ghost" size="sm" onClick={() => elegirColor('')}>Usar automático</Btn>
            ) : (
              <span className="text-xs muted-3">Automático: sale del nombre</span>
            )}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Colores sugeridos">
            {COLORES_SUGERIDOS.map((c) => {
              const duenio = usados.get(c)
              const elegido = color === c
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => elegirColor(c)}
                  disabled={duenio != null}
                  title={duenio ? `${c} · lo usa «${duenio}»` : c}
                  aria-label={duenio ? `${c}, lo usa ${duenio}` : c}
                  aria-pressed={elegido}
                  style={{
                    width: 26, height: 26, borderRadius: 99, background: c, padding: 0,
                    border: '2px solid var(--surface)',
                    boxShadow: elegido ? `0 0 0 2px ${c}` : '0 0 0 1px var(--border-strong)',
                    opacity: duenio ? 0.25 : 1, cursor: duenio ? 'not-allowed' : 'pointer',
                  }}
                />
              )
            })}
          </div>
          {color === 'invalido' ? (
            <div className="err-msg"><Icon name="alert-circle" size={13} />Escribe un código HEX de 6 dígitos, como #2E7D32.</div>
          ) : conflicto ? (
            <div className="err-msg"><Icon name="alert-circle" size={13} />Ese color ya lo usa «{conflicto}». Cada categoría tiene el suyo.</div>
          ) : (
            <div className="text-xs muted-3" style={{ marginTop: 6 }}>Cada categoría tiene su propio color. Los atenuados ya están en uso.</div>
          )}
        </div>
        <div className="field full">
          <span className="row gap-sm" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setActivo(!activo)}>
            <Switch on={activo} onChange={setActivo} />
            <span className="text-sm">Activa</span>
          </span>
        </div>
      </div>
    </Modal>
  )
}
