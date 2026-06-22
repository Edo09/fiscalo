import * as React from 'react';

/**
 * ErrorState — from fiscalo@1.0.0.
 */
export interface ErrorStateProps {
  title?: string;
  children?: React.ReactNode;
  onRetry?: () => void;
}

export declare const ErrorState: React.ComponentType<ErrorStateProps>;
