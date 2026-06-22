import * as React from 'react';

/**
 * Donut — from fiscalo@1.0.0.
 */
export interface DonutProps {
segments: { value: number; color: string }[]; size?: number; thickness?: number;
}

export declare const Donut: React.ComponentType<DonutProps>;
