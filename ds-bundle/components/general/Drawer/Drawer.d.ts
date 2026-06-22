import * as React from 'react';

/**
 * Drawer — from fiscalo@1.0.0.
 */
export interface DrawerProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}

export declare const Drawer: React.ComponentType<DrawerProps>;
