import React from 'react';
import { cn } from '@/lib/utils';

interface RowProps {
  gap?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

interface ColProps {
  grow?: number;
  children?: React.ReactNode;
}

export const Row: React.FC<RowProps> = ({ gap = 'md', children }) => {
  return (
    <div
      className={cn(
        'flex flex-row items-stretch my-2',
        gap === 'sm' && 'gap-1',
        gap === 'md' && 'gap-2',
        gap === 'lg' && 'gap-4',
      )}
    >
      {children}
    </div>
  );
};

export const Col: React.FC<ColProps> = ({ grow = 1, children }) => {
  return (
    <div className="flex flex-col" style={{ flexGrow: grow, flexBasis: 0 }}>
      {children}
    </div>
  );
};

export default Row;
