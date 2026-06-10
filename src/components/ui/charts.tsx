// Gráficos ligeros sin dependencias: barras, donut, progreso y sparkline.
import { useState } from 'react'
import { fmt } from '@/lib/format'

export interface BarDatum {
  mes: string
  ventas: number
  gastos?: number
}
export interface BarChartProps {
  data: BarDatum[]
  height?: number
  /** Multiplicador para el tooltip (mock en miles -> 1000; API en pesos -> 1). */
  valueScale?: number
  legend?: { primary: string; secondary?: string }
}

/** Techo "bonito" para el eje Y (1/2/4/5/10 × 10^n => mitades limpias). */
function niceCeil(v: number): number {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 5 ? 5 : 10
  return nf * exp
}

/** Formato compacto para etiquetas del eje (450k, 1.2M). */
function compactRD(v: number): string {
  if (v >= 1_000_000) return `${parseFloat((v / 1_000_000).toFixed(1))}M`
  if (v >= 1_000) return `${parseFloat((v / 1_000).toFixed(1))}k`
  return String(Math.round(v))
}

const SECONDARY_COLOR = 'var(--warning)'

export function BarChart({
  data,
  height = 180,
  valueScale = 1000,
  legend = { primary: 'Ventas', secondary: 'Gastos' },
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const hasGastos = data.some((d) => d.gastos != null)
  const max = niceCeil(Math.max(...data.flatMap((d) => [d.ventas * valueScale, (d.gastos ?? 0) * valueScale])))
  const ticks = [max, max / 2, 0]

  // El tooltip se centra sobre la columna; cerca de los bordes se ancla al lado
  // interior para no desbordar la tarjeta.
  const tipAlign = (i: number): React.CSSProperties => {
    const center = ((i + 0.5) / data.length) * 100
    if (i <= 1) return { left: `${(i / data.length) * 100}%` }
    if (i >= data.length - 2) return { left: `${((i + 1) / data.length) * 100}%`, transform: 'translateX(-100%)' }
    return { left: `${center}%`, transform: 'translateX(-50%)' }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Eje Y */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, textAlign: 'right', flexShrink: 0 }}>
          {ticks.map((t) => (
            <span key={t} className="text-xs muted-3 num" style={{ lineHeight: 1 }}>{compactRD(t)}</span>
          ))}
        </div>

        {/* Área de barras con líneas de guía */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ position: 'relative', height }}>
            {ticks.map((t, i) => (
              <div key={t} style={{ position: 'absolute', left: 0, right: 0, top: `${(1 - t / max) * 100}%`, borderTop: i === ticks.length - 1 ? '1px solid var(--border)' : '1px dashed var(--border)' }}></div>
            ))}
            <div className="bars" style={{ height: '100%', position: 'relative' }}>
              {data.map((d, i) => (
                <div
                  className={'bar-col' + (hover === i ? ' hovered' : '')}
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', height: '100%', alignItems: 'flex-end', gap: 3 }}>
                    <div style={{ width: hasGastos ? '38%' : '60%', maxWidth: 16, height: `${(d.ventas * valueScale / max) * 100}%`, minHeight: d.ventas > 0 ? 2 : 0, background: 'var(--accent)', borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
                    {hasGastos && (
                      <div style={{ width: '38%', maxWidth: 16, height: `${((d.gastos ?? 0) * valueScale / max) * 100}%`, minHeight: (d.gastos ?? 0) > 0 ? 2 : 0, background: SECONDARY_COLOR, borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Tooltip flotante de la columna activa */}
            {hover != null && data[hover] && (
              <div className="chart-tip" style={tipAlign(hover)}>
                <div className="chart-tip-title">{data[hover].mes}</div>
                <div className="chart-tip-row">
                  <span className="legend-dot" style={{ background: 'var(--accent)' }}></span>
                  <span className="chart-tip-label">{legend.primary}</span>
                  <span className="chart-tip-value">RD${fmt(data[hover].ventas * valueScale)}</span>
                </div>
                {hasGastos && legend.secondary && (
                  <div className="chart-tip-row">
                    <span className="legend-dot" style={{ background: SECONDARY_COLOR }}></span>
                    <span className="chart-tip-label">{legend.secondary}</span>
                    <span className="chart-tip-value">RD${fmt((data[hover].gastos ?? 0) * valueScale)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Etiquetas de mes alineadas con cada columna */}
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            {data.map((d, i) => (
              <span key={i} className="bar-label" style={{ flex: 1, textAlign: 'center' }}>{d.mes}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="legend" style={{ marginTop: 14, justifyContent: 'center' }}>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent)' }}></span>{legend.primary}</span>
        {hasGastos && legend.secondary && (
          <span className="legend-item"><span className="legend-dot" style={{ background: SECONDARY_COLOR }}></span>{legend.secondary}</span>
        )}
      </div>
    </div>
  )
}

export interface DonutSegment {
  value: number
  color: string
}
export function Donut({ segments, size = 120, thickness = 16 }: { segments: DonutSegment[]; size?: number; thickness?: number }) {
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  let offset = 0
  const total = segments.reduce((a, s) => a + s.value, 0)
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--neutral-soft)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset} strokeLinecap="butt"
            />
          )
          offset += len
          return el
        })}
      </svg>
    </div>
  )
}

export function Progress({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${value}%`, background: color }}></div>
    </div>
  )
}

export function Sparkline({ data, color = 'var(--accent)', width = 100, height = 30 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map((d, i) => `${(i / (data.length - 1)) * width},${height - ((d - min) / (max - min || 1)) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
