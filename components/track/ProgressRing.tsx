// Liviano a propósito: lo usan las filas, el peek y el sidebar sin cargar SubIssues.
/** Círculo de progreso x/y (como el de los sub-issues de Linear). */
export function ProgressRing({ done, total, size = 14 }: { done: number; total: number; size?: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? done / total : 0;
  return (
    <svg className="track-progress-ring" viewBox="0 0 14 14" width={size} height={size} aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke={frac >= 1 ? 'var(--good, var(--ink))' : 'var(--ink)'}
        strokeWidth="2"
        strokeDasharray={`${c * frac} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
