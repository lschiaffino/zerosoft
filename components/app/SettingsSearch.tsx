'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { crumbText, groupHits, navigateToSetting, searchSettings, settingHref, type SettingsSearchItem } from '@/lib/settings-search';

/** El índice de la persona, uno por idioma: se pide una vez por pestaña (lo arma /api/settings/search). */
const cache = new Map<string, Promise<SettingsSearchItem[]>>();

function loadIndex(locale: string): Promise<SettingsSearchItem[]> {
  let p = cache.get(locale);
  if (!p) {
    p = fetch(`/api/settings/search?locale=${encodeURIComponent(locale)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: SettingsSearchItem[] }) => d.items ?? [])
      .catch(() => {
        cache.delete(locale);
        return [];
      });
    cache.set(locale, p);
  }
  return p;
}

export function useSettingsIndex(): SettingsSearchItem[] | null {
  const locale = useLocale();
  const [items, setItems] = useState<SettingsSearchItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadIndex(locale).then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, [locale]);
  return items;
}

/** Solo una caja por página toma "/" y ⌘F (la última montada). */
const shortcutOwners: symbol[] = [];

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/**
 * Búsqueda de Ajustes como la del Mac: una caja que encuentra ajustes (no solo
 * páginas) por sus palabras, en cualquiera de los tres idiomas, con sinónimos
 * y errores de tipeo chicos. Los resultados van agrupados por área con sus
 * migas; Enter (o un clic) lleva a la página, baja hasta el ajuste y lo marca.
 *
 * - `nav`: arriba de la nav de /app/settings; los resultados reemplazan la
 *   lista mientras hay texto (`onQueryChange` avisa para esconderla).
 * - `header`: en la cabecera de los ajustes de cada app; los resultados
 *   flotan debajo de la caja.
 *
 * Teclado: "/" o ⌘F (Ctrl+F) enfoca la caja, flechas recorren, Enter abre,
 * Esc limpia (y con la caja vacía, en `header`, cierra).
 */
export default function SettingsSearch({ variant, onQueryChange }: { variant: 'nav' | 'header'; onQueryChange?: (q: string) => void }) {
  const t = useTranslations('settings.search');
  const router = useRouter();
  const items = useSettingsIndex();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const listId = `st-search-list-${uid}`;

  const hits = useMemo(() => (items && q.trim() ? searchSettings(items, q) : []), [items, q]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits.map((h) => h.item)), [groups]);
  const shown = q.trim() !== '' && (variant === 'nav' || open);
  // En la cabecera, con la caja enfocada y vacía: sugerencias de qué buscar.
  const hint = variant === 'header' && open && focused && q.trim() === '';
  const suggestions = useMemo(
    () =>
      String(t.raw('suggestions'))
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
    [t],
  );

  const change = useCallback(
    (value: string) => {
      setQ(value);
      setActive(0);
      setOpen(true);
      onQueryChange?.(value);
    },
    [onQueryChange],
  );

  // "/" y ⌘F enfocan la caja (⌘F reemplaza la búsqueda del navegador en Ajustes).
  useEffect(() => {
    const me = Symbol('settings-search');
    shortcutOwners.push(me);
    function onKey(e: globalThis.KeyboardEvent) {
      if (shortcutOwners[shortcutOwners.length - 1] !== me || e.defaultPrevented) return;
      const input = inputRef.current;
      if (!input || !input.offsetParent) return;
      const find = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f';
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target);
      if (!find && !slash) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      input.focus();
      input.select();
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = shortcutOwners.indexOf(me);
      if (i >= 0) shortcutOwners.splice(i, 1);
    };
  }, []);

  // En la cabecera, un clic afuera cierra los resultados (el texto queda).
  useEffect(() => {
    if (variant !== 'header' || !open) return;
    function onDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [variant, open]);

  // La opción activa queda a la vista al moverse con flechas.
  useEffect(() => {
    if (!shown) return;
    // Solo dentro de la lista flotante: scrollIntoView movería también el marco de la app.
    const el = document.getElementById(`${listId}-${active}`);
    const pop = el?.closest<HTMLElement>('.st-search-pop');
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    if (r.top < p.top) pop.scrollTop -= p.top - r.top + 6;
    else if (r.bottom > p.bottom) pop.scrollTop += r.bottom - p.bottom + 6;
  }, [active, shown, listId]);

  function pick(item: SettingsSearchItem) {
    if (variant === 'header') setOpen(false);
    navigateToSetting((href, scroll) => router.push(href, { scroll }), settingHref(item.href, item.anchor));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!flat.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % flat.length : (i - 1 + flat.length) % flat.length));
    } else if (e.key === 'Home' && shown && flat.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && shown && flat.length) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      const item = flat[active] ?? flat[0];
      if (item && shown) {
        e.preventDefault();
        pick(item);
      }
    } else if (e.key === 'Escape') {
      if (q) {
        e.preventDefault();
        e.stopPropagation();
        change('');
      } else if (variant === 'header') {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
  }

  const tryRow = (
    <p className="st-search-try">
      <span>{t('try')}</span>
      {suggestions.map((s) => (
        <button key={s} type="button" className="st-search-suggestion" onMouseDown={(e) => e.preventDefault()} onClick={() => change(s)}>
          {s}
        </button>
      ))}
    </p>
  );

  let index = -1;
  const body: ReactNode = hint ? (
    <div className="st-search-empty">
      <p>{t('hint')}</p>
      {tryRow}
    </div>
  ) : !shown ? null : items === null ? (
    <p className="st-search-empty" role="status">
      {t('loading')}
    </p>
  ) : flat.length === 0 ? (
    <div className="st-search-empty" role="status" data-testid="settings-search-empty">
      <p>{t('noResults', { q: q.trim() })}</p>
      {tryRow}
    </div>
  ) : (
    <div className="st-search-groups" role="listbox" id={listId} aria-label={t('results')}>
      {groups.map((g) => (
        <div key={g.area} role="group" aria-labelledby={`${listId}-g-${g.area}`} className="st-search-group">
          <p className="st-search-heading" id={`${listId}-g-${g.area}`} role="presentation">
            {g.product && <i className="st-nav-swatch" style={{ background: `var(--c-${g.product})` }} aria-hidden="true" />}
            {g.label}
          </p>
          {g.hits.map(({ item }) => {
            index += 1;
            const i = index;
            return (
              <div
                key={item.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="st-search-option"
                data-setting-result={item.id}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(item)}
              >
                <span className="st-search-title">{item.title}</span>
                <span className="st-search-crumbs">{crumbText(item)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div ref={wrapRef} className={`st-search st-search-${variant}`} data-testid={`settings-search-${variant}`} data-ready={items ? '' : undefined}>
      <label className="sr-only" htmlFor={`st-search-${uid}`}>
        {t('label')}
      </label>
      <input
        ref={inputRef}
        id={`st-search-${uid}`}
        className="input st-search-input"
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && flat.length ? `${listId}-${active}` : undefined}
        aria-keyshortcuts="/ Meta+F Control+F"
        placeholder={t('placeholder')}
        value={q}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
      />
      {(shown || hint) && <div className={variant === 'header' ? 'st-search-pop' : 'st-search-inline'}>{body}</div>}
    </div>
  );
}
