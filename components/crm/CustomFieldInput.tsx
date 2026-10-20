'use client';

import { fieldCurrency } from '@/lib/crm-custom-fields';
import { CUSTOM_PREFIX, type CustomFieldDef } from './formPayload';

/** Un campo propio dentro de un formulario de alta (nombre `custom.<name>`). */
export default function CustomFieldInput({ field, idPrefix }: { field: CustomFieldDef; idPrefix: string }) {
  const id = `${idPrefix}-custom-${field.name}`;
  const name = CUSTOM_PREFIX + field.name;

  if (field.type === 'boolean') {
    return (
      <label className="ui-check ui-field-check" htmlFor={id}>
        <input id={id} name={name} type="checkbox" />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === 'multiselect') {
    return (
      <fieldset className="ui-field crm-cf-multi">
        <legend className="label">{field.label}</legend>
        {field.options.map((opt, i) => (
          <label key={opt} className="ui-check" htmlFor={`${id}-${i}`}>
            <input id={`${id}-${i}`} name={name} type="checkbox" value={opt} />
            <span>{opt}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  const choices =
    field.type === 'select'
      ? field.options.map((o) => ({ value: o, label: o }))
      : field.type === 'user'
        ? (field.choices ?? [])
        : null;

  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {field.label}
        {field.type === 'currency' && <span className="muted"> ({fieldCurrency(field)})</span>}
      </label>
      {choices ? (
        <select id={id} name={name} className="select" defaultValue="">
          <option value="">—</option>
          {choices.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={name}
          className="input"
          type={
            field.type === 'number' || field.type === 'currency'
              ? 'number'
              : field.type === 'date'
                ? 'date'
                : field.type === 'url'
                  ? 'url'
                  : field.type === 'phone'
                    ? 'tel'
                    : 'text'
          }
          inputMode={field.type === 'url' ? 'url' : undefined}
          placeholder={field.type === 'url' ? 'https://' : undefined}
          step={field.type === 'number' || field.type === 'currency' ? 'any' : undefined}
        />
      )}
    </div>
  );
}
