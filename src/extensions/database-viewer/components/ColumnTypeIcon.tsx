import React from 'react';
import {
  TextAaIcon,
  HashIcon,
  CircleHalfIcon,
  ListChecksIcon,
  CalendarIcon,
  CheckSquareIcon,
  LinkSimpleIcon,
} from '@phosphor-icons/react';
import type { ColumnType } from '../types';

/**
 * Tiny type-marker rendered next to each column header — matches the
 * pattern Notion uses (`Aa` / `#` / `◇` / `▤`) so users can tell column
 * types at a glance without reading the value cells.
 */
const ICONS: Partial<Record<ColumnType, React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill' }>>> = {
  text: TextAaIcon,
  number: HashIcon,
  select: CircleHalfIcon,
  'multi-select': ListChecksIcon,
  date: CalendarIcon,
  checkbox: CheckSquareIcon,
  link: LinkSimpleIcon,
};

const ColumnTypeIcon: React.FC<{ type: ColumnType; size?: number }> = ({ type, size = 12 }) => {
  const Icon = ICONS[type];
  if (!Icon) return null;
  return (
    <span className="inline-flex items-center text-text-tertiary shrink-0" aria-hidden="true">
      <Icon size={size} weight="bold" />
    </span>
  );
};

export default ColumnTypeIcon;
