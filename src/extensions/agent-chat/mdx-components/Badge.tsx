import React from 'react';
import { cn } from '@/lib/utils';

type BadgeColor = 'accent' | 'muted' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  color?: BadgeColor;
  children?: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ color = 'muted', children }) => {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        color === 'accent' && 'bg-accent-muted text-accent',
        color === 'muted' && 'bg-bg-elevated text-text-secondary',
        color === 'success' && 'bg-success/15 text-success',
        color === 'warning' && 'bg-warning/15 text-warning',
        color === 'error' && 'bg-error/15 text-error',
        color === 'info' && 'bg-info/15 text-info',
      )}
    >
      {children}
    </span>
  );
};

export default Badge;
