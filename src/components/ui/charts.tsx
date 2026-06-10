// Gráficos ligeros sin dependencias: barras, donut, progreso y sparkline.
import { fmt0 } from '@/lib/format'

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
export function BarChart({
  data,
  height = 180,
  valueScale = 1000,
  legend = { primary: 'Ventas', secondary: 'Gastos' },
}: BarChartProps) {
  const hasGastos = data.some((d) => d.gastos != null)
  const max = Math.max(1, ...data.flatMap((d) => [d.ventas, d.gastos ?? 0]))
  return (
    <div>
      <div className="bars" style={{ height }}>
        {data.map((d, i) => (
          <div className="bar-col" key={i} title={`${d.mes}: RD$ ${fmt0(d.ventas * valueScale)}`}>
            <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', height: '100%', alignItems: 'flex-end', gap: 3 }}>
              <div style={{ width: hasGastos ? '38%' : '60%', maxWidth: 16, height: `${(d.ventas / max) * 100}%`, background: 'var(--accent)', borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
              {hasGastos && (
                <div style={{ width: '38%', maxWidth: 16, height: `${((d.gastos ?? 0) / max) * 100}%`, background: 'var(--accent-soft-2)', borderRadius: '4px 4px 2px 2px', transition: 'height .5s' }}></div>
              )}
            </div>
            <span className="bar-label">{d.mes}</span>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 14, justifyContent: 'center' }}>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent)' }}></span>{legend.primary}</span>
        {hasGastos && legend.secondary && (
          <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--accent-soft-2)' }}></span>{legend.secondary}</span>
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
