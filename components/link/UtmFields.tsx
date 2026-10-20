'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UTM_FIELDS, type UtmField } from '@/lib/link-url';
import type { UtmTemplateDto } from '@/lib/link-utm-templates';

export type UtmDraft = Record<UtmField, string>;

export const EMPTY_UTM: UtmDraft = { source: '', medium: '', campaign: '', term: '', content: '' };

const KEYS: Record<UtmField, string> = {
  source: 'utmSource',
  medium: 'utmMedium',
  campaign: 'utmCampaign',
  term: 'utmTerm',
  content: 'utmContent',
};

/** Valores de una plantilla como borrador del editor (null → ''). */
export function templateDraft(tpl: Pick<UtmTemplateDto, 'utm'>): UtmDraft {
  const out = { ...EMPTY_UTM };
  for (const f of UTM_FIELDS) out[f] = tpl.utm[f] ?? '';
  return out;
}

interface UtmFieldsProps {
  idPrefix: string;
  value: UtmDraft;
  onChange: (field: UtmField, value: string) => void;
  /** Aplicar una plantilla reemplaza los cinco campos de una vez. */
  onApply: (draft: UtmDraft) => void;
  disabled?: boolean;
}

/**
 * Los cinco utm_* y las plantillas del workspace: elegir una completa los
 * campos; "Guardar como plantilla" guarda los valores actuales con un nombre.
 */
export default function UtmFields({ idPrefix, value, onChange, onApply, disabled }: UtmFieldsProps) {
  const t = useTranslations('link');
  const [templates, setTemplates] = useState<UtmTemplateDto[]>([]);
  const [picked, setPicked] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/links/utm-templates')
      .then((r) => (r.ok ? (r.json() as Promise<{ templates: UtmTemplateDto[] }>) : null))
      .then((data) => {
        if (alive && data) setTemplates(data.templates);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const hasValues = UTM_FIELDS.some((f) => value[f].trim());

  function pick(id: string) {
    setPicked(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl) onApply(templateDraft(tpl));
  }

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/links/utm-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), ...value }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const tpl = (await res.json()) as UtmTemplateDto;
      setTemplates((prev) => [...prev, tpl].sort((a, b) => a.name.localeCompare(b.name)));
      setPicked(tpl.id);
      setNaming(false);
      setName('');
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`utmTemplates.errors.${code}`) ? t(`utmTemplates.errors.${code}`) : t('errors.generic'));
  }

  async function remove() {
    const tpl = templates.find((x) => x.id === picked);
    if (!tpl || !window.confirm(t('utmTemplates.removeConfirm', { name: tpl.name }))) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/links/utm-templates/${tpl.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.status === 204) {
      setTemplates((prev) => prev.filter((x) => x.id !== tpl.id));
      setPicked('');
    } else {
      setError(t(res?.status === 403 ? 'utmTemplates.errors.forbidden' : 'errors.generic'));
    }
  }

  return (
    <>
      <div className="lk-utm-templates">
        <label className="lk-inline-field">
          <span className="label">{t('utmTemplates.label')}</span>
          <select
            className="select lk-select-auto"
            value={picked}
            onChange={(e) => pick(e.target.value)}
            disabled={disabled || templates.length === 0}
          >
            <option value="">{templates.length === 0 ? t('utmTemplates.none') : t('utmTemplates.pick')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>
        {picked && (
          <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={remove} disabled={busy}>
            {t('utmTemplates.remove')}
          </button>
        )}
        {naming ? (
          <span className="lk-utm-save">
            <input
              className="input"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // Enter no puede mandar el formulario del link.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') setNaming(false);
              }}
              placeholder={t('utmTemplates.namePlaceholder')}
              aria-label={t('utmTemplates.nameLabel')}
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!name.trim() || busy} aria-busy={busy || undefined}>
              {t('utmTemplates.save')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNaming(false)}>
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setNaming(true)} disabled={disabled || !hasValues}>
            {t('utmTemplates.saveAs')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <div className="lk-utm">
        {UTM_FIELDS.map((field) => (
          <div className="ui-field" key={field}>
            <label className="label" htmlFor={`${idPrefix}-utm-${field}`}>
              {t(`new.${KEYS[field]}`)}
            </label>
            <input
              id={`${idPrefix}-utm-${field}`}
              className="input mono"
              type="text"
              maxLength={100}
              value={value[field]}
              onChange={(e) => onChange(field, e.target.value)}
              placeholder={t(`new.${KEYS[field]}Placeholder`)}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ))}
      </div>
    </>
  );
}
