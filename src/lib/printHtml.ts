// Imprime una página HTML con el tamaño de papel exacto de su contenido.
//
// Existe por la tirilla: imprimiendo un PDF, Chrome usa el tamaño de papel del
// driver (p. ej. "80(72.1) x 297 mm") y la impresora saca 297 mm aunque el
// recibo mida 148, o corta uno más largo. Una página HTML puede decirle al
// navegador el tamaño de la hoja con `@page { size }`, y ese alto se mide aquí,
// ya dibujado, justo antes de imprimir.

/** px CSS -> mm (96 px por pulgada, 25,4 mm por pulgada). */
const PX_A_MM = 25.4 / 96

/**
 * Regla `@page` para una hoja del tamaño del contenido.
 *
 * El alto se redondea hacia arriba y lleva 1 mm de holgura: si el contenido
 * midiera una fracción más que la hoja, el navegador abriría una segunda hoja
 * casi vacía. Nunca más bajo que ancho: una hoja más ancha que alta la toma
 * como apaisada.
 */
export function reglaPagina(anchoMm: number, altoContenidoMm: number): string {
  const alto = Math.max(Math.ceil(altoContenidoMm) + 1, Math.ceil(anchoMm))
  return `@page { size: ${anchoMm}mm ${alto}mm; margin: 0; }`
}

/** Espera a que las imágenes (logo, QR) estén decodificadas: cambian el alto. */
async function esperarImagenes(doc: Document): Promise<void> {
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined),
    ),
  )
  // Las fuentes son del sistema (Arial/Times/Courier), pero si alguna tarda en
  // cargar, medir antes daría otro alto.
  await doc.fonts?.ready
}

/**
 * Alto en mm del elemento `selector` dentro del documento, ya dibujado. El
 * iframe tiene que tener el ancho del papel para que los saltos de línea sean
 * los mismos que en la hoja.
 */
export async function medirAltoMm(doc: Document, selector: string): Promise<number> {
  await esperarImagenes(doc)
  const el = doc.querySelector(selector)
  const alto = el ? el.getBoundingClientRect().height : doc.documentElement.scrollHeight
  return alto * PX_A_MM
}

/**
 * Manda `html` al diálogo de impresión en una hoja de `anchoMm` de ancho y el
 * alto de su elemento `selector`.
 *
 * Mismo esquema que printDocument (iframe fuera de la vista, se retira un
 * minuto después porque quitarlo con el diálogo abierto cancela la impresión).
 * Si el navegador no deja imprimir el iframe, abre la página en otra pestaña
 * con la regla @page ya puesta, para imprimirla con Ctrl+P.
 *
 * @returns true si se lanzó el diálogo; false si hubo que abrir la pestaña.
 */
export function printHtml(html: string, opts: { anchoMm: number; selector: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    // Con el ancho real del papel (los saltos de línea dependen de él) y fuera
    // de la vista. Sin display:none: un iframe sin caja no se dibuja y no se
    // puede medir.
    Object.assign(iframe.style, {
      position: 'fixed', left: '-10000px', top: '0',
      width: `${opts.anchoMm}mm`, height: '100px', border: '0', opacity: '0',
    } satisfies Partial<CSSStyleDeclaration>)

    let resuelto = false
    let urlPestana: string | null = null
    const limpiar = () => {
      setTimeout(() => {
        iframe.remove()
        if (urlPestana) URL.revokeObjectURL(urlPestana)
      }, 60_000)
    }
    const abrirEnPestana = (htmlFinal: string) => {
      if (resuelto) return
      resuelto = true
      urlPestana = URL.createObjectURL(new Blob([htmlFinal], { type: 'text/html' }))
      window.open(urlPestana, '_blank', 'noopener')
      limpiar()
      resolve(false)
    }

    iframe.onload = async () => {
      if (resuelto) return
      const win = iframe.contentWindow
      const doc = iframe.contentDocument
      // El `load` del about:blank inicial llega antes que el del srcdoc.
      if (!win || !doc || win.location.href !== 'about:srcdoc') return
      let htmlFinal = html
      try {
        const altoMm = await medirAltoMm(doc, opts.selector)
        const estilo = doc.createElement('style')
        estilo.textContent = reglaPagina(opts.anchoMm, altoMm)
        doc.head.appendChild(estilo)
        htmlFinal = '<!doctype html>' + doc.documentElement.outerHTML
        if (resuelto) return
        win.focus()
        win.print()
        resuelto = true
        limpiar()
        resolve(true)
      } catch {
        abrirEnPestana(htmlFinal)
      }
    }
    // Si el iframe nunca carga, no dejar la promesa (ni el botón) colgados.
    setTimeout(() => abrirEnPestana(html), 8000)

    iframe.srcdoc = html
    document.body.appendChild(iframe)
  })
}
