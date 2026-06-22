import * as React from 'react';

/**
 * Image — from fiscalo@1.0.0.
 */
export interface ImageProps {
src?: string; alt?: string; width?: number | string; height?: number | string; className?: string; style?: React.CSSProperties; loading?: 'eager' | 'lazy'; onClick?: React.MouseEventHandler<HTMLImageElement>;
}

export declare const Image: React.ComponentType<ImageProps>;
