// FISCALO — Impresora de recibos de este equipo: ancho del rollo y cómo se
// imprime la tirilla. El contenido de cada ancho lo arma el backend
// (ReciboPos); aquí solo se elige.
import { Card } from '@/components/ui'
import type { AnchoTirilla, ModoImpresion } from '@/api'
import { ANCHOS_TIRILLA, useImpresoraStore } from '@/stores/impresora'

const INFO_ANCHO: Record<AnchoTirilla, string> = {
  80: 'El rollo estándar de las impresoras térmicas. Imprime 72 mm de ancho.',
  76: 'El rollo de las impresoras de impacto (tipo Epson TM-U220). Imprime 63,5 mm de ancho.',
  72: 'Rollo angosto. Imprime 64 mm de ancho.',
}

const MODOS: { id: ModoImpresion; titulo: string; desc: string }[] = [
  {
    id: 'web',
    titulo: 'Página web (recomendado)',
    desc: 'El papel mide lo que mide el recibo: no sale papel en blanco al final ni se corta una factura larga.',
  },
  {
    id: 'pdf',
    titulo: 'PDF',
    desc: 'El largo lo decide el tamaño de papel elegido en la impresora. Úsalo si la página web no imprime bien en tu equipo.',
  },
]

const grilla = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 } as const

function Opcion({ nombre, sel, titulo, desc, onSel }: {
  nombre: string; sel: boolean; titulo: string; desc: string; onSel: () => void
}) {
  return (
    <label
      style={{
        border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
        background: sel ? 'var(--accent-soft)' : 'var(--surface)',
        borderRadius: 'var(--r-sm)', padding: sel ? 13 : 14, cursor: 'pointer',
      }}
    >
      <span className="row gap-sm mb-sm" style={{ alignItems: 'center' }}>
        <input type="radio" name={nombre} checked={sel} onChange={onSel} style={{ margin: 0, accentColor: 'var(--accent)' }} />
        <span className="fw6 text-sm">{titulo}</span>
      </span>
      <span className="text-xs muted" style={{ display: 'block' }}>{desc}</span>
    </label>
  )
}

export function ImpresoraSection() {
  const ancho = useImpresoraStore((s) => s.anchoTirilla)
  const modo = useImpresoraStore((s) => s.modoImpresion)
  const setAncho = useImpresoraStore((s) => s.setAnchoTirilla)
  const setModo = useImpresoraStore((s) => s.setModoImpresion)

  return (
    <Card title="Impresora de recibos" sub="Se guarda en este equipo: cada caja puede tener su impresora">
      <div className="col gap-lg">
        <div>
          <div className="fw6 text-sm mb-sm">Ancho del rollo</div>
          <div role="radiogroup" aria-label="Ancho del rollo" style={grilla}>
            {ANCHOS_TIRILLA.map((a) => (
              <Opcion key={a} nombre="ancho-tirilla" sel={a === ancho} titulo={`${a} mm`} desc={INFO_ANCHO[a]} onSel={() => setAncho(a)} />
            ))}
          </div>
        </div>

        <div>
          <div className="fw6 text-sm mb-sm">Cómo se imprime</div>
          <div role="radiogroup" aria-label="Cómo se imprime" style={grilla}>
            {MODOS.map((m) => (
              <Opcion key={m.id} nombre="modo-impresion" sel={m.id === modo} titulo={m.titulo} desc={m.desc} onSel={() => setModo(m.id)} />
            ))}
          </div>
        </div>

        <div className="text-xs muted-3">
          {modo === 'web' ? (
            <>
              Al imprimir, deja la escala en <b>Predeterminado</b> (100 %). Si el diálogo deja elegir el tamaño
              de papel, elige el rollo de {ancho} mm.
            </>
          ) : (
            <>
              Al imprimir, pon la escala en <b>100 %</b> o <b>Tamaño real</b> (nunca «Ajustar a la página») y
              el papel en rollo de {ancho} mm. Si sale papel en blanco después del recibo, activa en las
              preferencias de la impresora la reducción del margen inferior (en Epson, «Paper Reduction»).
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
