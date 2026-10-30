// Configura zod antes de que se cargue ningún esquema: `jitless` apaga la compilación de los validadores con `new Function`, que la CSP de Express
// (sin 'unsafe-eval') no deja correr.
//
// Solo tiene efecto al importarse. Va PRIMERO entre los imports de cada trozo perezoso que trae zod (los módulos se evalúan en el orden en que se
// importan, así que la configuración corre antes de que un esquema se construya). Nunca se importa desde main.tsx ni desde App.tsx: zod en el arranque
// revienta el presupuesto del primer pintado, y `check-graph` falla si aparece allí.
import { z } from 'zod'

z.config({ jitless: true })
