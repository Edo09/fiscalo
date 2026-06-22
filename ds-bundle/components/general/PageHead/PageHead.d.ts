import * as React from 'react';

/**
 * PageHead — from fiscalo@1.0.0.
 */
export interface PageHeadProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}

export declare const PageHead: React.ComponentType<PageHeadProps>;
