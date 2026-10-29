// Fixture de graph.test.ts: imports que se borran al compilar, así que no son aristas del grafo, aunque apunten al barril `@/api`,
// que está prohibido (`montosLinea.ts` y `config/ecf.ts` lo importan así). Las dos formas: `import type` y todos los especificadores `type`.
// No se compila ni se ejecuta (tsconfig.json y eslint.config.js excluyen tests/fixtures).
import type { X } from '../../../../src/api/index'
import { type Y } from '../../../../src/api/index'

export type Par = [X, Y]
