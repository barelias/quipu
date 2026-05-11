import React from 'react';

interface StatProps {
  label?: string;
  value?: React.ReactNode;
  hint?: string;
}

const Stat: React.FC<StatProps> = ({ label, value, hint }) => {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-bg-surface px-3 py-2 my-1">
      {label && <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>}
      <div className="text-base font-semibold text-text-primary">{value}</div>
      {hint && <div className="text-xs text-text-secondary">{hint}</div>}
    </div>
  );
};

export default Stat;
