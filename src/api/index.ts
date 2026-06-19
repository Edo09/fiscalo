// Punto de entrada del cliente API.
export * from './types'
export { createFacturaSchema } from './schemas/factura'
export { createGastoSchema } from './schemas/gasto'
export { ApiError } from './http'
export { DEFAULT_USER_ID } from './config'
export {
  listFacturas,
  getFactura,
  createFactura,
  previewFactura,
  getEstado,
  getDocumentBase64,
  type DocKind,
} from './facturas'
export { listClients, getClient, updateClient, deleteClient } from './clients'
export {
  listCotizaciones,
  getCotizacion,
  createCotizacion,
  updateCotizacion,
  deleteCotizacion,
  getCotizacionPdf,
  previewCotizacion,
} from './cotizaciones'
export { listProducts, getProduct, createProduct, updateProduct, deleteProduct } from './products'
export { listProveedores, getProveedor, createProveedor, updateProveedor, deleteProveedor } from './proveedores'
export { listCategories, getCategory, createCategory, updateCategory, deleteCategory } from './categories'
export { listWarehouses, getWarehouse, createWarehouse, updateWarehouse, deleteWarehouse } from './warehouses'
export { listNcfRangos, registerNcfRango } from './ncf'
export { listEcfRecibidos, aprobarEcfRecibido } from './recepcion'
export { listUnidadesMedida } from './unidadesMedida'
export { listUsers, getUser, createUser, updateUser, deleteUser } from './users'
export { listRoles, getRole, createRole, updateRole, deleteRole, assignUserRole } from './roles'
export { getStats } from './stats'
export { getReporte606Preview, downloadReporte606, getReporte607Preview, downloadReporte607 } from './reportes'
export { getEmisor } from './emisor'
export {
  getBranding,
  updateBranding,
  uploadBrandingLogo,
  deleteBrandingLogo,
  previewBranding,
  type BrandingInput,
} from './branding'
export { login, logout, type LoginResult } from './auth'
export {
  listGastos,
  getGasto,
  getGastoStats,
  getGastoEstado,
  getGastoXml,
  createGasto,
} from './gastos'
export { formatApiDate, dgiiLabel, isRechazo, formatMonthKey, mapFacturaRow, mapClientRow, mapProductRow, mapProveedorRow, mapUserRow } from './mappers'
