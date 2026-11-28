'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import {
  MAX_OPTION_LABEL,
  OPTION_PROPERTIES,
  type OptionProperty,
  type OptionSets,
  type PropertyOption,
} from '@/lib/crm-property-options-shared';

type Usage = Record<OptionProperty, Record<string, number>>;

/**
 * Ajustes › Datos › Opciones de Lifecycle stage y Lead status, como "Edit
 * property" de HubSpot: agregar, renombrar (Enter guarda, Esc vuelve),
 * ordenar con ↑ ↓ y archivar o restaurar. Archivar no borra: los registros
 * que la tienen la siguen mostrando, solo deja de ofrecerse. Solo owner y
 * admins editan; el resto la ve.
 */
export function PropertyOptionsPanel({ initial, usage: initialUsage, canEdit }: { initial: OptionSets; usage: Usage; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [sets, setSets] = useState(initial);
  const [usage, setUsage] = useState(initialUsage);
  const [drafts, setDrafts] = useState<Record<OptionProperty, string>>({ lifecycle: '', leadStatus: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const builtinName = (prop: OptionProperty, v: string) => (t.has(`enums.${prop}.${v}`) ? t(`enums.${prop}.${v}`) : v);
  const nameOf = (prop: OptionProperty, o: PropertyOption) => o.label || builtinName(prop, o.value);

  async function send(prop: OptionProperty, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/property-options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ property: prop, ...body }),
    }).catch(() => null);
    setBusy(false);
    const data = (await res?.json().catch(() => null)) as { options?: PropertyOption[]; usage?: Record<string, number>; error?: string } | null;
    if (!res?.ok || !data?.options) {
      const code = data?.error;
      setError(code && t.has(`propertyOptions.errors.${code}`) ? t(`propertyOptions.errors.${code}`) : t('errors.generic'));
      return false;
    }
    setSets((s) => ({ ...s, [prop]: data.options! }));
    if (data.usage) setUsage((u) => ({ ...u, [prop]: data.usage! }));
    // Selectores, filtros y nombres del resto del CRM toman las opciones nuevas.
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent, prop: OptionProperty) {
    e.preventDefault();
    const label = drafts[prop].trim();
    if (!label) return;
    if (await send(prop, { action: 'add', label })) setDrafts((d) => ({ ...d, [prop]: '' }));
  }

  function move(prop: OptionProperty, value: string, delta: number) {
    // Se ordenan las activas; las archivadas quedan al final.
    const values = sets[prop].filter((o) => !o.archived).map((o) => o.value);
    const i = values.indexOf(value);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= values.length) return;
    [values[i], values[j]] = [values[j], values[i]];
    void send(prop, { action: 'reorder', values: [...values, ...sets[prop].filter((o) => o.archived).map((o) => o.value)] });
  }

  return (
    <div className="prop-options" data-testid="property-options">
      {OPTION_PROPERTIES.map((prop) => {
        const options = sets[prop];
        const active = options.filter((o) => !o.archived);
        const archived = options.filter((o) => o.archived);
        const title = t(`propertyOptions.properties.${prop}`);
        const row = (o: PropertyOption) => {
          const name = nameOf(prop, o);
          const count = usage[prop]?.[o.value] ?? 0;
          const idx = active.indexOf(o);
          return (
            <li key={o.value} className={`prop-options-row${o.archived ? ' is-archived' : ''}`} data-testid={`option-${prop}-${o.value}`}>
              <input
                key={`${o.value}:${name}`}
                className="input"
                defaultValue={name}
                aria-label={t('propertyOptions.nameOf', { name })}
                maxLength={MAX_OPTION_LABEL}
                disabled={!canEdit || busy || o.archived}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== name) void send(prop, { action: 'update', value: o.value, label: v });
                  else if (!v && o.builtin && o.label) void send(prop, { action: 'update', value: o.value, label: '' });
                  else if (!v) e.target.value = name;
                }}
                onKeyDown={(e) => {
                  const el = e.target as HTMLInputElement;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    el.blur();
                  }
                  if (e.key === 'Escape') {
                    el.value = name;
                    el.blur();
                  }
                }}
              />
              {canEdit ? <span className="prop-options-count muted">{t('propertyOptions.records', { count })}</span> : <span />}
              <span className="prop-options-tools">
                {canEdit && !o.archived && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(prop, o.value, -1)}
                      disabled={busy || idx <= 0}
                      aria-label={`${t('settings.moveUp')}: ${name}`}
                      title={t('settings.moveUp')}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => move(prop, o.value, 1)}
                      disabled={busy || idx === active.length - 1}
                      aria-label={`${t('settings.moveDown')}: ${name}`}
                      title={t('settings.moveDown')}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                  </>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void send(prop, { action: 'update', value: o.value, archived: !o.archived })}
                    disabled={busy || (!o.archived && active.length <= 1)}
                    aria-label={`${t(o.archived ? 'propertyOptions.restore' : 'propertyOptions.archive')}: ${name}`}
                  >
                    {t(o.archived ? 'propertyOptions.restore' : 'propertyOptions.archive')}
                  </button>
                )}
              </span>
            </li>
          );
        };
        return (
          <section key={prop} className="prop-options-group" data-testid={`property-options-${prop}`} aria-labelledby={`prop-options-${prop}`}>
            <h3 className="prop-options-title" id={`prop-options-${prop}`}>
              {title}
            </h3>
            <ol className="prop-options-list">{active.map(row)}</ol>
            {archived.length > 0 && (
              <>
                <h4 className="prop-options-subtitle">{t('propertyOptions.archivedTitle')}</h4>
                <ul className="prop-options-list">{archived.map(row)}</ul>
              </>
            )}
            {canEdit && (
              <form className="prop-options-add" onSubmit={(e) => void add(e, prop)}>
                <input
                  className="input"
                  value={drafts[prop]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [prop]: e.target.value }))}
                  placeholder={t(`propertyOptions.placeholders.${prop}`)}
                  aria-label={t('propertyOptions.addLabel', { property: title })}
                  maxLength={MAX_OPTION_LABEL}
                  data-testid={`property-options-input-${prop}`}
                />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !drafts[prop].trim()}>
                  {t('propertyOptions.add')}
                </button>
              </form>
            )}
          </section>
        );
      })}
      {!canEdit && <p className="ui-help">{t('common.adminOnly')}</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Ajustes › Datos: lifecycle que avanza solo con los deals (Opportunity al crear, Customer al ganar). */
export function LifecycleAutoSetting({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [on, setOn] = useState(initial);

  async function save() {
    const res = await fetch('/api/crm/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycleAuto: on }),
    }).catch(() => null);
    if (!res?.ok) return t('errors.generic');
    router.refresh();
  }

  return (
    <FormSection
      setting="crm-lifecycle-auto"
      title={t('propertyOptions.autoTitle')}
      description={t('propertyOptions.autoDesc')}
      onSubmit={save}
      disabled={!canEdit}
      note={canEdit ? undefined : t('common.adminOnly')}
    >
      <label className="ui-switch">
        <input
          type="checkbox"
          role="switch"
          name="lifecycleAuto"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          disabled={!canEdit}
          data-testid="lifecycle-auto"
        />
        {t('propertyOptions.autoLabel')}
      </label>
    </FormSection>
  );
}
