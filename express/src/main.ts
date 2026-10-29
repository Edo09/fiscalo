// Stub S0: trae `redondear` de src/ por ruta relativa (fuera de la carpeta express/,
// que es justo lo que el spike comprueba) y escribe "S0 ok" en la pagina.
import { redondear } from '../../src/features/invoices/montosLinea.ts'

const raiz = document.getElementById('app')
if (raiz) {
  raiz.textContent = 'S0 ok'
  // Usa la funcion de verdad para que el bundle la traiga y no se descarte.
  raiz.dataset.redondear = String(redondear(84.75 * 0.18, 2))
}
