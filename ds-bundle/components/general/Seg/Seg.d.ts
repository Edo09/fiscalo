import * as React from 'react';

/**
 * Seg — from fiscalo@1.0.0.
 */
export interface SegProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export declare const Seg: React.ComponentType<SegProps>;
