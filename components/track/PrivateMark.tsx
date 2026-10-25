/** Candado de proyecto privado (solo lo ven sus miembros). */
export default function PrivateMark({ label }: { label: string }) {
  return (
    <span className="track-private-mark" title={label}>
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="11" width="14" height="9" rx="1" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
