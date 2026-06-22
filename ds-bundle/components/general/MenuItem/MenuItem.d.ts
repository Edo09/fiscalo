import * as React from 'react';

/**
 * MenuItem — from fiscalo@1.0.0.
 */
export interface MenuItemProps {
  icon?: string;
  children?: React.ReactNode;
  danger?: boolean;
  onClick?: () => void;
}

export declare const MenuItem: React.ComponentType<MenuItemProps>;
