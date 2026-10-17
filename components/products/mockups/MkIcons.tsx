/** Íconos dibujados de las vistas (trazo de 2px, puntas rectas). */

export function MkPlus() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function MkArrow({ dir = 'right' }: { dir?: 'left' | 'right' }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={dir === 'left' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M1 7h11M8 3l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

/** Casilla de una lista: vacía o tildada. */
export function MkCheck({ done }: { done: boolean }) {
  return (
    <span className={`mk-check${done ? ' is-done' : ''}`} aria-hidden="true">
      {done ? (
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M1.5 5.2 4 7.5l4.5-5" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      ) : null}
    </span>
  );
}
