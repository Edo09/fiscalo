import * as React from 'react';

/**
 * RefreshButton — from fiscalo@1.0.0.
 */
export interface RefreshButtonProps {
  onRefresh: () => unknown;
  children?: React.ReactNode;
}

export declare const RefreshButton: React.ComponentType<RefreshButtonProps>;
