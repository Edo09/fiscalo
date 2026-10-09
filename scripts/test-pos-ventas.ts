// Ventas abiertas del POS (src/pos/carrito.ts): pestañas por empleado, guardadas
// en el equipo, máximo 5, cobro en duda congelado y precios al día en todas.
//
// Uso (Node 22.18+ quita los tipos solo, sin compilar):
//   node scripts/test-pos-ventas.ts

// localStorage del equipo, en memoria (Node no lo trae).
const datos = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => datos.get(k) ?? null,
  setItem: (k: string, v: string) => { datos.set(k, v) },
  removeItem: (k: string) => { datos.delete(k) },
  key: (i: number) => [...datos.keys()][i] ?? null,
  get length() { return datos.size },
}

type Store = typeof import('../src/pos/carrito.ts')
/** Un módulo nuevo = la página recién cargada (memoria vacía, mismo equipo). */
const cargar = (n: number): Promise<Store> => import(`../src/pos/carrito.ts?carga=${n}`) as Promise<Store>

let fallos = 0
let total = 0
const chk = (desc: string, ok: boolean, obtenido?: unknown) => {
  total++
  if (ok) console.log(`  ok  ${desc}`)
  else { fallos++; console.log(`  FALLA  ${desc}${obtenido !== undefined ? ` -> ${JSON.stringify(obtenido)}` : ''}`) }
}

const prod = (id: number, precio: number) => ({
  id, nombre: `Producto ${id}`, sku: `P${id}`, category_id: null, precio_centavos: precio, tasa: 0.18,
  indicador_facturacion: 1, stock: 10, stock_minimo: null, unidad_medida: '43', decimales: false, imagen: null,
})
const cliente = { id: 7, nombre: 'GRATEX EIRL', rnc: '131256432', descuento: 0 }
const cuerpo = {
  tipo_ecf: '32' as const, client_id: null, clave: 'clave-1', lineas: [{ product_id: 2, cantidad: 1 }],
  total_centavos: 500, forma_pago: 1 as const, recibido_centavos: null, ancho: 80, iniciada_ms: null,
}

const { useCarritoStore: s1, MAX_VENTAS, nombreVenta } = await cargar(1)
const st = () => s1.getState()

console.log('Entrar y vender')
st().abrirVentasDe(1, 10)
chk('el empleado arranca con una venta vacía', st().ventas.length === 1 && st().lineas.length === 0 && st().dueno === '1.10')
st().agregar(prod(1, 1000) as never)
chk('agregar va a la venta activa', st().lineas.length === 1 && st().ventas[0].lineas.length === 1)
chk('se guarda en el equipo', datos.has('fiscalpoint.pos.ventas.1.10'))

console.log('Ventas en espera')
const v1 = st().activaId
chk('nueva venta', st().nuevaVenta() === true && st().ventas.length === 2)
chk('la nueva es la activa y está vacía', st().activaId !== v1 && st().lineas.length === 0)
chk('se llama Venta 2', nombreVenta(st().ventas[1]) === 'Venta 2')
st().agregar(prod(2, 500) as never)
st().ponerCliente(cliente)
chk('con cliente, la pestaña toma su nombre', nombreVenta(st().ventas[1]) === 'GRATEX EIRL')
const v2 = st().activaId
st().cambiarA(v1)
chk('volver a la primera: su carrito, sin cliente', st().lineas[0]?.productoId === 1 && st().cliente === null)
st().cambiarA(v2)
chk('y la segunda conserva el suyo', st().lineas[0]?.productoId === 2 && st().cliente?.id === 7)

console.log(`Máximo ${MAX_VENTAS}`)
while (st().ventas.length < MAX_VENTAS) st().nuevaVenta()
chk(`no pasa de ${MAX_VENTAS}`, st().nuevaVenta() === false && st().ventas.length === MAX_VENTAS)

console.log('Cobro en duda')
st().cambiarA(v2)
st().marcarCobroEnDuda(cuerpo as never)
st().agregar(prod(3, 300) as never)
chk('con cobro en duda no se agrega', st().lineas.length === 1)
st().cerrarVenta(v2)
chk('ni se cierra', st().ventas.some((v) => v.id === v2))

console.log('Catálogo nuevo')
st().guardarCatalogo({ productos: [prod(1, 1200), prod(2, 999)], categorias: [], generado_at: '' } as never)
const venta1 = st().ventas.find((v) => v.id === v1)
const venta2 = st().ventas.find((v) => v.id === v2)
chk('precio nuevo en una venta en espera', venta1?.lineas[0].precioCentavos === 1200, venta1?.lineas[0].precioCentavos)
chk('la venta en duda no cambia', venta2?.lineas[0].precioCentavos === 500, venta2?.lineas[0].precioCentavos)

console.log('Otro empleado en la misma caja')
st().abrirVentasDe(1, 20)
chk('ve solo las suyas (una vacía)', st().ventas.length === 1 && st().lineas.length === 0 && st().dueno === '1.20')
st().abrirVentasDe(1, 10)
chk('el primero recupera sus ventas', st().ventas.length === MAX_VENTAS)
chk('con el cobro en duda y su clave', st().ventas.find((v) => v.id === v2)?.cobroEnDuda?.clave === 'clave-1')

console.log('Recargar la página')
const { useCarritoStore: s2 } = await cargar(2)
chk('memoria nueva: nada', s2.getState().ventas.length === 1 && s2.getState().dueno === null)
s2.getState().abrirVentasDe(1, 10)
chk('al entrar con el PIN, las ventas siguen', s2.getState().ventas.length === MAX_VENTAS)
chk('la activa es la misma de antes', s2.getState().activaId === st().activaId)
chk('el cobro en duda sigue congelado', s2.getState().ventas.find((v) => v.id === v2)?.cobroEnDuda?.clave === 'clave-1')

console.log('Cobrar y cerrar')
const a = s2.getState()
a.cambiarA(v1)
const antes = a.ventas.length
s2.getState().terminarActiva()
chk('cobrada con otras abiertas: se cierra su pestaña', s2.getState().ventas.length === antes - 1 && !s2.getState().ventas.some((v) => v.id === v1))
const libres = s2.getState().ventas.map((v) => v.numero)
s2.getState().nuevaVenta()
const nueva = s2.getState().ventas[s2.getState().ventas.length - 1]
chk('la nueva toma el número libre', nueva.numero === 1 && !libres.includes(1), nueva.numero)

console.log('La última venta')
const { useCarritoStore: s3 } = await cargar(3)
s3.getState().abrirVentasDe(2, 30)
s3.getState().agregar(prod(1, 1000) as never)
s3.getState().terminarActiva()
chk('si es la única, queda vacía (no desaparece)', s3.getState().ventas.length === 1 && s3.getState().lineas.length === 0)
chk('vacía no deja nada guardado', !datos.has('fiscalpoint.pos.ventas.2.30'))

console.log('Olvidar el equipo')
s2.getState().olvidarTodo()
chk('no queda ninguna venta guardada', ![...datos.keys()].some((k) => k.startsWith('fiscalpoint.pos.ventas.')), [...datos.keys()])

console.log(`\n${total - fallos}/${total} ok`)
if (fallos > 0) process.exit(1)
