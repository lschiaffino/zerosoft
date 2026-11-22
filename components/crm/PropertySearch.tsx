'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

interface PropertyFilter {
  query: string;
  hideEmpty: boolean;
}

const Ctx = createContext<PropertyFilter | null>(null);

/** ¿La propiedad entra con la búsqueda y "ocultar vacías" de la columna? Sin buscador arriba, todas. */
export function usePropertyMatch(): (field: { key: string; label: string; value: string; display?: string }, editing?: boolean) => boolean {
  const f = useContext(Ctx);
  return (field, editing) => {
    if (!f || editing) return true;
    if (f.hideEmpty && !field.value.trim()) return false;
    const q = f.query.trim().toLowerCase();
    if (!q) return true;
    return [field.label, field.display ?? '', field.value].some((s) => s.toLowerCase().includes(q));
  };
}

/**
 * Columna de propiedades de la ficha con buscador, como "Buscar propiedades" de
 * HubSpot: filtra las filas de todas las tarjetas por nombre o valor, y se
 * pueden ocultar las vacías. Las tarjetas sin coincidencias se ocultan
 * (styles/crm-list-hs.css).
 */
export default function PropertySearch({ children }: { children: ReactNode }) {
  const t = useTranslations('crm.propSearch');
  const [query, setQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const on = query.trim() !== '' || hideEmpty;
  return (
    <Ctx.Provider value={{ query, hideEmpty }}>
      <div className="prop-search">
        <input
          className="input prop-search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          data-testid="prop-search"
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm prop-search-empty"
          aria-pressed={hideEmpty}
          onClick={() => setHideEmpty((v) => !v)}
          data-testid="prop-hide-empty"
        >
          {hideEmpty ? t('showEmpty') : t('hideEmpty')}
        </button>
      </div>
      <div className={on ? 'prop-search-on' : undefined} data-testid="prop-search-scope">
        {children}
        {on && <p className="muted prop-search-none">{t('empty')}</p>}
      </div>
    </Ctx.Provider>
  );
}
