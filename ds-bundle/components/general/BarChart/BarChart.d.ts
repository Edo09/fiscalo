import * as React from 'react';

/**
 * BarChart — from fiscalo@1.0.0.
 */
export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  /** Multiplicador para el tooltip (mock en miles -> 1000; API en pesos -> 1). */
  valueScale?: number;
  legend?: { primary: string; secondary?: string; };
}

export declare const BarChart: React.ComponentType<BarChartProps>;
