// FISCALO — Branding del PDF (plantilla, acento, logo) contra /api/branding.
// Las plantillas y reglas vienen de docs/plantillas-factura.md.
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Btn, Card, Icon, LoadingState, ErrorState } from '@/components/ui'
import {
  ApiError, getBranding, updateBranding, uploadBrandingLogo, deleteBrandingLogo, previewBranding,
} from '@/api'
import type { BrandingData } from '@/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { presentDocument } from '@/lib/file'

const TEMPLATE_INFO: Record<string, { label: string; desc: string }> = {
  clasico: { label: 'Clásico', desc: 'Logo a la izquierda, banda de tabla negra, sello y dos firmas.' },
  moderno: { label: 'Moderno', desc: 'Banda de acento a todo lo ancho, tabla y fila de total en acento, pie con regla fina.' },
  compacto: { label: 'Compacto', desc: 'Tipografía condensada y cuerpo más pequeño: más líneas por página.' },
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function BrandingSection() {
  const { data, error, loading, reload } = useApiQuery(['branding'], getBranding)
  return (
    <Card title="Plantillas PDF" sub="Cómo se ven tus facturas y cotizaciones impresas">
      {loading ? (
        <LoadingState rows={4} />
      ) : error || !data ? (
        <ErrorState title="No se pudo cargar el branding" onRetry={reload}>{error}</ErrorState>
      ) : (
        // key: si el servidor cambia plantilla/acento (otro usuario, refetch),
        // el formulario se reinicia con los valores nuevos.
        <BrandingForm key={`${data.template}|${data.accent_color ?? ''}`} branding={data} />
      )}
    </Card>
  )
}

function BrandingForm({ branding }: { branding: BrandingData }) {
  const queryClient = useQueryClient()
  const [template, setTemplate] = useState(branding.template)
  const [accent, setAccent] = useState(branding.accent_color ?? '')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // available_templates incluye las predefinidas y, si existe, la custom del tenant.
  const templates = branding.available_templates?.length
    ? branding.available_templates
    : Object.keys(TEMPLATE_INFO)

  const accentTrim = accent.trim()
  const accentValid = accentTrim === '' || HEX_RE.test(accentTrim)
  const dirty = template !== branding.template || (accentTrim || null) !== (branding.accent_color ?? null)

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['branding'] })

  const save = async () => {
    setSaving(true)
    try {
      await updateBranding({ template, accent_color: accentTrim || null })
      invalidate()
      toast.success('Branding actualizado. Tus próximos PDF usarán este diseño.')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar el branding.')
    } finally {
      setSaving(false)
    }
  }

  const preview = async () => {
    setPreviewing(true)
    try {
      const doc = await previewBranding({ template, accent_color: accentTrim || null })
      presentDocument(doc)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo generar la vista previa.')
    } finally {
      setPreviewing(false)
    }
  }

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast.error('El logo debe ser PNG o JPG.'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('El logo no puede pasar de 2 MB.'); return }
    setLogoBusy(true)
    try {
      await uploadBrandingLogo(file)
      invalidate()
      toast.success('Logo actualizado.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir el logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  const removeLogo = async () => {
    setLogoBusy(true)
    try {
      await deleteBrandingLogo()
      invalidate()
      toast.success('Logo eliminado; se usará el logo global.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <div className="col gap-lg">
      <div>
        <div className="fw6 text-sm mb-sm">Plantilla</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {templates.map((t) => {
            const info = TEMPLATE_INFO[t]
            const sel = template === t
            return (
              <div
                key={t}
                onClick={() => setTemplate(t)}
                style={{
                  border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: sel ? 'var(--accent-soft)' : 'var(--surface)',
                  borderRadius: 'var(--r-sm)', padding: sel ? 13 : 14, cursor: 'pointer',
                }}
              >
                <div className="row between mb-sm">
                  <span className="fw6 text-sm">{info?.label ?? 'A la medida'}</span>
                  {sel && <span style={{ color: 'var(--accent)' }}><Icon name="check-circle" size={16} /></span>}
                </div>
                <div className="text-xs muted">{info?.desc ?? 'Diseño exclusivo de tu empresa, hecho a la medida de tu factura.'}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="divider" style={{ margin: 0 }}></div>

      <div className="field" style={{ margin: 0 }}>
        <label>Color de acento</label>
        <div className="row gap-sm" style={{ alignItems: 'center' }}>
          <input
            type="color"
            value={HEX_RE.test(accentTrim) ? accentTrim : '#1f6feb'}
            onChange={(e) => setAccent(e.target.value)}
            style={{ width: 38, height: 34, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', cursor: 'pointer' }}
          />
          <input
            className="input mono" style={{ width: 130 }} placeholder="#RRGGBB"
            value={accent} onChange={(e) => setAccent(e.target.value)}
          />
          {accentTrim !== '' && <Btn variant="ghost" size="sm" onClick={() => setAccent('')}>Quitar</Btn>}
        </div>
        <div className="text-xs muted-3" style={{ marginTop: 6 }}>
          Colorea bandas y rellenos de la plantilla. El color del texto sobre el acento se calcula automáticamente para que siempre sea legible.
        </div>
        {!accentValid && (
          <div className="text-xs fw5" style={{ color: 'var(--danger)', marginTop: 4 }}>Formato inválido: usa hex #RRGGBB.</div>
        )}
      </div>

      <div className="divider" style={{ margin: 0 }}></div>

      <div>
        <div className="fw6 text-sm mb-sm">Logo</div>
        <div className="row gap-md" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={(e) => void onLogoPick(e)} />
          <Btn variant="secondary" size="sm" icon="upload" onClick={() => fileRef.current?.click()} disabled={logoBusy}>
            {branding.has_custom_logo ? 'Cambiar logo' : 'Subir logo'}
          </Btn>
          {branding.has_custom_logo && (
            <Btn variant="ghost" size="sm" icon="trash-2" onClick={() => void removeLogo()} disabled={logoBusy}>Quitar logo</Btn>
          )}
          <span className="text-xs muted-3">PNG o JPG, máx. 2 MB. Sin logo propio se usa el logo global.</span>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Btn variant="secondary" icon="eye" onClick={() => void preview()} disabled={previewing || !accentValid}>
          {previewing ? 'Generando…' : 'Vista previa'}
        </Btn>
        <Btn variant="ghost" onClick={() => { setTemplate(branding.template); setAccent(branding.accent_color ?? '') }} disabled={!dirty}>
          Cancelar
        </Btn>
        <Btn variant="primary" icon="check" onClick={() => void save()} disabled={saving || !dirty || !accentValid}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Btn>
      </div>
    </div>
  )
}
