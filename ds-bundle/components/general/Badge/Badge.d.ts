import * as React from 'react';

/**
 * Badge — from fiscalo@1.0.0.
 */
export interface BadgeProps {
  tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger";
  dot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export declare const Badge: React.ComponentType<BadgeProps>;
