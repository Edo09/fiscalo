BarChart from fiscalo. Use via `window.Fiscalo.BarChart` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface BarChartProps {
  data: BarDatum[];
  height?: number;
  /** Multiplicador para el tooltip (mock en miles -> 1000; API en pesos -> 1). */
  valueScale?: number;
  legend?: { primary: string; secondary?: string; };
}
```
