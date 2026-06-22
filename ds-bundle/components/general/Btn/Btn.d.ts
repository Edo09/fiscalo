import * as React from 'react';

/**
 * Btn — from fiscalo@1.0.0.
 */
export interface BtnProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "" | "sm" | "lg";
  icon?: string;
  iconRight?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}

export declare const Btn: React.ComponentType<BtnProps>;
