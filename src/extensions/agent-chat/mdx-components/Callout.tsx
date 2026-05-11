import React from 'react';
import { InfoIcon, WarningIcon, XCircleIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

type CalloutType = 'info' | 'warn' | 'error' | 'success';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children?: React.ReactNode;
}

const ICONS: Record<CalloutType, React.ComponentType<{ size?: number; weight?: 'bold' | 'fill' }>> = {
  info: InfoIcon,
  warn: WarningIcon,
  error: XCircleIcon,
  success: CheckCircleIcon,
};

const Callout: React.FC<CalloutProps> = ({ type = 'info', title, children }) => {
  const Icon = ICONS[type] ?? InfoIcon;
  return (
    <div
      className={cn(
        'flex gap-2 my-2 rounded-md border px-3 py-2 text-sm',
        type === 'info' && 'border-info/30 bg-info/5 text-text-primary',
        type === 'warn' && 'border-warning/40 bg-warning/10 text-text-primary',
        type === 'error' && 'border-error/40 bg-error/10 text-text-primary',
        type === 'success' && 'border-success/40 bg-success/10 text-text-primary',
      )}
    >
      <Icon size={16} weight="bold" />
      <div className="flex-1">
        {title && <div className="font-medium text-text-primary mb-0.5">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
};

export default Callout;
