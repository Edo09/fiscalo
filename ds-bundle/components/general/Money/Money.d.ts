import * as React from 'react';

/**
 * Money — from fiscalo@1.0.0.
 */
export interface MoneyProps {
  value: number;
  cur?: boolean;
  className?: string;
  sign?: boolean;
}

export declare const Money: React.ComponentType<MoneyProps>;
