// Control de existencias en las ventas (spec 2026-10-19-control-existencias-ventas):
// las funciones puras de src/features/inventory/existencia.ts. Leen el error
// estructurado STOCK_INSUFICIENTE que manda el API, arman el texto que ve el
// usuario, y hacen la revisión local (solo un aviso: el API tiene la última
// palabra) de lo que una venta pide contra la existencia que la pantalla conoce.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-existencia.ts
import { ApiError } from '../src/api/errores.ts'
import {
  CODIGO_STOCK_INSUFICIENTE, consumoPorProducto, datosStockInsuficiente, estadoExistencia, faltantesLocales,
  ecfRevisaExistencia, faltantesLocalesEcf, lineasPrefillAjuste, textoFaltante,
} from '../src/features/inventory/existencia.ts'
import type { FaltanteStock } from '../src/features/inventory/existencia.ts'

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean) => {
  total++
  if (!ok) fallos++
  console.log(`  [${ok ? 'OK  ' : 'FALLA'}] ${desc}`)
}

// Igualdad profunda sin mirar el orden de las claves. Los Map se comparan como
// lista de pares [id, cantidad] ordenada por id.
const ordenar = (v: unknown): unknown =>
  v instanceof Map
    ? [...v.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, x]) => [k, ordenar(x)])
    : Array.isArray(v)
      ? v.map(ordenar)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar((v as Record<string, unknown>)[k])]))
        : v
const json = (v: unknown): string => JSON.stringify(ordenar(v))
const igual = (desc: string, obtenido: unknown, esperado: unknown) => {
  const ok = json(obtenido) === json(esperado)
  chk(ok ? desc : `${desc}: dio ${json(obtenido)}, se esperaba ${json(esperado)}`, ok)
}

// La fila tal como la manda el API (spec 4.4): números JSON, claves en snake_case.
const FILA_API = {
  product_id: 12, nombre: 'Cemento gris', sku: 'CEM-01', unidad_medida: 'Unidad',
  solicitado: 5, disponible: 2, faltante: 3,
}
const FALTANTE: FaltanteStock = {
  productId: 12, nombre: 'Cemento gris', sku: 'CEM-01', unidadMedida: 'Unidad', solicitado: 5, disponible: 2, faltante: 3,
}
const error422 = (datos: unknown, codigo: string | null = CODIGO_STOCK_INSUFICIENTE, status = 422): ApiError =>
  new ApiError('No hay existencia suficiente de «Cemento gris»: pides 5 y hay 2.', status, { datos, codigo })

console.log('CODIGO_STOCK_INSUFICIENTE')
igual('es el código que manda el API', CODIGO_STOCK_INSUFICIENTE, 'STOCK_INSUFICIENTE')

// --- datosStockInsuficiente --------------------------------------------------
console.log('datosStockInsuficiente: lee el error estructurado del API')
igual('422 con faltantes -> la lista, con las claves del front', datosStockInsuficiente(error422({ faltantes: [FILA_API] })), [FALTANTE])
igual('sin código en el error (API sin el código aún) pero con faltantes -> también se lee',
  datosStockInsuficiente(error422({ faltantes: [FILA_API] }, null)), [FALTANTE])
igual('varios productos -> todos, en el orden que llegan',
  datosStockInsuficiente(error422({ faltantes: [FILA_API, { ...FILA_API, product_id: 30, nombre: 'Varilla', solicitado: 1, disponible: 0, faltante: 1 }] }))
    ?.map((f) => f.productId), [12, 30])
igual('sku y unidad ausentes o nulos -> null en el front',
  datosStockInsuficiente(error422({ faltantes: [{ product_id: 7, nombre: 'Flete', solicitado: 1, disponible: 0, faltante: 1, sku: null }] })),
  [{ productId: 7, nombre: 'Flete', sku: null, unidadMedida: null, solicitado: 1, disponible: 0, faltante: 1 }])
igual('cantidades como texto DECIMAL ("2.500") también se leen como número',
  datosStockInsuficiente(error422({ faltantes: [{ ...FILA_API, solicitado: '5.000', disponible: '2.500', faltante: '2.500' }] }))
    ?.map((f) => [f.solicitado, f.disponible, f.faltante]), [[5, 2.5, 2.5]])
igual('un 409 con los mismos datos -> null (409 es "pantalla desactualizada", nunca existencia)',
  datosStockInsuficiente(error422({ faltantes: [FILA_API] }, CODIGO_STOCK_INSUFICIENTE, 409)), null)
igual('un 500 con los mismos datos -> null', datosStockInsuficiente(error422({ faltantes: [FILA_API] }, null, 500)), null)
igual('422 con otro código -> null', datosStockInsuficiente(error422({ faltantes: [FILA_API] }, 'OTRO_CODIGO')), null)
igual('422 llano (producto inexistente, cantidad <= 0): sin datos -> null', datosStockInsuficiente(error422(undefined, null)), null)
igual('422 con datos que no son faltantes -> null', datosStockInsuficiente(error422({ otra: 1 }, null)), null)
igual('422 con datos nulos -> null', datosStockInsuficiente(error422(null, null)), null)
igual('422 con datos de texto -> null', datosStockInsuficiente(error422('hola', null)), null)
igual('faltantes vacío -> null (no hay nada que mostrar)', datosStockInsuficiente(error422({ faltantes: [] })), null)
igual('faltantes que no es lista -> null', datosStockInsuficiente(error422({ faltantes: 'x' })), null)
igual('una fila rota se descarta y las buenas se conservan',
  datosStockInsuficiente(error422({ faltantes: [null, { nombre: 'sin id' }, 5, FILA_API] })), [FALTANTE])
igual('todas las filas rotas -> null', datosStockInsuficiente(error422({ faltantes: [null, { nombre: 'sin id' }] })), null)
igual('un Error cualquiera -> null', datosStockInsuficiente(new Error('boom')), null)
igual('null -> null', datosStockInsuficiente(null), null)
igual('undefined -> null', datosStockInsuficiente(undefined), null)
igual('un texto -> null', datosStockInsuficiente('STOCK_INSUFICIENTE'), null)
igual('un objeto suelto con la forma de un ApiError -> null (solo vale un ApiError de verdad)',
  datosStockInsuficiente({ status: 422, codigo: CODIGO_STOCK_INSUFICIENTE, datos: { faltantes: [FILA_API] } }), null)

// --- textoFaltante -----------------------------------------------------------
console.log('textoFaltante: la frase de cada producto')
{
  const t = textoFaltante(FALTANTE)
  igual('pide 5 y hay 2: la frase completa', t, 'No hay existencia suficiente de «Cemento gris»: pides 5 y hay 2.')
  chk('menciona el nombre, el 5 y el 2', t.includes('Cemento gris') && t.includes('5') && t.includes('2'))
}
{
  const t = textoFaltante({ ...FALTANTE, disponible: 0, faltante: 5 })
  chk(`disponible 0 -> no lleva signo menos (dio "${t}")`, !t.includes('-') && t.includes('hay 0'))
}
{
  const t = textoFaltante({ ...FALTANTE, disponible: -3, faltante: 8 })
  chk(`un disponible negativo que llegara mal nunca se muestra como "quedan -3" (dio "${t}")`, !t.includes('-') && t.includes('hay 0'))
}
{
  const t = textoFaltante({ ...FALTANTE, solicitado: 0.3, disponible: 0.299, faltante: 0.001 })
  chk(`decimales: sin ceros de relleno, con punto decimal (dio "${t}")`, t.includes('pides 0.3 y hay 0.299'))
}
{
  const t = textoFaltante({ ...FALTANTE, solicitado: 1200, disponible: 1000 })
  chk(`miles con separador de la app (dio "${t}")`, t.includes('pides 1,200 y hay 1,000'))
}
{
  // El front arma su propio texto: aquí el nombre se muestra siempre. El API lo
  // omite de SU frase porque el humanizador la tomaría por una constante interna.
  const t = textoFaltante({ ...FALTANTE, nombre: 'CABLE_THHN_12' })
  chk(`un nombre que parece constante se muestra igual (dio "${t}")`, t.includes('«CABLE_THHN_12»'))
}

// --- consumoPorProducto ------------------------------------------------------
console.log('consumoPorProducto: lo que una venta pide, por producto')
igual('suma las líneas repetidas del mismo producto',
  consumoPorProducto([{ productId: 1, cantidad: 3 }, { productId: 2, cantidad: 1 }, { productId: 1, cantidad: 3 }]),
  new Map([[1, 6], [2, 1]]))
igual('salta las líneas sin producto (texto libre)',
  consumoPorProducto([{ productId: null, cantidad: 9 }, { productId: 1, cantidad: 2 }]), new Map([[1, 2]]))
igual('salta los servicios',
  consumoPorProducto([{ productId: 5, cantidad: 4, esServicio: true }, { productId: 1, cantidad: 2, esServicio: false }]),
  new Map([[1, 2]]))
igual('una línea de cantidad cero, negativa o inválida no cuenta (no puede tapar otra)',
  consumoPorProducto([
    { productId: 1, cantidad: 0 }, { productId: 1, cantidad: -4 }, { productId: 1, cantidad: Number.NaN },
    { productId: 1, cantidad: 2 },
  ]),
  new Map([[1, 2]]))
igual('sin líneas -> mapa vacío', consumoPorProducto([]), new Map())
chk('0.1 + 0.2 da exactamente 0.3 (sin ruido binario)',
  consumoPorProducto([{ productId: 1, cantidad: 0.1 }, { productId: 1, cantidad: 0.2 }]).get(1) === 0.3)

// --- faltantesLocales --------------------------------------------------------
console.log('faltantesLocales: la revisión local contra la existencia conocida')
type Existencias = Parameters<typeof faltantesLocales>[1]
const bien = (stock: number | null, extra: Record<string, unknown> = {}) =>
  ({ stock, nombre: 'Cemento gris', esServicio: false, sku: 'CEM-01', unidadMedida: 'Unidad', ...extra })
const hay = (id: number, stock: number | null, extra: Record<string, unknown> = {}): Existencias =>
  new Map([[id, bien(stock, extra)]])

igual('pide 5 y hay 2 -> falta 3, con nombre, sku y unidad del producto',
  faltantesLocales(new Map([[12, 5]]), hay(12, 2)), [FALTANTE])
igual('existencia nula cuenta como 0',
  faltantesLocales(new Map([[12, 4]]), hay(12, null)), [{ ...FALTANTE, solicitado: 4, disponible: 0, faltante: 4 }])
igual('existencia 0 rechaza cualquier cantidad',
  faltantesLocales(new Map([[12, 1]]), hay(12, 0)), [{ ...FALTANTE, solicitado: 1, disponible: 0, faltante: 1 }])
igual('un servicio nunca falta, aunque no tenga existencia',
  faltantesLocales(new Map([[12, 5]]), hay(12, null, { esServicio: true })), [])
igual('exactamente igual pasa', faltantesLocales(new Map([[12, 5]]), hay(12, 5)), [])
igual('sobra existencia: pasa', faltantesLocales(new Map([[12, 5]]), hay(12, 50)), [])
igual('0.1 + 0.2 contra 0.3 pasa (milésimas, no flotantes)',
  faltantesLocales(consumoPorProducto([{ productId: 12, cantidad: 0.1 }, { productId: 12, cantidad: 0.2 }]), hay(12, 0.3)), [])
igual('0.3 contra 0.299 falta 0.001',
  faltantesLocales(new Map([[12, 0.3]]), hay(12, 0.299)), [{ ...FALTANTE, solicitado: 0.3, disponible: 0.299, faltante: 0.001 }])
igual('existencia negativa: disponible 0 y falta pedido - existencia (5 contra -3 -> 8)',
  faltantesLocales(new Map([[12, 5]]), hay(12, -3)), [{ ...FALTANTE, solicitado: 5, disponible: 0, faltante: 8 }])
igual('un producto que la pantalla aún no conoce no se marca (no hay dato que comparar)',
  faltantesLocales(new Map([[99, 5]]), hay(12, 0)), [])
igual('un producto cuya existencia no se ha cargado (undefined) no se marca',
  faltantesLocales(new Map([[12, 5]]), hay(12, undefined as unknown as null)), [])
igual('sin consumo -> sin faltantes', faltantesLocales(new Map(), hay(12, 0)), [])
igual('sin sku ni unidad en la existencia -> null',
  faltantesLocales(new Map([[12, 5]]), new Map([[12, { stock: 2, nombre: 'Cemento gris', esServicio: false }]])),
  [{ ...FALTANTE, sku: null, unidadMedida: null }])
igual('varios productos salen ordenados por id, como los del API',
  faltantesLocales(
    new Map([[30, 2], [12, 5]]),
    new Map([[30, bien(0, { nombre: 'Varilla' })], [12, bien(2)]]),
  ).map((f) => f.productId), [12, 30])

console.log('faltantesLocales: editar una factura guardada (el crédito de lo que ya tiene)')
igual('guardada con 3 y existencia 1: pasar a 5 -> disponible 4, falta 1',
  faltantesLocales(new Map([[12, 5]]), hay(12, 1), new Map([[12, 3]])), [{ ...FALTANTE, solicitado: 5, disponible: 4, faltante: 1 }])
igual('guardada con 3 y existencia 1: dejar 3 -> sin faltante', faltantesLocales(new Map([[12, 3]]), hay(12, 1), new Map([[12, 3]])), [])
igual('guardada con 3 y existencia 1: bajar a 2 -> sin faltante', faltantesLocales(new Map([[12, 2]]), hay(12, 1), new Map([[12, 3]])), [])
igual('guardada con 3 y existencia 1: pedir 4 (justo lo que hay + lo suyo) pasa',
  faltantesLocales(new Map([[12, 4]]), hay(12, 1), new Map([[12, 3]])), [])
igual('el crédito de otro producto no ayuda',
  faltantesLocales(new Map([[12, 5]]), hay(12, 1), new Map([[30, 3]])), [{ ...FALTANTE, solicitado: 5, disponible: 1, faltante: 4 }])
igual('existencia negativa con crédito: -3 + 1 = -2 -> disponible 0, falta 5 + 2',
  faltantesLocales(new Map([[12, 5]]), hay(12, -3), new Map([[12, 1]])), [{ ...FALTANTE, solicitado: 5, disponible: 0, faltante: 7 }])
igual('crédito con decimales: 0.1 + 0.2 contra existencia 0 y crédito 0.3 pasa',
  faltantesLocales(consumoPorProducto([{ productId: 12, cantidad: 0.1 }, { productId: 12, cantidad: 0.2 }]), hay(12, 0), new Map([[12, 0.3]])), [])

// El formulario de factura simple arma el crédito con consumoPorProducto sobre las
// líneas con las que se abrió la factura (lo mismo que revierte el API al editar).
console.log('faltantesLocales: el crédito sale de las líneas guardadas de la factura')
{
  const guardadas = consumoPorProducto([
    { productId: 12, cantidad: 2 }, { productId: 12, cantidad: 2 }, { productId: null, cantidad: 9 }, { productId: 30, cantidad: 1 },
  ])
  igual('dos líneas guardadas del mismo producto suman y las libres no cuentan', guardadas, new Map([[12, 4], [30, 1]]))
  igual('guardada con 2 + 2 y existencia 1: pasar a 7 -> disponible 5, falta 2',
    faltantesLocales(new Map([[12, 7]]), hay(12, 1), guardadas), [{ ...FALTANTE, solicitado: 7, disponible: 5, faltante: 2 }])
  igual('guardada con 2 + 2 y existencia 1: dejar 4 -> sin faltante',
    faltantesLocales(new Map([[12, 4]]), hay(12, 1), guardadas), [])
  igual('una línea nueva de otro producto no usa el crédito de las guardadas',
    faltantesLocales(new Map([[12, 4], [31, 2]]), new Map([[12, bien(1)], [31, bien(0, { nombre: 'Varilla' })]]), guardadas)
      .map((f) => [f.productId, f.disponible, f.faltante]), [[31, 0, 2]])
  igual('sin facturas guardadas (factura nueva) el crédito vacío no cambia nada',
    faltantesLocales(new Map([[12, 5]]), hay(12, 2), consumoPorProducto([])), [FALTANTE])
}

// Tras un rechazo el formulario guarda lo que el API dijo que hay. En una edición su
// `disponible` ya incluye el crédito (C13): la existencia propia se deduce como
// solicitado - faltante - crédito, y con ella la revisión local da la misma fila.
console.log('faltantesLocales: la existencia deducida de una fila del API reproduce esa fila')
{
  const deduce = (fila: FaltanteStock, credito: number): number => fila.solicitado - fila.faltante - credito
  const casos: [string, FaltanteStock, number][] = [
    ['factura nueva (sin crédito)', FALTANTE, 0],
    ['edición: guardada con 3, existencia 1, pide 5', { ...FALTANTE, solicitado: 5, disponible: 4, faltante: 1 }, 3],
    ['edición con existencia negativa: -3, guardada con 1, pide 5', { ...FALTANTE, solicitado: 5, disponible: 0, faltante: 7 }, 1],
    ['decimales: existencia 0.299 pide 0.3', { ...FALTANTE, solicitado: 0.3, disponible: 0.299, faltante: 0.001 }, 0],
  ]
  for (const [desc, fila, credito] of casos) {
    const stock = deduce(fila, credito)
    igual(`${desc}: existencia deducida ${stock}`,
      faltantesLocales(new Map([[12, fila.solicitado]]), hay(12, stock), credito > 0 ? new Map([[12, credito]]) : undefined), [fila])
  }
}

// --- faltantesLocalesEcf -----------------------------------------------------
// El aviso de la factura electrónica (InvoiceFormView): la misma revisión, pero
// según el tipo de e-CF. Las entradas (E34 nota de crédito, E41) no sacan nada
// del almacén y el API no las revisa: la pantalla no debe avisar de lo que el
// API no va a rechazar.
console.log('faltantesLocalesEcf: el aviso del formulario de e-CF')
{
  const sobra = [{ productId: 12, cantidad: 5 }] // pide 5 contra existencia 2
  for (const t of ['31', '32', '33', '44', '45', '46']) {
    igual(`E${t} pide 5 y hay 2 -> falta 3`, faltantesLocalesEcf(t, sobra, hay(12, 2)), [FALTANTE])
  }
  igual('E34 (nota de crédito) no produce faltante aunque pida más de lo que hay',
    faltantesLocalesEcf('34', sobra, hay(12, 2)), [])
  igual('E41 (entrada) tampoco', faltantesLocalesEcf('41', sobra, hay(12, 0)), [])
  igual('una línea sin producto (texto libre) no produce faltante',
    faltantesLocalesEcf('32', [{ productId: null, cantidad: 9 }], hay(12, 0)), [])
  igual('un Bien sin datos de existencia (la lista aún no cargó) no se marca',
    faltantesLocalesEcf('32', sobra, new Map()), [])
  igual('un Bien de otro producto cargado no marca el que no se conoce',
    faltantesLocalesEcf('32', sobra, hay(99, 0)), [])
  igual('un Bien con existencia nula (cargado) cuenta como 0',
    faltantesLocalesEcf('32', [{ productId: 12, cantidad: 4 }], hay(12, null)), [{ ...FALTANTE, solicitado: 4, disponible: 0, faltante: 4 }])
  igual('una línea de servicio no se revisa',
    faltantesLocalesEcf('32', [{ productId: 12, cantidad: 5, esServicio: true }], hay(12, 0)), [])
  igual('el mismo producto en dos líneas se suma antes de comparar (2 de 3 contra 4 falta 2)',
    faltantesLocalesEcf('31', [{ productId: 12, cantidad: 3 }, { productId: 12, cantidad: 3 }], hay(12, 4)),
    [{ ...FALTANTE, solicitado: 6, disponible: 4, faltante: 2 }])
  igual('exactamente igual pasa', faltantesLocalesEcf('32', sobra, hay(12, 5)), [])
  igual('sin líneas -> sin faltantes', faltantesLocalesEcf('32', [], hay(12, 0)), [])
}

// ecfRevisaExistencia: la misma regla de tipos que usa faltantesLocalesEcf, para
// que el selector de productos (Agotado / Existencia N) y el aviso de las líneas
// coincidan: lo que el API no revisa no se pinta como agotado.
console.log('ecfRevisaExistencia: qué tipos de e-CF revisa el bloqueo')
{
  for (const t of ['31', '32', '33', '43', '44', '45', '46', '47']) {
    chk(`E${t} se revisa (saca del almacén)`, ecfRevisaExistencia(t) === true)
  }
  chk('E34 (nota de crédito) no se revisa: es una entrada', ecfRevisaExistencia('34') === false)
  chk('E41 (entrada) no se revisa', ecfRevisaExistencia('41') === false)
}

// --- estadoExistencia --------------------------------------------------------
// Lo que Productos muestra de la existencia (C18): con la regla activa un Bien sin
// existencia anotada vale 0 y sale «Agotado», porque eso es lo que hace el bloqueo
// (NULL cuenta como 0). Con la regla apagada todo queda como siempre: «N/A» y «Disponible».
console.log('estadoExistencia: la existencia que muestra Productos, con y sin la regla')
igual('regla activa, Bien con existencia en blanco -> se ve 0 y Agotado',
  estadoExistencia(null, false, true), { stock: 0, agotado: true })
igual('regla apagada, Bien con existencia en blanco -> sigue «N/A» y Disponible (como hoy)',
  estadoExistencia(null, false, false), { stock: null, agotado: false })
igual('regla activa, servicio sin existencia -> sigue «N/A»: un servicio no tiene existencia que bloquear',
  estadoExistencia(null, true, true), { stock: null, agotado: false })
igual('regla apagada, servicio sin existencia -> «N/A»', estadoExistencia(null, true, false), { stock: null, agotado: false })
for (const estricto of [true, false]) {
  const regla = estricto ? 'regla activa' : 'regla apagada'
  igual(`${regla}, Bien con 0 -> Agotado`, estadoExistencia(0, false, estricto), { stock: 0, agotado: true })
  igual(`${regla}, Bien con existencia negativa -> Agotado y se conserva el número guardado`,
    estadoExistencia(-3, false, estricto), { stock: -3, agotado: true })
  igual(`${regla}, Bien con 5 -> 5 y no agotado`, estadoExistencia(5, false, estricto), { stock: 5, agotado: false })
  igual(`${regla}, Bien con 0.001 -> no agotado (milésimas)`, estadoExistencia(0.001, false, estricto), { stock: 0.001, agotado: false })
}
{
  // La regla apagada no cambia nada de lo que ya se veía: ni para un Bien ni para un servicio.
  const hoy = (stock: number | null) => ({ stock, agotado: stock !== null && stock <= 0 })
  const distintos = [null, 0, 2.5, -1, 100].flatMap((s) => [false, true].map((srv) => [s, srv] as const))
    .filter(([s, srv]) => json(estadoExistencia(s, srv, false)) !== json(hoy(s)))
  igual('regla apagada: igual que la regla de siempre en todas las combinaciones', distintos, [])
}

// --- lineasPrefillAjuste -----------------------------------------------------
console.log('lineasPrefillAjuste: las líneas con las que se abre «Ajuste de inventario»')
igual('una línea por faltante, con cantidad = faltante',
  lineasPrefillAjuste([FALTANTE, { ...FALTANTE, productId: 30, nombre: 'Varilla', solicitado: 1, disponible: 0, faltante: 1 }]),
  [{ productId: 12, cantidad: 3 }, { productId: 30, cantidad: 1 }])
igual('con existencia negativa trae el stock hasta lo vendido (faltante 8, no 5)',
  lineasPrefillAjuste([{ ...FALTANTE, solicitado: 5, disponible: 0, faltante: 8 }]), [{ productId: 12, cantidad: 8 }])
igual('decimales', lineasPrefillAjuste([{ ...FALTANTE, faltante: 0.001 }]), [{ productId: 12, cantidad: 0.001 }])
igual('sin faltantes -> sin líneas', lineasPrefillAjuste([]), [])
igual('un faltante que no suma nada (0 o negativo) no genera línea: un ajuste de 0 no vale',
  lineasPrefillAjuste([{ ...FALTANTE, faltante: 0 }, { ...FALTANTE, productId: 30, faltante: -1 }]), [])

console.log(`\n${total - fallos}/${total} OK`)
if (fallos > 0) process.exit(1)
