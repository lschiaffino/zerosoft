'use client';

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

  return (
    <div className="ui-field">
      <label className="label" htmlFor={id}>
        {field.label}
      </label>
      {field.type === 'select' ? (
        <select id={id} name={name} className="select" defaultValue="">
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={name}
          className="input"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          step={field.type === 'number' ? 'any' : undefined}
        />
      )}
    </div>
  );
}
