import * as React from 'react';

/**
 * Sparkline — from fiscalo@1.0.0.
 */
export interface SparklineProps {
data: number[]; color?: string; width?: number; height?: number;
}

export declare const Sparkline: React.ComponentType<SparklineProps>;
