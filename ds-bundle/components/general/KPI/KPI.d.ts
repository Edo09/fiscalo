import * as React from 'react';

/**
 * KPI — from fiscalo@1.0.0.
 */
export interface KPIProps {
label: string; value: number | string; money?: boolean; icon?: string; iconBg?: string; iconColor?: string; delta?: string; deltaDir?: 'up' | 'down'; foot?: React.ReactNode;
}

export declare const KPI: React.ComponentType<KPIProps>;
