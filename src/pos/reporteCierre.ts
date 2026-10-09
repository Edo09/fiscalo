// Reporte de cierre de turno en tirilla (api-gratex docs/specs/pos.md K8).
//
// Lo arma el POS al cerrar y app.* al reimprimir, desde la MISMA foto que
// guardó el servidor (pos_turnos.totales_json): las dos copias dicen lo mismo.
// Sale como página web por printHtml, igual que el recibo de venta.
import type { ReporteCierre } from './api.ts'
import { DENOMINACIONES, formatoCentavos } from './montos.ts'

/** Selector del contenedor que mide printHtml para fijar el largo del papel. */
export const SELECTOR_REPORTE = '.reporte'

/**
 * Ancho imprimible de cada rollo, en mm (ReciboPos::MEDIDAS del backend): lo
 * que de verdad imprime el driver, no lo que mide el papel.
 */
export const ANCHO_UTIL_MM: Record<80 | 76 | 72, number> = { 80: 72, 76: 63.5, 72: 64 }

function esc(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** '2026-10-08 18:10:05' → '08/10/2026 6:10 p. m.' sin pasar por zonas horarias. */
export function fechaHora(valor: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(valor ?? '')
  if (!m) return valor ?? '—'
  const h = Number(m[4])
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${m[3]}/${m[2]}/${m[1]} ${h12}:${m[5]} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** "Faltan RD$ 0.25" / "Sobran RD$ 5.00" / "Cuadra". */
export function textoDiferencia(centavos: number): string {
  if (centavos === 0) return 'Cuadra'
  return `${centavos < 0 ? 'Faltan' : 'Sobran'} RD$ ${formatoCentavos(Math.abs(centavos))}`
}

const fila = (etiqueta: string, valor: string, clase = '') =>
  `<div class="fila${clase ? ' ' + clase : ''}"><span>${esc(etiqueta)}</span><span>${esc(valor)}</span></div>`

export function reporteCierreHtml(r: ReporteCierre, opts: { empresa?: string | null; anchoMm: number }): string {
  const ventas = r.ventas.por_forma
    .map((f) => fila(`  ${f.nombre} (${f.cantidad})`, formatoCentavos(f.monto_centavos)))
    .join('')
  const devoluciones = r.devoluciones.cantidad > 0
    ? fila(`Devoluciones (${r.devoluciones.cantidad})`, formatoCentavos(r.devoluciones.total_centavos), 'b')
      + r.devoluciones.por_forma.map((f) => fila(`  ${f.nombre} (${f.cantidad})`, formatoCentavos(f.monto_centavos))).join('')
    : ''
  const comprobantes = Object.entries(r.comprobantes).map(([t, n]) => `${t}: ${n}`).join(' · ') || 'ninguno'
  const conteo = DENOMINACIONES
    .filter((d) => (r.conteo[String(d)] ?? 0) > 0)
    .map((d) => fila(`  ${d.toLocaleString('es-DO')} × ${r.conteo[String(d)]}`, formatoCentavos(d * 100 * r.conteo[String(d)])))
    .join('')
  const otros = (r.conteo.otros_centavos ?? 0) > 0 ? fila('  Otros / centavos', formatoCentavos(r.conteo.otros_centavos)) : ''
  const lista = (titulo: string, xs: { e_ncf: string; total_centavos: number }[]) => xs.length === 0
    ? ''
    : `<div class="b">${esc(titulo)} (${xs.length})</div>` + xs.map((x) => fila(`  ${x.e_ncf}`, formatoCentavos(x.total_centavos))).join('')
  const cerroOtro = r.cerrado_por.id !== r.empleado.id

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cierre de turno ${r.turno_id}</title><style>
  html, body { margin: 0; background: #fff; color: #000; }
  .reporte { width: ${opts.anchoMm}mm; padding: 1mm 0 3mm; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; line-height: 1.35; }
  .c { text-align: center; }
  .t { font-size: 11pt; font-weight: bold; }
  .b { font-weight: bold; }
  .sep { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
  .fila { display: flex; justify-content: space-between; gap: 2mm; white-space: pre; }
  .fila span:first-child { overflow: hidden; text-overflow: ellipsis; }
  .fila.b span { font-weight: bold; }
  .grande { font-size: 11pt; font-weight: bold; }
  .firma { margin-top: 8mm; border-top: 1px solid #000; padding-top: 1mm; text-align: center; font-size: 7.5pt; }
  </style></head><body><div class="reporte">
  ${opts.empresa ? `<div class="c b">${esc(opts.empresa)}</div>` : ''}
  <div class="c t">CIERRE DE TURNO</div>
  <hr class="sep">
  ${fila('Caja', r.caja.nombre)}
  ${fila('Cajero', r.empleado.nombre)}
  ${fila('Apertura', fechaHora(r.abierto_at))}
  ${fila('Cierre', fechaHora(r.cerrado_at))}
  ${cerroOtro ? fila('Cerró', `${r.cerrado_por.nombre} (supervisor)`) : ''}
  <hr class="sep">
  ${fila(`VENTAS (${r.ventas.cantidad})`, formatoCentavos(r.ventas.total_centavos), 'b')}
  ${ventas}
  ${devoluciones}
  ${fila('Comprobantes', comprobantes)}
  ${fila(`Ventas canceladas (${r.canceladas.cantidad})`, formatoCentavos(r.canceladas.monto_centavos))}
  ${fila(`Líneas quitadas (${r.lineas_quitadas.cantidad})`, formatoCentavos(r.lineas_quitadas.monto_centavos))}
  ${lista('Pendientes de la DGII', r.pendientes)}
  ${lista('Rechazadas por la DGII', r.rechazadas)}
  <hr class="sep">
  <div class="b">EFECTIVO</div>
  ${fila('  Fondo inicial', formatoCentavos(r.fondo_centavos))}
  ${fila('+ Ventas en efectivo', formatoCentavos(r.efectivo_ventas_centavos))}
  ${r.efectivo_devoluciones_centavos > 0 ? fila('− Devoluciones en efectivo', formatoCentavos(r.efectivo_devoluciones_centavos)) : ''}
  ${fila('= Esperado', formatoCentavos(r.esperado_centavos), 'b')}
  <div class="b" style="margin-top:1mm">CONTEO</div>
  ${conteo}${otros}
  ${fila('Contado', formatoCentavos(r.contado_centavos), 'b')}
  <hr class="sep">
  <div class="c grande">${esc(textoDiferencia(r.diferencia_centavos))}</div>
  ${r.nota ? `<div style="margin-top:1mm"><b>Nota:</b> ${esc(r.nota)}</div>` : ''}
  <div class="firma">Firma de ${esc(r.empleado.nombre)}</div>
  ${cerroOtro ? `<div class="firma">Firma de ${esc(r.cerrado_por.nombre)} (supervisor)</div>` : ''}
  </div></body></html>`
}
