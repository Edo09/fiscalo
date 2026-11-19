// API falsa de fiscalo, SOLO para medir la interfaz con el barrido (nunca toca produccion).
// Uso: node scripts/responsive-sweep/mock-api.mjs [--port=8795] [--vacio] [--out=<carpeta>]
//   --vacio  listas sin filas, como una empresa nueva
//   --out    donde se guardan los resultados (por defecto <carpeta temporal>/fiscalo-sweep, o SWEEP_OUT)
// Ademas guarda los resultados del barrido: POST /api/__sweep/save?name=<ruta relativa> -> <out>/<ruta>
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as fx from './fixtures.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const port = Number(args.port || 8795)
const vacio = Boolean(args.vacio)
const outDir = path.resolve(String(args.out || process.env.SWEEP_OUT || path.join(os.tmpdir(), 'fiscalo-sweep')))

const user = {
  id: 1, email: 'demo@fiscalo.test', username: 'demo', name: 'Usuario Demo',
  role: 'admin', permissions: ['*'],
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

function pagina(items, u) {
  const q = (u.searchParams.get('query') || '').toLowerCase()
  const filtrados = q ? items.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : items
  const pageSize = Math.max(1, Number(u.searchParams.get('pageSize')) || 20)
  const page = Math.max(1, Number(u.searchParams.get('page')) || 1)
  const total = filtrados.length
  return { items: filtrados.slice((page - 1) * pageSize, page * pageSize), pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }
}

// ---- POS (cajero): PIN 1234 entra directo a la venta con el turno abierto ----
const posEmp = { id: 7, nombre: 'Carlos Martínez', rol: 'cajero', activo: true }
const posCaja = { id: 1, nombre: 'Caja 1', activa: true }
const posTurno = { id: 11, empleado_id: 7, empleado_nombre: 'Carlos Martínez', abierto_at: '2026-11-19 08:00:00', fondo_inicial: 500000, de_dia_anterior: false }
const POS_CATS = [{ id: 1, nombre: 'Bebidas', color: null, productos: 6 }, { id: 2, nombre: 'Comida', color: null, productos: 6 }, { id: 3, nombre: 'Snacks', color: null, productos: 4 }, { id: 4, nombre: 'Servicios', color: null, productos: 2 }]
const POS_NOMBRES = [['Agua 500 ml', 1], ['Refresco cola 355 ml', 1], ['Jugo de naranja natural', 1], ['Café con leche', 1], ['Cerveza Presidente 12 oz', 1], ['Malta Morena', 1], ['Sándwich de pollo', 2], ['Pizza personal', 2], ['Pica pollo con tostones', 2], ['Empanada de queso', 2], ['Arepa rellena', 2], ['Ensalada César', 2], ['Papas fritas', 3], ['Galletas de avena', 3], ['Chocolate en barra', 3], ['Chicle de menta', 3], ['Recarga celular', 4], ['Envío a domicilio', 4]]
const posCatalogo = () => ({
  productos: POS_NOMBRES.map(([nombre, cat], i) => ({ id: 700 + i, nombre, sku: 'P' + (100 + i), category_id: cat, precio_centavos: 6000 + i * 3500, listas: i % 5 === 0 ? [{ lista: 2, precio_centavos: 5500 + i * 3000 }] : [], tasa: 18, indicador_facturacion: 1, stock: cat === 4 ? null : 12 + i, stock_minimo: 5, unidad_medida: '43', decimales: false, imagen: null })),
  categorias: POS_CATS, generado_at: '2026-11-19 09:00:00',
})
async function pos(req, res, pathname, u) {
  const sesion = !!req.headers['x-pos-sesion']
  const ok = (data) => send(res, 200, { status: true, data })
  let body = {}
  if (req.method !== 'GET') { try { body = JSON.parse((await readBody(req)).toString() || '{}') } catch { body = {} } }
  if (pathname === '/api/pos/estado') return ok({ empresa: { nombre: 'Empresa Demo SRL', rnc: '131880681' }, equipo: { id: 1, nombre: 'Equipo caja 1', bloqueado: false, bloqueo_segundos: 0 }, caja: posCaja, empleado: sesion ? posEmp : null, turno_caja: sesion ? posTurno : null })
  if (pathname === '/api/pos/sesion' && req.method === 'POST') return body.pin === '1234' ? ok({ token: 'sesion-demo', empleado: posEmp, caja: posCaja, turno_caja: posTurno }) : send(res, 401, { status: false, error: 'PIN incorrecto', codigo: 'PIN_INCORRECTO', intentos_restantes: 4 })
  if (pathname === '/api/pos/sesion') return ok({ cerrada: true })
  if (pathname === '/api/pos/catalogo') return ok(posCatalogo())
  if (pathname === '/api/pos/turno' && req.method === 'POST') return ok({ turno_caja: posTurno })
  if (pathname === '/api/pos/ventas/dia') return ok({ fecha: '2026-11-19', caja: { id: 1, nombre: 'Caja 1' }, empleado: { id: 7, nombre: 'Carlos Martínez' }, resumen: { cantidad: 3, total_centavos: 184200, por_forma: [{ forma_pago: 1, nombre: 'Efectivo', cantidad: 2, total_centavos: 120000 }, { forma_pago: 3, nombre: 'Tarjeta', cantidad: 1, total_centavos: 64200 }] }, ventas: [1, 2, 3].map((i) => ({ factura_id: 900 + i, e_ncf: 'E32000000' + (100 + i), tipo_ecf: 'E32', fecha: '2026-11-19 10:0' + i + ':00', total_centavos: 60000 + i * 1400, forma_pago: 1, forma_pago_nombre: 'Efectivo', estado_dgii: 'ACEPTADO', envio_pendiente: false, turno_id: 11, cliente: null })) })
  if (pathname === '/api/pos/ventas' && req.method === 'GET') return ok({ turno_caja: posTurno, ventas: [] })
  if (pathname === '/api/pos/clientes/rnc') return ok({ cliente: { id: 5, nombre: 'Cliente Demo SRL', rnc: '101000000', descuento: 10, lista_precio: null }, nuevo: false, estado_dgii: null })
  return ok({})
}

const listas = {
  '/api/clients': fx.clients, '/api/products': fx.products, '/api/categories': fx.categories, '/api/warehouses': fx.warehouses,
  '/api/facturas': fx.facturas, '/api/facturas-simples': fx.facturasSimples, '/api/gastos': fx.gastos, '/api/users': fx.users,
  '/api/roles': fx.roles, '/api/proveedores': fx.proveedores, '/api/audit-logs': fx.auditLogs, '/api/ncf/rangos': fx.ncfRangos,
  '/api/inventario/ajustes': fx.ajustes, '/api/cotizaciones': fx.cotizaciones, '/api/ecf/recepcion': fx.ecfRecibidos,
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const { pathname } = u

    if (req.method === 'POST' && pathname === '/api/__sweep/save') {
      const name = u.searchParams.get('name') || ''
      if (!/^[A-Za-z0-9_@.\-/]+$/.test(name) || name.includes('..')) return send(res, 400, { error: 'nombre' })
      const file = path.join(outDir, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, await readBody(req))
      return send(res, 200, { ok: true })
    }

    if (pathname.startsWith('/api/pos/')) return pos(req, res, pathname, u)

    if (req.method !== 'GET') {
      console.log(req.method, pathname)
      return send(res, 200, { status: true, data: {} })
    }
    if (pathname === '/api/auth/me') return send(res, 200, { success: true, data: { user } })
    if (pathname === '/api/emisor')
      return send(res, 200, { status: true, data: { rnc: '131880681', razon_social: 'EMPRESA DEMO SRL', nombre_comercial: 'Empresa Demo' } })
    if (pathname === '/api/branding') return send(res, 200, { status: true, pos_enabled: true, data: { pos_enabled: true } })

    if (pathname === '/api/facturas/stats') return send(res, 200, { status: true, data: vacio ? { secuencias: [] } : fx.stats() })
    if (pathname === '/api/gastos/stats') return send(res, 200, { status: true, data: fx.gastosStats() })
    if (pathname === '/api/facturas-simples/stats') return send(res, 200, { status: true, data: fx.facturasSimplesStats() })
    if (pathname === '/api/facturas/avisos')
      return send(res, 200, { status: true, data: { certificado_fallo: { ventas_hoy: 0 }, secuencias: [], sin_rango: { ventas: 0 } } })
    if (pathname === '/api/inventario/valor') {
      const v = fx.valorInventario()
      const p = pagina(vacio ? [] : v.rows, u)
      return send(res, 200, { status: true, data: p.items, totales: vacio ? { productos: 0, existencia: 0, valor: 0 } : v.totales, hasta: '2026-11-19', pagination: p.pagination })
    }
    if (pathname === '/api/audit-logs/resumen')
      return send(res, 200, { status: true, data: { total: 1280, fallidos: 14, accesos_denegados: 3, logins_fallidos: 5, usuarios: 3, top_usuarios: [{ user_id: 1, username: 'usuario0', email: 'usuario0@empresa.com.do', total: 700 }], por_modulo: [{ module: 'facturas', total: 800 }, { module: 'auth', total: 300 }] } })
    if (pathname === '/api/audit-logs/facetas')
      return send(res, 200, { status: true, data: { modulos: ['facturas', 'auth', 'clientes'], acciones: ['CREATE', 'UPDATE', 'EMIT'], usuarios: [{ user_id: 1, username: 'usuario0', email: 'usuario0@empresa.com.do' }] } })

    if (pathname === '/api/reportes/606/preview') return send(res, 200, { status: true, data: fx.reporte606() })
    if (pathname === '/api/reportes/607/preview') return send(res, 200, { status: true, data: fx.reporte607() })
    if (pathname === '/api/reportes/ventas') return send(res, 200, { status: true, data: fx.reporteVentas(u.searchParams.get('agrupar') || 'documento') })

    const gen = listas[pathname]
    if (gen) {
      const p = pagina(vacio ? [] : gen(), u)
      return send(res, 200, { status: true, data: p.items, pagination: p.pagination })
    }
    return send(res, 200, { status: true, data: [], pagination: { total: 0, page: 1, pageSize: 20, totalPages: 1 } })
  })
  .listen(port, '127.0.0.1', () => console.log('mock-api up on', port, vacio ? '(vacio)' : '(con datos)', 'out:', outDir))
