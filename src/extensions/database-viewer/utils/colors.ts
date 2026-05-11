/**
 * Convert a `#rrggbb` hex to `rgba(r, g, b, alpha)`. Returns the input
 * unchanged if it doesn't match the 6-digit hex shape — keeps the
 * existing palette working but tolerates user-provided values too.
 */
export function hexToRgba(hex: string, alpha: number): string {
  if (typeof hex !== 'string') return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const h = match[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Notion-style soft pill: background at ~15% alpha, text at full
 * saturation. Returns CSS values ready to spread into a `style` prop.
 */
export function pillStyle(color: string): { backgroundColor: string; color: string } {
  return {
    backgroundColor: hexToRgba(color, 0.15),
    color,
  };
}

/**
 * Slightly stronger tint for board-lane header chips — a hair more
 * opaque than the cell pill so the lane header reads as a container
 * rather than just a label.
 */
export function laneHeaderStyle(color: string): { backgroundColor: string; color: string } {
  return {
    backgroundColor: hexToRgba(color, 0.2),
    color,
  };
}
