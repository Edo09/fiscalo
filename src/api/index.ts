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
export { listClients } from './clients'
export { listUsers } from './users'
export { getStats } from './stats'
export { login, logout, type LoginResult } from './auth'
export {
  listGastos,
  getGasto,
  getGastoStats,
  getGastoEstado,
  getGastoXml,
  createGasto,
} from './gastos'
export { formatApiDate, dgiiLabel, isRechazo, formatMonthKey, mapFacturaRow, mapClientRow, mapUserRow } from './mappers'
