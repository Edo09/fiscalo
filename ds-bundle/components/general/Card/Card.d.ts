import * as React from 'react';

/**
 * Card — from fiscalo@1.0.0.
 */
export interface CardProps {
  title?: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  noPad?: boolean;
}

export declare const Card: React.ComponentType<CardProps>;
