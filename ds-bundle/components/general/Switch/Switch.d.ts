import * as React from 'react';

/**
 * Switch — from fiscalo@1.0.0.
 */
export interface SwitchProps {
  on: boolean;
  onChange?: (value: boolean) => void;
}

export declare const Switch: React.ComponentType<SwitchProps>;
