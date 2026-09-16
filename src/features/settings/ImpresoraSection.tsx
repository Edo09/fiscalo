// FISCALO — Impresora de recibos de este equipo: ancho del rollo de la tirilla.
// El dibujo de cada ancho lo hace el backend (ReciboPos); aquí solo se elige.
import { Card } from '@/components/ui'
import type { AnchoTirilla } from '@/api'
import { ANCHOS_TIRILLA, useImpresoraStore } from '@/stores/impresora'

const INFO: Record<AnchoTirilla, string> = {
  80: 'El rollo estándar de las impresoras térmicas. Imprime 72 mm de ancho.',
  76: 'El rollo de las impresoras de impacto (tipo Epson TM-U220). Imprime 63,5 mm de ancho.',
  72: 'Rollo angosto. Imprime 64 mm de ancho.',
}

export function ImpresoraSection() {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const setAncho = useImpresoraStore((s) => s.setAnchoTirilla)

  return (
    <Card title="Impresora de recibos" sub="Ancho del rollo de papel · se guarda en este equipo">
      <div className="col gap-lg">
        <div
          role="radiogroup"
          aria-label="Ancho del rollo"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}
        >
          {ANCHOS_TIRILLA.map((a) => {
            const sel = a === ancho
            return (
              <label
                key={a}
                style={{
                  border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: sel ? 'var(--accent-soft)' : 'var(--surface)',
                  borderRadius: 'var(--r-sm)', padding: sel ? 13 : 14, cursor: 'pointer',
                }}
              >
                <span className="row gap-sm mb-sm" style={{ alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="ancho-tirilla"
                    checked={sel}
                    onChange={() => setAncho(a)}
                    style={{ margin: 0, accentColor: 'var(--accent)' }}
                  />
                  <span className="fw6 text-sm">{a} mm</span>
                </span>
                <span className="text-xs muted" style={{ display: 'block' }}>{INFO[a]}</span>
              </label>
            )
          })}
        </div>

        <div className="text-xs muted-3">
          Cada caja guarda su propio ancho: si tienes impresoras distintas, configúralo en cada equipo.
          Al imprimir, pon la escala en <b>100 %</b> o <b>Tamaño real</b> (nunca «Ajustar a la página») y,
          en la configuración de la impresora, papel de {ancho} mm y márgenes en cero.
        </div>
      </div>
    </Card>
  )
}
