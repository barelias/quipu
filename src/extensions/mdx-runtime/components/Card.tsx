import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: string;
  variant?: 'default' | 'subtle' | 'accent';
  children?: React.ReactNode;
}

/**
 * Quipu-styled card. Accepts only explicit props — `{...rest}` is
 * intentionally NOT spread so MDX authors cannot inject DOM attributes
 * (`dangerouslySetInnerHTML`, `onClick`, etc.) into the underlying div.
 */
const Card: React.FC<CardProps> = ({ title, variant = 'default', children }) => {
  return (
    <div
      className={cn(
        'rounded-md border border-border my-2 overflow-hidden',
        variant === 'default' && 'bg-bg-surface',
        variant === 'subtle' && 'bg-bg-elevated',
        variant === 'accent' && 'bg-accent-muted border-accent/30',
      )}
    >
      {title && (
        <div className="px-3 py-1.5 text-xs font-medium text-text-secondary border-b border-border/50">
          {title}
        </div>
      )}
      <div className="px-3 py-2 text-sm text-text-primary">
        {children}
      </div>
    </div>
  );
};

export default Card;
