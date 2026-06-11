// Punto de entrada del cliente API.
export * from './types'
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
export { listUsers } from './users'
export { getStats } from './stats'
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
