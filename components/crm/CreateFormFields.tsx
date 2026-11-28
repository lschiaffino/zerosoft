'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { COMMON_CURRENCIES } from '@/lib/crm-constants';
import {
  builtinField,
  builtinLabelKey,
  type CreateFormEntity,
  type ResolvedCreateField,
} from '@/lib/crm-create-form-shared';
import { CUSTOM_PREFIX } from './formPayload';
import { useCrmOptions } from './CrmViewer';

export interface CreateFormOption {
  value: string;
  label: string;
}

/** Datos que piden algunas propiedades (empresa, contacto, owner, moneda, personas). */
export interface CreateFormContext {
  companies?: CreateFormOption[];
  /** null = cargando. */
  contacts?: CreateFormOption[] | null;
  people?: CreateFormOption[];
  me?: string;
  baseCurrency?: string;
  /** Empresa ya elegida (detalle de empresa): el select queda fijo. */
  fixedCompanyId?: string;
  /** Empresa preseleccionada que se puede cambiar (?companyId=). */
  defaultCompanyId?: string;
}

/** Lo que devuelve GET /api/crm/create-form. */
export interface CreateFormData {
  fields: ResolvedCreateField[];
  people: CreateFormOption[];
  me: string;
  baseCurrency: string;
  canEdit: boolean;
}

/** Carga el formulario de alta del objeto para quien lo abre. null mientras carga o si falla. */
export function useCreateForm(entity: CreateFormEntity): CreateFormData | null {
  const [data, setData] = useState<CreateFormData | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/create-form?entity=${entity}`)
      .then((r) => (r.ok ? (r.json() as Promise<CreateFormData>) : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [entity]);
  return data;
}

/** Etiqueta de una propiedad del formulario (propia traducida o personalizada). */
export function useFieldLabel(entity: CreateFormEntity): (key: string, custom?: { label: string }) => string {
  const t = useTranslations('crm');
  return (key, custom) => custom?.label ?? (t.has(builtinLabelKey(entity, key)) ? t(builtinLabelKey(entity, key)) : key);
}

/** Resumen de "Más campos": las primeras etiquetas. */
export function useMoreHint(entity: CreateFormEntity, more: ReadonlyArray<ResolvedCreateField>): string {
  const label = useFieldLabel(entity);
  const names = more.slice(0, 5).map((f) => label(f.key, f.custom));
  return more.length > 5 ? `${names.join(', ')}…` : names.join(', ');
}

/**
 * Mensaje de obligatorias vacías: "Completá: Monto, Plan". `labels` trae las
 * etiquetas de las personalizadas que manda la ruta.
 */
export function useMissingMessage(entity: CreateFormEntity) {
  const t = useTranslations('crm');
  const label = useFieldLabel(entity);
  return (keys: string[], fields: ReadonlyArray<ResolvedCreateField> = [], labels: Record<string, string> = {}) =>
    t('createForm.missing', {
      fields: keys
        .map((k) => labels[k] ?? label(k, fields.find((f) => f.key === k)?.custom))
        .join(', '),
    });
}

/** Lee el error de la ruta de alta: obligatorias que faltan (o null si es otro error). */
export function missingFromResponse(data: unknown): { fields: string[]; labels: Record<string, string> } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { error?: unknown; fields?: unknown; labels?: unknown };
  if (d.error !== 'missing_required' || !Array.isArray(d.fields)) return null;
  const labels = d.labels && typeof d.labels === 'object' ? (d.labels as Record<string, string>) : {};
  return { fields: d.fields.filter((f): f is string => typeof f === 'string'), labels };
}

interface CreateFormFieldsProps {
  entity: CreateFormEntity;
  fields: ReadonlyArray<ResolvedCreateField>;
  /** quick: modal de alta rápida (qm-field); full: formularios de página (ui-field). */
  variant: 'quick' | 'full';
  idPrefix: string;
  ctx?: CreateFormContext;
}

/**
 * Las propiedades configuradas del formulario de alta (Ajustes › Datos ›
 * Formulario de alta), en orden. Cada input lleva `name` = la clave (o
 * `custom.<name>`); createFormBody (formPayload.ts) arma el body.
 */
export default function CreateFormFields({ entity, fields, variant, idPrefix, ctx = {} }: CreateFormFieldsProps) {
  const t = useTranslations('crm');
  const crmOpts = useCrmOptions();
  const label = useFieldLabel(entity);
  const quick = variant === 'quick';
  const cls = (kind: 'input' | 'select' | 'textarea') => (quick ? undefined : kind);

  const field = (f: ResolvedCreateField) => {
    const id = `${idPrefix}-${f.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const text = label(f.key, f.custom);
    const req = f.required;
    const reqProps = req ? { required: true, 'aria-required': true as const } : {};
    const caption = (
      <>
        {text}
        {f.custom?.type === 'currency' && f.custom.options[0] && <span className="muted"> ({f.custom.options[0]})</span>}
        {req && (
          <span className="crm-req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </>
    );
    const wrap = (control: ReactNode, opts: { help?: string } = {}) =>
      quick ? (
        <label key={f.key} className="qm-field" htmlFor={id} data-testid={`create-field-${f.key}`}>
          <span>{caption}</span>
          {control}
          {opts.help && <span className="ui-help">{opts.help}</span>}
        </label>
      ) : (
        <div key={f.key} className="ui-field" data-testid={`create-field-${f.key}`}>
          <label className="label" htmlFor={id}>
            {caption}
          </label>
          {control}
          {opts.help && <p className="ui-help">{opts.help}</p>}
        </div>
      );
    const select = (options: CreateFormOption[], opts: { defaultValue?: string; empty?: string | null; disabled?: boolean } = {}) => (
      <select
        id={id}
        name={f.custom ? CUSTOM_PREFIX + f.custom.name : f.key}
        className={cls('select')}
        defaultValue={opts.defaultValue ?? ''}
        disabled={opts.disabled}
        {...reqProps}
      >
        {opts.empty !== null && <option value="">{opts.empty ?? '—'}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );

    if (f.custom) {
      const c = f.custom;
      const name = CUSTOM_PREFIX + c.name;
      const help = c.description || undefined;
      if (c.type === 'boolean') {
        return (
          <label key={f.key} className={quick ? 'qm-check' : 'ui-check ui-field-check'} htmlFor={id} data-testid={`create-field-${f.key}`}>
            <input id={id} name={name} type="checkbox" />
            <span>{c.label}</span>
          </label>
        );
      }
      if (c.type === 'multiselect') {
        return (
          <fieldset key={f.key} className={`${quick ? 'qm-field' : 'ui-field'} crm-cf-multi`} data-testid={`create-field-${f.key}`}>
            <legend className={quick ? undefined : 'label'}>{caption}</legend>
            {c.options.map((opt, i) => (
              <label key={opt} className="ui-check" htmlFor={`${id}-${i}`}>
                <input id={`${id}-${i}`} name={name} type="checkbox" value={opt} />
                <span>{opt}</span>
              </label>
            ))}
          </fieldset>
        );
      }
      if (c.type === 'select') return wrap(select(c.options.map((o) => ({ value: o, label: o }))), { help });
      if (c.type === 'user') return wrap(select(ctx.people ?? []), { help });
      const type =
        c.type === 'number' || c.type === 'currency'
          ? 'number'
          : c.type === 'date'
            ? 'date'
            : c.type === 'url'
              ? 'url'
              : c.type === 'phone'
                ? 'tel'
                : 'text';
      return wrap(
        <input
          id={id}
          name={name}
          className={cls('input')}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          inputMode={c.type === 'url' ? 'url' : undefined}
          placeholder={c.type === 'url' ? 'https://' : undefined}
          maxLength={type === 'text' || type === 'url' || type === 'tel' ? 500 : undefined}
          {...reqProps}
        />,
        { help },
      );
    }

    const def = builtinField(entity, f.key);
    if (!def) return null;
    switch (def.input) {
      case 'select': {
        // Lifecycle, lead status y deal type: las opciones activas del workspace (Ajustes › Datos › Opciones).
        const optionProp = def.enumKey === 'lifecycle' || def.enumKey === 'leadStatus' || def.enumKey === 'dealType' ? def.enumKey : null;
        return wrap(
          select(
            optionProp
              ? crmOpts.choices(optionProp)
              : (def.options ?? []).map((v) => ({ value: v, label: t(`enums.${def.enumKey}.${v}`) })),
            def.defaultValue ? { defaultValue: def.defaultValue, empty: null } : {},
          ),
        );
      }
      case 'company':
        return wrap(
          select(ctx.companies ?? [], {
            defaultValue: ctx.fixedCompanyId ?? ctx.defaultCompanyId,
            empty: t('contacts.form.noCompany'),
            disabled: !!ctx.fixedCompanyId,
          }),
        );
      case 'contact':
        return wrap(
          select(ctx.contacts ?? [], {
            empty: ctx.contacts === null ? t('record.loading') : t('record.form.noContact'),
          }),
        );
      case 'owner':
        return wrap(select(ctx.people ?? [], { defaultValue: ctx.me, empty: null }));
      case 'currency': {
        const base = (ctx.baseCurrency || 'USD').toUpperCase();
        const codes = COMMON_CURRENCIES.includes(base as (typeof COMMON_CURRENCIES)[number])
          ? [...COMMON_CURRENCIES]
          : [base, ...COMMON_CURRENCIES];
        return wrap(select(codes.map((c) => ({ value: c, label: c })), { defaultValue: base, empty: null }));
      }
      case 'textarea':
        return wrap(<textarea id={id} name={f.key} className={cls('textarea')} rows={3} maxLength={5000} {...reqProps} />);
      default: {
        const type = def.input === 'tel' ? 'tel' : def.input === 'url' ? 'url' : def.input === 'number' ? 'number' : def.input === 'date' ? 'date' : 'text';
        return wrap(
          <input
            id={id}
            name={f.key}
            className={cls('input')}
            type={type}
            min={type === 'number' ? 0 : undefined}
            step={type === 'number' ? (f.key === 'employees' ? 1 : 'any') : undefined}
            inputMode={type === 'url' ? 'url' : type === 'number' ? 'decimal' : undefined}
            placeholder={type === 'url' ? 'https://' : undefined}
            maxLength={type === 'text' || type === 'url' || type === 'tel' ? 500 : undefined}
            {...reqProps}
          />,
        );
      }
    }
  };

  return <>{fields.map(field)}</>;
}
