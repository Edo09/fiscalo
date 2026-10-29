// Dinero en pesos dominicanos como se lee en pantalla: `RD$ 11,800.00`. Los miles van con coma y los decimales con punto (es-DO), con los
// mismos formatos que la app completa (`fmt` y `fmt0` de src/lib/format.ts); aquí se les pone la moneda delante y el signo de un negativo
// va antes de ella: `-RD$ 11,800.00`, no `RD$ -11,800.00`.
import { aNumero, fmt, fmt0 } from '@/lib/format'

/**
 * `formato(|v|)` con la moneda delante. El signo solo se escribe si lo que se ve no es cero: `Intl` escribe `-0` como «-0.00» y un negativo
 * que se redondea a cero (-0.004) también quedaría así, y «-RD$ 0.00» no es un monto.
 */
function moneda(v: number, formato: (n: number) => string): string {
  const texto = formato(Math.abs(v))
  return v < 0 && /[1-9]/.test(texto) ? `-RD$ ${texto}` : `RD$ ${texto}`
}

/**
 * `11800` es `RD$ 11,800.00`. Acepta el DECIMAL en texto que manda MySQL (`"11800.00"`); lo que no es un número (NaN, vacío) se ve como cero,
 * igual que en `aNumero`.
 */
export function rd(n: number): string {
  return moneda(aNumero(n), fmt)
}

/** Sin centavos, para las cifras grandes de los tiles: `23600` es `RD$ 23,600` y `184250.4` es `RD$ 184,250`. */
export function rd0(n: number): string {
  return moneda(aNumero(n), fmt0)
}
