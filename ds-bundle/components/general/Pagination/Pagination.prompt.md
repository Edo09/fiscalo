Pagination from fiscalo. Use via `window.Fiscalo.Pagination` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface PaginationProps {
  page: number;
  /** Total de páginas (del backend). Si es null, se usa prev/next simple. */
  totalPages?: number;
  /** Total de registros (del backend) para el resumen "de N". */
  total?: number;
  pageSize: number;
  /** Nº de filas en la página actual (resumen + fallback de "siguiente"). */
  count: number;
  onPage: (page: number) => void;
  /** Si se pasa, muestra el selector de tamaño de página. */
  onPageSize?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Solo resumen + selector (sin botones de página). Para la barra superior. */
  compact?: boolean;
  /** Clase del contenedor (margen). Por defecto `mt-md`. */
  className?: string;
}
```
