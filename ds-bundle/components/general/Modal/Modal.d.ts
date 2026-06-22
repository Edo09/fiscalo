import * as React from 'react';

/**
 * Modal — from fiscalo@1.0.0.
 */
export interface ModalProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  icon?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}

export declare const Modal: React.ComponentType<ModalProps>;
