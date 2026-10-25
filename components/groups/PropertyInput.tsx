'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CascadeNode, FileValue, PropertyDef } from '@/lib/groups';
import { propertyText } from '@/lib/groups-rules';
import { useErrorText } from './ui';

/** Sube un archivo con /api/groups/upload. Devuelve { url, name } o un código de error. */
export async function uploadFile(file: File): Promise<{ value: FileValue; error: null } | { value: null; error: string }> {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/groups/upload', { method: 'POST', body: form });
    const data = (await res.json().catch(() => ({}))) as { url?: string; filename?: string; mimetype?: string; error?: string };
    if (!res.ok || !data.url) return { value: null, error: data.error ?? 'upload_failed' };
    return { value: { url: data.url, name: data.filename ?? file.name }, error: null };
  } catch {
    return { value: null, error: 'network_error' };
  }
}

/**
 * Campo para editar una propiedad propia (chats y tickets) según su tipo:
 * texto, número, opción, multiselección, fecha, casilla, URL, archivo y
 * desplegable dependiente (cada nivel aparece al elegir el anterior).
 */
export default function PropertyInput({
  def,
  value,
  onChange,
  disabled = false,
}: {
  def: PropertyDef;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState('');
  const label = `${def.label}${def.required ? ' *' : ''}`;

  if (def.type === 'checkbox') {
    return (
      <label className="gr-check-label">
        <input type="checkbox" className="ui-check" checked={value === 'true' || value === true} onChange={(e) => onChange(e.target.checked ? 'true' : '')} disabled={disabled} />
        {label}
      </label>
    );
  }

  let control;
  if (def.type === 'select') {
    control = (
      <select className="select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{t('props.none')}</option>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (def.type === 'multiselect') {
    const list = Array.isArray(value) ? value.map(String) : [];
    control = (
      <span className="gr-multi" role="group" aria-label={def.label}>
        {def.options.map((o) => {
          const on = list.includes(o);
          return (
            <button
              key={o}
              type="button"
              className={`gr-multi-opt${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}
            >
              {o}
            </button>
          );
        })}
      </span>
    );
  } else if (def.type === 'cascade') {
    const path = Array.isArray(value) ? value.map(String) : [];
    const levels: CascadeNode[][] = [def.tree ?? []];
    for (let i = 0; i < path.length && i < 2; i++) {
      const hit = levels[i].find((n) => n.label === path[i]);
      if (hit?.children?.length) levels.push(hit.children);
      else break;
    }
    control = (
      <span className="gr-cascade">
        {levels.map((opts, i) => (
          <select
            key={i}
            className="select"
            value={path[i] ?? ''}
            disabled={disabled}
            aria-label={i === 0 ? def.label : t('props.level', { n: i + 1, name: def.label })}
            onChange={(e) => onChange(e.target.value ? [...path.slice(0, i), e.target.value] : path.slice(0, i))}
          >
            <option value="">{t('props.none')}</option>
            {opts.map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
      </span>
    );
  } else if (def.type === 'file') {
    const f = value && typeof value === 'object' && !Array.isArray(value) ? (value as FileValue) : null;
    control = (
      <span className="gr-file-prop">
        {f ? (
          <>
            <a href={f.url} target="_blank" rel="noreferrer">
              {f.name}
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} disabled={disabled}>
              {t('common.remove')}
            </button>
          </>
        ) : (
          <input
            type="file"
            aria-label={def.label}
            disabled={disabled || uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setUploading(true);
              setFileError('');
              const res = await uploadFile(file);
              setUploading(false);
              if (res.value) onChange(res.value);
              else setFileError(errText(res.error));
            }}
          />
        )}
        {uploading && <span className="ui-help">{t('common.loading')}</span>}
        {fileError && <span className="ui-error">{fileError}</span>}
      </span>
    );
  } else {
    control = (
      <input
        className="input"
        type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'url' ? 'url' : 'text'}
        value={String(value ?? '')}
        placeholder={def.type === 'url' ? 'https://' : undefined}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }

  // Multiselección y dependiente tienen varios controles: van en un grupo, no en un <label>.
  if (def.type === 'multiselect' || def.type === 'cascade') {
    return (
      <div className="ui-field">
        <span className="label">{label}</span>
        {control}
      </div>
    );
  }
  return (
    <label className="ui-field">
      <span className="label">{label}</span>
      {control}
    </label>
  );
}

/** Texto corto de un valor (tablas, chips). */
export function PropertyValueText({ def, value }: { def: PropertyDef; value: unknown }) {
  const t = useTranslations('groups');
  if (def.type === 'checkbox') return <>{value === 'true' ? t('props.yes') : ''}</>;
  if (def.type === 'file' && value && typeof value === 'object') {
    const f = value as FileValue;
    return (
      <a href={f.url} target="_blank" rel="noreferrer">
        {f.name}
      </a>
    );
  }
  return <>{propertyText(value, def.type)}</>;
}

/** Valores posibles para filtrar por una propiedad (vacío: se escribe a mano). */
export function filterOptions(def: PropertyDef): string[] {
  if (def.type === 'select' || def.type === 'multiselect') return def.options;
  if (def.type === 'checkbox') return ['true'];
  if (def.type === 'cascade') {
    const out: string[] = [];
    const walk = (nodes: CascadeNode[]) => {
      for (const n of nodes) {
        out.push(n.label);
        if (n.children) walk(n.children);
      }
    };
    walk(def.tree ?? []);
    return [...new Set(out)];
  }
  return [];
}
