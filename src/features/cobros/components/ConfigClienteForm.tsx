// La configuración de cobro mensual de UN cliente: su monto mensual (DOP), su propio día de vencimiento y si
// el cobro del mes siguiente se genera solo. Cambiarla NO toca los cobros que ya existen: cada cobro guarda
// su monto, y el nuevo solo vale para los que se generen desde ahora.
import { useState } from 'react'
import { toast } from 'sonner'
import { Btn, Icon } from '@/components/ui'
import { ApiError, type ConfigCobro } from '@/api'
import {
  aCentavos, centavosDeTexto, configFormSchema, deCentavos, erroresPorCampo, textoDinero, textoMontoCampo,
} from '@/api/schemas/cobros'
import { useAccionUnica } from '@/hooks/useAccionUnica'
import { diasDelMes, fechaCorta, fechaHoraCorta, periodoCorto, periodoSiguiente, vencimientoDe } from '../format'
import { useGuardarConfig } from '../hooks'
import { Aviso } from './Aviso'

export function ConfigClienteForm({ clientId, config, periodoInicial }: {
  clientId: number
  config: ConfigCobro | null
  /** Periodo desde el que se muestra cuándo vencerían los próximos cobros. */
  periodoInicial: string
}) {
  const guardarConfig = useGuardarConfig()
  const [monto, setMonto] = useState(config ? textoMontoCampo(aCentavos(config.monto_mensual)) : '')
  const [dia, setDia] = useState(config ? String(config.dia_vencimiento) : '')
  const [descripcion, setDescripcion] = useState(config?.descripcion ?? '')
  const [activo, setActivo] = useState(config?.activo ?? true)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const guardar = useAccionUnica(async () => {
    setError(null)
    const p = configFormSchema.safeParse({ monto, dia, descripcion, activo })
    if (!p.success) { setErrores(erroresPorCampo(p.error)); return }
    setErrores({})
    setSaving(true)
    try {
      await guardarConfig.mutateAsync({
        clientId,
        config: {
          monto_mensual: deCentavos(centavosDeTexto(p.data.monto) as number), dia_vencimiento: Number(p.data.dia),
          descripcion: p.data.descripcion || undefined, activo: p.data.activo,
        },
      })
      toast.success(!p.data.activo
        ? 'Configuración guardada. Quedó desactivada: no se generará ningún cobro solo.'
        : config
          ? 'Configuración guardada. El monto nuevo vale para los cobros que se generen desde ahora; los que ya existen no cambian.'
          : 'Cobro mensual configurado. Al quedar pagado un cobro se genera el del mes siguiente; si no tiene ninguno abierto, crea el de este mes con "Nuevo cobro".')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  })

  // Cuándo vencerían los próximos cobros con el día que está escrito (para ver el efecto en los meses cortos).
  const diaNum = /^\d{1,2}$/.test(dia.trim()) ? Number(dia) : null
  const vista: { periodo: string; fecha: string; ajustado: boolean }[] = []
  if (diaNum !== null && diaNum >= 1 && diaNum <= 31) {
    let p = periodoInicial
    for (let i = 0; i < 4; i++) {
      vista.push({ periodo: p, fecha: vencimientoDe(p, diaNum), ajustado: diaNum > diasDelMes(p) })
      p = periodoSiguiente(p)
    }
  }
  const campo = (k: string, extra = '') => 'field' + extra + (errores[k] ? ' field-error' : '')

  return (
    <div>
      {!config && <Aviso>Este cliente todavía no tiene cobro mensual. Configúralo y, al quedar pagado un cobro, se genera solo el del mes siguiente.</Aviso>}
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="form-grid">
        <div className={campo('monto')}>
          <label className="label" htmlFor="cfg-monto">Monto mensual <span className="req">*</span></label>
          <div className="input-group">
            <span className="input-prefix">RD$</span>
            <input
              id="cfg-monto" className="input" inputMode="decimal" placeholder="0.00" value={monto}
              onChange={(e) => { setMonto(e.target.value); setErrores((x) => ({ ...x, monto: '' })) }}
            />
          </div>
          {errores.monto && <div className="err-msg">{errores.monto}</div>}
        </div>
        <div className={campo('dia')}>
          <label className="label" htmlFor="cfg-dia">Día de vencimiento <span className="req">*</span></label>
          <input
            id="cfg-dia" className="input" inputMode="numeric" placeholder="1 a 31" value={dia} maxLength={2}
            onChange={(e) => { setDia(e.target.value); setErrores((x) => ({ ...x, dia: '' })) }}
          />
          {errores.dia && <div className="err-msg">{errores.dia}</div>}
          <div className="hint">Cada cliente tiene el suyo. Si un mes no tiene ese día, vence el último día del mes.</div>
        </div>
        <div className={campo('descripcion', ' full')}>
          <label className="label" htmlFor="cfg-desc">Descripción de cada cobro <span className="opt">(opcional)</span></label>
          <input
            id="cfg-desc" className="input" value={descripcion} maxLength={150} placeholder="Mensualidad de soporte, plan Pro…"
            onChange={(e) => setDescripcion(e.target.value)}
          />
          {errores.descripcion && <div className="err-msg">{errores.descripcion}</div>}
        </div>
        <div className="field full">
          {/* Un interruptor de verdad (botón con role="switch"): se alcanza con el teclado, y es el único control que
              decide si el cobro del mes siguiente se genera solo. La etiqueta lo activa al tocar el texto. */}
          <label className="cobros-interruptor-fila">
            <button
              type="button" role="switch" aria-checked={activo} className={'switch cobros-interruptor' + (activo ? ' on' : '')}
              onClick={() => setActivo(!activo)}
            />
            <span className="text-sm">Generar el cobro del mes siguiente al quedar pagado el actual</span>
          </label>
          {!activo && <div className="hint">Con esto apagado se conserva el monto y el día, pero no se genera ningún cobro nuevo solo.</div>}
        </div>
      </div>

      {vista.length > 0 && (
        <div className="mb-md">
          <div className="label">Así vencerían los próximos cobros</div>
          <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
            {vista.map((v) => (
              <span key={v.periodo} className="filter-chip" style={{ cursor: 'default' }} title={v.ajustado ? 'Ese mes no tiene ese día: vence el último' : undefined}>
                {periodoCorto(v.periodo)}: {fechaCorta(v.fecha)}{v.ajustado && <Icon name="info" size={12} />}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="text-xs muted-3">
          {config
            ? `Monto actual: ${textoDinero(aCentavos(config.monto_mensual))} · día ${config.dia_vencimiento}${config.updated_at ? ` · modificado ${fechaHoraCorta(config.updated_at)}` : ''}`
            : 'Sin configurar'}
        </span>
        <Btn variant="primary" icon="save" onClick={() => void guardar()} disabled={saving}>
          {saving ? 'Guardando…' : config ? 'Guardar configuración' : 'Configurar cobro mensual'}
        </Btn>
      </div>
      <p className="text-xs muted-3" style={{ marginTop: 10 }}>
        Cambiar el monto o el día no modifica los cobros ya generados ni sus pagos: solo los que se creen desde ahora.
      </p>
    </div>
  )
}
