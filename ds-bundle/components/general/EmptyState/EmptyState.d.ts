import * as React from 'react';

/**
 * EmptyState — from fiscalo@1.0.0.
 */
export interface EmptyStateProps {
  icon?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

export declare const EmptyState: React.ComponentType<EmptyStateProps>;
