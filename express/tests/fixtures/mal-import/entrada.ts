// Fixture de graph.test.ts: un import de VALOR a un módulo prohibido (api/mappers.ts, anexo 3.3).
// No se compila ni se ejecuta (tsconfig.json y eslint.config.js excluyen tests/fixtures): el recorrido del grafo solo lee los import.
import * as mappers from '../../../../src/api/mappers'

export { mappers }
