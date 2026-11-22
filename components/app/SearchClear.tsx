'use client';

/**
 * La × para vaciar un buscador, en lugar de la nativa de `input type="search"`
 * (que dibuja el navegador y no sigue el diseño). Va justo después del campo,
 * dentro de un contenedor con `position: relative`; el campo lleva
 * `data-clearable` para esconder la nativa y dejarle lugar (styles/ui.css).
 * Al tocarla vacía el campo y le devuelve el foco, como en WhatsApp.
 */
export default function SearchClear({ shown, onClear, label }: { shown: boolean; onClear: () => void; label: string }) {
  if (!shown) return null;
  return (
    <button
      type="button"
      className="ui-search-clear"
      aria-label={label}
      title={label}
      data-testid="search-clear"
      // Sin robarle el foco al campo: el clic no lo saca del buscador.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        onClear();
        const input = e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[data-clearable]');
        input?.focus();
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </button>
  );
}
