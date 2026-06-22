import * as React from 'react';

/**
 * Tabs — from fiscalo@1.0.0.
 */
export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

export declare const Tabs: React.ComponentType<TabsProps>;
