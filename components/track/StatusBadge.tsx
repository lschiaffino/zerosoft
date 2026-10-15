'use client';

import { safeHexColor } from '@/lib/track-color';

interface StatusBadgeProps {
  name: string | null;
  color: string | null;
}

export default function StatusBadge({ name, color }: StatusBadgeProps) {
  if (!name) return <span className="track-badge">—</span>;

  const dotColor = safeHexColor(color, '#666666');
  const textColor = safeHexColor(color, 'currentColor');

  return (
    <span className="track-badge" style={{ color: textColor, borderColor: textColor }}>
      <span className="track-badge-dot" style={{ background: dotColor }} />
      {name}
    </span>
  );
}
