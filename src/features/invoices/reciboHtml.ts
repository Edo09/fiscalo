// HTML del recibo de tirilla, para imprimirlo como página web.
//
// Los textos llegan ya formateados del backend (ReciboPos::datos), con los
// mismos helpers que el PDF: aquí solo se decide dónde va cada uno. Tamaños de
// letra y altos de renglón copiados de ReciboPos para que las dos salidas se
// vean igual. A diferencia del PDF, el texto que no cabe se parte solo, así que
// no hace falta medir etiquetas ni montos.
import type { ReciboDatos } from '@/api'

/** Selector del contenedor que se mide para fijar el alto de la hoja. */
export const SELECTOR_RECIBO = '.recibo'

const FUENTES: Record<ReciboDatos['fuente'], string> = {
  Arial: 'Arial, Helvetica, sans-serif',
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
}

function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Solo imágenes embebidas: nada de URLs que la página tenga que ir a buscar. */
function imagen(uri: string | null, clase: string, alt: string): string {
  return uri && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(uri)
    ? `<img class="${clase}" src="${uri}" alt="${esc(alt)}">`
    : ''
}

function pares(lista: [string, string][]): string {
  if (lista.length === 0) return ''
  const filas = lista.map(([etiqueta, valor]) => `<b>${esc(etiqueta)}:</b><span>${esc(valor)}</span>`).join('')
  return `<div class="pares">${filas}</div>`
}

const SEPARADOR = '<hr class="sep">'

export function reciboHtml(d: ReciboDatos): string {
  const { ancho_mm: ancho, margen_mm: margen } = d.papel

  const emisor = [
    imagen(d.logo, 'logo', 'Logo'),
    d.emisor.razon_social && `<div class="emisor">${esc(d.emisor.razon_social)}</div>`,
    d.emisor.rnc && `<div class="chico centro">${esc(d.emisor.rnc)}</div>`,
    d.emisor.direccion && `<div class="chico centro">${esc(d.emisor.direccion)}</div>`,
    d.emisor.contacto && `<div class="chico centro">${esc(d.emisor.contacto)}</div>`,
  ].filter(Boolean).join('')

  const receptor = d.receptor
    ? pares(d.receptor.pares)
      + (d.receptor.contacto ? `<div>${esc(d.receptor.contacto)}</div>` : '')
      + SEPARADOR
    : ''

  const lineas = d.lineas.map((l) => `
    <div class="linea">
      <div class="desc">${esc(l.descripcion)}</div>
      <div class="fila">
        <span class="cp">${esc(l.cantidad_precio)}${l.itbis ? ` <span class="itbis">(${esc(l.itbis)})</span>` : ''}</span>
        <span class="valor">${esc(l.valor)}</span>
      </div>
    </div>`).join('')

  const totales = d.totales.map((t) => `
    <div class="${t.total ? 'tot total' : 'tot'}"><span>${esc(t.etiqueta)}:</span><span>${esc(t.valor)}</span></div>`).join('')

  const timbre = d.timbre
    ? `${imagen(d.timbre.qr, 'qr', 'Código QR de la DGII')}
      ${d.timbre.aviso_preview ? `<div class="aviso centro">${esc(d.timbre.aviso_preview)}</div>` : ''}
      <div class="centro etiqueta">Código de Seguridad</div>
      <div class="centro codigo">${esc(d.timbre.codigo_seguridad)}</div>
      <div class="centro etiqueta">Fecha de Firma</div>
      <div class="centro">${esc(d.timbre.fecha_firma)}</div>
      ${SEPARADOR}`
    : ''

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(d.nombre)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; color: #000; }
  body {
    width: ${ancho}mm;
    font-family: ${FUENTES[d.fuente] ?? FUENTES.Arial};
    font-size: 7pt; line-height: 3.2mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .recibo { width: ${ancho}mm; padding: ${margen}mm; overflow-wrap: anywhere; }
  .centro { text-align: center; }
  .logo { display: block; max-width: 34mm; max-height: 14mm; margin: 0 auto 1.5mm; }
  .emisor { font-weight: bold; font-size: 9pt; line-height: 4mm; text-align: center; }
  .chico { font-size: 6.5pt; line-height: 3mm; }
  .sep { border: 0; border-top: 0.15mm solid #000; margin: 1.2mm 0; }
  .titulo { font-weight: bold; font-size: 8pt; line-height: 3.6mm; text-align: center; margin-bottom: 1mm; }
  .pares { display: grid; grid-template-columns: fit-content(55%) 1fr; column-gap: 1.5mm; }
  .cabecera { display: flex; justify-content: space-between; font-weight: bold; font-size: 6.5pt; }
  .cabecera + .sep { margin: 0.5mm 0; }
  .linea { margin-bottom: 0.8mm; }
  .desc { white-space: pre-line; }
  .fila { display: flex; justify-content: space-between; align-items: baseline; gap: 1.5mm; }
  .cp { font-size: 6.5pt; min-width: 0; }
  .itbis { display: inline-block; white-space: nowrap; margin-left: 1mm; }
  .valor { white-space: nowrap; }
  .motivo { font-size: 6.5pt; }
  .tot { display: grid; grid-template-columns: 1fr minmax(45%, max-content); column-gap: 1mm; line-height: 3.6mm; }
  .tot > span { text-align: right; }
  .tot > span:last-child { white-space: nowrap; }
  .total { font-weight: bold; font-size: 9pt; line-height: 5mm; }
  .qr { display: block; width: 26mm; height: 26mm; margin: 0 auto 1.5mm; image-rendering: pixelated; }
  .aviso { font-weight: bold; }
  .etiqueta { font-weight: bold; font-size: 6.5pt; }
  .codigo { font-size: 8pt; line-height: 3.6mm; }
  .pie { font-size: 6pt; line-height: 2.8mm; text-align: center; }
  .pie + .pie { margin-top: 1mm; }
</style>
</head>
<body>
<main class="recibo">
  ${emisor}
  ${SEPARADOR}
  <div class="titulo">${esc(d.titulo)}</div>
  ${pares(d.identificacion)}
  ${SEPARADOR}
  ${receptor}
  <div class="cabecera"><span>CANT. x PRECIO</span><span>VALOR</span></div>
  ${SEPARADOR}
  ${lineas}
  ${d.motivo ? `<div class="motivo">Motivo: ${esc(d.motivo)}</div>` : ''}
  ${SEPARADOR}
  ${totales}
  ${SEPARADOR}
  ${timbre}
  ${d.leyenda_qr ? `<div class="pie">${esc(d.leyenda_qr)}</div>` : ''}
  <div class="pie">${esc(d.gracias)}</div>
</main>
</body>
</html>`
}
