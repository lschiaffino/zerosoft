'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface DetailsTab {
  id: string;
  label: string;
  icon: ReactNode;
  /** Un número chico al lado del ícono (miembros, tareas abiertas). */
  count?: number;
  content: ReactNode;
}

/** Abre el panel del chat en una pestaña (el encabezado del chat, "Notas", "Agregar miembros"): `detail` es el id. */
export const DETAILS_TAB_EVENT = 'zs:details-tab';

/** Pedida con el panel todavía cerrado: la toma el panel al montarse. */
let pending: string | null = null;

export function showDetailsTab(id: string): void {
  pending = id;
  window.dispatchEvent(new CustomEvent<string>(DETAILS_TAB_EVENT, { detail: id }));
}

function readTab(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveTab(key: string, id: string) {
  try {
    window.localStorage.setItem(key, id);
  } catch {
    /* sin almacenamiento: vale para esta vista */
  }
}

/**
 * Las pestañas del panel de un chat en Lines e Inbox, como el de Periskope: Info, Miembros, Archivos, Notas,
 * Tareas y CRM, con ícono y nombre. La elegida queda guardada por persona y por app (localStorage); si el chat no
 * tiene esa pestaña (Miembros en un 1:1) se abre la primera. Teclado: flechas, Inicio y Fin entre pestañas
 * (foco itinerante), Tab entra al contenido. Cada pestaña se dibuja la primera vez que se abre y después queda
 * montada aunque esté oculta, así no se pierde lo que se estaba escribiendo ni se vuelve a pedir lo cargado.
 */
export default function DetailsTabs({ tabs, storageKey, label }: { tabs: DetailsTab[]; storageKey: string; label: string }) {
  const uid = useId();
  const ids = tabs.map((t) => t.id);
  const [active, setActive] = useState(ids[0]);
  const [seen, setSeen] = useState<Set<string>>(() => new Set([ids[0]]));
  const list = useRef<HTMLDivElement>(null);

  const pick = useCallback(
    (id: string, persist = true) => {
      setActive(id);
      setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
      if (persist) saveTab(storageKey, id);
    },
    [storageKey],
  );

  // La pestaña guardada (después de montar: en el servidor no hay localStorage).
  useEffect(() => {
    const wanted = pending && ids.includes(pending) ? pending : null;
    pending = null;
    if (wanted) return pick(wanted);
    const saved = readTab(storageKey);
    if (saved && ids.includes(saved)) pick(saved, false);
    // Solo al montar o al cambiar de persona o de app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Cambia el chat y la pestaña abierta ya no está (Miembros al pasar a un 1:1): la primera.
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!ids.includes(active)) pick(ids[0], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Desde afuera (encabezado del chat, menú, comandos): abrir una pestaña.
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!ids.includes(id)) return;
      pending = null;
      pick(id);
    };
    window.addEventListener(DETAILS_TAB_EVENT, onTab);
    return () => window.removeEventListener(DETAILS_TAB_EVENT, onTab);
  }, [idsKey, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = ids.indexOf(active);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const id = ids[(next + ids.length) % ids.length];
    pick(id);
    list.current?.querySelector<HTMLButtonElement>(`[data-details-tab="${id}"]`)?.focus();
  };

  return (
    <div className="wa-dtabs-wrap">
      <div ref={list} className="wa-dtabs" role="tablist" aria-label={label} onKeyDown={onKeyDown} data-count={tabs.length}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-controls={`${uid}-panel-${t.id}`}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={`wa-dtab${on ? ' is-on' : ''}`}
              data-details-tab={t.id}
              title={t.label}
              onClick={() => pick(t.id)}
            >
              <span className="wa-dtab-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="wa-dtab-label">{t.label}</span>
              {!!t.count && <span className="wa-dtab-count">{t.count > 99 ? '99+' : t.count}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((t) =>
        seen.has(t.id) ? (
          <div
            key={t.id}
            role="tabpanel"
            id={`${uid}-panel-${t.id}`}
            aria-labelledby={`${uid}-tab-${t.id}`}
            className="wa-dtab-panel"
            data-details-panel={t.id}
            hidden={t.id !== active}
          >
            {t.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
