import * as React from 'react';

/**
 * Dropdown — from fiscalo@1.0.0.
 */
export interface DropdownProps {
  trigger: React.ReactNode;
  children?: React.ReactNode;
  align?: "left" | "right";
  width?: number;
  /** Clase del contenedor (p.ej. `desktop-only` para ocultarlo en móvil). */
  className?: string;
}

export declare const Dropdown: React.ComponentType<DropdownProps>;
