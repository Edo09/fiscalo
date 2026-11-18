// Arma el query string de una URL. Vive aparte de http.ts (que importa la sesión del navegador) para que lo que arma
// rutas (rutas-cobros.ts) se pueda probar con Node, sin navegador. http.ts lo re-exporta: siempre se importó de allí.

/** Construye un query string a partir de pares definidos (lo vacío no se manda). */
export function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
