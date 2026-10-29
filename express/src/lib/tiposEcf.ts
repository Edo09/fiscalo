// Lo que Express sabe de los tipos de comprobante (e-CF), contratos 4.4. Se vende E31 (crédito fiscal), E32 (consumo) y E45 (gubernamental);
// E33 y E34 (notas de débito y de crédito) salen en las filas y en el detalle, pero el asistente de ventas no las emite. Un código que Express
// no vende se trata con rigor: pide comprador y no permite crédito. Son reglas de validación previa, para no mandar al API lo que se sabe
// que rechazará; quien decide al emitir es el API.

/** Desde este total (RD$) una factura de consumo (E32) tiene que identificar al comprador: alcanza el 250000 exacto. */
export const UMBRAL_CONSUMO = 250000

/** Los tipos que el asistente de ventas puede emitir. */
const TIPOS_DE_VENTA = ['31', '32', '45']

const NOMBRES = new Map([
  ['45', 'Gubernamental'],
  ['31', 'Crédito fiscal'],
  ['32', 'Consumo'],
  ['34', 'Nota de crédito'],
  ['33', 'Nota de débito'],
])

/** ¿El asistente de ventas puede emitir este tipo? E31, E32 y E45; las notas (E33, E34) y los demás no. */
export function esTipoDeVenta(codigo: string): boolean {
  return TIPOS_DE_VENTA.includes(codigo)
}

/**
 * ¿Esta factura tiene que identificar al comprador? E31 y E45 siempre; E32 solo desde `UMBRAL_CONSUMO` (por debajo, el comprador es
 * opcional y sin él es «consumidor final»). Un código que Express no vende también lo pide.
 */
export function exigeComprador(codigo: string, total: number): boolean {
  return codigo === '32' ? total >= UMBRAL_CONSUMO : true
}

/** ¿Se puede vender a crédito? E31 y E45; el consumo (E32) es de contado, y un código que Express no vende no permite crédito. */
export function permiteCredito(codigo: string): boolean {
  return codigo === '31' || codigo === '45'
}

/** `Nueva factura E45`: el título de la pantalla donde se arma una venta de ese tipo. */
export function tituloNuevaFactura(codigo: string): string {
  return `Nueva factura E${codigo}`
}

/**
 * El nombre del comprobante: `45` Gubernamental, `31` Crédito fiscal, `32` Consumo, `34` Nota de crédito y `33` Nota de débito. Para armar
 * `Factura Gubernamental (E45)`. De un código que no está en la lista no se sabe más que el código: `E41`.
 */
export function nombreTipo(codigo: string): string {
  return NOMBRES.get(codigo) ?? `E${codigo}`
}
