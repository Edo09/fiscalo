// Fixture de graph.test.ts: zod entra por un import estático, así que quedaría en la clausura del arranque.
// No se compila ni se ejecuta (tsconfig.json y eslint.config.js excluyen tests/fixtures).
import { z } from 'zod'

export const texto = z.string()
