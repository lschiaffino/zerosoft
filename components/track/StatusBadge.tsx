'use client';

import { StatusDot } from './InlineEditors';

interface StatusBadgeProps {
  name: string | null;
  color: string | null;
  category?: string | null;
}

/** Status de solo lectura: el color va en el glifo, el texto siempre en tinta. */
export default function StatusBadge({ name, color, category = null }: StatusBadgeProps) {
  if (!name) return <span className="track-badge">–</span>;
  return (
    <span className="track-badge">
      <StatusDot color={color} category={category} />
      {name}
    </span>
  );
}
