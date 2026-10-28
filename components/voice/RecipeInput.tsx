'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { VoicePrompt } from '@/lib/voice-types';

export interface RecipeOption {
  id: string;
  name: string;
  /** Propio, del equipo o de fábrica. */
  origin: 'mine' | 'team' | 'builtin';
}

/** Recipes que puede correr la persona: los propios, los del equipo y los de fábrica. */
export function useRecipes(): RecipeOption[] {
  const tPrompts = useTranslations('voice.prompts');
  const raw = tPrompts.raw('recipes') as Record<string, { name: string }>;
  const builtin = useMemo(() => Object.entries(raw).map(([k, v]) => ({ id: `builtin:${k}`, name: v.name, origin: 'builtin' as const })), [raw]);
  const [own, setOwn] = useState<RecipeOption[]>([]);
  useEffect(() => {
    let alive = true;
    void fetch('/api/voice/prompts?kind=recipe')
      .then((r) => (r.ok ? (r.json() as Promise<{ prompts: VoicePrompt[] }>) : { prompts: [] }))
      .then((d) => alive && setOwn(d.prompts.map((p) => ({ id: p.id, name: p.name, origin: p.mine ? ('mine' as const) : ('team' as const) }))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => [...own, ...builtin], [own, builtin]);
}

/**
 * Campo de pregunta con recipes (como Granola): escribir "/" abre la lista
 * de recipes; flechas para elegir, Enter lo corre (lo que se escribe después
 * del nombre es el tema), Esc cierra.
 */
export default function RecipeInput({
  value,
  onChange,
  onAsk,
  onRecipe,
  placeholder,
  label,
  disabled,
  busy,
  submitLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onAsk: (question: string) => void;
  onRecipe: (recipe: RecipeOption, topic: string) => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  submitLabel: string;
}) {
  const t = useTranslations('voice.recipes');
  const recipes = useRecipes();
  const listId = useId();
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const slash = value.startsWith('/');
  const query = slash ? value.slice(1).trim().toLowerCase() : '';
  const matches = slash ? recipes.filter((r) => !query || r.name.toLowerCase().includes(query) || query.startsWith(r.name.toLowerCase())).slice(0, 8) : [];
  const open = slash && !closed && !disabled;

  useEffect(() => {
    setActive(0);
    setClosed(false);
  }, [value]);

  function run(r: RecipeOption) {
    const rest = value.slice(1).trim();
    const topic = rest.toLowerCase().startsWith(r.name.toLowerCase()) ? rest.slice(r.name.length).trim() : '';
    onRecipe(r, topic);
  }

  return (
    <form
      className="vc-ask vc-recipe-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || busy) return;
        if (open && matches[active]) return run(matches[active]);
        if (value.trim() && !slash) onAsk(value.trim());
      }}
    >
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={2000}
        data-voice-context="other"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setClosed(true);
          }
        }}
      />
      <button type="submit" className="btn btn-secondary" disabled={disabled || busy || !value.trim() || (slash && !matches.length)} aria-busy={busy || undefined}>
        {submitLabel}
      </button>
      {open && (
        <ul className="vc-recipe-menu" role="listbox" id={listId} aria-label={t('label')}>
          {matches.length === 0 ? (
            <li className="vc-muted vc-recipe-empty">{t('noMatch')}</li>
          ) : (
            matches.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`vc-recipe-option${i === active ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(r)}
              >
                <span>/{r.name}</span>
                <span className="vc-muted">{t(`origin.${r.origin}`)}</span>
              </li>
            ))
          )}
        </ul>
      )}
      {!value && <span className="sr-only">{t('hint')}</span>}
    </form>
  );
}
